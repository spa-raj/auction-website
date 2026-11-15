import { notificationsSchema } from '../../shared/notifications.js';
import { attachRealtime } from './realtime.js';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { z } from 'zod';
import { categories, createAuctionSchema, type Auction, type Bid } from '../../shared/auction.js';

const connectionString = process.env.DATABASE_URL ?? 'postgres://auction:auction@localhost:55432/auction_part_6';
const querySchema = z.object({
  q: z.string().trim().max(120).default(''),
  category: z.enum(categories).optional(),
  sort: z.enum(['newest', 'closing', 'price-asc', 'price-desc']).default('newest'),
});
// The selected demo user is supplied by the browser; it is not authentication.
const userIdSchema = z.coerce.number().int().min(1).max(10);
const slugSchema = z.string().regex(/^[a-z0-9-]{1,180}$/);
const auctionSelect = `SELECT a.slug, a.title, a.category, a.description, a.condition, a.location,
  a.starting_price_cents AS "startingPriceCents", a.closes_at AS "closesAt", a.created_at AS "createdAt",
  a.kicker, a.specs, json_build_object('id',u.id,'name',u.name) AS seller,
  COALESCE(top_bid.amount_cents,a.starting_price_cents) AS "currentAmountCents",
  (SELECT count(*)::int FROM bids WHERE auction_slug=a.slug) AS "bidCount",
  CASE WHEN top_bid.id IS NULL THEN NULL ELSE json_build_object('id',bu.id,'name',bu.name) END AS "currentBidder",
  CASE WHEN outcome.auction_slug IS NULL THEN NULL ELSE json_build_object(
    'status',outcome.status,'winner',CASE WHEN winner.id IS NULL THEN NULL ELSE json_build_object('id',winner.id,'name',winner.name) END,
    'winningAmountCents',outcome.winning_amount_cents,'finalizedAt',to_char(outcome.finalized_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) END AS "finalOutcome"
  FROM auctions a JOIN demo_users u ON u.id=a.seller_id
  LEFT JOIN LATERAL (SELECT id,bidder_id,amount_cents FROM bids WHERE auction_slug=a.slug ORDER BY amount_cents DESC,created_at,id LIMIT 1) top_bid ON true
  LEFT JOIN demo_users bu ON bu.id=top_bid.bidder_id
  LEFT JOIN auction_outcomes outcome ON outcome.auction_slug=a.slug
  LEFT JOIN demo_users winner ON winner.id=outcome.winner_id`;

export type Clock = () => Date;
type AuctionRow = Omit<Auction, 'closesAt' | 'createdAt' | 'ended'> & { closesAt: Date; createdAt: Date };
function auctionAt(auction: AuctionRow, now: Date): Auction {
  return { ...auction, closesAt: auction.closesAt.toISOString(), createdAt: auction.createdAt.toISOString(),
    ended: auction.finalOutcome !== null || now.getTime() >= auction.closesAt.getTime() };
}

export function buildApp({ clock = () => new Date(), databaseUrl = connectionString, redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:56379' }: { clock?: Clock; redisUrl?: string; databaseUrl?: string } = {}) {
  const app = Fastify({ logger: true, requestIdHeader: 'x-request-id', bodyLimit: 32_768, routerOptions: { maxParamLength: 180 } });
  const pool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 1000 });
  const realtime = attachRealtime(app, redisUrl);
  app.addHook('onRequest', async (request, reply) => { reply.header('x-request-id', request.id); });
  app.get('/api/health', async (request, reply) => {
    try {
      await pool.query('SELECT 1');
      const ready = realtime.ready();
      return reply.code(ready ? 200 : 503).send({ ok: ready, db: 'ok', redis: ready ? 'ok' : 'down', requestId: request.id });
    }
    catch (error) { request.log.error({ err: error }, 'database health check failed'); return reply.code(503).send({ ok: false, db: 'down', requestId: request.id }); }
  });
  app.get('/api/notifications', async (request, reply) => {
    const user = userIdSchema.safeParse(request.headers['x-demo-user-id']);
    if (!user.success) return reply.code(400).send({ message: 'Select a valid demo recipient.' });
    const result = await pool.query(`SELECT n.id,n.role,e.payload AS event FROM recipient_notifications n
      JOIN auction_outbox e ON e.event_id=n.event_id WHERE n.recipient_id=$1 AND n.dismissed_at IS NULL
      ORDER BY e.created_at,n.id LIMIT 50`, [user.data]);
    return notificationsSchema.parse({ notifications: result.rows });
  });
  app.post<{ Params: { id: string } }>('/api/notifications/:id/dismiss', async (request, reply) => {
    const user = userIdSchema.safeParse(request.headers['x-demo-user-id']);
    const id = z.uuid().safeParse(request.params.id);
    if (!user.success || !id.success) return reply.code(400).send({ message: 'Select a valid demo recipient and notification.' });
    const result = await pool.query(`UPDATE recipient_notifications SET dismissed_at=COALESCE(dismissed_at,clock_timestamp())
      WHERE id=$1 AND recipient_id=$2 RETURNING id`, [id.data,user.data]);
    if (!result.rowCount) return reply.code(404).send({ message: 'Notification not found for this participant.' });
    try { realtime.notificationsChanged(user.data); }
    catch (error) { request.log.error({ err: error }, 'Post-dismissal notification failed'); }
    return { dismissed: true };
  });
  app.get('/api/users', async () => ({ users: (await pool.query('SELECT id,name FROM demo_users ORDER BY id')).rows }));
  app.get('/api/auctions', async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ message: 'Invalid catalog filters.', issues: parsed.error.issues });
    const { q, category, sort } = parsed.data;
    const order = { newest: 'a.created_at DESC,a.slug', closing: 'a.closes_at ASC,a.slug', 'price-asc': '"currentAmountCents" ASC,a.slug', 'price-desc': '"currentAmountCents" DESC,a.slug' }[sort];
    const result = await pool.query<AuctionRow>(`${auctionSelect} WHERE
      ($1='' OR strpos(lower(a.title || ' ' || a.category || ' ' || a.kicker || ' ' || a.description),lower($1))>0)
      AND ($2::text IS NULL OR a.category=$2) ORDER BY ${order}`, [q, category ?? null]);
    const now = clock();
    return { auctions: result.rows.map(auction => auctionAt(auction, now)), serverTime: now.toISOString() };
  });
  app.get<{ Params: { slug: string } }>('/api/auctions/:slug', async (request, reply) => {
    if (!slugSchema.safeParse(request.params.slug).success) return reply.code(400).send({ message: 'Invalid auction identifier.' });
    const client = await pool.connect();
    try {
      // Wait for in-flight accepted bids before reporting a final winner.
      // The shared row lock keeps summary/history consistent without blocking other readers.
      await client.query('BEGIN');
      const locked = await client.query('SELECT slug FROM auctions WHERE slug=$1 FOR SHARE', [request.params.slug]);
      if (!locked.rowCount) return reply.code(404).send({ message: 'Auction not found.' });
      const result = await client.query<AuctionRow>(`${auctionSelect} WHERE a.slug=$1`, [request.params.slug]);
      if (!result.rows[0]) return reply.code(404).send({ message: 'Auction not found.' });
      const bids = await client.query<Bid>(`SELECT b.id, json_build_object('id',u.id,'name',u.name) AS bidder,
        b.amount_cents AS "amountCents", b.created_at AS "createdAt" FROM bids b JOIN demo_users u ON u.id=b.bidder_id
        WHERE b.auction_slug=$1 ORDER BY b.created_at DESC,b.id DESC`, [request.params.slug]);
      const now = clock();
      return { auction: auctionAt(result.rows[0], now), bids: bids.rows, serverTime: now.toISOString() };
    } finally {
      try { await client.query('ROLLBACK'); }
      finally { client.release(); }
    }
  });
  app.post('/api/auctions', async (request, reply) => {
    const input = createAuctionSchema.safeParse(request.body);
    const userId = userIdSchema.safeParse(request.headers['x-demo-user-id']);
    if (!input.success) return reply.code(400).send({ message: 'Please check the listing fields.', issues: input.error.issues });
    if (!userId.success) return reply.code(400).send({ message: 'Select a valid demo user before posting.' });
    const user = await pool.query('SELECT id FROM demo_users WHERE id=$1', [userId.data]);
    if (!user.rowCount) return reply.code(400).send({ message: 'The selected demo user does not exist.' });
    const a = input.data;
    const titleSlug = a.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0,110) || 'auction';
    const slug = `${titleSlug}-${randomUUID()}`;
    const result = await pool.query(`INSERT INTO auctions (slug,title,category,description,condition,location,starting_price_cents,seller_id,closes_at)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz WHERE $9::timestamptz > clock_timestamp() RETURNING slug`,
      [slug,a.title,a.category,a.description,a.condition,a.location,a.startingPriceCents,userId.data,a.closesAt]);
    if (!result.rowCount) return reply.code(400).send({ message: 'Choose a future closing time.' });
    return reply.code(201).header('location', `/api/auctions/${slug}`).send({ slug });
  });
  app.post<{Params:{slug:string}}>('/api/auctions/:slug/bids', async (request,reply) => {
    const user = userIdSchema.safeParse(request.headers['x-demo-user-id']);
    const input = z.object({amountCents:z.number().min(1).max(2_147_483_647).refine(Number.isInteger)}).safeParse(request.body);
    if (!slugSchema.safeParse(request.params.slug).success || !input.success || !user.success) return reply.code(400).send({message:'Select a valid demo user and enter a bid in whole cents.'});
    if (!(await pool.query('SELECT id FROM demo_users WHERE id=$1',[user.data])).rowCount) return reply.code(400).send({message:'Invalid demo user.'});
    const client = await pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      // Read the price in a subsequent statement: a SELECT that waited for
      // a row lock can otherwise retain its pre-wait snapshot.
      const locked = await client.query('SELECT slug FROM auctions WHERE slug=$1 FOR UPDATE', [request.params.slug]);
      if (!locked.rowCount) return reply.code(404).send({ message: 'Auction not found.' });
      const auction = (await client.query<AuctionRow>(`${auctionSelect} WHERE a.slug=$1`, [request.params.slug])).rows[0];
      const acceptedAt = clock();
      if (auction.finalOutcome !== null || acceptedAt.getTime() >= auction.closesAt.getTime()) return reply.code(409).send({ code: 'AUCTION_ENDED', message: 'This auction has ended.' });
      if (auction.seller.id === user.data) return reply.code(403).send({ message: 'You cannot bid on your own auction.' });
      const minimum = auction.currentAmountCents + 100;
      if (input.data.amountCents < minimum) return reply.code(409).send({
        code: 'BID_TOO_LOW',
        message: `Your bid is below the current minimum. Your bid must be at least ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minimum / 100)}.`,
        minimumBidCents: minimum,
      });
      // This single post-lock clock reading owns eligibility and the stored timestamp.
      await client.query(`INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ($1,$2,$3,$4)`,
        [request.params.slug, user.data, input.data.amountCents, acceptedAt]);
      await client.query('COMMIT');
      committed = true;
      try { realtime.changed(request.params.slug); }
      catch (error) { request.log.error({ err: error }, 'Post-commit notification failed'); }
      return reply.code(201).send({ accepted: true });
    } finally {
      try { if (!committed) await client.query('ROLLBACK'); }
      finally { client.release(); }
    }
  });
  app.addHook('onClose', async () => pool.end());
  return app;
}

import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { z } from 'zod';
import { categories, createAuctionSchema, type Auction, type Bid } from '../../shared/auction.js';

const connectionString = process.env.DATABASE_URL ?? 'postgres://auction:auction@localhost:55432/auction_part_2';
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
  a.closes_at <= clock_timestamp() AS ended
  FROM auctions a JOIN demo_users u ON u.id=a.seller_id
  LEFT JOIN LATERAL (SELECT id,bidder_id,amount_cents FROM bids WHERE auction_slug=a.slug ORDER BY amount_cents DESC,created_at,id LIMIT 1) top_bid ON true
  LEFT JOIN demo_users bu ON bu.id=top_bid.bidder_id`;

export function buildApp() {
  const app = Fastify({ logger: true, requestIdHeader: 'x-request-id', bodyLimit: 32_768, routerOptions: { maxParamLength: 180 } });
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 1000 });
  app.addHook('onRequest', async (request, reply) => { reply.header('x-request-id', request.id); });
  app.get('/api/health', async (request, reply) => {
    try { await pool.query('SELECT 1'); return { ok: true, db: 'ok', requestId: request.id }; }
    catch (error) { request.log.error({ err: error }, 'database health check failed'); return reply.code(503).send({ ok: false, db: 'down', requestId: request.id }); }
  });
  app.get('/api/users', async () => ({ users: (await pool.query('SELECT id,name FROM demo_users ORDER BY id')).rows }));
  app.get('/api/auctions', async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ message: 'Invalid catalog filters.', issues: parsed.error.issues });
    const { q, category, sort } = parsed.data;
    const order = { newest: 'a.created_at DESC,a.slug', closing: 'a.closes_at ASC,a.slug', 'price-asc': '"currentAmountCents" ASC,a.slug', 'price-desc': '"currentAmountCents" DESC,a.slug' }[sort];
    const result = await pool.query<Auction>(`${auctionSelect} WHERE
      ($1='' OR strpos(lower(a.title || ' ' || a.category || ' ' || a.kicker || ' ' || a.description),lower($1))>0)
      AND ($2::text IS NULL OR a.category=$2) ORDER BY ${order}`, [q, category ?? null]);
    return { auctions: result.rows, serverTime: new Date().toISOString() };
  });
  app.get<{ Params: { slug: string } }>('/api/auctions/:slug', async (request, reply) => {
    if (!slugSchema.safeParse(request.params.slug).success) return reply.code(400).send({ message: 'Invalid auction identifier.' });
    const result = await pool.query<Auction>(`${auctionSelect} WHERE a.slug=$1`, [request.params.slug]);
    if (!result.rows[0]) return reply.code(404).send({ message: 'Auction not found.' });
    const bids = await pool.query<Bid>(`SELECT b.id, json_build_object('id',u.id,'name',u.name) AS bidder,
      b.amount_cents AS "amountCents", b.created_at AS "createdAt" FROM bids b JOIN demo_users u ON u.id=b.bidder_id
      WHERE b.auction_slug=$1 ORDER BY b.created_at DESC,b.id DESC`, [request.params.slug]);
    return { auction: result.rows[0], bids: bids.rows, serverTime: new Date().toISOString() };
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
    // Sequential validation only. Simultaneous-bid protection is intentionally deferred to Part 3.
    const auction = (await pool.query<Auction>(`${auctionSelect} WHERE a.slug=$1`,[request.params.slug])).rows[0];
    if (!auction) return reply.code(404).send({message:'Auction not found.'});
    if (auction.ended) return reply.code(409).send({message:'This auction has ended.'});
    if (auction.seller.id === user.data) return reply.code(403).send({message:'You cannot bid on your own auction.'});
    const minimum = auction.currentAmountCents + 100;
    if (input.data.amountCents < minimum) return reply.code(409).send({message:`Your bid must be at least ${new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(minimum/100)}.`,minimumBidCents:minimum});
    const accepted = await pool.query(`INSERT INTO bids (auction_slug,bidder_id,amount_cents)
      SELECT $1,$2,$3 WHERE EXISTS (SELECT 1 FROM auctions WHERE slug=$1 AND closes_at>clock_timestamp()) RETURNING id`,[request.params.slug,user.data,input.data.amountCents]);
    if (!accepted.rowCount) return reply.code(409).send({message:'This auction has ended.'});
    return reply.code(201).send({accepted:true});
  });
  app.addHook('onClose', async () => pool.end());
  return app;
}

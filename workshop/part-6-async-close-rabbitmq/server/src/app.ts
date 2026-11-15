import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { database } from './db.js';
import { auctions, bids, notifications, outbox, users } from './schema.js';
import { readAuctions, type AuctionRow } from './auction-query.js';
import { notificationsSchema } from '../../shared/notifications.js';
import { attachRealtime } from './realtime.js';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { z } from 'zod';
import { categories, createAuctionSchema, type Auction } from '../../shared/auction.js';

const connectionString = process.env.DATABASE_URL ?? 'postgres://auction:auction@localhost:55432/auction_part_6';
const querySchema = z.object({
  q: z.string().trim().max(120).default(''),
  category: z.enum(categories).optional(),
  sort: z.enum(['newest', 'closing', 'price-asc', 'price-desc']).default('newest'),
});
// The selected demo user is supplied by the browser; it is not authentication.
const userIdSchema = z.coerce.number().int().min(1).max(10);
const slugSchema = z.string().regex(/^[a-z0-9-]{1,180}$/);
export type Clock = () => Date;
function auctionAt(auction: AuctionRow, now: Date): Auction {
  return { ...auction, closesAt: auction.closesAt.toISOString(), createdAt: auction.createdAt.toISOString(),
    ended: auction.finalOutcome !== null || now.getTime() >= auction.closesAt.getTime() };
}

export function buildApp({ clock = () => new Date(), databaseUrl = connectionString, redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:56379' }: { clock?: Clock; redisUrl?: string; databaseUrl?: string } = {}) {
  const app = Fastify({ logger: true, requestIdHeader: 'x-request-id', bodyLimit: 32_768, routerOptions: { maxParamLength: 180 } });
  const pool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 1000 });
  const db = database(pool);
  const realtime = attachRealtime(app, redisUrl);
  app.addHook('onRequest', async (request, reply) => { reply.header('x-request-id', request.id); });
  app.get('/api/health', async (request, reply) => {
    try {
      await db.select({ id: users.id }).from(users).limit(1);
      const ready = realtime.ready();
      return reply.code(ready ? 200 : 503).send({ ok: ready, db: 'ok', redis: ready ? 'ok' : 'down', requestId: request.id });
    }
    catch (error) { request.log.error({ err: error }, 'database health check failed'); return reply.code(503).send({ ok: false, db: 'down', requestId: request.id }); }
  });
  app.get('/api/notifications', async (request, reply) => {
    const user = userIdSchema.safeParse(request.headers['x-demo-user-id']);
    if (!user.success) return reply.code(400).send({ message: 'Select a valid demo recipient.' });
    const rows = await db.select({ id: notifications.id, role: notifications.role, event: outbox.payload })
      .from(notifications).innerJoin(outbox, eq(outbox.eventId, notifications.eventId))
      .where(and(eq(notifications.recipientId, user.data), isNull(notifications.dismissedAt)))
      .orderBy(asc(outbox.createdAt), asc(notifications.id)).limit(50);
    return notificationsSchema.parse({ notifications: rows });
  });
  app.post<{ Params: { id: string } }>('/api/notifications/:id/dismiss', async (request, reply) => {
    const user = userIdSchema.safeParse(request.headers['x-demo-user-id']);
    const id = z.uuid().safeParse(request.params.id);
    if (!user.success || !id.success) return reply.code(400).send({ message: 'Select a valid demo recipient and notification.' });
    const result = await db.update(notifications).set({ dismissedAt: sql`coalesce(${notifications.dismissedAt}, clock_timestamp())` })
      .where(and(eq(notifications.id, id.data), eq(notifications.recipientId, user.data))).returning({ id: notifications.id });
    if (!result.length) return reply.code(404).send({ message: 'Notification not found for this participant.' });
    try { realtime.notificationsChanged(user.data); }
    catch (error) { request.log.error({ err: error }, 'Post-dismissal notification failed'); }
    return { dismissed: true };
  });
  app.get('/api/users', async () => ({ users: await db.select().from(users).orderBy(asc(users.id)) }));
  app.get('/api/auctions', async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ message: 'Invalid catalog filters.', issues: parsed.error.issues });
    const { q, category, sort } = parsed.data;
    const result = await readAuctions(db, { q, category, sort });
    const now = clock();
    return { auctions: result.map(auction => auctionAt(auction, now)), serverTime: now.toISOString() };
  });
  app.get<{ Params: { slug: string } }>('/api/auctions/:slug', async (request, reply) => {
    if (!slugSchema.safeParse(request.params.slug).success) return reply.code(400).send({ message: 'Invalid auction identifier.' });
    const detail = await db.transaction(async tx => {
      // Shared lock waits for accepted bids and keeps summary/history coherent.
      const locked = await tx.select({ slug: auctions.slug }).from(auctions)
        .where(eq(auctions.slug, request.params.slug)).for('share');
      if (!locked.length) return null;
      const [auction] = await readAuctions(tx, { slug: request.params.slug });
      const history = await tx.select({ id: bids.id, bidder: { id: users.id, name: users.name },
        amountCents: bids.amountCents, createdAt: bids.createdAt }).from(bids)
        .innerJoin(users, eq(users.id, bids.bidderId)).where(eq(bids.auctionSlug, request.params.slug))
        .orderBy(desc(bids.createdAt), desc(bids.id));
      const now = clock();
      return { auction: auctionAt(auction, now), bids: history, serverTime: now.toISOString() };
    });
    if (!detail) return reply.code(404).send({ message: 'Auction not found.' });
    return detail;
  });
  app.post('/api/auctions', async (request, reply) => {
    const input = createAuctionSchema.safeParse(request.body);
    const userId = userIdSchema.safeParse(request.headers['x-demo-user-id']);
    if (!input.success) return reply.code(400).send({ message: 'Please check the listing fields.', issues: input.error.issues });
    if (!userId.success) return reply.code(400).send({ message: 'Select a valid demo user before posting.' });
    const user = await db.select({ id: users.id }).from(users).where(eq(users.id, userId.data));
    if (!user.length) return reply.code(400).send({ message: 'The selected demo user does not exist.' });
    const a = input.data;
    const titleSlug = a.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0,110) || 'auction';
    const slug = `${titleSlug}-${randomUUID()}`;
    const result = await db.insert(auctions).select(db.select({ slug: sql`${slug}`.as('slug'), title: sql`${a.title}`.as('title'),
      category: sql`${a.category}`.as('category'), description: sql`${a.description}`.as('description'), condition: sql`${a.condition}`.as('condition'),
      location: sql`${a.location}`.as('location'), startingPriceCents: sql`${a.startingPriceCents}`.as('startingPriceCents'), sellerId: sql`${userId.data}`.as('sellerId'),
      closesAt: sql`${a.closesAt}::timestamptz`.as('closesAt'), createdAt: sql`now()`.as('createdAt'), kicker: sql`''`.as('kicker'), specs: sql`'[]'::jsonb`.as('specs'),
    }).from(users).where(and(eq(users.id, userId.data), gt(sql`${a.closesAt}::timestamptz`, sql`clock_timestamp()`)))).returning({ slug: auctions.slug });
    if (!result.length) return reply.code(400).send({ message: 'Choose a future closing time.' });
    return reply.code(201).header('location', `/api/auctions/${slug}`).send({ slug });
  });
  app.post<{Params:{slug:string}}>('/api/auctions/:slug/bids', async (request,reply) => {
    const user = userIdSchema.safeParse(request.headers['x-demo-user-id']);
    const input = z.object({amountCents:z.number().min(1).max(2_147_483_647).refine(Number.isInteger)}).safeParse(request.body);
    if (!slugSchema.safeParse(request.params.slug).success || !input.success || !user.success) return reply.code(400).send({message:'Select a valid demo user and enter a bid in whole cents.'});
    if (!(await db.select({ id: users.id }).from(users).where(eq(users.id, user.data))).length) return reply.code(400).send({message:'Invalid demo user.'});
    const result = await db.transaction(async tx => {
      // Read price in a subsequent statement, with a fresh post-wait snapshot.
      const locked = await tx.select({ slug: auctions.slug }).from(auctions)
        .where(eq(auctions.slug, request.params.slug)).for('update');
      if (!locked.length) return { status: 404, body: { message: 'Auction not found.' } };
      const [auction] = await readAuctions(tx, { slug: request.params.slug });
      const acceptedAt = clock();
      if (auction.finalOutcome !== null || acceptedAt.getTime() >= auction.closesAt.getTime()) return { status: 409, body: { code: 'AUCTION_ENDED', message: 'This auction has ended.' } };
      if (auction.seller.id === user.data) return { status: 403, body: { message: 'You cannot bid on your own auction.' } };
      const minimum = auction.currentAmountCents + 100;
      if (input.data.amountCents < minimum) return { status: 409, body: {
        code: 'BID_TOO_LOW',
        message: `Your bid is below the current minimum. Your bid must be at least ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minimum / 100)}.`,
        minimumBidCents: minimum,
      } };
      // This single post-lock clock reading owns eligibility and the stored timestamp.
      await tx.insert(bids).values({ auctionSlug: request.params.slug, bidderId: user.data,
        amountCents: input.data.amountCents, createdAt: acceptedAt });
      return { status: 201, body: { accepted: true } };
    });
    if (result.status === 201) {
      // transaction() resolves only after COMMIT; never signal a rolled-back bid.
      try { realtime.changed(request.params.slug); }
      catch (error) { request.log.error({ err: error }, 'Post-commit notification failed'); }
    }
    return reply.code(result.status).send(result.body);
  });
  app.addHook('onClose', async () => pool.end());
  return app;
}

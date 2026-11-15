import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { closeDueAuctions } from './close-auctions.js';
import { buildApp } from './app.js';
import { detailSchema } from '../../shared/auction.js';
import { auctionClosedSchema } from '../../shared/auction-closed.js';

const schema = `close_${randomUUID().replaceAll('-', '')}`;
const baseUrl = process.env.DATABASE_URL ?? 'postgres://auction:auction@localhost:55432/auction_part_6_test';
const admin = new pg.Pool({ connectionString: baseUrl });
const databaseUrl = new URL(baseUrl);
databaseUrl.searchParams.set('options', `-c search_path=${schema}`);
const pool = new pg.Pool({ connectionString: databaseUrl.toString(), statement_timeout: 1500 });
const closing = Date.parse('2035-06-01T12:00:00.500Z');
const at = (offset = 0) => () => new Date(closing + offset);
const close = (offset = 0, batchSize = 25) => closeDueAuctions(pool, { clock: at(offset), batchSize });
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await pool.query(await readFile(new URL('../migrations/001_auctions.sql', import.meta.url), 'utf8'));
  await pool.query(await readFile(new URL('../migrations/002_auction_outcomes.sql', import.meta.url), 'utf8'));
  await pool.query('TRUNCATE auctions CASCADE');
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});
async function fixture(offset = 0) {
  const slug = `close-test-${randomUUID()}`;
  await pool.query(`INSERT INTO auctions (slug,title,category,description,condition,location,starting_price_cents,seller_id,closes_at)
    VALUES ($1,'Close test','GPUs','Worker fixture','Used','Austin',10000,1,$2)`, [slug, new Date(closing + offset)]);
  return slug;
}
async function result(slug: string) {
  return (await pool.query(`SELECT o.*, e.event_id, e.payload, e.published_at FROM auction_outcomes o
    JOIN auction_outbox e USING (auction_slug) WHERE auction_slug=$1`, [slug])).rows[0];
}
async function insertBid(client: pg.Pool | pg.PoolClient, slug: string, user = 2, amount = 10100) {
  await client.query('INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ($1,$2,$3,$4)',
    [slug,user,amount,new Date(closing - 1)]);
}
async function blockedBy(pid: number) {
  const until = Date.now() + 3000;
  while (Date.now() < until) {
    const found = await pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))`, [pid]);
    if (found.rowCount) return;
    await sleep(10);
  }
  throw new Error('Bid did not wait for auction row lock');
}

describe('authoritative auction close', () => {
  it('does not close early, closes exactly at the deadline, and stores a nullable no-bid result', async () => {
    const slug = await fixture();
    expect(await close(-1)).not.toContain(slug);
    expect(await result(slug)).toBeUndefined();
    expect(await close()).toContain(slug);
    const stored = await result(slug);
    expect(stored).toMatchObject({ status: 'no_bids', winner_id: null, winning_bid_id: null, winning_amount_cents: null, published_at: null });
    expect(stored.finalized_at.getTime()).toBe(closing);
    expect(auctionClosedSchema.parse(stored.payload).outcome).toEqual({ status: 'no_bids', winnerId: null, winningBidId: null, winningAmountCents: null });
  });

  it('selects the highest accepted bid, not the latest timestamp or the starting price', async () => {
    const slug = await fixture();
    await insertBid(pool, slug, 2, 10100);
    await insertBid(pool, slug, 3, 10500);
    await insertBid(pool, slug, 4, 10300);
    await close(1);
    const stored = await result(slug);
    expect(stored).toMatchObject({ status: 'sold', winner_id: 3, winning_amount_cents: 10500 });
    const event = auctionClosedSchema.parse(stored.payload);
    expect(event).toMatchObject({ eventId: stored.event_id, type: 'auction.closed', version: 1, sellerId: 1, auctionSlug: slug, closesAt: at()().toISOString() });
    expect(event.outcome).toMatchObject({ status: 'sold', winnerId: 3, winningAmountCents: 10500 });
    const before = JSON.stringify(stored);
    expect(await close(1000)).not.toContain(slug);
    expect(JSON.stringify(await result(slug))).toBe(before);
  });

  it('allows independent concurrent closers but records one outcome and event per auction', async () => {
    const slugs = await Promise.all(Array.from({ length: 12 }, () => fixture()));
    const results = await Promise.all(Array.from({ length: 4 }, () => close(1, 3)));
    const closed = results.flat();
    expect(new Set(closed).size).toBe(closed.length);
    expect(closed.sort()).toEqual(slugs.sort());
    expect((await pool.query('SELECT * FROM auction_outcomes WHERE auction_slug=ANY($1)', [slugs])).rowCount).toBe(12);
    expect((await pool.query('SELECT * FROM auction_outbox WHERE auction_slug=ANY($1)', [slugs])).rowCount).toBe(12);
    expect(await close(1)).toEqual([]);
  });

  it('skips a locked auction, processes another, then includes the pre-deadline bid after commit', async () => {
    const locked = await fixture(); const other = await fixture();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT slug FROM auctions WHERE slug=$1 FOR UPDATE', [locked]);
      await insertBid(client, locked);
      // If SKIP LOCKED is missing this times out instead of hanging the suite.
      const processed = await close(1);
      expect(processed).toContain(other); expect(processed).not.toContain(locked);
      expect(await result(locked)).toBeUndefined();
      await client.query('COMMIT');
      expect(await close(2)).toContain(locked);
      expect(await result(locked)).toMatchObject({ winner_id: 2, winning_amount_cents: 10100 });
    } finally { await client.query('ROLLBACK'); client.release(); }
  });

  it('rolls back the outcome when outbox insertion fails, and succeeds on retry', async () => {
    const slug = await fixture();
    await pool.query(`CREATE FUNCTION fail_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.auction_slug='${slug}' THEN RAISE EXCEPTION 'injected outbox failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_event BEFORE INSERT ON auction_outbox FOR EACH ROW EXECUTE FUNCTION fail_event()`);
    try {
      await expect(close()).rejects.toThrow('injected outbox failure');
      expect((await pool.query('SELECT 1 FROM auction_outcomes WHERE auction_slug=$1', [slug])).rowCount).toBe(0);
      expect((await pool.query('SELECT 1 FROM auction_outbox WHERE auction_slug=$1', [slug])).rowCount).toBe(0);
    } finally { await pool.query('DROP TRIGGER fail_event ON auction_outbox; DROP FUNCTION fail_event()'); }
    expect(await close()).toContain(slug);
  });

  it('enforces duplicate outcome and event uniqueness in PostgreSQL', async () => {
    const slug = await fixture(); await close();
    await expect(pool.query(`INSERT INTO auction_outcomes SELECT * FROM auction_outcomes WHERE auction_slug=$1`, [slug]))
      .rejects.toMatchObject({ code: '23505' });
    await expect(pool.query(`INSERT INTO auction_outbox SELECT $2::uuid,auction_slug,event_type,event_version,payload,created_at,published_at
      FROM auction_outbox WHERE auction_slug=$1`, [slug, randomUUID()])).rejects.toMatchObject({ code: '23505' });
  });

  it('bounds batches and drains the oldest overdue auctions first', async () => {
    const newer = await fixture(-10); const oldest = await fixture(-100); const future = await fixture(100);
    expect(await close(0, 1)).toEqual([oldest]);
    expect(await close(0, 1)).toEqual([newer]);
    expect(await close(0, 1)).toEqual([]);
    expect(await result(future)).toBeUndefined();
    await pool.query('DELETE FROM auctions WHERE slug=$1', [future]);
    await expect(closeDueAuctions(pool, { batchSize: 0 })).rejects.toThrow();
  });

  it('serves finalizing vs persisted outcomes and rejects bids against a finalized result even with an earlier clock', async () => {
    const slug = await fixture(); await insertBid(pool, slug);
    const app = buildApp({ databaseUrl: databaseUrl.toString(), clock: at(1) });
    const earlier = buildApp({ databaseUrl: databaseUrl.toString(), clock: at(-1) });
    try {
      expect(detailSchema.parse((await app.inject(`/api/auctions/${slug}`)).json()).auction).toMatchObject({ ended: true, finalOutcome: null });
      await close(1);
      const detail = detailSchema.parse((await app.inject(`/api/auctions/${slug}`)).json());
      expect(detail.auction.finalOutcome).toMatchObject({ status: 'sold', winner: { id: 2 }, winningAmountCents: 10100 });
      expect((await earlier.inject({ method: 'POST', url: `/api/auctions/${slug}/bids`, headers: { 'x-demo-user-id': '3' }, payload: { amountCents: 10200 } })).json()).toMatchObject({ code: 'AUCTION_ENDED' });
    } finally { await app.close(); await earlier.close(); }
  });

  it('rejects a queued bid checked at the deadline and finalizes without that bid', async () => {
    const slug = await fixture(); let now = closing - 1;
    const app = buildApp({ databaseUrl: databaseUrl.toString(), clock: () => new Date(now) });
    const locker = await pool.connect();
    const sendBid = () => app.inject({ method: 'POST', url: `/api/auctions/${slug}/bids`, headers: { 'x-demo-user-id': '2' }, payload: { amountCents: 10100 } }).then(r => r);
    let pending: ReturnType<typeof sendBid> | undefined;
    try {
      await app.ready();
      await locker.query('BEGIN');
      await locker.query('SELECT slug FROM auctions WHERE slug=$1 FOR UPDATE', [slug]);
      const pid = (await locker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
      pending = sendBid();
      const response = pending.then(r => r);
      await blockedBy(pid);
      expect(await close(1)).not.toContain(slug);
      now = closing;
      await locker.query('COMMIT');
      expect((await response).json()).toMatchObject({ code: 'AUCTION_ENDED' });
      expect(await close(1)).toContain(slug);
      expect(await result(slug)).toMatchObject({ status: 'no_bids' });
    } finally { await locker.query('ROLLBACK'); locker.release(); await pending; await app.close(); }
  });
});

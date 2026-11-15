import { afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { buildApp } from './app.js';
import { detailSchema, listSchema } from '../../shared/auction.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://auction:auction@localhost:55432/auction_part_5' });
const created: string[] = [];
// Millisecond precision catches accidental Date-to-string truncation, too.
const closing = Date.parse('2035-06-01T12:00:00.500Z');
async function fixture(closesAt = closing) {
  const slug = `closing-test-${randomUUID()}`;
  await pool.query(`INSERT INTO auctions
    (slug,title,category,description,condition,location,starting_price_cents,seller_id,closes_at)
    VALUES ($1,'Closing test','GPUs','Deadline fixture','Used','Austin',10000,1,$2)`, [slug, new Date(closesAt)]);
  created.push(slug);
  return slug;
}
function bid(app: ReturnType<typeof buildApp>, slug: string) {
  return app.inject({ method: 'POST', url: `/api/auctions/${slug}/bids`,
    headers: { 'x-demo-user-id': '2' }, payload: { amountCents: 10100 } }).then(response => response);
}
afterAll(async () => {
  await pool.query('DELETE FROM auctions WHERE slug=ANY($1::text[])', [created]);
  await pool.end();
});

describe('application-clock closing rules', () => {
  it.each([
    { offset: -1, status: 201, label: 'one millisecond before' },
    { offset: 0, status: 409, label: 'exactly at' },
    { offset: 1, status: 409, label: 'one millisecond after' },
  ])('checks a bid $label closing', async ({ offset, status }) => {
    const now = closing + offset;
    const clock = vi.fn(() => new Date(now));
    const app = buildApp({ clock });
    try {
      const slug = await fixture();
      const response = await bid(app, slug);
      expect(response.statusCode).toBe(status);
      expect(clock).toHaveBeenCalledTimes(1);
      const stored = await pool.query<{ created_at: Date }>('SELECT created_at FROM bids WHERE auction_slug=$1', [slug]);
      if (status === 201) {
        expect(stored.rows).toHaveLength(1);
        expect(stored.rows[0].created_at.getTime()).toBe(now);
      } else {
        expect(response.json()).toMatchObject({ code: 'AUCTION_ENDED' });
        expect(stored.rows).toHaveLength(0);
      }
      const detail = detailSchema.parse((await app.inject(`/api/auctions/${slug}`)).json());
      expect(detail.serverTime).toBe(new Date(now).toISOString());
      expect(detail.auction.ended).toBe(offset >= 0);
      const catalog = listSchema.parse((await app.inject('/api/auctions')).json());
      expect(catalog.serverTime).toBe(detail.serverTime);
      expect(catalog.auctions.find(a => a.slug === slug)?.ended).toBe(offset >= 0);
    } finally { await app.close(); }
  });

  it('uses the same reading for acceptance and timestamp even if the next reading would be after closing', async () => {
    const clock = vi.fn(() => new Date(closing + 1000)).mockReturnValueOnce(new Date(closing - 1));
    const app = buildApp({ clock });
    try {
      const slug = await fixture();
      expect((await bid(app, slug)).statusCode).toBe(201);
      expect(clock).toHaveBeenCalledTimes(1);
      const stored = await pool.query<{ created_at: Date }>('SELECT created_at FROM bids WHERE auction_slug=$1', [slug]);
      expect(stored.rows[0].created_at.getTime()).toBe(closing - 1);
      const detail = detailSchema.parse((await app.inject(`/api/auctions/${slug}`)).json());
      expect(detail.auction).toMatchObject({ ended: true, currentBidder: { id: 2 }, bidCount: 1 });
      expect(detail.bids[0].createdAt).toBe(new Date(closing - 1).toISOString());
    } finally { await app.close(); }
  });

  it('does not let the database wall clock override an eligible injected time', async () => {
    const historicalClosing = Date.parse('2000-01-01T00:00:00.500Z');
    const app = buildApp({ clock: () => new Date(historicalClosing - 1) });
    try {
      const slug = await fixture(historicalClosing);
      expect((await bid(app, slug)).statusCode).toBe(201);
      const detail = detailSchema.parse((await app.inject(`/api/auctions/${slug}`)).json());
      expect(detail.auction.ended).toBe(false);
      expect(detail.bids[0].createdAt).toBe('2000-01-01T00:00:00.499Z');
    } finally { await app.close(); }
  });

  it.each([0, 1])('reads the clock only after a lock wait, rejecting when it advances to closing + %i ms', async offset => {
    let now = closing - 1000;
    const clock = vi.fn(() => new Date(now));
    const app = buildApp({ clock });
    const locker = await pool.connect();
    let pending: ReturnType<typeof bid> | undefined;
    try {
      const slug = await fixture();
      await locker.query('BEGIN');
      await locker.query('SELECT slug FROM auctions WHERE slug=$1 FOR UPDATE', [slug]);
      const blockerPid = (await locker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = bid(app, slug);
      const until = Date.now() + 3000;
      let blocked = false;
      while (Date.now() < until) {
        const result = await pool.query<{ blocked: boolean }>(`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
          AND $1=ANY(pg_blocking_pids(pid))
          AND query LIKE '%FROM auctions%' AND query LIKE '%FOR UPDATE%') AS blocked`, [blockerPid]);
        if (result.rows[0].blocked) { blocked = true; break; }
        await sleep(10);
      }
      expect(blocked).toBe(true);
      expect(clock).not.toHaveBeenCalled();
      now = closing + offset;
      await locker.query('COMMIT');
      expect((await pending).statusCode).toBe(409);
      expect((await pending).json()).toMatchObject({ code: 'AUCTION_ENDED' });
      expect(clock).toHaveBeenCalledTimes(1);
      expect((await pool.query('SELECT 1 FROM bids WHERE auction_slug=$1', [slug])).rowCount).toBe(0);
      const detail = detailSchema.parse((await app.inject(`/api/auctions/${slug}`)).json());
      expect(detail.auction).toMatchObject({ ended: true, currentBidder: null, bidCount: 0 });
    } finally {
      try { await locker.query('ROLLBACK'); }
      finally {
        locker.release();
        await pending;
        await app.close();
      }
    }
  });

  it('waits for a pre-deadline accepted bid to commit before reporting the final winner', async () => {
    const app = buildApp({ clock: () => new Date(closing + 1) });
    const locker = await pool.connect();
    let pending: ReturnType<typeof bid> | undefined;
    try {
      const slug = await fixture();
      await locker.query('BEGIN');
      await locker.query('SELECT slug FROM auctions WHERE slug=$1 FOR UPDATE', [slug]);
      await locker.query('INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ($1,2,10100,$2)',
        [slug, new Date(closing - 1)]);
      const blockerPid = (await locker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = app.inject(`/api/auctions/${slug}`).then(response => response);
      const until = Date.now() + 3000;
      let blocked = false;
      while (Date.now() < until) {
        const result = await pool.query<{ blocked: boolean }>(`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
          AND $1=ANY(pg_blocking_pids(pid))
          AND query='SELECT slug FROM auctions WHERE slug=$1 FOR SHARE') AS blocked`, [blockerPid]);
        if (result.rows[0].blocked) { blocked = true; break; }
        await sleep(10);
      }
      expect(blocked).toBe(true);
      await locker.query('COMMIT');
      const detail = detailSchema.parse((await pending).json());
      expect(detail.auction).toMatchObject({ ended: true, currentBidder: { id: 2 }, bidCount: 1, currentAmountCents: 10100 });
      expect(detail.bids).toHaveLength(1);
      expect(detail.bids[0].createdAt).toBe(new Date(closing - 1).toISOString());
    } finally {
      try { await locker.query('ROLLBACK'); }
      finally {
        locker.release();
        await pending;
        await app.close();
      }
    }
  });

});

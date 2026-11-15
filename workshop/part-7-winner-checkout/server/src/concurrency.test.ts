import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { buildApp } from './app.js';
import { detailSchema } from '../../shared/auction.js';

const connectionString = process.env.DATABASE_URL ?? 'postgres://auction:auction@localhost:55432/auction_part_7?options=-csearch_path%3Dwinner_checkout';
const pool = new pg.Pool({ connectionString });
// Independent API pools prove that protection is in PostgreSQL, not one process.
const apps = [buildApp(), buildApp()];
const created: string[] = [];
async function auction() {
  const response = await apps[0].inject({ method: 'POST', url: '/api/auctions', headers: { 'x-demo-user-id': '1' }, payload: {
    title: `Concurrency ${randomUUID()}`, category: 'GPUs', description: 'Concurrency fixture', condition: 'Used',
    location: 'Austin', startingPriceCents: 10000, closesAt: new Date(Date.now() + 3600000).toISOString(),
  } });
  expect(response.statusCode).toBe(201);
  const slug = response.json<{ slug: string }>().slug;
  created.push(slug);
  return slug;
}
function bid(slug: string, amountCents: number, user: number) {
  return apps[user % apps.length].inject({ method: 'POST', url: `/api/auctions/${slug}/bids`,
    headers: { 'x-demo-user-id': String(user) }, payload: { amountCents } }).then(response => response);
}
async function detail(slug: string) {
  return detailSchema.parse((await apps[0].inject(`/api/auctions/${slug}`)).json());
}
async function waitForBlockedBids(count: number) {
  const until = Date.now() + 3000;
  while (Date.now() < until) {
    const result = await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock'
      AND query ILIKE '%from "auctions"%for update%'`);
    if (result.rows[0].count >= count) return;
    await sleep(10);
  }
  throw new Error(`Expected ${count} bids waiting for auction row locks`);
}
async function withLockedAuction(slug: string, run: (client: pg.PoolClient) => Promise<void>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT slug FROM auctions WHERE slug=$1 FOR UPDATE', [slug]);
    await run(client);
  } finally {
    try { await client.query('ROLLBACK'); }
    finally { client.release(); }
  }
}
afterAll(async () => {
  await pool.query('DELETE FROM auctions WHERE slug=ANY($1::text[])', [created]);
  await Promise.all(apps.map(app => app.close()));
  await pool.end();
});

describe('serialized bidding across API instances', () => {
  it('accepts exactly one equal bid and rejects the rest with the updated minimum', async () => {
    const slug = await auction();
    await withLockedAuction(slug, async client => {
      const pending = Promise.all([2, 3, 4].map(user => bid(slug, 10100, user)));
      try { await waitForBlockedBids(3); }
      finally { await client.query('COMMIT'); }
      const responses = await pending;
      expect(responses.map(r => r.statusCode).sort()).toEqual([201, 409, 409]);
      for (const response of responses.filter(r => r.statusCode === 409)) {
        expect(response.json()).toMatchObject({ code: 'BID_TOO_LOW', minimumBidCents: 10200 });
      }
    });
    const result = await detail(slug);
    expect(result.auction).toMatchObject({ currentAmountCents: 10100, bidCount: 1 });
    expect(result.bids).toHaveLength(1);
    // Rejections roll back and release locks; an explicit later bid succeeds.
    expect((await bid(slug, 10200, 5)).statusCode).toBe(201);
  });

  it('reads price committed during the lock wait, rather than the old snapshot', async () => {
    const slug = await auction();
    await withLockedAuction(slug, async client => {
      const pending = bid(slug, 10100, 3);
      try {
        await waitForBlockedBids(1);
        await client.query('INSERT INTO bids (auction_slug,bidder_id,amount_cents) VALUES ($1,2,10500)', [slug]);
      } finally { await client.query('COMMIT'); }
      const response = await pending;
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'BID_TOO_LOW', minimumBidCents: 10600 });
    });
    expect((await detail(slug)).bids.map(b => b.amountCents)).toEqual([10500]);
  });

  it('serializes different amounts without promising their arrival order', async () => {
    const slug = await auction();
    const responses = await Promise.all([bid(slug, 10100, 2), bid(slug, 10500, 3)]);
    expect(responses[1].statusCode).toBe(201);
    expect([201, 409]).toContain(responses[0].statusCode);
    const result = await detail(slug);
    expect(result.auction.currentAmountCents).toBe(10500);
    expect(result.auction.bidCount).toBe(responses.filter(r => r.statusCode === 201).length);
    expect(result.bids.map(b => b.amountCents)).toEqual(responses[0].statusCode === 201 ? [10500, 10100] : [10500]);
  });

  it('allows another auction to accept bids while this auction is locked', async () => {
    const first = await auction(); const second = await auction();
    await withLockedAuction(first, async client => {
      const pending = bid(first, 10100, 2);
      try {
        await waitForBlockedBids(1);
        expect((await bid(second, 10100, 3)).statusCode).toBe(201);
      } finally { await client.query('COMMIT'); }
      expect((await pending).statusCode).toBe(201);
    });
  });

  it('rolls back an insertion failure and permits a subsequent valid bid', async () => {
    const slug = await auction();
    const trigger = `fail_bid_${randomUUID().replaceAll('-', '')}`;
    try {
      await pool.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'injected test insert failure'; END $$;
        CREATE TRIGGER ${trigger} BEFORE INSERT ON bids FOR EACH ROW
        WHEN (NEW.auction_slug='${slug}') EXECUTE FUNCTION ${trigger}()`);
      expect((await bid(slug, 10100, 2)).statusCode).toBe(500);
      expect((await detail(slug)).bids).toHaveLength(0);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON bids; DROP FUNCTION IF EXISTS ${trigger}()`);
    }
    expect((await bid(slug, 10100, 3)).statusCode).toBe(201);
    expect((await detail(slug)).auction.bidCount).toBe(1);
  });
});

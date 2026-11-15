import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { buildApp } from './app.js';
import { buildStripeApp } from '../../stripe-service/src/app.js';
import { closeDueAuctions } from './close-auctions.js';

const schema = `payments_${randomUUID().replaceAll('-', '')}`;
const url = new URL(process.env.DATABASE_URL ?? 'postgres://auction:auction@localhost:55432/auction_part_7_test');
const admin = new pg.Pool({ connectionString: url.href });
url.searchParams.set('options', `-c search_path=${schema}`);
const pool = new pg.Pool({ connectionString: url.href });
const secret = 'payment_test_secret';
let app: ReturnType<typeof buildApp>;
const mock = buildStripeApp({ logger: false, baseUrl: 'http://mock.test', webhookSecret: secret,
  retryMs: 60_000, deliverWebhook: async (body, signature) => (await webhook(body, signature)).statusCode === 200 });
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  for (const file of ['001_auctions.sql', '002_auction_outcomes.sql', '003_recipient_notifications.sql', '004_purchases.sql']) {
    await pool.query(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  await pool.query('TRUNCATE auctions CASCADE');
  const address = await mock.listen({ port: 0, host: '127.0.0.1' });
  app = buildApp({ databaseUrl: url.href, payments: { stripeUrl: address, stripePublicUrl: 'http://mock.test', webUrl: 'http://market.test', webhookSecret: secret } });
});
afterAll(async () => { await app?.close(); await mock.close(); await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
async function fixture(sold = true) {
  const slug = `payment-${randomUUID()}`;
  await pool.query(`INSERT INTO auctions (slug,title,category,description,condition,location,starting_price_cents,seller_id,closes_at)
    VALUES ($1,'Payment GPU','GPUs','Checkout fixture','Used','Local',10000,1,clock_timestamp()-interval '1 second')`, [slug]);
  if (sold) await pool.query('INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ($1,2,12345,clock_timestamp()-interval \'2 seconds\')', [slug]);
  await closeDueAuctions(pool);
  return slug;
}
const checkout = (slug: string, user = '2', body: object = {}) => app.inject({ method: 'POST', url: `/api/auctions/${slug}/checkout`, headers: { 'x-demo-user-id': user }, payload: body });
const status = (slug: string, user = '2') => app.inject({ url: `/api/auctions/${slug}/purchase`, headers: { 'x-demo-user-id': user } });
const webhook = (body: string, signature = createHmac('sha256', secret).update(body).digest('hex')) => app.inject({ method: 'POST', url: '/api/webhooks/stripe', headers: { 'content-type': 'application/json', 'x-stripe-signature': signature }, payload: body });
async function session(slug: string) {
  const response = await checkout(slug); expect(response.statusCode).toBe(200);
  const id = new URL(response.json().url).pathname.split('/').at(-1)!;
  const purchase = (await status(slug)).json().purchase;
  return { id, purchase };
}
function event(id: string, purchase: { id: string; amountCents: number }) {
  return { eventId: randomUUID(), eventType: 'checkout.session.completed', occurredAt: new Date().toISOString(),
    data: { object: { id, object: 'checkout.session', status: 'complete', payment_status: 'paid', client_reference_id: purchase.id, amount_total: purchase.amountCents, currency: 'usd' } } };
}
const attempt = (id: string, cardNumber: string) => mock.inject({ method: 'POST', url: `/v1/checkout/sessions/${id}/attempt`, payload: { cardNumber, expiry: '12 / 39', cvc: '123' } });

describe('winner checkout and signed purchase completion', () => {
  it('creates purchases only for sold results and enforces winner eligibility', async () => {
    const slug = await fixture();
    for (const user of ['1', '3']) expect((await checkout(slug, user)).statusCode).toBe(403);
    expect((await checkout(slug, '11')).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/api/auctions/${slug}/checkout`, payload: {} })).statusCode).toBe(400);
    expect((await status(slug, '1')).statusCode).toBe(200);
    expect((await status(slug, '3')).statusCode).toBe(403);
    const noBid = await fixture(false);
    expect((await checkout(noBid)).statusCode).toBe(409);
    expect((await pool.query('SELECT * FROM purchases WHERE auction_slug=$1', [noBid])).rowCount).toBe(0);
    const live = `live-${randomUUID()}`;
    await pool.query(`INSERT INTO auctions (slug,title,category,description,condition,location,starting_price_cents,seller_id,closes_at)
      VALUES ($1,'Open GPU','GPUs','Open','Used','Local',10000,1,clock_timestamp()+interval '1 hour')`, [live]);
    expect((await checkout(live)).statusCode).toBe(409);
  });
  it('uses only the stored winning amount and fixed return URLs, rejecting tampering', async () => {
    const slug = await fixture();
    for (const body of [{ amountCents: 1 }, { winnerId: 3 }, { currency: 'eur' }, { success_url: 'https://evil.test' }, { purchaseId: randomUUID() }]) {
      expect((await checkout(slug, '2', body)).statusCode).toBe(400);
    }
    const { id, purchase } = await session(slug);
    expect(purchase.amountCents).toBe(12345);
    const page = await mock.inject(`/checkout/${id}`);
    expect(page.body).toContain('$123.45');
    expect(page.body).toContain(`http://market.test/items/${slug}?checkout=canceled`);
    const paid = await attempt(id, '4242424242424242');
    expect(paid.json().redirect_url).toBe(`http://market.test/items/${slug}?checkout=success&session_id=${id}`);
  });
  it('reuses one purchase/session across concurrent windows and an API restart', async () => {
    const slug = await fixture();
    const responses = await Promise.all(Array.from({ length: 5 }, () => checkout(slug)));
    expect(responses.every(r => r.statusCode === 200)).toBe(true);
    expect(new Set(responses.map(r => r.json().url)).size).toBe(1);
    expect((await pool.query('SELECT * FROM purchases WHERE auction_slug=$1', [slug])).rowCount).toBe(1);
    const restarted = buildApp({ databaseUrl: url.href });
    try { expect((await restarted.inject({ url: `/api/auctions/${slug}/purchase`, headers: { 'x-demo-user-id': '2' } })).json()).toEqual((await status(slug)).json()); }
    finally { await restarted.close(); }
  });
  it('rejects missing, malformed and forged signatures and verifies raw bytes', async () => {
    const slug = await fixture(); const { id, purchase } = await session(slug);
    const body = JSON.stringify(event(id, purchase));
    for (const signature of ['', 'abcd', 'g'.repeat(64), '0'.repeat(64)]) expect((await webhook(body, signature)).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/webhooks/stripe', headers: { 'content-type': 'application/json' }, payload: body })).statusCode).toBe(400);
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    expect((await webhook(`${body}\n`, signature)).statusCode).toBe(400);
    expect((await webhook('{')).statusCode).toBe(400);
    expect((await status(slug)).json().purchase.status).toBe('unpaid');
    expect((await webhook(body)).statusCode).toBe(200);
  });
  it('rejects signed events with mismatched purchase/session/amount/currency/status', async () => {
    const slug = await fixture(); const { id, purchase } = await session(slug);
    for (const mismatch of [{ amount_total: 1 }, { currency: 'eur' }, { id: 'cs_test_bad' }, { client_reference_id: randomUUID() }, { payment_status: 'unpaid' }, { status: 'open' }]) {
      const completion = event(id, purchase); Object.assign(completion.data.object, mismatch);
      expect([400, 409]).toContain((await webhook(JSON.stringify(completion))).statusCode);
    }
    expect((await status(slug)).json().purchase.status).toBe('unpaid');
    expect((await pool.query('SELECT * FROM payment_events WHERE purchase_id=$1', [purchase.id])).rowCount).toBe(0);
  });
  it('acknowledges replay once, detects event-ID conflicts and preserves paid time', async () => {
    const slug = await fixture(); const { id, purchase } = await session(slug);
    const completion = event(id, purchase); const body = JSON.stringify(completion);
    expect((await webhook(body)).statusCode).toBe(200);
    const paid = (await status(slug)).json().purchase;
    const repeated = await Promise.all(Array.from({ length: 5 }, () => webhook(body)));
    expect(repeated.every(r => r.statusCode === 200)).toBe(true);
    completion.occurredAt = new Date(Date.now() + 1000).toISOString();
    expect((await webhook(JSON.stringify(completion))).statusCode).toBe(409);
    expect((await pool.query('SELECT * FROM payment_events WHERE purchase_id=$1', [purchase.id])).rowCount).toBe(1);
    expect((await status(slug)).json().purchase).toEqual(paid);
    expect((await checkout(slug)).json()).toEqual({ status: 'paid' });
    const other = await fixture(); const second = await session(other);
    const collision = event(second.id, second.purchase); collision.eventId = completion.eventId;
    expect((await webhook(JSON.stringify(collision))).statusCode).toBe(409);
    expect((await status(other)).json().purchase.status).toBe('unpaid');
  });
  it('keeps a declined or canceled session unpaid and supports retry to completion', async () => {
    const slug = await fixture(); const { id } = await session(slug);
    expect((await attempt(id, '4000000000000002')).statusCode).toBe(402);
    expect((await status(slug)).json().purchase.status).toBe('unpaid');
    const page = await mock.inject(`/checkout/${id}`);
    expect(page.body).toContain('?checkout=canceled'); // Cancel is navigation, not a payment transition.
    expect((await session(slug)).id).toBe(id);
    expect((await status(slug)).json().purchase.status).toBe('unpaid');
    expect((await attempt(id, '4242424242424242')).statusCode).toBe(200);
    expect((await status(slug)).json().purchase.status).toBe('paid');
    expect((await status(slug, '1')).json().purchase.status).toBe('paid');
  });
});

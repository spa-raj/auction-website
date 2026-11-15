import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { chromium, type Browser } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { z } from 'zod';
import { buildApp } from '../server/src/app.js';
import { closeDueAuctions } from '../server/src/close-auctions.js';
import { buildStripeApp } from '../stripe-service/src/app.js';
import { purchaseResponseSchema } from '../shared/purchase.js';

// Self-verification uses a disposable schema and mock, never live payment state.
const artifacts = await mkdtemp(join(tmpdir(), 'part7-payment-recovery-'));
const stateFile = join(artifacts, 'mock', 'sessions.json');
const schema = `browser_recovery_${randomUUID().replaceAll('-', '')}`;
const databaseUrl = new URL('postgres://auction:auction@127.0.0.1:55432/auction_part_7_test');
const admin = new pg.Pool({ connectionString: databaseUrl.href });
databaseUrl.searchParams.set('options', `-c search_path=${schema}`);
const pool = new pg.Pool({ connectionString: databaseUrl.href });
const base = `http://127.0.0.1:${Number(process.env.PAYMENT_RECOVERY_WEB_PORT ?? 5187)}`;
const secret = 'browser_recovery_secret';
let allowDelivery = false; let failLookups = false;
let mockUrl = ''; let mockAddress = ''; let api: ReturnType<typeof buildApp> | undefined;
let vite: ViteDevServer | undefined; let browser: Browser | undefined;
const makeMock = () => {
  const app = buildStripeApp({ logger: false, stateFile, baseUrl: mockUrl || undefined, webhookSecret: secret, retryMs: 100,
    deliverWebhook: async (body, signature) => {
      if (!allowDelivery || !api) return false;
      return (await api.inject({ method: 'POST', url: '/api/webhooks/stripe', headers: { 'content-type': 'application/json', 'x-stripe-signature': signature }, payload: body })).statusCode === 200;
    } });
  app.addHook('onRequest', async (request, reply) => {
    if (failLookups && request.method === 'GET' && request.url.startsWith('/v1/checkout/sessions/')) return reply.code(503).send({ message: 'Temporary mock lookup outage' });
  });
  return app;
};
let mock = makeMock();
try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  for (const file of ['001_auctions.sql', '002_auction_outcomes.sql', '003_recipient_notifications.sql', '004_purchases.sql']) {
    await pool.query(await readFile(new URL(`../server/migrations/${file}`, import.meta.url), 'utf8'));
  }
  await pool.query('TRUNCATE auctions CASCADE');
  // Reserve a random port, then rebuild with its public checkout URL.
  mockAddress = await mock.listen({ port: 0, host: '127.0.0.1' }); mockUrl = mockAddress;
  await mock.close(); mock = makeMock();
  await mock.listen({ port: Number(new URL(mockAddress).port), host: '127.0.0.1' });
  api = buildApp({ databaseUrl: databaseUrl.href, payments: { stripeUrl: mockAddress, stripePublicUrl: mockUrl, webUrl: base, webhookSecret: secret } });
  const apiAddress = await api.listen({ port: 0, host: '127.0.0.1' });
  vite = await createServer({ configFile: false, root: fileURLToPath(new URL('../web', import.meta.url)), plugins: [react()],
    server: { host: '127.0.0.1', port: Number(new URL(base).port), strictPort: true,
      proxy: { '/api': apiAddress, '/socket.io': { target: apiAddress, ws: true } } } });
  await vite.listen();
  const slug = `seller-payment-review-${randomUUID()}`;
  await pool.query(`INSERT INTO auctions (slug,title,category,description,condition,location,starting_price_cents,seller_id,closes_at)
    VALUES ($1,'Seller payment recovery','GPUs','Isolated browser recovery verification','Used','Local',10000,1,clock_timestamp()-interval '1 second')`, [slug]);
  await pool.query(`INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ($1,2,12345,clock_timestamp()-interval '2 seconds')`, [slug]);
  await closeDueAuctions(pool);
  browser = await chromium.launch({ channel: 'chrome', chromiumSandbox: true, headless: true });
  const sellerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const winnerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await sellerContext.addInitScript(() => { if (!sessionStorage.getItem('auction-part-7-active-user')) sessionStorage.setItem('auction-part-7-active-user', '1'); });
  await winnerContext.addInitScript(() => { if (!sessionStorage.getItem('auction-part-7-active-user')) sessionStorage.setItem('auction-part-7-active-user', '2'); });
  const seller = await sellerContext.newPage(); const winner = await winnerContext.newPage();
  const errors: string[] = [];
  for (const page of [seller, winner]) { page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message)); }
  const itemUrl = `${base}/items/${slug}`;
  const purchaseUrl = `${base}/api/auctions/${slug}/purchase`;
  await Promise.all([seller.goto(itemUrl), winner.goto(itemUrl)]);
  await seller.getByRole('heading', { name: 'Seller payment status', exact: true }).waitFor();
  for (const page of [seller, winner]) await page.locator('.purchase-panel').getByRole('status').filter({ hasText: 'Unpaid · $123.45' }).waitFor();
  assert.equal(await seller.getByRole('button', { name: /Complete purchase|Restart checkout/ }).count(), 0);
  await seller.locator('.purchase-panel').screenshot({ path: join(artifacts, 'seller-unpaid.png') });
  await winner.getByRole('button', { name: 'Complete purchase', exact: true }).click();
  await winner.waitForURL('**/checkout/cs_test_*');
  const originalUrl = winner.url(); const originalId = new URL(originalUrl).pathname.split('/').at(-1)!;
  await winner.getByRole('link', { name: 'Cancel', exact: true }).click();
  await winner.getByText('Checkout canceled. Your purchase is still unpaid and you can retry.').waitFor();
  const originalPurchase = purchaseResponseSchema.parse(await (await winner.request.get(purchaseUrl, { headers: { 'x-demo-user-id': '2' } })).json());
  assert.equal(originalPurchase.role, 'winner');
  // Remove this one known-unpaid session from the disposable state file only.
  await mock.close();
  const stored = z.array(z.object({ id: z.string(), status: z.string(), payment_status: z.string() }).passthrough()).parse(JSON.parse(await readFile(stateFile, 'utf8')));
  const removed = stored.find(s => s.id === originalId);
  assert.equal(removed?.status, 'open'); assert.equal(removed?.payment_status, 'unpaid');
  await writeFile(stateFile, JSON.stringify(stored.filter(s => s.id !== originalId)));
  mock = makeMock(); await mock.listen({ port: Number(new URL(mockAddress).port), host: '127.0.0.1' });
  for (const page of [seller, winner]) await page.getByRole('button', { name: 'Refresh payment status', exact: true }).click();
  await seller.getByText('The winner’s unpaid checkout session is no longer available. The winner can restart checkout.').waitFor();
  await winner.getByRole('button', { name: 'Restart checkout', exact: true }).waitFor();
  await seller.locator('.purchase-panel').screenshot({ path: join(artifacts, 'seller-missing.png') });
  await winner.locator('.purchase-panel').screenshot({ path: join(artifacts, 'winner-missing.png') });
  assert.equal((await seller.request.post(`${base}/api/auctions/${slug}/checkout`, { headers: { 'x-demo-user-id': '1' }, data: {} })).status(), 403);
  await winner.getByRole('button', { name: 'Restart checkout', exact: true }).click();
  await winner.waitForURL('**/checkout/cs_test_*');
  const replacementUrl = winner.url(); assert.notEqual(replacementUrl, originalUrl);
  await winner.getByRole('link', { name: 'Cancel', exact: true }).click();
  await winner.locator('.purchase-panel').getByRole('status').filter({ hasText: 'Unpaid' }).waitFor();
  const replacementPurchase = purchaseResponseSchema.parse(await (await winner.request.get(purchaseUrl, { headers: { 'x-demo-user-id': '2' } })).json());
  assert.deepEqual(replacementPurchase, originalPurchase);
  failLookups = true;
  for (const page of [seller, winner]) await page.getByRole('button', { name: 'Refresh payment status', exact: true }).click();
  for (const page of [seller, winner]) await page.getByRole('alert').filter({ hasText: 'Payment service unavailable' }).waitFor();
  assert(await winner.getByRole('button', { name: 'Complete purchase', exact: true }).isDisabled());
  await seller.locator('.purchase-panel').screenshot({ path: join(artifacts, 'seller-provider-unavailable.png') });
  failLookups = false;
  for (const page of [seller, winner]) await page.getByRole('button', { name: 'Refresh payment status', exact: true }).click();
  await winner.getByRole('button', { name: 'Complete purchase', exact: true }).waitFor();
  await winner.waitForFunction(() => !document.querySelector<HTMLButtonElement>('.purchase-panel .primary-button')?.disabled);
  // A failed status fetch retains the last known status and offers recovery.
  await seller.route(purchaseUrl, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Temporary status outage' }) }));
  await seller.getByRole('button', { name: 'Refresh payment status', exact: true }).click();
  await seller.getByRole('alert').filter({ hasText: 'Displayed payment information may be outdated' }).waitFor();
  assert((await seller.locator('.purchase-panel').innerText()).includes('Unpaid · $123.45'));
  await seller.unroute(purchaseUrl);
  await seller.getByRole('button', { name: 'Refresh payment status', exact: true }).click();
  await seller.locator('.purchase-panel [role="alert"]').waitFor({ state: 'detached' });
  await winner.getByRole('button', { name: 'Complete purchase', exact: true }).click();
  await winner.waitForURL(replacementUrl);
  await winner.getByLabel('Card number', { exact: true }).fill('4242 4242 4242 4242');
  await winner.getByLabel('Expiration', { exact: true }).fill('12 / 39');
  await winner.getByLabel('CVC', { exact: true }).fill('123');
  await winner.getByRole('button', { name: 'Pay $123.45', exact: true }).click();
  await winner.getByRole('alert').filter({ hasText: 'Confirmation is pending' }).waitFor();
  await winner.goto(`${itemUrl}?checkout=success`);
  await seller.getByRole('button', { name: 'Refresh payment status', exact: true }).click();
  for (const page of [seller, winner]) await page.getByRole('status').filter({ hasText: 'Confirmation is pending and retries automatically' }).waitFor();
  assert.equal(await winner.getByRole('button', { name: /Complete purchase|Restart checkout/ }).count(), 0);
  const pending = purchaseResponseSchema.parse(await (await seller.request.get(purchaseUrl, { headers: { 'x-demo-user-id': '1' } })).json());
  assert.equal(pending.role, 'seller'); assert.equal(pending.purchase.status, 'unpaid');
  assert(!('id' in pending.purchase)); assert(!JSON.stringify(pending).includes('cs_test_'));
  for (const [name, page] of [['seller', seller], ['winner', winner]] as const) await page.locator('.purchase-panel').screenshot({ path: join(artifacts, `${name}-pending.png`) });
  allowDelivery = true; // The durable mock loop, not a browser payment retry, confirms.
  for (const page of [seller, winner]) await page.getByRole('heading', { name: 'Purchase paid', exact: true }).waitFor();
  await seller.reload(); await seller.getByRole('status').filter({ hasText: 'Paid · $123.45' }).waitFor();
  await seller.locator('.purchase-panel').screenshot({ path: join(artifacts, 'seller-paid.png') });
  await seller.getByLabel('Active demo user', { exact: true }).selectOption('3');
  await seller.locator('.purchase-panel').waitFor({ state: 'detached' });
  assert.equal((await seller.request.get(purchaseUrl, { headers: { 'x-demo-user-id': '3' } })).status(), 403);
  await seller.getByLabel('Active demo user', { exact: true }).selectOption('1');
  await seller.getByRole('heading', { name: 'Purchase paid', exact: true }).waitFor();
  assert.equal(await seller.getByRole('button', { name: /Complete purchase|Restart checkout/ }).count(), 0);
  assert.deepEqual(errors, []);
  await writeFile(join(artifacts, 'evidence.json'), JSON.stringify({ checks: ['seller unpaid status', 'seller cannot checkout', 'actual unpaid session disappearance', 'same purchase replacement', 'provider unavailable preserves status', 'status fetch failure and retry', 'pending confirmation no further payment', 'autonomous signed completion', 'seller automatically sees paid', 'paid reload', 'role projections', 'identity switch removes private status'], originalUrl, replacementUrl, errors }, null, 2));
  console.log(`PASS: seller payment status and recovery browser verification. Evidence: ${artifacts}`);
} finally {
  await browser?.close(); await vite?.close(); await api?.close(); await mock.close();
  await pool.end(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end();
  await rm(join(artifacts, 'mock'), { recursive: true, force: true });
}

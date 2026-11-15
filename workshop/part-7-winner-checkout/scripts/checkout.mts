import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';
import { detailSchema } from '../shared/auction.js';
import { notificationsSchema } from '../shared/notifications.js';

// Automated self-verification. User-requested demonstrations use test:bidding-war.
const base = process.env.CHECKOUT_BASE_URL ?? 'http://127.0.0.1:5107';
const artifacts = await mkdtemp(join(tmpdir(), 'part7-checkout-'));
async function create(suffix: string, bidder?: number) {
  const response = await fetch(`${base}/api/auctions`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-user-id': '7' },
    body: JSON.stringify({ title: `Checkout browser ${suffix} ${randomUUID().slice(0,8)}`, category: 'GPUs', description: 'Checkout verification', condition: 'Used', location: 'Local', startingPriceCents: 10000, closesAt: new Date(Date.now() + 4000).toISOString() }) });
  assert.equal(response.status, 201);
  const { slug } = await response.json() as { slug: string };
  if (bidder) {
    const bid = await fetch(`${base}/api/auctions/${slug}/bids`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-user-id': String(bidder) }, body: JSON.stringify({ amountCents: 12345 }) });
    assert.equal(bid.status, 201);
  }
  return slug;
}
async function waitForResult(slug: string) {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    const result = detailSchema.parse(await (await fetch(`${base}/api/auctions/${slug}`)).json());
    if (result.auction.finalOutcome) return result;
    await sleep(100);
  }
  throw new Error(`No final outcome: ${slug}`);
}
async function dismissFixtureNotices(slugs: string[]) {
  for (const id of [7, 8]) {
    const until = Date.now() + 8000;
    while (Date.now() < until) {
      const notices = notificationsSchema.parse(await (await fetch(`${base}/api/notifications`, { headers: { 'x-demo-user-id': String(id) } })).json());
      const relevant = notices.notifications.filter(n => slugs.includes(n.event.auctionSlug));
      if (relevant.length >= (id === 7 ? 2 : 1)) {
        for (const notice of relevant) assert((await fetch(`${base}/api/notifications/${notice.id}/dismiss`, { method: 'POST', headers: { 'x-demo-user-id': String(id) } })).ok);
        break;
      }
      await sleep(100);
    }
  }
}
const browser = await chromium.launch({ channel: 'chrome', chromiumSandbox: true, headless: true });
try {
  const slug = await create('sold', 8);
  const noBid = await create('no-bids');
  const [sold, noBids] = await Promise.all([waitForResult(slug), waitForResult(noBid)]);
  assert.equal(sold.auction.finalOutcome?.winner?.id, 8);
  assert.equal(noBids.auction.finalOutcome?.status, 'no_bids');
  await dismissFixtureNotices([slug, noBid]);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.addInitScript(() => { if (!sessionStorage.getItem('auction-part-7-active-user')) sessionStorage.setItem('auction-part-7-active-user', '8'); });
  const page = await context.newPage(); const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/items/${slug}`);
  await page.getByRole('status').filter({ hasText: 'Unpaid · $123.45' }).waitFor();
  await page.locator('.purchase-panel').screenshot({ path: join(artifacts, 'unpaid.png') });
  // A transient checkout error is visible and the same action remains retryable.
  const checkout = `${base}/api/auctions/${slug}/checkout`;
  await page.route(checkout, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Payment service unavailable. Retry shortly.' }) }));
  await page.getByRole('button', { name: 'Complete purchase', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Payment service unavailable' }).waitFor();
  await page.unroute(checkout);
  await page.getByRole('button', { name: 'Complete purchase', exact: true }).click();
  await page.waitForURL('**/checkout/cs_test_*');
  const sessionUrl = page.url();
  await page.getByLabel('Card number', { exact: true }).fill('4000 0000 0000 0002');
  await page.getByLabel('Expiration', { exact: true }).fill('12 / 39');
  await page.getByLabel('CVC', { exact: true }).fill('123');
  await page.getByRole('button', { name: 'Pay $123.45', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Your card was declined' }).waitFor();
  await page.screenshot({ path: join(artifacts, 'declined.png') });
  await page.getByRole('link', { name: 'Cancel', exact: true }).click();
  await page.waitForURL('**checkout=canceled');
  await page.getByText('Checkout canceled. Your purchase is still unpaid and you can retry.').waitFor();
  await page.getByRole('status').filter({ hasText: 'Unpaid · $123.45' }).waitFor();
  await page.locator('.purchase-panel').screenshot({ path: join(artifacts, 'canceled.png') });
  await page.getByRole('button', { name: 'Complete purchase', exact: true }).click();
  await page.waitForURL(sessionUrl);
  await page.getByLabel('Card number', { exact: true }).fill('4242 4242 4242 4242');
  await page.getByLabel('Expiration', { exact: true }).fill('12 / 39');
  await page.getByLabel('CVC', { exact: true }).fill('123');
  await page.getByRole('button', { name: 'Pay $123.45', exact: true }).click();
  await page.waitForURL('**checkout=success&session_id=*');
  await page.getByRole('heading', { name: 'Purchase paid', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('status').filter({ hasText: 'Paid · $123.45' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Complete purchase', exact: true }).count(), 0);
  await page.locator('.purchase-panel').screenshot({ path: join(artifacts, 'paid.png') });
  await page.getByLabel('Active demo user', { exact: true }).selectOption('7');
  await page.getByRole('status').filter({ hasText: 'Paid · $123.45' }).waitFor();
  await page.getByLabel('Active demo user', { exact: true }).selectOption('9');
  await page.locator('.purchase-panel').waitFor({ state: 'detached' });
  await page.getByLabel('Active demo user', { exact: true }).selectOption('8');
  await page.getByRole('heading', { name: 'Purchase paid', exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.purchase-panel').scrollIntoViewIfNeeded();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(artifacts, 'mobile-paid.png'), fullPage: true });
  await page.goto(`${base}/items/${noBid}`);
  await page.getByText('ENDED WITHOUT BIDS', { exact: true }).waitFor();
  assert.equal(await page.locator('.purchase-panel').count(), 0);
  assert.deepEqual(errors, []);
  await writeFile(join(artifacts, 'evidence.json'), JSON.stringify({ base, slug, noBid, checks: ['server finalization', 'unpaid winner CTA', 'checkout unavailable retry', 'hosted decline', 'cancel unpaid', 'same-session retry', 'signed completion paid', 'paid survives reload', 'seller visibility', 'loser hidden', 'identity switching', 'mobile layout', 'no-bid no purchase'], errors }, null, 2));
  console.log(`PASS: checkout browser verification. Evidence: ${artifacts}`);
} finally { await browser.close(); }

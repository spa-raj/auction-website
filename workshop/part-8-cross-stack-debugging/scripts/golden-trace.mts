import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { z } from 'zod';
import { detailSchema } from '../shared/auction.js';
import { notificationsSchema } from '../shared/notifications.js';
import { validCarrier } from '../shared/tracing.js';

const base = process.env.GOLDEN_BASE_URL ?? 'http://127.0.0.1:5108';
const jaeger = process.env.JAEGER_URL ?? 'http://127.0.0.1:16686';
const headless = process.argv.includes('--headless');
const artifacts = await mkdtemp(join(tmpdir(), 'part8-golden-trace-'));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://auction:auction@127.0.0.1:55432/auction_part_8?options=-csearch_path%3Dwinner_checkout' });
const contexts: BrowserContext[] = []; const profiles: string[] = []; const pages: Page[] = [];
const errors: string[] = []; const bounds: unknown[] = [];
let stopping = false;
async function cleanup() {
  await Promise.all(contexts.map(context => context.close())); await pool.end();
  await Promise.all(profiles.map(profile => rm(profile, { recursive: true, force: true })));
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { if (!stopping) { stopping = true; void cleanup().finally(() => process.exit(130)); } });
const tag = z.object({ key: z.string(), value: z.unknown() });
const traceSchema = z.object({ traceID: z.string(), spans: z.array(z.object({ traceID: z.string(), spanID: z.string(), operationName: z.string(), processID: z.string(), startTime: z.number(), tags: z.array(tag),
  references: z.array(z.object({ refType: z.string(), traceID: z.string(), spanID: z.string() })) })), processes: z.record(z.string(), z.object({ serviceName: z.string(), tags: z.array(tag) })) });
type CollectedTrace = z.infer<typeof traceSchema>;
async function getTrace(id: string): Promise<CollectedTrace | undefined> {
  const response = await fetch(`${jaeger}/api/traces/${id}`);
  if (!response.ok) return undefined;
  const parsed = z.object({ data: z.array(traceSchema) }).safeParse(await response.json());
  return parsed.success ? parsed.data.data[0] : undefined;
}
function attribute(span: CollectedTrace['spans'][number], name: string) { return span.tags.find(tag => tag.key === name)?.value; }
async function submit(page: Page, amount: number) {
  await page.getByLabel('Your bid (USD)', { exact: true }).fill(String(amount));
  const result = page.waitForResponse(response => response.url().endsWith('/bids') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Place bid', exact: true }).click();
  return (await result).status();
}
try {
  assert((await fetch(`${base}/api/health`)).ok, 'Start Part 8 with npm start');
  assert((await fetch(`${jaeger}/api/services`)).ok, 'Jaeger must be reachable');
  // Dismiss only previous generated notices for these demo participants.
  for (const id of [1, 2, 3]) {
    const response = await fetch(`${base}/api/notifications`, { headers: { 'x-demo-user-id': String(id) } });
    const notices = notificationsSchema.parse(await response.json());
    for (const notice of notices.notifications) {
      if (!/^(Golden trace |PRIVATE_TRACE_TITLE_|Bidding War |Checkout decline )/.test(notice.event.title)) continue;
      assert((await fetch(`${base}/api/notifications/${notice.id}/dismiss`, { method: 'POST', headers: { 'x-demo-user-id': String(id) } })).ok);
    }
    const remaining = notificationsSchema.parse(await (await fetch(`${base}/api/notifications`, { headers: { 'x-demo-user-id': String(id) } })).json());
    assert.equal(remaining.notifications.length, 0, `Demo user ${id} has unrelated notices; leaving them untouched`);
  }
  for (let index = 0; index < 4; index++) {
    const profile = await mkdtemp(join(tmpdir(), 'part8-golden-chrome-')); profiles.push(profile);
    const context = await chromium.launchPersistentContext(profile, { channel: 'chrome', chromiumSandbox: true, headless,
      viewport: headless ? { width: 1280, height: 900 } : null, args: ['--no-first-run', '--disable-session-crashed-bubble', '--disable-background-timer-throttling'] });
    contexts.push(context);
    await context.addInitScript(id => { if (id < 4) sessionStorage.setItem('auction-part-8-active-user', String(id)); }, index + 1);
    const page = context.pages()[0]; pages.push(page); page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(index === 3 ? jaeger : `${base}/health`);
    if (!headless) {
      const version = await context.newPage(); await version.goto('chrome://version');
      assert(!(await version.locator('#command_line').innerText()).includes('--no-sandbox')); await version.close();
      const session = await context.newCDPSession(page);
      const { windowId } = await session.send('Browser.getWindowForTarget');
      const geometry = await page.evaluate(() => ({ width: screen.availWidth, height: screen.availHeight }));
      const width = Math.floor(geometry.width / 2); const height = Math.floor(geometry.height / 2);
      assert(width >= 600 && height >= 450, 'A desktop large enough for four windows is required');
      const desired = { left: index % 2 * width, top: Math.floor(index / 2) * height, width, height };
      await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
      await session.send('Browser.setWindowBounds', { windowId, bounds: desired });
      const actual = (await session.send('Browser.getWindowBounds', { windowId })).bounds;
      for (const key of ['left', 'top', 'width', 'height'] as const) assert(Math.abs((actual[key] ?? NaN) - desired[key]) <= 35, `Window tiling failed: ${key}`);
      bounds.push(actual); await session.detach();
    }
  }
  const [seller, winner, other, tracePage] = pages;
  const marker = `PRIVATE_TRACE_TITLE_${randomUUID().slice(0, 8)}`;
  await seller.goto(`${base}/auctions/new`);
  await seller.getByLabel('Title', { exact: true }).fill(marker);
  await seller.getByLabel('Description', { exact: true }).fill('PRIVATE_TRACE_PAYLOAD_MARKER');
  await seller.getByLabel('Location', { exact: true }).fill('PRIVATE_TRACE_LOCATION_MARKER');
  await seller.getByLabel('Starting price (USD)', { exact: true }).fill('100');
  const deadline = Math.floor((Date.now() + 20_000) / 1000) * 1000;
  const local = new Date(deadline - new Date(deadline).getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
  await seller.getByLabel('Closing time (your local time)').fill(local);
  await seller.getByRole('button', { name: 'Publish auction', exact: true }).click(); await seller.waitForURL('**/items/**');
  const itemUrl = seller.url(); const slug = new URL(itemUrl).pathname.slice('/items/'.length);
  await Promise.all([winner.goto(itemUrl), other.goto(itemUrl)]);
  for (const page of [winner, other]) await page.getByRole('status', { name: 'Live updates', exact: true }).filter({ hasText: /^Live$/ }).waitFor();
  assert.equal(await submit(winner, 101), 201);
  assert.equal(await submit(other, 102), 201);
  assert.equal(await submit(winner, 103), 201);
  assert.equal(await submit(other, 102), 409);
  await other.getByRole('alert').filter({ hasText: 'Review the updated amount' }).waitFor();
  console.log('Bids accepted, stale bid rejected. Waiting for authoritative close and recipient popups.');
  for (const [page, heading] of [[seller, 'Your auction sold'], [winner, 'You won the auction']] as const) {
    await page.getByRole('dialog').getByRole('heading', { name: heading, exact: true }).waitFor({ timeout: 30000 });
    await page.getByRole('dialog').getByRole('button', { name: 'Dismiss', exact: true }).click();
  }
  const detail = detailSchema.parse(await (await fetch(`${base}/api/auctions/${slug}`)).json());
  assert.equal(detail.auction.finalOutcome?.winner?.id, 2); assert.equal(detail.auction.finalOutcome?.winningAmountCents, 10300);
  await winner.getByRole('button', { name: 'Complete purchase', exact: true }).click(); await winner.waitForURL('**/checkout/cs_test_*');
  await winner.getByLabel('Card number', { exact: true }).fill('4000 0000 0000 0002');
  await winner.getByLabel('Expiration', { exact: true }).fill('12 / 39'); await winner.getByLabel('CVC', { exact: true }).fill('123');
  await winner.getByRole('button', { name: 'Pay $103.00', exact: true }).click();
  await winner.getByRole('alert').filter({ hasText: 'Your card was declined' }).waitFor();
  await winner.screenshot({ path: join(artifacts, 'declined.png') });
  await winner.getByRole('link', { name: 'Cancel', exact: true }).click();
  await winner.getByText('Checkout canceled. Your purchase is still unpaid and you can retry.').waitFor();
  await winner.getByRole('button', { name: 'Complete purchase', exact: true }).click(); await winner.waitForURL('**/checkout/cs_test_*');
  await winner.getByLabel('Card number', { exact: true }).fill('4242 4242 4242 4242');
  await winner.getByLabel('Expiration', { exact: true }).fill('12 / 39'); await winner.getByLabel('CVC', { exact: true }).fill('123');
  await winner.getByRole('button', { name: 'Pay $103.00', exact: true }).click();
  await winner.waitForURL('**checkout=success&session_id=*');
  for (const page of [seller, winner]) await page.getByRole('heading', { name: 'Purchase paid', exact: true }).waitFor();
  assert.equal(await other.locator('.purchase-panel').count(), 0);
  const row = (await pool.query(`SELECT p.id,p.trace_context,a.telemetry_id FROM purchases p JOIN auctions a ON a.slug=p.auction_slug WHERE p.auction_slug=$1`, [slug])).rows[0];
  const traceID = validCarrier(row.trace_context)!.traceparent.slice(3, 35);
  const expected = ['auction.bid', 'auction.close', 'auction.outbox.publish', 'auction.notification.process', 'auction.notification.recipient', 'auction.notification.signal', 'winner.checkout', 'mock-stripe.checkout.create', 'mock-stripe.payment.attempt', 'mock-stripe.webhook.deliver', 'winner.purchase.webhook', 'winner.purchase.paid', 'postgres.operation'];
  let golden: CollectedTrace | undefined;
  const until = Date.now() + 15000;
  while (Date.now() < until) { golden = await getTrace(traceID); if (golden && expected.every(name => golden!.spans.some(span => span.operationName === name))) break; await sleep(300); }
  assert(golden, `Trace not collected: ${traceID}`);
  for (const name of expected) assert(golden.spans.some(span => span.operationName === name), `Missing span ${name}`);
  const services = Object.values(golden.processes).map(process => process.serviceName);
  for (const suffix of ['api', 'close-worker', 'notification-worker', 'mock-stripe']) assert(services.includes(`auction-part-8-${suffix}`), `Missing service ${suffix}`);
  const root = golden.spans.find(span => span.operationName === 'auction.bid'); assert(root);
  assert(root.references.length === 0, 'Winning bid must be the trace root');
  const declined = golden.spans.find(span => span.operationName === 'mock-stripe.payment.attempt' && attribute(span, 'business.outcome') === 'declined'); assert(declined);
  assert.notEqual(attribute(declined, 'error'), true, 'Decline is an expected outcome');
  assert.equal(golden.spans.filter(span => span.operationName === 'winner.purchase.paid').length, 1);
  const losingBid = (await pool.query('SELECT trace_context FROM bids WHERE auction_slug=$1 AND bidder_id=3', [slug])).rows[0];
  const losingTraceID = validCarrier(losingBid.trace_context)!.traceparent.slice(3, 35);
  const losing = await getTrace(losingTraceID); assert(losing); assert.notEqual(losingTraceID, traceID);
  assert(!losing.spans.some(span => span.operationName.startsWith('winner.') || span.operationName === 'auction.close'));
  const exported = JSON.stringify(golden);
  const participants = z.object({ users: z.array(z.object({ name: z.string() })) }).parse(await (await fetch(`${base}/api/users`)).json());
  for (const privateValue of [marker, slug, 'PRIVATE_TRACE_PAYLOAD_MARKER', 'PRIVATE_TRACE_LOCATION_MARKER', '4242424242424242', '4000000000000002', ...participants.users.map(user => user.name)]) assert(!exported.includes(privateValue), `Private content leaked to trace: ${privateValue}`);
  assert(!/db\.statement|db\.query\.text|url\.full|http\.url|exception\.message|exception\.stacktrace/.test(exported), 'Forbidden telemetry attributes');
  // With business work settled, repeated health/status/detail reads stay quiet.
  await sleep(1000); const quietStart = Date.now() * 1000;
  for (let i = 0; i < 3; i++) for (const path of ['/api/health', `/api/auctions/${slug}`, `/api/auctions/${slug}/purchase`]) assert((await fetch(`${base}${path}`, { headers: { 'x-demo-user-id': '2' } })).ok);
  await sleep(3500);
  const afterIdle = await getTrace(traceID); assert(afterIdle); assert(!afterIdle.spans.some(span => span.startTime >= quietStart), 'Routine polls added workflow spans');
  const traceUrl = `${jaeger}/trace/${traceID}`; await tracePage.goto(traceUrl);
  await tracePage.getByText('auction.bid', { exact: false }).first().waitFor();
  await seller.locator('.purchase-panel').scrollIntoViewIfNeeded(); await winner.locator('.purchase-panel').scrollIntoViewIfNeeded();
  for (const [index, page] of pages.entries()) await page.screenshot({ path: join(artifacts, ['seller-paid.png', 'winner-paid.png', 'other-bidder.png', 'jaeger.png'][index]) });
  assert.deepEqual(errors, []);
  await writeFile(join(artifacts, 'trace.json'), JSON.stringify(golden, null, 2));
  await writeFile(join(artifacts, 'evidence.json'), JSON.stringify({ traceID, traceUrl, auctionUrl: itemUrl, auctionId: row.telemetry_id, purchaseId: row.id, losingTraceID, expected, services, privacy: 'passed', idleNoise: 'passed', declineIsBusinessOutcome: true, headed: !headless, chromiumSandbox: true, windowBounds: bounds, pageErrors: errors }, null, 2));
  console.log(`PASS: complete golden trace ${traceID}\nJaeger: ${traceUrl}\nAuction: ${itemUrl}\nEvidence: ${artifacts}`);
  if (!headless) { console.log('Four sandboxed Chrome windows remain open: seller top-left, winner top-right, other bidder bottom-left, Jaeger bottom-right. Ctrl+C closes this demonstration.'); await new Promise<void>(() => {}); }
} catch (error) { console.error(error); process.exitCode = 1; }
finally { if (!stopping) await cleanup(); }

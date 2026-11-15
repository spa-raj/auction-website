import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import pg from 'pg';
import { detailSchema } from '../shared/auction.js';

const base = process.env.BIDDING_WAR_BASE_URL ?? 'http://127.0.0.1:5102';
const holdMs = Number(process.env.BIDDING_WAR_HOLD_MS ?? 600_000);
assert(Number.isSafeInteger(holdMs) && holdMs >= 0, 'BIDDING_WAR_HOLD_MS must be a nonnegative integer');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://auction:auction@127.0.0.1:55432/auction_part_2' });
const contexts: BrowserContext[] = [];
const pages: Page[] = [];
const profiles: string[] = [];
const logs: string[] = [];
const name = `bidding_war_${randomUUID().replaceAll('-', '')}`;
const lockKey = randomInt(1, 2_000_000_000);
let locked = false;
let instrumented = false;
let deadline = 0;
let slug = '';
let stopping = false;

async function cleanupInstrumentation() {
  if (locked) { await db.query('SELECT pg_advisory_unlock($1)', [lockKey]); locked = false; }
  if (instrumented) {
    await db.query(`DROP TRIGGER IF EXISTS ${name} ON bids; DROP FUNCTION IF EXISTS ${name}()`);
    instrumented = false;
  }
}
async function cleanup() {
  await cleanupInstrumentation();
  await db.end();
  await Promise.all(contexts.map(context => context.close()));
  await Promise.all(profiles.map(path => rm(path, { recursive: true, force: true })));
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    void cleanup().finally(() => process.exit(130));
  });
}
async function activity(message: string) {
  const remaining = deadline ? `${((deadline - Date.now()) / 1000).toFixed(1)}s` : 'setup';
  logs.push(`${remaining} · ${message}`);
  console.log(logs.at(-1));
  await Promise.all(pages.map(page => page.evaluate(({ logs, deadline }) => {
    sessionStorage.setItem('war-log', logs.join('\n'));
    sessionStorage.setItem('war-deadline', String(deadline));
  }, { logs, deadline })));
}
async function detail() {
  const response = await pages[0].request.get(`${base}/api/auctions/${slug}`);
  assert.equal(response.status(), 200);
  return detailSchema.parse(await response.json());
}
async function refresh() {
  await Promise.all(pages.map(async page => {
    await page.reload();
    await page.getByRole('heading', { name: 'Bid history', exact: true }).waitFor();
  }));
}
async function submit(page: Page, dollars: number) {
  await page.getByLabel('Your bid (USD)').fill(String(dollars));
  const response = page.waitForResponse(response => response.url().endsWith(`/api/auctions/${slug}/bids`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Place bid', exact: true }).click();
  return (await response).status();
}
async function at(millisecondsBeforeDeadline: number) {
  await sleep(Math.max(0, deadline - millisecondsBeforeDeadline - Date.now()));
}

try {
  await db.connect();
  const health = await fetch(`${base}/api/health`);
  assert(health.ok, 'Start the app with npm start before running this test');

  // Four independent Chrome processes ensure four real windows and isolated sessions.
  for (let index = 0; index < 4; index++) {
    const profile = await mkdtemp(join(tmpdir(), 'bidding-war-'));
    profiles.push(profile);
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chrome', headless: false, viewport: null,
      args: ['--no-first-run', '--disable-session-crashed-bubble', '--disable-background-timer-throttling'],
    });
    contexts.push(context);
    await context.addInitScript(({ id, role }) => {
      sessionStorage.setItem('auction-part-2-active-user', String(id));
      document.addEventListener('DOMContentLoaded', () => {
        // Presentation-only styling; the auction, form and history remain the actual app.
        const style = document.createElement('style');
        style.textContent = `
          body {font-size:13px;zoom:.8} .site-header, header, footer, .breadcrumbs,
          .item-gallery, .item-details-grid, .seller-card, .product-category {display:none!important}
          .item-page {padding:10px 20px!important;max-width:none!important}
          .item-layout {display:block!important} .item-summary {max-width:none!important} .item-summary h1 {font-size:20px;margin:4px 0}
          .auction-panel {padding:10px;gap:8px;grid-template-columns:repeat(3,1fr)} .current-price strong {font-size:25px}
          .current-price {grid-column:auto;padding-bottom:0;border-bottom:0}
          .auction-panel>.listing-form {padding:8px;gap:6px;grid-template-columns:140px 1fr 140px}
          .listing-form label {grid-column:1;grid-row:1;align-self:center}
          .listing-form input {grid-column:2;grid-row:1}
          .listing-form button {grid-column:3;grid-row:1}
          .listing-form p {grid-column:1/-1}
          .listing-form input {padding:6px} .primary-button {padding:8px}
          .auction-panel p, .listing-form p {margin:0} .history-section {margin:10px 0}
          .history-section h2 {font-size:18px;margin:4px 0} .eyebrow {display:none}
          th,td {padding:5px} #war {padding:10px 20px;background:#11243b;color:white}
          #war strong {font-size:18px} #war pre {font:12px/1.3 monospace;margin:4px 0;white-space:pre-wrap}
        `;
        document.body.append(style);
        const panel = document.createElement('aside');
        panel.id = 'war';
        const heading = document.createElement('strong');
        const clock = document.createElement('span');
        const log = document.createElement('pre');
        panel.append(heading, clock, log);
        document.body.prepend(panel);
        setInterval(() => {
          const end = Number(sessionStorage.getItem('war-deadline'));
          heading.textContent = `${role} · demo user ${id}  `;
          clock.textContent = end ? (Date.now() >= end ? 'ENDED' : `${Math.ceil((end - Date.now()) / 1000)}s remaining`) : 'Preparing auction';
          log.textContent = (sessionStorage.getItem('war-log') ?? 'Bidding War · waiting for seller').split('\n').slice(-6).join('\n');
        }, 100);
      });
    }, { id: index + 1, role: index === 0 ? 'SELLER' : `BIDDER ${index}` });
    const page = context.pages()[0];
    page.setDefaultTimeout(5000);
    pages.push(page);
    await page.goto(`${base}/health`);
    await page.getByRole('status').filter({ hasText: 'OK' }).waitFor();
    const session = await context.newCDPSession(page);
    const { windowId } = await session.send('Browser.getWindowForTarget');
    const geometry = await page.evaluate(() => {
      const desktop = screen as Screen & { availLeft?: number; availTop?: number };
      return { left: desktop.availLeft ?? 0, top: desktop.availTop ?? 0, width: desktop.availWidth, height: desktop.availHeight };
    });
    const width = Math.floor(geometry.width / 2);
    const height = Math.floor(geometry.height / 2);
    assert(width >= 600 && height >= 450, 'Desktop is too small for four readable windows');
    const bounds = { left: geometry.left + (index % 2) * width, top: geometry.top + Math.floor(index / 2) * height, width, height };
    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await session.send('Browser.setWindowBounds', { windowId, bounds });
    const actual = (await session.send('Browser.getWindowBounds', { windowId })).bounds;
    for (const key of ['left', 'top', 'width', 'height'] as const) {
      assert(Math.abs((actual[key] ?? NaN) - bounds[key]) <= 35, `Window tiling unavailable: ${key}`);
    }
    await session.detach();
  }

  const seller = pages[0];
  await seller.goto(`${base}/auctions/new`);
  await seller.getByLabel('Title', { exact: true }).fill(`Bidding War ${name.slice(-6)}`);
  await seller.getByLabel('Description', { exact: true }).fill('Three bidders compete. Equal accepted amounts demonstrate the race.');
  await seller.getByLabel('Location', { exact: true }).fill('Bidding War');
  await seller.getByLabel('Starting price (USD)').fill('100');
  deadline = Math.floor((Date.now() + 20_000) / 1000) * 1000;
  const local = new Date(deadline - new Date(deadline).getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
  await seller.getByLabel('Closing time (your local time)').fill(local);
  await seller.getByRole('button', { name: 'Publish auction' }).click();
  await seller.waitForURL('**/items/**');
  slug = new URL(seller.url()).pathname.slice('/items/'.length);
  assert.match(slug, /^[a-z0-9-]+$/); // Safe literal for the auction-specific trigger predicate.
  await Promise.all(pages.slice(1).map(page => page.goto(`${base}/items/${slug}`)));
  await Promise.all(pages.map(page => page.getByRole('heading', { name: 'Bid history', exact: true }).waitFor()));
  assert.equal((await detail()).auction.seller.id, 1);
  for (let index = 0; index < pages.length; index++) {
    assert.equal(await pages[index].getByLabel('Active demo user').inputValue(), String(index + 1));
  }
  await activity('Seller posted $100 auction · three isolated bidders');

  // Hold only this auction's inserts AFTER application validation. No fake responses,
  // modified bid amounts, or endpoint hooks. The session lock has bounded lifetime.
  await db.query('SELECT pg_advisory_lock($1)', [lockKey]);
  locked = true;
  await db.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_advisory_xact_lock_shared(${lockKey}::bigint); RETURN NEW; END $$;
    CREATE TRIGGER ${name} BEFORE INSERT ON bids FOR EACH ROW
    WHEN (NEW.auction_slug = '${slug}') EXECUTE FUNCTION ${name}()`);
  instrumented = true;
  await activity('SIMULTANEOUS · all three submit $101 · insert barrier active');
  const race = Promise.all(pages.slice(1).map(page => submit(page, 101)));
  // Attach rejection handling immediately while observing the database barrier.
  void race.catch(() => {});
  try {
    const timeout = Date.now() + 4500;
    let waiting = 0;
    while (Date.now() < timeout) {
      const result = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_locks
        WHERE locktype='advisory' AND classid=0 AND objid=$1 AND NOT granted`, [lockKey]);
      waiting = result.rows[0].count;
      if (waiting === 3) break;
      await sleep(25);
    }
    assert.equal(waiting, 3, 'All three bids must validate before any insert is released');
  } finally {
    await db.query('SELECT pg_advisory_unlock($1)', [lockKey]);
    locked = false;
  }
  assert.deepEqual(await race, [201, 201, 201]);
  await cleanupInstrumentation();
  const raced = await detail();
  const duplicates = raced.bids.filter(bid => bid.amountCents === 10100);
  assert.equal(duplicates.length, 3, 'DEFECT NOT REPRODUCED: expected duplicate accepted $101 bids');
  assert.equal(new Set(duplicates.map(bid => bid.bidder.id)).size, 3);
  await activity('RACE REPRODUCED · three accepted $101 bids · barrier removed');
  await refresh();

  assert.equal(await submit(pages[1], 102), 201);
  await activity('STAGGERED · bidder 1 $102 accepted');
  await sleep(350);
  assert.equal(await submit(pages[2], 102), 409);
  await activity('STAGGERED · bidder 2 stale $102 rejected (409)');
  assert.equal(await submit(pages[3], 103), 201);
  await activity('STAGGERED · bidder 3 $103 accepted');
  await refresh();

  // Send the near-deadline attempts from the browser directly so network timing
  // is not dominated by locator actionability, and the disabled UI cannot hide API behavior.
  const timedBid = async (page: Page, amountCents: number) => page.evaluate(async ({ slug, amountCents }) => {
    const response = await fetch(`/api/auctions/${slug}/bids`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-demo-user-id': sessionStorage.getItem('auction-part-2-active-user')! },
      body: JSON.stringify({ amountCents }) });
    return response.status;
  }, { slug, amountCents });
  assert(Date.now() < deadline - 2000, 'Setup took too long to demonstrate the deadline');
  await at(1500);
  assert.equal(await timedBid(pages[2], 10400), 201);
  await activity('DEADLINE · bidder 2 $104 before closing accepted');
  await at(-250);
  assert.equal(await timedBid(pages[3], 10500), 409);
  await activity('DEADLINE · bidder 3 $105 after closing rejected (409)');
  await refresh();
  const final = await detail();
  assert(final.auction.ended);
  assert.equal(final.auction.bidCount, 6);
  assert.equal(final.auction.currentAmountCents, 10400);
  assert.equal(final.auction.currentBidder?.id, 3);
  assert.equal(final.bids.filter(bid => bid.amountCents === 10100).length, 3);
  for (const page of pages) {
    assert.equal(await page.locator('.ending strong').textContent(), 'ENDED');
    assert(await page.getByRole('button', { name: 'Place bid' }).isDisabled());
    assert.equal(await page.locator('tbody tr').count(), 6);
  }
  assert.equal((await db.query('SELECT 1 FROM pg_trigger WHERE tgname=$1', [name])).rowCount, 0);
  await activity('PASS · 3 × $101 accepted · winner bidder 2 at $104 · ENDED');
  const artifacts = await mkdtemp(join(tmpdir(), 'bidding-war-results-'));
  for (const [index, page] of pages.entries()) {
    await page.waitForFunction(() => document.querySelector('#war pre')?.textContent?.includes('PASS'));
    await page.screenshot({ path: join(artifacts, `${index === 0 ? 'seller' : `bidder-${index}`}.png`) });
    const geometry = await page.locator('tbody').evaluate(element => ({ bottom: element.getBoundingClientRect().bottom, height: innerHeight }));
    assert(geometry.bottom <= geometry.height, `Bid history must fit visibly: ${JSON.stringify(geometry)}; screenshot: ${artifacts}`);
  }
  console.log(`Screenshots: ${artifacts}`);
  console.log(`Auction: ${seller.url()}\nHolding four Chrome windows for ${holdMs}ms. Ctrl+C cleans up and closes them.`);
  // Instrumentation is already removed; preserve the ended auction for inspection.
  await sleep(holdMs);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (!stopping) await cleanup();
}

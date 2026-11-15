import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import pg from 'pg';
import { auctionChangeSchema } from '../shared/realtime.js';
import { notificationsSchema, recipientSchema } from '../shared/notifications.js';
import { detailSchema } from '../shared/auction.js';

const base = process.env.BIDDING_WAR_BASE_URL ?? 'http://127.0.0.1:5106';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://auction:auction@127.0.0.1:55432/auction_part_6' });
const contexts: BrowserContext[] = [];
const pages: Page[] = [];
const profiles: string[] = [];
const logs: string[] = [];
const notifications: string[][] = [];
const navigations: number[] = [];
const outcomeSignals: number[] = [];
const recipientSubscriptions: number[] = [];
const windowBounds: { left: number; top: number; width: number; height: number }[] = [];
const clearedReviewNotices: string[] = [];
const pageErrors: string[] = [];
const name = `bidding_war_${randomUUID().replaceAll('-', '')}`;
const observer = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://auction:auction@127.0.0.1:55432/auction_part_6' });
let locked = false;
let deadline = 0;
let slug = '';
let stopping = false;

async function releaseBarrier() {
  if (locked) { await db.query('ROLLBACK'); locked = false; }
}
async function cleanup() {
  await releaseBarrier();
  await db.end();
  await observer.end();
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
async function expectRealtimeState(amountCents: number, bidCount: number) {
  const until = Date.now() + 5000;
  while (notifications.some(events => events.length < bidCount) && Date.now() < until) await sleep(10);
  assert(notifications.every(events => events.length === bidCount), `Expected ${bidCount} Socket.IO changes per window: ${JSON.stringify(notifications)}`);
  const state = await detail();
  assert.equal(state.auction.currentAmountCents, amountCents);
  assert.equal(state.auction.bidCount, bidCount);
  await Promise.all(pages.map(async page => {
    await page.waitForFunction(({ amountCents, bidCount, bidder }) => {
      const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
      return document.querySelector('.current-price strong')?.textContent === currency.format(amountCents / 100)
        && document.querySelectorAll('tbody tr').length === bidCount
        && document.querySelector('tbody tr td:nth-child(2)')?.textContent === currency.format(amountCents / 100)
        && document.querySelector('.bidder strong')?.textContent === bidder
        && Array.from(document.querySelectorAll('.listing-form p')).some(p => p.textContent === `Minimum bid: ${currency.format((amountCents + 100) / 100)}`);
    }, { amountCents, bidCount, bidder: state.auction.currentBidder?.name });
  }));
  assert(navigations.every(count => count === 0), `Auction pages must not reload/navigate: ${JSON.stringify(navigations)}`);
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
  await observer.connect();
  const health = await fetch(`${base}/api/health`);
  assert(health.ok, 'Start the app with npm start before running this test');

  // Clear only prior machine-created demo notices for these participants.
  // Unrelated pending notices remain untouched and must not be mistaken for this auction.
  for (const user of [1,2,3,4]) {
    const response = await fetch(`${base}/api/notifications`, { headers: { 'x-demo-user-id': String(user) } });
    assert(response.ok);
    const pending = notificationsSchema.parse(await response.json());
    for (const notice of pending.notifications) {
      if (!/^(Bidding War |Review (sold|no-bid) auction$|Popup review —)/.test(notice.event.title)) continue;
      const dismissed = await fetch(`${base}/api/notifications/${notice.id}/dismiss`, {
        method: 'POST', headers: { 'x-demo-user-id': String(user) },
      });
      assert(dismissed.ok); clearedReviewNotices.push(notice.id);
    }
    const remaining = notificationsSchema.parse(await (await fetch(`${base}/api/notifications`, { headers: { 'x-demo-user-id': String(user) } })).json());
    assert.equal(remaining.notifications.length, 0, `Demo user ${user} has unrelated pending notices; leaving them untouched`);
  }

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
      sessionStorage.setItem('auction-part-6-active-user', String(id));
      // Test-only: prevent fallback refreshes from masking missing socket handling.
      const interval = window.setInterval.bind(window);
      window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        if (timeout === 5000 && typeof handler === 'function') {
          // After socket-only assertions, the runner can request one HTTP catch-up
          // without document navigation; timers remain disabled during bidding/popups.
          window.addEventListener('war:reconcile', () => handler(...args));
        }
        return interval(handler, timeout === 5000 ? 3600000 : timeout, ...args);
      }) as typeof window.setInterval;
      window.addEventListener('focus', event => event.stopImmediatePropagation(), true);
      document.addEventListener('visibilitychange', event => event.stopImmediatePropagation(), true);
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
    notifications.push([]);
    navigations.push(0); outcomeSignals.push(0); recipientSubscriptions.push(0);
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('websocket', socket => socket.on('framereceived', frame => {
      const payload = String(frame.payload);
      if (!payload.startsWith('42[')) return;
      const event: unknown = JSON.parse(payload.slice(2));
      if (!Array.isArray(event)) return;
      if (event[0] === 'notifications:changed' || event[0] === 'notifications:watching') {
        const recipient = recipientSchema.parse(event[1]);
        assert.equal(recipient.userId, index + 1);
        if (event[0] === 'notifications:changed') outcomeSignals[index]++;
        else recipientSubscriptions[index]++;
        return;
      }
      if (event[0] !== 'auction:changed') return;
      const change = auctionChangeSchema.parse(event[1]);
      assert.equal(change.slug, slug);
      notifications[index].push(change.slug);
    }));
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
    windowBounds.push(bounds);
    await session.detach();
  }

  const seller = pages[0];
  await seller.goto(`${base}/auctions/new`);
  await seller.getByLabel('Title', { exact: true }).fill(`Bidding War ${name.slice(-6)}`);
  await seller.getByLabel('Description', { exact: true }).fill('Three bidders compete. Only one equal bid can be accepted.');
  await seller.getByLabel('Location', { exact: true }).fill('Bidding War');
  await seller.getByLabel('Starting price (USD)').fill('100');
  deadline = Math.floor((Date.now() + 45_000) / 1000) * 1000;
  const local = new Date(deadline - new Date(deadline).getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
  await seller.getByLabel('Closing time (your local time)').fill(local);
  await seller.getByRole('button', { name: 'Publish auction' }).click();
  await seller.waitForURL('**/items/**');
  slug = new URL(seller.url()).pathname.slice('/items/'.length);
  assert.match(slug, /^[a-z0-9-]+$/);
  await Promise.all(pages.slice(1).map(page => page.goto(`${base}/items/${slug}`)));
  await Promise.all(pages.map(page => page.getByRole('heading', { name: 'Bid history', exact: true }).waitFor()));
  assert.equal((await detail()).auction.seller.id, 1);
  for (let index = 0; index < pages.length; index++) {
    assert.equal(await pages[index].getByLabel('Active demo user').inputValue(), String(index + 1));
  }
  await Promise.all(pages.map(page => page.getByRole('status', { name: 'Live updates', exact: true }).filter({ hasText: /^Live$/ }).waitFor()));
  // From this point, every auction document must stay mounted throughout the war.
  for (const [index, page] of pages.entries()) page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) navigations[index]++;
  });
  assert(recipientSubscriptions.every(count => count > 0), 'All participants must have recipient Socket.IO subscriptions');
  await activity('Seller posted $100 auction · three isolated bidders · socket-only updates');

  // Hold the auction row BEFORE application validation. All contenders must
  // wait here, then read the latest committed price after their own lock is acquired.
  await db.query('BEGIN');
  await db.query('SELECT slug FROM auctions WHERE slug=$1 FOR UPDATE', [slug]);
  locked = true;
  await activity('SIMULTANEOUS · three submit $101 · auction row locked');
  const race = Promise.all(pages.slice(1).map(page => submit(page, 101)));
  // Attach rejection handling immediately while observing the database barrier.
  void race.catch(() => {});
  try {
    const timeout = Date.now() + 4500;
    let waiting = 0;
    while (Date.now() < timeout) {
      const result = await observer.query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock'
        AND query='SELECT slug FROM auctions WHERE slug=$1 FOR UPDATE'`);
      waiting = result.rows[0].count;
      if (waiting === 3) break;
      await sleep(25);
    }
    assert.equal(waiting, 3, 'All three bids must wait for the auction row before validation');
  } finally {
    await db.query('COMMIT');
    locked = false;
  }
  const statuses = await race;
  assert.deepEqual([...statuses].sort(), [201, 409, 409]);
  const raced = await detail();
  assert.equal(raced.bids.length, 1, 'Only one concurrent $101 bid may persist');
  assert.equal(raced.bids[0].amountCents, 10100);
  for (const [index, status] of statuses.entries()) {
    if (status === 409) {
      const page = pages[index + 1];
      await page.getByRole('alert').filter({ hasText: 'Review the updated amount' }).waitFor();
      assert.equal(await page.getByLabel('Your bid (USD)').inputValue(), '101');
      await page.getByText('Minimum bid: $102.00', { exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector('.current-price strong')?.textContent === '$101.00' && document.querySelectorAll('tbody tr').length === 1);
    }
  }
  await activity(`PROTECTED · $101 responses ${statuses.join('/')} · one persisted · two rejected`);
  await expectRealtimeState(10100, 1);

  // A failed refresh must leave the auction and rejected draft usable.
  const detailUrl = `${base}/api/auctions/${slug}`;
  await pages[1].route(detailUrl, route => route.abort());
  assert.equal(await submit(pages[1], 101), 409);
  await pages[1].getByRole('alert').filter({ hasText: 'Unable to refresh auction details' }).waitFor();
  assert.equal(await pages[1].getByLabel('Your bid (USD)').inputValue(), '101');
  assert(await pages[1].getByRole('heading', { name: 'Bid history', exact: true }).isVisible());
  await pages[1].unroute(detailUrl);
  assert.equal(await submit(pages[1], 102), 201);
  await pages[1].getByRole('status').filter({ hasText: 'Your bid was accepted.' }).waitFor();
  await pages[1].waitForFunction(() => !document.querySelector('main > [role="alert"]'));
  await activity('RECOVERY · refresh failure preserved draft · explicit higher bid accepted');
  await expectRealtimeState(10200, 2);
  await activity('STAGGERED · bidder 1 $102 accepted · all windows updated via Socket.IO');
  await sleep(350);
  assert.equal(await submit(pages[2], 102), 409);
  await activity('STAGGERED · bidder 2 stale $102 rejected (409)');
  assert.equal(await submit(pages[3], 103), 201);
  await activity('STAGGERED · bidder 3 $103 accepted');
  await expectRealtimeState(10300, 3);

  // Send the near-deadline attempts from the browser directly so network timing
  // is not dominated by locator actionability, and the disabled UI cannot hide API behavior.
  const timedBid = async (page: Page, amountCents: number) => page.evaluate(async ({ slug, amountCents }) => {
    const response = await fetch(`/api/auctions/${slug}/bids`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-demo-user-id': sessionStorage.getItem('auction-part-6-active-user')! },
      body: JSON.stringify({ amountCents }) });
    return response.status;
  }, { slug, amountCents });
  assert(Date.now() < deadline - 2000, 'Setup took too long to demonstrate the deadline');
  await at(1500);
  assert.equal(await timedBid(pages[2], 10400), 201);
  await expectRealtimeState(10400, 4);
  await activity('DEADLINE · bidder 2 $104 before closing accepted · all windows updated');
  await at(-250);
  const lateAttemptAt = new Date().toISOString();
  const lateStatus = await timedBid(pages[3], 10500);
  assert.equal(lateStatus, 409);
  await activity('DEADLINE · bidder 3 $105 after closing rejected (409)');
  // Deadline controls must close on mounted pages even before worker finalization.
  await Promise.all(pages.map(page => page.waitForFunction(() =>
    ['Auction ended · finalizing result', 'SOLD'].includes(document.querySelector('.ending strong')?.textContent ?? ''))));
  assert((await Promise.all(pages.map(page => page.getByRole('button', { name: 'Place bid', exact: true }).isDisabled()))).every(Boolean));
  await activity('DEADLINE UI · all four pages disabled bidding without navigation');

  const until = Date.now() + 12000;
  let recorded = await observer.query(`SELECT o.*, e.event_id,e.published_at FROM auction_outcomes o
    JOIN auction_outbox e USING (auction_slug) WHERE auction_slug=$1`, [slug]);
  while ((!recorded.rows[0]?.published_at) && Date.now() < until) {
    await sleep(100);
    recorded = await observer.query(`SELECT o.*, e.event_id,e.published_at FROM auction_outcomes o
      JOIN auction_outbox e USING (auction_slug) WHERE auction_slug=$1`, [slug]);
  }
  assert.equal(recorded.rowCount, 1, 'One durable final outcome/outbox pair must exist');
  assert.equal(recorded.rows[0].status, 'sold');
  assert.equal(recorded.rows[0].winner_id, 3);
  assert.equal(recorded.rows[0].winning_amount_cents, 10400);
  assert(recorded.rows[0].published_at instanceof Date, 'Outbox publication must be confirmed');
  await pages[0].getByRole('dialog').getByRole('heading', { name: 'Your auction sold', exact: true }).waitFor({ timeout: 12000 });
  await pages[2].getByRole('dialog').getByRole('heading', { name: 'You won the auction', exact: true }).waitFor({ timeout: 12000 });
  for (const index of [0,2]) {
    const modal = pages[index].getByRole('dialog');
    assert((await modal.innerText()).includes(`Bidding War ${name.slice(-6)}`), 'Popup must belong to this auction');
    assert((await modal.innerText()).includes('$104.00'));
    assert(outcomeSignals[index] > 0, 'Popup must receive a real recipient Socket.IO signal with reconciliation disabled');
  }
  assert.equal(await pages[1].getByRole('dialog').count(), 0, 'Losing bidder 1 must not receive a popup');
  assert.equal(await pages[3].getByRole('dialog').count(), 0, 'Losing bidder 3 must not receive a popup');
  assert.deepEqual(outcomeSignals.map(count => count > 0), [true,false,true,false]);
  const recipientRows = await observer.query(`SELECT n.id,n.recipient_id,n.role,n.dismissed_at FROM recipient_notifications n
    JOIN auction_outbox e USING(event_id) WHERE e.auction_slug=$1 ORDER BY n.recipient_id`, [slug]);
  assert.deepEqual(recipientRows.rows.map(row => [row.recipient_id,row.role]), [[1,'seller'],[3,'winner']]);
  assert(recipientRows.rows.every(row => row.dismissed_at === null), 'Keep both popups pending for review');
  await activity('POPUPS · seller auction-closed + bidder 2 congratulations · $104 · losers receive none');

  // Bid refresh and popup delivery above were socket-only. Now explicitly reconcile
  // the final result over HTTP, leaving documents mounted and popups open.
  await Promise.all(pages.map(page => page.evaluate(() => window.dispatchEvent(new Event('war:reconcile')))));
  await Promise.all(pages.map(page => page.waitForFunction(() => document.querySelector('.ending strong')?.textContent === 'SOLD')));
  const liveEndedPages = await Promise.all(pages.map(async (page,index) => ({
    role: index === 0 ? 'seller' : `bidder-${index}`,
    status: await page.locator('.ending strong').textContent(),
    biddingDisabled: await page.getByRole('button', { name: 'Place bid', exact: true }).isDisabled(),
  })));
  const final = await detail();
  assert(final.auction.ended);
  assert.equal(final.auction.bidCount, 4);
  assert.equal(final.auction.currentAmountCents, 10400);
  assert.equal(final.auction.currentBidder?.id, 3);
  assert.equal(final.auction.finalOutcome?.status, 'sold');
  assert.equal(final.auction.finalOutcome?.winner?.id, 3);
  assert.equal(final.auction.finalOutcome?.winningAmountCents, 10400);
  assert.equal(final.bids.filter(bid => bid.amountCents === 10100).length, 1);
  for (const page of pages) {
    assert.equal(await page.locator('.ending strong').textContent(), 'SOLD');
    assert(await page.getByRole('button', { name: 'Place bid', exact: true }).isDisabled());
    assert.equal(await page.locator('tbody tr').count(), 4);
  }
  assert(navigations.every(count => count === 0));
  assert.deepEqual(pageErrors, []);
  await activity('PASS · protected bids · persisted winner $104 · seller/winner popups · zero reloads');
  const artifacts = await mkdtemp(join(tmpdir(), 'bidding-war-results-'));
  for (const [index, page] of pages.entries()) {
    await page.waitForFunction(() => document.querySelector('#war pre')?.textContent?.includes('PASS'));
    await page.screenshot({ path: join(artifacts, `${index === 0 ? 'seller' : `bidder-${index}`}.png`) });
    const geometry = await page.locator('tbody').evaluate(element => ({ bottom: element.getBoundingClientRect().bottom, height: innerHeight }));
    assert(geometry.bottom <= geometry.height, `Bid history must fit visibly: ${JSON.stringify(geometry)}; screenshot: ${artifacts}`);
  }
  const evidence = {
    auctionUrl: seller.url(), closesAt: new Date(deadline).toISOString(),
    simultaneousBid: { amountCents: 10100, responseStatuses: statuses, persistedCount: final.bids.filter(bid => bid.amountCents === 10100).length },
    lateBid: { amountCents: 10500, attemptedAt: lateAttemptAt, status: lateStatus, persistedCount: final.bids.filter(bid => bid.amountCents === 10500).length },
    realtime: { pollingDisabled: true, focusRefreshDisabled: true, notificationsPerWindow: notifications.map(events => events.length), documentNavigationsPerWindow: navigations, pageErrors },
    headed: true, browser: 'Google Chrome', windowBounds, clearedReviewNotices,
    notificationDelivery: { signalsPerWindow: outcomeSignals, subscriptionsPerWindow: recipientSubscriptions,
      sellerModal: 'Your auction sold', winnerModal: 'You won the auction', winnerWindow: 2,
      losingBidderModals: false, recipientRows: recipientRows.rows, popupsLeftOpen: true },
    finalReconciliation: 'Explicit test-triggered HTTP catch-up after socket-only bid and popup assertions; no document reloads',
    recordedOutcome: recorded.rows[0], finalOutcome: final.auction.finalOutcome,
    liveEndedPages, finalBidCount: final.auction.bidCount, finalAmountCents: final.auction.currentAmountCents,
    winner: final.auction.currentBidder, persistedBids: final.bids,
  };
  await writeFile(join(artifacts, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(`Screenshots and evidence.json: ${artifacts}`);
  console.log(`Auction: ${seller.url()}\nFour Chrome windows remain open for review. Ctrl+C cleans up and closes them.`);
  // The row-lock barrier is released; preserve the ended auction for inspection.
  console.log('Verification complete. Windows remain open until Ctrl+C.');
  await new Promise<void>(() => {});
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (!stopping) await cleanup();
}

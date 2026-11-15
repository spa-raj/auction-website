import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { detailSchema } from '../shared/auction.js';

const base = process.env.BIDDING_WAR_BASE_URL ?? 'http://127.0.0.1:5103';
const contexts: BrowserContext[] = [];
const browsers: Browser[] = [];
const processes: ChildProcess[] = [];
const profiles: string[] = [];
const pages: Page[] = [];
const errors: string[] = [];
const releaseResponses: (() => void)[] = [];
let stopping = false;
async function cleanup() {
  releaseResponses.forEach(release => release());
  await Promise.all(browsers.map(browser => browser.close()));
  await Promise.all(processes.map(process => new Promise<void>(resolve => {
    if (process.exitCode !== null || process.signalCode !== null) { resolve(); return; }
    process.once('exit', () => resolve());
    process.kill('SIGTERM');
  })));
  await Promise.all(profiles.map(profile => rm(profile, { recursive: true, force: true })));
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  if (stopping) return;
  stopping = true;
  void cleanup().finally(() => process.exit(130));
});
async function createAuction(title: string, duration: number) {
  const deadline = Date.now() + duration;
  const response = await pages[0].request.post(`${base}/api/auctions`, {
    headers: { 'x-demo-user-id': '1' }, data: { title, category: 'GPUs', description: 'Closing-time browser verification',
      condition: 'Used', location: 'Austin', startingPriceCents: 10000, closesAt: new Date(deadline).toISOString() },
  });
  assert.equal(response.status(), 201);
  return { slug: (await response.json() as { slug: string }).slug, deadline };
}
async function open(page: Page, slug: string) {
  await page.goto(`${base}/items/${slug}`);
  await page.getByRole('heading', { name: 'Bid history', exact: true }).waitFor();
}
async function waitUntil(time: number) { await sleep(Math.max(0, time - Date.now())); }
async function submit(page: Page, slug: string, user: number, amountCents: number) {
  return page.request.post(`${base}/api/auctions/${slug}/bids`, {
    headers: { 'x-demo-user-id': String(user) }, data: { amountCents },
  });
}
async function expectEnded(page: Page) {
  await page.waitForFunction(() => document.querySelector('.ending strong')?.textContent === 'ENDED');
  assert(await page.getByRole('button', { name: 'Place bid', exact: true }).isDisabled());
  assert(await page.getByLabel('Your bid (USD)').isDisabled());
}

try {
  for (let index = 0; index < 2; index++) {
    const profile = await mkdtemp(join(tmpdir(), 'closing-time-chrome-'));
    profiles.push(profile);
    // Attach without Playwright's focused-page emulation. A separate real Chrome
    // process/profile per participant still guarantees separate visible windows.
    const chrome = spawn('google-chrome', ['--remote-debugging-port=0', `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
    processes.push(chrome);
    let launchError: Error | undefined;
    chrome.once('error', error => { launchError = error; });
    let port = '';
    const until = Date.now() + 8000;
    while (!port && Date.now() < until) {
      if (launchError) throw launchError;
      if (chrome.exitCode !== null) throw new Error('Headed Chrome exited before CDP was ready');
      port = await readFile(join(profile, 'DevToolsActivePort'), 'utf8').then(value => value.split('\n')[0]).catch(() => '');
      if (!port) await sleep(25);
    }
    assert(/^\d+$/.test(port), 'Headed Chrome CDP did not become ready');
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
    browsers.push(browser);
    const context = browser.contexts()[0];
    contexts.push(context);
    await context.addInitScript(id => sessionStorage.setItem('auction-part-3-active-user', String(id)), index + 1);
    const page = context.pages()[0];
    page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message));
    pages.push(page);
    await page.goto(`${base}/health`);
    await page.getByRole('status').filter({ hasText: 'OK' }).waitFor();
    const session = await context.newCDPSession(page);
    const { windowId } = await session.send('Browser.getWindowForTarget');
    const desktop = await page.evaluate(() => ({ width: screen.availWidth, height: screen.availHeight }));
    assert(desktop.width >= 1200 && desktop.height >= 900, 'Desktop too small for two readable windows');
    const target = { left: index * Math.floor(desktop.width / 2), top: 0, width: Math.floor(desktop.width / 2), height: desktop.height };
    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await session.send('Browser.setWindowBounds', { windowId, bounds: target });
    const actual = (await session.send('Browser.getWindowBounds', { windowId })).bounds;
    for (const key of ['left', 'top', 'width', 'height'] as const) assert(Math.abs((actual[key] ?? NaN) - target[key]) <= 35, `Window tiling unavailable: ${key}`);
    await session.detach();
  }

  // Foreground expiry must disable bidding before the final refresh returns.
  const foreground = await createAuction('Closing review — foreground deadline', 8000);
  await Promise.all(pages.map(page => open(page, foreground.slug)));
  await pages[1].bringToFront();
  const button = pages[1].getByRole('button', { name: 'Place bid', exact: true });
  await pages[1].waitForFunction(() => { const button = document.querySelector('.listing-form button') as HTMLButtonElement | null; return button && !button.disabled; });
  assert.equal(await pages[1].getByLabel('Active demo user').inputValue(), '2');
  await pages[1].getByLabel('Your bid (USD)').fill('101');
  const accepted = pages[1].waitForResponse(r => r.url().endsWith(`/api/auctions/${foreground.slug}/bids`) && r.request().method() === 'POST');
  await button.click();
  assert.equal((await accepted).status(), 201);
  await pages[1].getByRole('status').filter({ hasText: 'Your bid was accepted.' }).waitFor();
  const foregroundUrl = `${base}/api/auctions/${foreground.slug}`;
  let releaseForeground!: () => void;
  const foregroundGate = new Promise<void>(resolve => { releaseForeground = resolve; });
  releaseResponses.push(releaseForeground);
  await pages[1].route(foregroundUrl, async route => {
    if (Date.now() >= foreground.deadline) await foregroundGate;
    await route.continue();
  });
  await expectEnded(pages[1]);
  assert(Date.now() < foreground.deadline + 750, 'Foreground deadline should not wait for the five-second poll');
  assert.equal(await pages[1].locator('.bidder strong').textContent(), 'Confirming final result…');
  releaseForeground();
  await pages[1].waitForFunction(() => document.querySelector('.bidder strong')?.textContent === 'Decommissioned Dreams');
  assert.equal((await submit(pages[1], foreground.slug, 2, 10200)).status(), 409);
  const firstDetail = detailSchema.parse(await (await pages[1].request.get(foregroundUrl)).json());
  assert.equal(firstDetail.bids.length, 1);
  assert(firstDetail.auction.ended);
  console.log('PASS · foreground deadline disables form without waiting for refresh; final winner confirmed; late API bid rejected');

  // Background the bidder using a temporary blank tab in its own window.
  // The two participants still have separate Chrome windows. Hold responses so the
  // browser definitely has stale no-bids state when it becomes visible again.
  const background = await createAuction('Closing review — resumed bidder', 8000);
  await Promise.all(pages.map(page => open(page, background.slug)));
  await pages[1].waitForFunction(() => { const button = document.querySelector('.listing-form button') as HTMLButtonElement | null; return button && !button.disabled; });
  const backgroundUrl = `${base}/api/auctions/${background.slug}`;
  let releaseBackground!: () => void;
  const backgroundGate = new Promise<void>(resolve => { releaseBackground = resolve; });
  releaseResponses.push(releaseBackground);
  let resumed = false;
  let resumedRequests = 0;
  await pages[1].route(backgroundUrl, async route => {
    if (resumed) resumedRequests++;
    await backgroundGate;
    await route.continue();
  });
  const backgroundTab = await contexts[1].newPage();
  await backgroundTab.bringToFront();
  await pages[1].waitForFunction(() => document.visibilityState === 'hidden', undefined, { polling: 50 });
  assert.equal((await submit(pages[0], background.slug, 3, 10100)).status(), 201);
  await waitUntil(background.deadline + 150);
  resumed = true;
  const resumedAt = Date.now();
  await pages[1].bringToFront();
  await pages[1].waitForFunction(() => document.visibilityState === 'visible');
  await expectEnded(pages[1]);
  while (!resumedRequests && Date.now() < resumedAt + 1500) await sleep(10);
  assert(resumedRequests > 0, 'Visible/focused tab must request fresh state immediately');
  assert(Date.now() < resumedAt + 1500, 'Tab activation must not wait for polling');
  releaseBackground();
  await pages[1].waitForFunction(() => document.querySelector('.bidder strong')?.textContent === 'Heap & Sons');
  assert.equal(await pages[1].locator('tbody tr').count(), 1);
  await backgroundTab.close();
  console.log('PASS · actual hidden-to-visible Chrome tab rechecks immediately and reconciles a bid accepted while hidden');

  const empty = await createAuction('Closing review — no bids', 3500);
  await open(pages[0], empty.slug);
  await expectEnded(pages[0]);
  await pages[0].waitForFunction(() => document.querySelector('.bidder strong')?.textContent === 'No bids');
  console.log('PASS · auction without bids ends with No bids');
  assert.deepEqual(errors, []);
  const artifacts = await mkdtemp(join(tmpdir(), 'closing-time-results-'));
  for (const [index, page] of pages.entries()) await page.screenshot({ path: join(artifacts, `${index === 0 ? 'no-bids' : 'resumed-winner'}.png`), fullPage: true });
  console.log(`Screenshots: ${artifacts}`);
  console.log(`No-bids auction: ${pages[0].url()}\nResumed-winner auction: ${pages[1].url()}`);
  console.log('PASS · Slice 2 browser verification complete. Two tiled Chrome windows remain open until Ctrl+C.');
  await new Promise<void>(() => {});
} catch (error) {
  console.error(error);
  const artifacts = await mkdtemp(join(tmpdir(), 'closing-time-failure-'));
  for (const [index, page] of pages.entries()) {
    console.error(`Window ${index}: ${await page.locator('main').innerText().catch(() => 'unavailable')}`);
    await page.screenshot({ path: join(artifacts, `window-${index}.png`), fullPage: true }).catch(() => {});
  }
  console.error(`Failure screenshots: ${artifacts}`);
  process.exitCode = 1;
} finally {
  if (!stopping) await cleanup();
}

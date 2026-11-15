import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { detailSchema } from '../shared/auction.js';

const base = process.env.BIDDING_WAR_BASE_URL ?? 'http://127.0.0.1:5104';
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
    headers: { 'x-demo-user-id': '1' }, data: { title, category: 'GPUs', description: 'Realtime browser verification',
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
    const profile = await mkdtemp(join(tmpdir(), 'realtime-chrome-'));
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
    await context.addInitScript(id => sessionStorage.setItem('auction-part-4-active-user', String(id)), index + 1);
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

  const auction = await createAuction('Live auction-detail review', 3600000);
  await Promise.all(pages.map(page => open(page, auction.slug)));
  for (const page of pages) await page.getByRole('status', { name: 'Live updates', exact: true }).filter({ hasText: /^Live$/ }).waitFor();
  // Count actual incoming Socket.IO invalidations. Disable interval polling in the
  // watcher so a passing result cannot be explained by its five-second fallback.
  let changes = 0;
  pages[0].on('websocket', ws => ws.on('framereceived', frame => {
    if (String(frame.payload).includes('auction:changed')) changes++;
  }));
  // Re-open to observe the socket from establishment, with polling disabled.
  await pages[0].addInitScript(() => {
    const interval = window.setInterval.bind(window);
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      interval(handler, timeout === 5000 ? 3600000 : timeout, ...args)) as typeof window.setInterval;
  });
  await pages[0].reload();
  await pages[0].getByRole('status', { name: 'Live updates', exact: true }).filter({ hasText: /^Live$/ }).waitFor();
  await pages[0].getByLabel('Active demo user').selectOption('3');
  await pages[0].getByLabel('Your bid (USD)').fill('100.50');
  await pages[1].getByLabel('Your bid (USD)').fill('101');
  const accepted = pages[1].waitForResponse(r => r.url().endsWith(`/api/auctions/${auction.slug}/bids`));
  const started = Date.now();
  await pages[1].getByRole('button', { name: 'Place bid', exact: true }).click();
  assert.equal((await accepted).status(), 201);
  await pages[0].waitForFunction(() => document.querySelector('.current-price strong')?.textContent === '$101.00');
  const elapsed = Date.now() - started;
  assert(elapsed < 1000, `Realtime update took ${elapsed}ms`);
  assert(changes >= 1, 'Watcher must receive a Socket.IO auction:changed frame');
  assert.equal(await pages[0].locator('tbody tr').count(), 1);
  assert.equal(await pages[0].getByLabel('Your bid (USD)').inputValue(), '100.50');
  assert((await pages[0].locator('.listing-form').innerText()).includes('Minimum bid: $102.00'));
  console.log(`PASS · Socket.IO invalidation → HTTP refetch in ${elapsed}ms; polling disabled; history/minimum updated; draft preserved`);

  // A real offline watcher misses a bid, then catches up on reconnect.
  await contexts[0].setOffline(true);
  await pages[0].getByRole('status', { name: 'Live updates', exact: true }).filter({ hasText: /Reconnecting/ }).waitFor();
  assert.equal((await submit(pages[1], auction.slug, 2, 10200)).status(), 201);
  await contexts[0].setOffline(false);
  await pages[0].getByRole('status', { name: 'Live updates', exact: true }).filter({ hasText: /^Live$/ }).waitFor();
  await pages[0].waitForFunction(() => document.querySelector('.current-price strong')?.textContent === '$102.00');
  assert.equal(await pages[0].getByLabel('Your bid (USD)').inputValue(), '100.50');
  console.log('PASS · reconnect refetch recovers a missed bid without polling or draft loss');

  // Hold an old HTTP snapshot across another accepted bid. The pending refresh
  // must run after that stale response, without waiting for interval polling.
  let release!: () => void;
  let held!: () => void;
  const heldPromise = new Promise<void>(resolve => { held = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  releaseResponses.push(release);
  const detailUrl = `${base}/api/auctions/${auction.slug}`;
  await pages[0].route(detailUrl, async route => {
    const response = await route.fetch();
    held();
    await gate;
    await route.fulfill({ response });
  }, { times: 1 });
  await pages[0].evaluate(() => window.dispatchEvent(new Event('focus')));
  await heldPromise;
  const before = changes;
  assert.equal((await submit(pages[1], auction.slug, 2, 10300)).status(), 201);
  const until = Date.now() + 2000;
  while (changes === before && Date.now() < until) await sleep(10);
  assert(changes > before);
  release();
  await pages[0].waitForFunction(() => document.querySelector('.current-price strong')?.textContent === '$103.00');
  assert.equal(await pages[0].locator('tbody tr').count(), 3);
  assert.equal(await pages[0].getByLabel('Your bid (USD)').inputValue(), '100.50');
  console.log('PASS · notification during in-flight fetch triggers follow-up read');
  assert.deepEqual(errors, []);
  const artifacts = await mkdtemp(join(tmpdir(), 'realtime-results-'));
  for (const [index, page] of pages.entries()) await page.screenshot({ path: join(artifacts, `window-${index}.png`), fullPage: true });
  console.log(`Screenshots: ${artifacts}\nReview: ${pages[0].url()}`);
  console.log('PASS · two tiled headed Chrome windows remain open for review. Ctrl+C closes them.');
  await new Promise<void>(() => {});
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (!stopping) await cleanup();
}

import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium, type Browser, type Page } from 'playwright';
import pg from 'pg';
import amqp from 'amqplib';

const headless = process.argv.includes('--headless');
const base = process.env.NOTIFICATION_BASE_URL ?? 'http://localhost:5107';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://auction:auction@localhost:55432/auction_part_7?options=-csearch_path%3Dwinner_checkout' });
const artifacts = await mkdtemp(join(tmpdir(), 'part6-notifications-'));
const browsers: Browser[] = [];
const pages: Page[] = [];
const frames = [0,0,0,0];
const failures: string[] = [];
const checks: string[] = [];
const slugs: string[] = [];
const positions = ['0,0','960,0','0,540','960,540'];
async function cleanup() { await Promise.all(browsers.map(browser => browser.close())); await pool.end(); }
async function until(check: () => Promise<boolean>, message: string, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await sleep(50); }
  throw new Error(message);
}
async function create(title: string, delay: number, sold: boolean) {
  const response = await pages[0].request.post(`${base}/api/auctions`, { headers: { 'x-demo-user-id': '4' }, data: {
    title, category: 'GPUs', description: 'Recipient notification review', condition: 'Used', location: 'Austin',
    startingPriceCents: 10000, closesAt: new Date(Date.now() + delay).toISOString(),
  } });
  assert.equal(response.status(), 201);
  const { slug } = await response.json() as { slug: string }; slugs.push(slug);
  if (sold) for (const [user,amount] of [[6,10100],[5,10200]]) {
    const bid = await pages[0].request.post(`${base}/api/auctions/${slug}/bids`, { headers: { 'x-demo-user-id': String(user) }, data: { amountCents: amount } });
    assert.equal(bid.status(), 201);
  }
  return slug;
}
async function openSession(index: number, userId: number) {
  const browser = await chromium.launch({ channel: 'chrome', headless,
    args: headless ? [] : [`--window-position=${positions[index]}`, '--window-size=960,540'] });
  browsers.push(browser);
  const context = await browser.newContext({ viewport: { width: 930, height: 680 } });
  await context.addInitScript(user => {
    sessionStorage.setItem('auction-part-7-active-user', String(user));
    // Healthy-path assertions require a real websocket signal, not reconciliation.
    const interval = window.setInterval.bind(window);
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      interval(timeout === 5000 ? () => {} : handler, timeout, ...args)) as typeof window.setInterval;
  }, userId);
  const page = await context.newPage();
  page.on('pageerror', error => failures.push(error.message));
  page.on('websocket', socket => socket.on('framereceived', frame => {
    if (String(frame.payload).includes('notifications:changed')) frames[index]++;
  }));
  await page.goto(`${base}/search`);
  await until(async () => (await page.getByLabel('Active demo user', { exact: true }).inputValue()) === String(userId), 'Demo identity not ready');
  // Wait for the initial recipient read before starting an auction.
  await until(async () => page.evaluate(() => document.querySelectorAll('.product-card').length > 0), 'Catalog not ready');
  return page;
}
try {
  for (const [i,user] of [4,5,6,4].entries()) pages.push(await openSession(i,user));
  const health = await pages[0].request.get(`${base}/api/health`); assert.equal(health.status(),200);
  // Existing review data is preserved; dismiss only preexisting notices for review identities.
  for (const user of [4,5,6]) {
    const response = await pages[0].request.get(`${base}/api/notifications`, { headers: { 'x-demo-user-id': String(user) } });
    const body = await response.json() as { notifications: { id: string; event: { title: string } }[] };
    for (const notification of body.notifications.filter(notice => notice.event.title.startsWith('Popup review —'))) await pages[0].request.post(`${base}/api/notifications/${notification.id}/dismiss`, { headers: { 'x-demo-user-id': String(user) } });
  }
  await until(async () => (await Promise.all(pages.map(page => page.getByRole('dialog').count()))).every(count => count === 0), 'Old review modals did not clear');
  const beforeFrames = [...frames];
  const sold = await create('Popup review — sold GPU', 6000, true);
  for (const i of [0,1,3]) {
    await pages[i].getByRole('dialog').waitFor({ state: 'visible' });
    assert((await pages[i].getByRole('dialog').innerText()).includes('Popup review — sold GPU'));
    assert(frames[i] > beforeFrames[i], 'Expected a real notification websocket frame with polling disabled');
  }
  assert.equal(await pages[2].getByRole('dialog').count(), 0);
  assert.match(await pages[0].getByRole('dialog').innerText(), /Your auction sold/);
  assert.match(await pages[1].getByRole('dialog').innerText(), /You won the auction/);
  assert.match(await pages[1].getByRole('dialog').innerText(), /\$102.00/);
  checks.push('seller and winner receive actual websocket popups on catalog; losing bidder does not');
  await pages[0].keyboard.press('Escape'); assert(await pages[0].getByRole('dialog').isVisible());
  await pages[0].screenshot({ path: join(artifacts,'seller.png'), fullPage: true });
  await pages[1].screenshot({ path: join(artifacts,'winner.png'), fullPage: true });
  await pages[0].getByRole('button', { name: 'Dismiss', exact: true }).click();
  await until(async () => (await pages[0].getByRole('dialog').count()) === 0 && (await pages[3].getByRole('dialog').count()) === 0, 'Cross-window dismissal failed');
  checks.push('Escape cannot dismiss; explicit dismissal clears both seller windows');
  await pages[1].getByRole('link', { name: 'View auction' }).click();
  await pages[1].getByRole('dialog').waitFor({ state: 'visible' });
  assert(pages[1].url().endsWith(sold));
  await pages[1].getByLabel('Notification demo user').selectOption('6');
  await until(async () => (await pages[1].getByRole('dialog').count()) === 0, 'Old recipient popup leaked after switch');
  await pages[1].getByLabel('Active demo user', { exact: true }).selectOption('5');
  await pages[1].getByRole('dialog').waitFor({ state: 'visible' });
  checks.push('auction navigation retains pending popup; identity switch clears old recipient immediately');
  await pages[1].route('**/api/notifications/*/dismiss', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Injected dismissal failure' }) }));
  await pages[1].getByRole('button', { name: 'Dismiss', exact: true }).click();
  await pages[1].getByText(/Could not save dismissal/).waitFor();
  assert(await pages[1].getByRole('dialog').isVisible());
  await pages[1].unroute('**/api/notifications/*/dismiss');
  await pages[1].getByRole('button', { name: 'Dismiss', exact: true }).click();
  await until(async () => (await pages[1].getByRole('dialog').count()) === 0, 'Retry dismissal failed');
  checks.push('failed dismissal remains visible; retry persists dismissal');
  const outbox = (await pool.query('SELECT payload,published_at FROM auction_outbox WHERE auction_slug=$1', [sold])).rows[0];
  assert(outbox.published_at instanceof Date);
  const connection = await amqp.connect(process.env.RABBITMQ_URL ?? 'amqp://auction:auction@127.0.0.1:56726/auction_part_7');
  try {
    const channel = await connection.createConfirmChannel();
    const replayFrame = frames[0];
    await new Promise<void>((resolve,reject) => channel.sendToQueue('auction.notifications', Buffer.from(JSON.stringify(outbox.payload)),
      { persistent: true, messageId: (outbox.payload as { eventId: string }).eventId }, error => error ? reject(error) : resolve()));
    await until(async () => frames[0] > replayFrame, 'Replay not consumed');
    assert.equal(await pages[0].getByRole('dialog').count(),0); assert.equal(await pages[1].getByRole('dialog').count(),0);
    const records = (await pool.query('SELECT n.* FROM recipient_notifications n JOIN auction_outbox e USING(event_id) WHERE e.auction_slug=$1', [sold])).rows;
    assert.equal(records.length,2); assert(records.every(row => row.dismissed_at instanceof Date));
  } finally { await connection.close(); }
  checks.push('real broker duplicate replay preserves two unique dismissed notices and never reopens popup');
  // Disconnect the winner before the next result. Initial load must recover it.
  await pages[1].close();
  const noBids = await create('Popup review — no bids', 4500, false);
  const offline = await create('Popup review — offline winner', 8000, true);
  await pages[0].getByRole('heading', { name: 'Your auction ended without bids' }).waitFor();
  assert.equal(await pages[2].getByRole('dialog').count(),0);
  await pages[0].screenshot({ path: join(artifacts,'no-bids.png'), fullPage: true });
  await until(async () => (await pool.query('SELECT 1 FROM recipient_notifications n JOIN auction_outbox e USING(event_id) WHERE e.auction_slug=$1 AND n.recipient_id=5', [offline])).rowCount === 1, 'Offline notification not persisted');
  await pages[0].getByText('1 more pending').waitFor();
  await pages[0].getByRole('button', { name: 'Dismiss', exact: true }).click();
  await pages[0].getByText('Popup review — offline winner', { exact: true }).waitFor();
  checks.push('no-bid notification is seller-only; multiple results queue without replacing the active modal');
  const returningContext = await browsers[1].newContext({ viewport: { width: 390, height: 844 } });
  await returningContext.addInitScript(() => sessionStorage.setItem('auction-part-7-active-user', '5'));
  const returned = await returningContext.newPage();
  await returned.goto(`${base}/search`);
  await returned.getByRole('heading', { name: 'You won the auction' }).waitFor();
  assert.match(await returned.getByRole('dialog').innerText(), /Popup review — offline winner/);
  assert(await returned.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await returned.screenshot({ path: join(artifacts,'offline-winner-mobile.png'), fullPage: true });
  await returned.reload(); await returned.getByRole('heading', { name: 'You won the auction' }).waitFor();
  checks.push('offline winner recovers on fresh load and reload; modal fits mobile viewport');
  assert.deepEqual(failures, []);
  const evidence = { artifacts, checks, frames, soldUrl: `${base}/items/${sold}`, noBidUrl: `${base}/items/${noBids}`, offlineUrl: `${base}/items/${offline}`, slugs, failures };
  await writeFile(join(artifacts,'evidence.json'), JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence,null,2));
  if (!headless) {
    console.log('Chrome review windows remain open. Ctrl+C closes this demonstration.');
    await new Promise<void>(resolve => { process.once('SIGINT',resolve); process.once('SIGTERM',resolve); });
  }
} finally { await cleanup(); }

import { afterAll, beforeAll, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import pg from 'pg';
import { createClient } from 'redis';
import { buildApp } from './app.js';
import type { AuctionEvents } from '../../shared/realtime.js';

const app = buildApp();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://auction:auction@localhost:55432/auction_part_4' });
const sockets: Socket<AuctionEvents>[] = [];
let base = '';
let slug = '';
beforeAll(async () => {
  base = await app.listen({ port: 0, host: '127.0.0.1' });
  const response = await app.inject({ method: 'POST', url: '/api/auctions', headers: { 'x-demo-user-id': '1' }, payload: {
    title: 'Realtime integration', category: 'GPUs', description: 'Realtime verification', condition: 'Used', location: 'Austin',
    startingPriceCents: 10000, closesAt: new Date(Date.now() + 3600000).toISOString(),
  } });
  expect(response.statusCode).toBe(201);
  slug = response.json().slug;
});
afterAll(async () => {
  sockets.forEach(socket => socket.disconnect());
  if (slug) await pool.query('DELETE FROM auctions WHERE slug=$1', [slug]);
  await app.close(); await pool.end();
});
async function watch(watchedSlug: string) {
  const socket: Socket<AuctionEvents> = io(base, { transports: ['websocket'], auth: { slug: watchedSlug }, autoConnect: false, reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Subscription timed out')), 2000);
    socket.once('auction:watching', change => { clearTimeout(timeout); expect(change.slug).toBe(watchedSlug); resolve(); });
    socket.once('connect_error', error => { clearTimeout(timeout); reject(error); });
    socket.connect();
  });
  return socket;
}
const bid = (amountCents: number, user = '2') => app.inject({ method: 'POST', url: `/api/auctions/${slug}/bids`, headers: { 'x-demo-user-id': user }, payload: { amountCents } });
it('notifies only auction watchers after commit; stale and seller bids emit nothing', async () => {
  const watcher = await watch(slug);
  const other = await watch('unrelated-auction');
  const redis = createClient({ url: process.env.REDIS_URL ?? 'redis://127.0.0.1:56379' });
  redis.on('error', () => {});
  await redis.connect();
  const publications: Buffer[] = [];
  await redis.subscribe(`auction-part-4:socket.io#/#auction:${slug}#`, message => { publications.push(message); }, true);
  const events: string[] = [];
  const otherEvents: string[] = [];
  other.on('auction:changed', change => otherEvents.push(change.slug));
  watcher.on('auction:changed', change => events.push(change.slug));
  const notification = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Missing notification')), 2000);
    watcher.once('auction:changed', change => {
      void pool.query('SELECT amount_cents FROM bids WHERE auction_slug=$1', [change.slug]).then(result => {
        clearTimeout(timeout);
        expect(result.rows.map(row => row.amount_cents)).toEqual([10100]); resolve();
      }).catch(reject);
    });
  });
  expect((await bid(10100)).statusCode).toBe(201);
  await notification;
  expect((await bid(10100)).statusCode).toBe(409);
  expect((await bid(10200, '1')).statusCode).toBe(403);
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(events).toEqual([slug]); expect(otherEvents).toEqual([]);
  expect(publications).toHaveLength(1);
  await redis.close();
});
it('requires Redis before readiness and releases failed-startup connections', async () => {
  const unavailable = buildApp({ redisUrl: 'redis://127.0.0.1:1' });
  try { await expect(unavailable.ready()).rejects.toThrow('Redis must be available before startup'); }
  finally { await unavailable.close(); }
}, 8000);

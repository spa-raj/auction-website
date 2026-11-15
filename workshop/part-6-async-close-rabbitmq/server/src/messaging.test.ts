import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { io, type Socket } from 'socket.io-client';
import { createClient } from 'redis';
import { buildApp } from './app.js';
import { closeDueAuctions } from './close-auctions.js';
import { publishPendingOutbox } from './outbox.js';
import { openBroker, publishConfirmed, notificationQueue, exchange, rabbitUrl } from './broker.js';
import { InvalidCloseEvent, parseCloseEvent, recordNotifications } from './notifications.js';
import { createNotificationSignal } from './notification-signal.js';
import { auctionClosedSchema, type AuctionClosed } from '../../shared/auction-closed.js';
import { notificationsSchema, type NotificationEvents } from '../../shared/notifications.js';

const schema = `messaging_${randomUUID().replaceAll('-', '')}`;
const connectionString = process.env.DATABASE_URL ?? 'postgres://auction:auction@localhost:55432/auction_part_6_test';
const admin = new pg.Pool({ connectionString });
const databaseUrl = new URL(connectionString);
databaseUrl.searchParams.set('options', `-c search_path=${schema}`);
const pool = new pg.Pool({ connectionString: databaseUrl.toString() });
const app = buildApp({ databaseUrl: databaseUrl.toString() });
let base = '';
let broker: Awaited<ReturnType<typeof openBroker>>;
const sockets: Socket<NotificationEvents>[] = [];
beforeAll(async () => {
  expect(new URL(rabbitUrl).pathname).toBe('/auction_part_6_test');
  await admin.query(`CREATE SCHEMA ${schema}`);
  for (const file of ['001_auctions.sql', '002_auction_outcomes.sql', '003_recipient_notifications.sql']) {
    await pool.query(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  await pool.query('TRUNCATE auctions CASCADE');
  broker = await openBroker();
  await broker.channel.purgeQueue(notificationQueue);
  base = await app.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(async () => {
  sockets.forEach(socket => socket.disconnect());
  await app.close();
  if (broker) { await broker.channel.purgeQueue(notificationQueue).catch(() => {}); await broker.connection.close().catch(() => {}); }
  await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
});
async function fixture(sold = true): Promise<AuctionClosed> {
  const slug = `messaging-${randomUUID()}`;
  await pool.query(`INSERT INTO auctions (slug,title,category,description,condition,location,starting_price_cents,seller_id,closes_at)
    VALUES ($1,'Notification test','GPUs','Message fixture','Used','Austin',10000,1,clock_timestamp()-interval '1 second')`, [slug]);
  if (sold) await pool.query('INSERT INTO bids (auction_slug,bidder_id,amount_cents) VALUES ($1,2,10100)', [slug]);
  await closeDueAuctions(pool);
  return auctionClosedSchema.parse((await pool.query('SELECT payload FROM auction_outbox WHERE auction_slug=$1', [slug])).rows[0].payload);
}
async function rows(event: AuctionClosed) {
  return (await pool.query('SELECT * FROM recipient_notifications WHERE event_id=$1 ORDER BY recipient_id', [event.eventId])).rows;
}
const pending = (user: number) => app.inject({ url: '/api/notifications', headers: { 'x-demo-user-id': String(user) } });
const dismiss = (id: string, user: number) => app.inject({ method: 'POST', url: `/api/notifications/${id}/dismiss`, headers: { 'x-demo-user-id': String(user) } });
async function watch(userId: number) {
  const socket: Socket<NotificationEvents> = io(base, { transports: ['websocket'], auth: { userId }, autoConnect: false, reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Recipient room subscription timed out')), 2000);
    socket.once('notifications:watching', () => { clearTimeout(timer); resolve(); });
    socket.once('connect_error', error => { clearTimeout(timer); reject(error); }); socket.connect();
  });
  return socket;
}

describe('confirmed outbox publication', () => {
  it('does not mark events published before confirmation and retains stable IDs after a failed publish', async () => {
    const event = await fixture();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const publisher = vi.fn(async () => { entered(); await gate; });
    const publishing = publishPendingOutbox(pool, publisher);
    try {
      await started;
      expect((await pool.query('SELECT published_at FROM auction_outbox WHERE event_id=$1', [event.eventId])).rows[0].published_at).toBeNull();
    } finally { release(); }
    expect(await publishing).toBe(1);
    expect((await pool.query('SELECT published_at FROM auction_outbox WHERE event_id=$1', [event.eventId])).rows[0].published_at).toBeInstanceOf(Date);
    const failed = await fixture();
    await expect(publishPendingOutbox(pool, async () => { throw new Error('nacked'); })).rejects.toThrow('nacked');
    const stored = (await pool.query('SELECT event_id,published_at FROM auction_outbox WHERE event_id=$1', [failed.eventId])).rows[0];
    expect(stored).toEqual({ event_id: failed.eventId, published_at: null });
    const retry = vi.fn(async (_event: AuctionClosed) => {});
    expect(await publishPendingOutbox(pool, retry)).toBe(1);
    expect(retry.mock.calls[0][0]).toMatchObject({ eventId: failed.eventId });
    expect(await publishPendingOutbox(pool, retry)).toBe(0);
  });

  it('publishes persistent messages to the real broker with confirms and marks only after acceptance', async () => {
    const event = await fixture();
    expect(await publishPendingOutbox(pool, value => publishConfirmed(broker.channel, value))).toBe(1);
    const message = await broker.channel.get(notificationQueue, { noAck: false });
    expect(message).not.toBe(false);
    if (!message) throw new Error('Expected close event');
    expect(message.properties).toMatchObject({ messageId: event.eventId, deliveryMode: 2, contentType: 'application/json' });
    expect(parseCloseEvent(message.content)).toEqual(event);
    broker.channel.ack(message);
  });

  it('leaves unroutable events pending even if RabbitMQ confirms receipt by the exchange', async () => {
    const event = await fixture();
    await broker.channel.unbindQueue(notificationQueue, exchange, 'auction.closed');
    try {
      await expect(publishPendingOutbox(pool, value => publishConfirmed(broker.channel, value))).rejects.toThrow('unroutable');
      expect((await pool.query('SELECT published_at FROM auction_outbox WHERE event_id=$1', [event.eventId])).rows[0].published_at).toBeNull();
    } finally { await broker.channel.bindQueue(notificationQueue, exchange, 'auction.closed'); }
    await publishPendingOutbox(pool, async () => {});
  });
});

describe('durable recipient processing', () => {
  it('selects only seller and winner; no-bid auctions select only the seller', async () => {
    const sold = await fixture(); const noBids = await fixture(false);
    expect(await recordNotifications(pool, sold)).toEqual([1, 2]);
    expect(await recordNotifications(pool, noBids)).toEqual([1]);
    expect((await rows(sold)).map(row => [row.recipient_id,row.role])).toEqual([[1,'seller'],[2,'winner']]);
    expect((await rows(noBids)).map(row => [row.recipient_id,row.role])).toEqual([[1,'seller']]);
    const loser = notificationsSchema.parse((await pending(3)).json());
    expect(loser.notifications).toEqual([]);
  });

  it('makes concurrent redelivery idempotent and cannot revive a dismissed notification', async () => {
    const event = await fixture();
    await Promise.all(Array.from({ length: 4 }, () => recordNotifications(pool,event)));
    const before = await rows(event); expect(before).toHaveLength(2);
    expect((await dismiss(before[0].id as string,1)).statusCode).toBe(200);
    expect((await dismiss(before[0].id as string,1)).statusCode).toBe(200);
    await recordNotifications(pool,event);
    const after = await rows(event);
    expect(after.map(row => row.id)).toEqual(before.map(row => row.id));
    expect(after[0].dismissed_at).toBeInstanceOf(Date); expect(after[1].dismissed_at).toBeNull();
    expect(notificationsSchema.parse((await pending(1)).json()).notifications.some(notice => notice.event.eventId === event.eventId)).toBe(false);
    expect(notificationsSchema.parse((await pending(2)).json()).notifications.some(notice => notice.event.eventId === event.eventId)).toBe(true);
    expect((await dismiss(before[1].id as string,3)).statusCode).toBe(404);
  });

  it('rolls back all recipients on insertion failure and retries without partial delivery', async () => {
    const event = await fixture();
    await pool.query(`CREATE FUNCTION fail_recipient() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.recipient_id=2 THEN RAISE EXCEPTION 'recipient insert failed'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_recipient BEFORE INSERT ON recipient_notifications FOR EACH ROW EXECUTE FUNCTION fail_recipient()`);
    try {
      await expect(recordNotifications(pool,event)).rejects.toThrow('recipient insert failed');
      expect(await rows(event)).toHaveLength(0);
    } finally { await pool.query('DROP TRIGGER fail_recipient ON recipient_notifications; DROP FUNCTION fail_recipient()'); }
    await recordNotifications(pool,event); expect(await rows(event)).toHaveLength(2);
  });

  it('rejects malformed, unsupported and forged recipient events', async () => {
    expect(() => parseCloseEvent(Buffer.from('not JSON'))).toThrow(InvalidCloseEvent);
    expect(() => parseCloseEvent(Buffer.from('{"version":99}'))).toThrow(InvalidCloseEvent);
    const event = await fixture();
    await expect(recordNotifications(pool,{ ...event, sellerId: 3 })).rejects.toThrow(InvalidCloseEvent);
    expect(await rows(event)).toHaveLength(0);
    expect((await app.inject('/api/notifications')).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/notifications/invalid/dismiss', headers: { 'x-demo-user-id': '1' } })).statusCode).toBe(400);
  });

  it('recovers real broker redelivery after recipient commit but before acknowledgement', async () => {
    const event = await fixture();
    await broker.channel.purgeQueue(notificationQueue);
    await publishConfirmed(broker.channel,event);
    const original = await broker.channel.get(notificationQueue, { noAck: false });
    if (!original) throw new Error('Missing initial delivery');
    await recordNotifications(pool,parseCloseEvent(original.content));
    const before = await rows(event);
    await dismiss(before[0].id as string,1);
    // Simulate a crash in the commit-to-ack gap: closing requeues the unacked message.
    await broker.connection.close(); broker = await openBroker();
    let redelivered = await broker.channel.get(notificationQueue, { noAck: false });
    for (let attempt = 0; !redelivered && attempt < 20; attempt++) {
      await sleep(25); redelivered = await broker.channel.get(notificationQueue, { noAck: false });
    }
    if (!redelivered) throw new Error('Missing redelivery');
    expect(redelivered.fields.redelivered).toBe(true);
    await recordNotifications(pool,parseCloseEvent(redelivered.content)); broker.channel.ack(redelivered);
    const after = await rows(event);
    expect(after.map(row => row.id)).toEqual(before.map(row => row.id));
    expect(after[0].dismissed_at).toBeInstanceOf(Date);
  });

  it('delivers real Redis emitter signals to matching Socket.IO recipients and synchronizes dismissals', async () => {
    const seller = await watch(1); const winner = await watch(2); const loser = await watch(3);
    const events = [0,0,0];
    [seller,winner,loser].forEach((socket,i) => socket.on('notifications:changed', () => events[i]++));
    const redis = createClient({ url: process.env.REDIS_URL ?? 'redis://127.0.0.1:56379' });
    redis.on('error', () => {}); await redis.connect();
    const publications: string[] = [];
    await redis.pSubscribe(`${process.env.REDIS_CHANNEL_PREFIX ?? 'auction-part-6:socket.io'}#/#user:*`, (_message,channel) => publications.push(channel));
    const signals = createNotificationSignal(); await signals.redis.connect();
    try {
      const event = await fixture(); const recipients = await recordNotifications(pool,event);
      for (const user of recipients) signals.changed(user);
      await vi.waitFor(() => expect(events).toEqual([1,1,0]));
      expect(publications.some(channel => channel.includes('user:1'))).toBe(true);
      expect(publications.some(channel => channel.includes('user:2'))).toBe(true);
      const sellerNotice = (await rows(event))[0];
      await dismiss(sellerNotice.id as string,1);
      await vi.waitFor(() => expect(events[0]).toBe(2));
      expect(events[1]).toBe(1); expect(events[2]).toBe(0);
    } finally { signals.redis.destroy(); await redis.close(); }
  });
});

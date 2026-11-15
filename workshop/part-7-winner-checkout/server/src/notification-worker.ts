import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { openBroker, notificationQueue } from './broker.js';
import { InvalidCloseEvent, parseCloseEvent, recordNotifications } from './notifications.js';
import { createNotificationSignal } from './notification-signal.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://auction:auction@localhost:55432/auction_part_7?options=-csearch_path%3Dwinner_checkout',
  application_name: 'auction-part-7-notification-worker', connectionTimeoutMillis: 1000, statement_timeout: 10000 });
pool.on('error', error => console.error('Notification database connection error', error));
const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => stop.abort());
const signals = createNotificationSignal();
void signals.redis.connect().catch(error => console.error('Notification Redis startup failed', error));
let backoff = 1000;
try {
  while (!stop.signal.aborted) {
    let broker: Awaited<ReturnType<typeof openBroker>> | undefined;
    let processing = Promise.resolve();
    try {
      broker = await openBroker();
      const { connection, channel } = broker;
      const lost = new Promise<void>(resolve => { connection.once('close', resolve); channel.once('close', resolve); });
      await channel.prefetch(1);
      const consumer = await channel.consume(notificationQueue, message => {
        if (!message) { void channel.close().catch(() => {}); return; }
        processing = (async () => {
          try {
            const event = parseCloseEvent(message.content);
            const recipients = await recordNotifications(pool, event);
            backoff = 1000;
            channel.ack(message); // durable records now own recovery; not browser receipt
            for (const userId of recipients) signals.changed(userId);
          } catch (error) {
            console.error({ error, messageId: message.properties.messageId }, 'Notification processing failed');
            if (error instanceof InvalidCloseEvent) channel.reject(message, false);
            else {
              await sleep(backoff);
              backoff = Math.min(backoff * 2, 10000);
              channel.nack(message, false, true);
            }
          }
        })().catch(error => { console.error('Notification channel lost during delivery', error); void channel.close().catch(() => {}); });
      }, { noAck: false });
      backoff = 1000;
      console.info('Notification worker consuming auction.closed');
      let onStop: () => void = () => {};
      const stopped = new Promise<void>(resolve => {
        onStop = resolve;
        if (stop.signal.aborted) resolve();
        else stop.signal.addEventListener('abort', onStop, { once: true });
      });
      await Promise.race([lost, stopped]);
      stop.signal.removeEventListener('abort', onStop);
      await channel.cancel(consumer.consumerTag).catch(() => {});
      await processing;
    } catch (error) { console.error('Notification worker reconnecting', error); }
    finally { if (broker) await broker.connection.close().catch(() => {}); }
    try { await sleep(backoff, undefined, { signal: stop.signal }); } catch { /* shutdown */ }
    backoff = Math.min(backoff * 2, 10000);
  }
} finally { if (signals.redis.isOpen) signals.redis.destroy(); await pool.end(); }

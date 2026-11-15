import { startTelemetry } from '../../shared/otel.js';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { openBroker, publishConfirmed } from './broker.js';
import { publishPendingOutbox } from './outbox.js';
import { closeDueAuctions } from './close-auctions.js';

const telemetry = startTelemetry('auction-part-8-close-worker');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://auction:auction@localhost:55432/auction_part_8?options=-csearch_path%3Dwinner_checkout',
  application_name: 'auction-part-8-close-worker', connectionTimeoutMillis: 1000,
  statement_timeout: 10000,
});
const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => stop.abort());
pool.on('error', error => console.error('Close worker database connection error', error));
console.info('Auction close worker started; polling every second');
const relay = (async () => {
  let backoff = 1000;
  while (!stop.signal.aborted) {
    let broker: Awaited<ReturnType<typeof openBroker>> | undefined;
    try {
      broker = await openBroker();
      const channel = broker.channel;
      while (!stop.signal.aborted) {
        const count = await publishPendingOutbox(pool, (event, carrier) => publishConfirmed(channel, event, carrier));
        if (count) console.info({ count }, 'Outbox publication confirmed');
        backoff = 1000;
        await sleep(1000, undefined, { signal: stop.signal });
      }
    } catch (error) { if (!stop.signal.aborted) console.error('Outbox relay retrying; outcomes remain independent', error); }
    finally { if (broker) await broker.connection.close().catch(() => {}); }
    try { await sleep(backoff, undefined, { signal: stop.signal }); } catch { /* shutdown */ }
    backoff = Math.min(backoff * 2, 10000);
  }
})();
try {
  while (!stop.signal.aborted) {
    try {
      const closed = await closeDueAuctions(pool);
      if (closed.length) console.info({ closed }, 'Auction outcomes and outbox events committed');
    } catch (error) { console.error('Auction close batch failed; retrying next poll', error); }
    try { await sleep(1000, undefined, { signal: stop.signal }); }
    catch (error) { if (!stop.signal.aborted) throw error; }
  }
} finally { await relay; await pool.end(); await telemetry.shutdown(); }

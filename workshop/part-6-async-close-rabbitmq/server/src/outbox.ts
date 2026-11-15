import type pg from 'pg';
import { auctionClosedSchema, type AuctionClosed } from '../../shared/auction-closed.js';

export async function publishPendingOutbox(pool: pg.Pool, publish: (event: AuctionClosed) => Promise<void>): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pending = await client.query<{ event_id: string; payload: unknown }>(`SELECT event_id,payload FROM auction_outbox
      WHERE published_at IS NULL ORDER BY created_at,event_id LIMIT 25 FOR UPDATE SKIP LOCKED`);
    for (const row of pending.rows) {
      const event = auctionClosedSchema.parse(row.payload);
      if (event.eventId !== row.event_id) throw new Error('Outbox event ID does not match its payload');
      await publish(event);
      // The publish promise resolves only after broker confirmation.
      await client.query('UPDATE auction_outbox SET published_at=clock_timestamp() WHERE event_id=$1', [row.event_id]);
    }
    await client.query('COMMIT');
    return pending.rowCount ?? 0;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

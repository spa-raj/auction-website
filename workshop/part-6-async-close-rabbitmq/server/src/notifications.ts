import type pg from 'pg';
import { auctionClosedSchema, type AuctionClosed } from '../../shared/auction-closed.js';

export class InvalidCloseEvent extends Error {}
export function parseCloseEvent(content: Buffer): AuctionClosed {
  try { return auctionClosedSchema.parse(JSON.parse(content.toString('utf8')) as unknown); }
  catch { throw new InvalidCloseEvent('Malformed or unsupported auction close event'); }
}

/** Commit every recipient together; conflict handling preserves IDs and dismissals. */
export async function recordNotifications(pool: pg.Pool, event: AuctionClosed): Promise<number[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stored = await client.query<{ payload: unknown }>('SELECT payload FROM auction_outbox WHERE event_id=$1', [event.eventId]);
    if (!stored.rows[0] || JSON.stringify(auctionClosedSchema.parse(stored.rows[0].payload)) !== JSON.stringify(event)) {
      throw new InvalidCloseEvent('Close event does not match its recorded outbox event');
    }
    const recipients = [{ userId: event.sellerId, role: 'seller' }];
    if (event.outcome.status === 'sold' && event.outcome.winnerId !== event.sellerId) {
      recipients.push({ userId: event.outcome.winnerId, role: 'winner' });
    }
    for (const recipient of recipients) {
      await client.query(`INSERT INTO recipient_notifications (event_id,recipient_id,role) VALUES ($1,$2,$3)
        ON CONFLICT (event_id,recipient_id) DO NOTHING`, [event.eventId,recipient.userId,recipient.role]);
    }
    await client.query('COMMIT');
    return recipients.map(recipient => recipient.userId);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

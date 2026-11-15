import { eq } from 'drizzle-orm';
import { database } from './db.js';
import { notifications, outbox } from './schema.js';
import type pg from 'pg';
import { auctionClosedSchema, type AuctionClosed } from '../../shared/auction-closed.js';

export class InvalidCloseEvent extends Error {}
export function parseCloseEvent(content: Buffer): AuctionClosed {
  try { return auctionClosedSchema.parse(JSON.parse(content.toString('utf8')) as unknown); }
  catch { throw new InvalidCloseEvent('Malformed or unsupported auction close event'); }
}

/** Commit every recipient together; conflict handling preserves IDs and dismissals. */
export async function recordNotifications(pool: pg.Pool, event: AuctionClosed): Promise<number[]> {
  return database(pool).transaction(async tx => {
    const [stored] = await tx.select({ payload: outbox.payload }).from(outbox).where(eq(outbox.eventId, event.eventId));
    if (!stored || JSON.stringify(auctionClosedSchema.parse(stored.payload)) !== JSON.stringify(event)) {
      throw new InvalidCloseEvent('Close event does not match its recorded outbox event');
    }
    const recipients: { userId: number; role: 'seller' | 'winner' }[] = [{ userId: event.sellerId, role: 'seller' }];
    if (event.outcome.status === 'sold' && event.outcome.winnerId !== event.sellerId) {
      recipients.push({ userId: event.outcome.winnerId, role: 'winner' });
    }
    for (const recipient of recipients) {
      await tx.insert(notifications).values({ eventId: event.eventId, recipientId: recipient.userId, role: recipient.role })
        .onConflictDoNothing({ target: [notifications.eventId, notifications.recipientId] });
    }
    return recipients.map(recipient => recipient.userId);
  });
}

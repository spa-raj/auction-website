import { asc, eq, isNull, sql } from 'drizzle-orm';
import type pg from 'pg';
import { database } from './db.js';
import { outbox } from './schema.js';
import { auctionClosedSchema, type AuctionClosed } from '../../shared/auction-closed.js';

export async function publishPendingOutbox(pool: pg.Pool, publish: (event: AuctionClosed) => Promise<void>): Promise<number> {
  return database(pool).transaction(async tx => {
    const pending = await tx.select({ eventId: outbox.eventId, payload: outbox.payload }).from(outbox)
      .where(isNull(outbox.publishedAt)).orderBy(asc(outbox.createdAt), asc(outbox.eventId))
      .limit(25).for('update', { skipLocked: true });
    for (const row of pending) {
      const event = auctionClosedSchema.parse(row.payload);
      if (event.eventId !== row.eventId) throw new Error('Outbox event ID does not match its payload');
      await publish(event);
      // The publish promise resolves only after broker confirmation.
      await tx.update(outbox).set({ publishedAt: sql`clock_timestamp()` }).where(eq(outbox.eventId, row.eventId));
    }
    return pending.length;
  });
}

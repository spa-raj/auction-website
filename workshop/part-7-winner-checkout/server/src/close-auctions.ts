import { and, asc, desc, eq, lte, notExists } from 'drizzle-orm';
import { database } from './db.js';
import { auctions, bids, outcomes, outbox, purchases } from './schema.js';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { auctionClosedSchema } from '../../shared/auction-closed.js';

const optionsSchema = z.object({ batchSize: z.number().int().min(1).max(100), now: z.date() });

/** One bounded transaction; skipped auctions are retried on the next poll. */
export async function closeDueAuctions(pool: pg.Pool, { batchSize = 25, clock = () => new Date() }: {
  batchSize?: number; clock?: () => Date;
} = {}): Promise<string[]> {
  const { now } = optionsSchema.parse({ batchSize, now: clock() });
  return database(pool).transaction(async tx => {
    const due = await tx.select().from(auctions).where(and(lte(auctions.closesAt, now),
      notExists(tx.select({ slug: outcomes.auctionSlug }).from(outcomes).where(eq(outcomes.auctionSlug, auctions.slug)))))
      .orderBy(asc(auctions.closesAt), asc(auctions.slug)).limit(batchSize).for('update', { of: auctions, skipLocked: true });
    const closed: string[] = [];
    for (const auction of due) {
      // Recheck in a fresh snapshot after claiming: another closer may have
      // committed after the claim statement took its initial snapshot.
      if ((await tx.select().from(outcomes).where(eq(outcomes.auctionSlug, auction.slug))).length) continue;
      // Fresh snapshot after acquiring the auction lock, including bids committed while waiting.
      const [bid] = await tx.select().from(bids).where(eq(bids.auctionSlug, auction.slug))
        .orderBy(desc(bids.amountCents), asc(bids.createdAt), asc(bids.id)).limit(1);
      const event = auctionClosedSchema.parse({
        eventId: randomUUID(), type: 'auction.closed', version: 1,
        auctionSlug: auction.slug, title: auction.title, sellerId: auction.sellerId,
        closesAt: auction.closesAt.toISOString(), finalizedAt: now.toISOString(),
        outcome: bid ? { status: 'sold', winningBidId: bid.id, winnerId: bid.bidderId, winningAmountCents: bid.amountCents }
          : { status: 'no_bids', winningBidId: null, winnerId: null, winningAmountCents: null },
      });
      await tx.insert(outcomes).values({ auctionSlug: auction.slug, status: event.outcome.status,
        winningBidId: event.outcome.winningBidId, winnerId: event.outcome.winnerId,
        winningAmountCents: event.outcome.winningAmountCents, closesAt: new Date(event.closesAt), finalizedAt: now });
      if (event.outcome.status === 'sold') {
        await tx.insert(purchases).values({ auctionSlug: auction.slug, winnerId: event.outcome.winnerId,
          amountCents: event.outcome.winningAmountCents });
      }
      await tx.insert(outbox).values({ eventId: event.eventId, auctionSlug: auction.slug,
        eventType: event.type, eventVersion: event.version, payload: event, createdAt: now });
      closed.push(auction.slug);
    }
    return closed;
  });
}

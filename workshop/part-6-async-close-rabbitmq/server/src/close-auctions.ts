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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const due = await client.query<{ slug: string; title: string; seller_id: number; closes_at: Date }>(`
      SELECT a.slug, a.title, a.seller_id, a.closes_at FROM auctions a
      WHERE a.closes_at <= $1 AND NOT EXISTS (
        SELECT 1 FROM auction_outcomes o WHERE o.auction_slug = a.slug)
      ORDER BY a.closes_at, a.slug LIMIT $2 FOR UPDATE OF a SKIP LOCKED`, [now, batchSize]);
    const closed: string[] = [];
    for (const auction of due.rows) {
      // Recheck in a fresh snapshot after claiming: another closer may have
      // committed after the claim statement took its initial snapshot.
      if ((await client.query('SELECT 1 FROM auction_outcomes WHERE auction_slug=$1', [auction.slug])).rowCount) continue;
      // Separate statement after the auction lock: observe any bid that committed
      // before we claimed it, including a pre-deadline bid committing after expiry.
      const bid = (await client.query<{ id: number; bidder_id: number; amount_cents: number }>(`
        SELECT id, bidder_id, amount_cents FROM bids WHERE auction_slug=$1
        ORDER BY amount_cents DESC, created_at, id LIMIT 1`, [auction.slug])).rows[0];
      const event = auctionClosedSchema.parse({
        eventId: randomUUID(), type: 'auction.closed', version: 1,
        auctionSlug: auction.slug, title: auction.title, sellerId: auction.seller_id,
        closesAt: auction.closes_at.toISOString(), finalizedAt: now.toISOString(),
        outcome: bid ? { status: 'sold', winningBidId: bid.id, winnerId: bid.bidder_id, winningAmountCents: bid.amount_cents }
          : { status: 'no_bids', winningBidId: null, winnerId: null, winningAmountCents: null },
      });
      await client.query(`INSERT INTO auction_outcomes
        (auction_slug,status,winning_bid_id,winner_id,winning_amount_cents,closes_at,finalized_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`, [auction.slug,event.outcome.status,event.outcome.winningBidId,
        event.outcome.winnerId,event.outcome.winningAmountCents,event.closesAt,event.finalizedAt]);
      await client.query(`INSERT INTO auction_outbox
        (event_id,auction_slug,event_type,event_version,payload,created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
        [event.eventId,auction.slug,event.type,event.version,event,event.finalizedAt]);
      closed.push(auction.slug);
    }
    await client.query('COMMIT');
    return closed;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

import { and, asc, count, desc, eq, getTableColumns, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database, Transaction } from './db.js';
import { auctions, bids, outcomes, users } from './schema.js';
import { categories, finalOutcomeSchema, type Auction } from '../../shared/auction.js';

export type AuctionRow = Omit<Auction, 'closesAt' | 'createdAt' | 'ended'> & { closesAt: Date; createdAt: Date };
export async function readAuctions(db: Database | Transaction, { slug, q = '', category, sort = 'newest' }: {
  slug?: string; q?: string; category?: typeof categories[number]; sort?: 'newest' | 'closing' | 'price-asc' | 'price-desc';
} = {}): Promise<AuctionRow[]> {
  const seller = alias(users, 'seller');
  const bidder = alias(users, 'bidder');
  const winner = alias(users, 'winner');
  const top = db.select({ id: bids.id, bidderId: bids.bidderId, amountCents: bids.amountCents })
    .from(bids).where(eq(bids.auctionSlug, auctions.slug))
    .orderBy(desc(bids.amountCents), asc(bids.createdAt), asc(bids.id)).limit(1).as('top_bid');
  const currentAmount = sql<number>`coalesce(${top.amountCents}, ${auctions.startingPriceCents})`;
  const historyCount = db.select({ value: count() }).from(bids).where(eq(bids.auctionSlug, auctions.slug));
  const order: SQL[] = { newest: [desc(auctions.createdAt)], closing: [asc(auctions.closesAt)],
    'price-asc': [asc(currentAmount)], 'price-desc': [desc(currentAmount)] }[sort];
  const rows = await db.select({ ...getTableColumns(auctions), seller: { id: seller.id, name: seller.name },
    currentAmountCents: currentAmount, bidCount: sql<number>`(${historyCount})`.mapWith(Number),
    currentBidder: { id: bidder.id, name: bidder.name },
    outcome: { status: outcomes.status, winningAmountCents: outcomes.winningAmountCents, finalizedAt: outcomes.finalizedAt },
    winner: { id: winner.id, name: winner.name },
  }).from(auctions).innerJoin(seller, eq(seller.id, auctions.sellerId))
    .leftJoinLateral(top, sql`true`).leftJoin(bidder, eq(bidder.id, top.bidderId))
    .leftJoin(outcomes, eq(outcomes.auctionSlug, auctions.slug)).leftJoin(winner, eq(winner.id, outcomes.winnerId))
    .where(and(slug === undefined ? undefined : eq(auctions.slug, slug), category === undefined ? undefined : eq(auctions.category, category),
      q === '' ? undefined : sql`strpos(lower(${auctions.title} || ' ' || ${auctions.category} || ' ' || ${auctions.kicker} || ' ' || ${auctions.description}), lower(${q})) > 0`))
    .orderBy(...order, asc(auctions.slug));
  return rows.map(({ sellerId: _sellerId, outcome, winner: winningUser, ...row }) => ({ ...row,
    finalOutcome: outcome === null ? null : finalOutcomeSchema.parse({ ...outcome, winner: winningUser, finalizedAt: outcome.finalizedAt.toISOString() }),
  }));
}

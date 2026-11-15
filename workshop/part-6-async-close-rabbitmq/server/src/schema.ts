import { sql } from 'drizzle-orm';
import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { AuctionClosed } from '../../shared/auction-closed.js';
import { categories } from '../../shared/auction.js';

const instant = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
// Existing explicit migrations own constraints, indexes and defaults. These mappings
// describe that schema for queries; startup never pushes or regenerates the schema.
export const users = pgTable('demo_users', {
  id: integer('id').primaryKey(), name: text('name').notNull(),
});
export const auctions = pgTable('auctions', {
  slug: text('slug').primaryKey(), title: text('title').notNull(),
  category: text('category', { enum: categories }).notNull(), description: text('description').notNull(),
  condition: text('condition').notNull(), location: text('location').notNull(),
  startingPriceCents: integer('starting_price_cents').notNull(), sellerId: integer('seller_id').notNull(),
  closesAt: instant('closes_at').notNull(), createdAt: instant('created_at').notNull().defaultNow(),
  kicker: text('kicker').notNull().default(''), specs: jsonb('specs').$type<[string, string][]>().notNull().default([]),
});
export const bids = pgTable('bids', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(), auctionSlug: text('auction_slug').notNull(),
  bidderId: integer('bidder_id').notNull(), amountCents: integer('amount_cents').notNull(),
  createdAt: instant('created_at').notNull().defaultNow(),
});
export const outcomes = pgTable('auction_outcomes', {
  auctionSlug: text('auction_slug').primaryKey(), status: text('status', { enum: ['sold', 'no_bids'] }).notNull(),
  winningBidId: integer('winning_bid_id'), winnerId: integer('winner_id'), winningAmountCents: integer('winning_amount_cents'),
  closesAt: instant('closes_at').notNull(), finalizedAt: instant('finalized_at').notNull(),
});
export const outbox = pgTable('auction_outbox', {
  eventId: uuid('event_id').primaryKey(), auctionSlug: text('auction_slug').notNull(),
  eventType: text('event_type').notNull(), eventVersion: integer('event_version').notNull(),
  payload: jsonb('payload').$type<AuctionClosed>().notNull(), createdAt: instant('created_at').notNull(),
  publishedAt: instant('published_at'),
});
export const notifications = pgTable('recipient_notifications', {
  id: uuid('id').primaryKey().defaultRandom(), eventId: uuid('event_id').notNull(),
  recipientId: integer('recipient_id').notNull(), role: text('role', { enum: ['seller', 'winner'] }).notNull(),
  createdAt: instant('created_at').notNull().default(sql`clock_timestamp()`), dismissedAt: instant('dismissed_at'),
});

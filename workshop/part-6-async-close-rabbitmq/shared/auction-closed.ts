import { z } from 'zod';

export const auctionClosedSchema = z.object({
  eventId: z.uuid(), type: z.literal('auction.closed'), version: z.literal(1),
  auctionSlug: z.string().regex(/^[a-z0-9-]{1,180}$/), title: z.string().min(1).max(120),
  sellerId: z.number().int().positive(), closesAt: z.iso.datetime(), finalizedAt: z.iso.datetime(),
  outcome: z.discriminatedUnion('status', [
    z.object({ status: z.literal('sold'), winningBidId: z.number().int().positive(), winnerId: z.number().int().positive(), winningAmountCents: z.number().int().positive() }).strict(),
    z.object({ status: z.literal('no_bids'), winningBidId: z.null(), winnerId: z.null(), winningAmountCents: z.null() }).strict(),
  ]),
}).strict();
export type AuctionClosed = z.infer<typeof auctionClosedSchema>;

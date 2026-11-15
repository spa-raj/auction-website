import { z } from 'zod';

export const categories = ['GPUs', 'CPUs', 'Memory', 'Chassis', 'Networking', 'Cooling'] as const;
export const conditions = ['New', 'Open box', 'Used', 'Refurbished'] as const;
export const userSchema = z.object({ id: z.number().int().positive(), name: z.string() });
export type DemoUser = z.infer<typeof userSchema>;
export const createAuctionSchema = z.object({
  title: z.string().trim().min(1).max(120),
  category: z.enum(categories),
  description: z.string().trim().min(1).max(5000),
  condition: z.enum(conditions),
  location: z.string().trim().min(1).max(120),
  startingPriceCents: z.number().int().min(1).max(100_000_000),
  closesAt: z.iso.datetime().refine(value => Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now(), 'Choose a future closing time.'),
});
export const bidSchema = z.object({ id: z.number().int(), bidder: userSchema, amountCents: z.number().int(), createdAt: z.iso.datetime() });
export const auctionSchema = z.object({
  slug: z.string(), title: z.string(), category: z.enum(categories), description: z.string(), condition: z.string(), location: z.string(),
  startingPriceCents: z.number().int(), currentAmountCents: z.number().int(), bidCount: z.number().int(),
  closesAt: z.iso.datetime(), createdAt: z.iso.datetime(), seller: userSchema,
  kicker: z.string(), specs: z.array(z.tuple([z.string(), z.string()])), currentBidder: userSchema.nullable(),
  ended: z.boolean(),
});
export const detailSchema = z.object({ auction: auctionSchema, bids: z.array(bidSchema), serverTime: z.iso.datetime() });
export const listSchema = z.object({ auctions: z.array(auctionSchema), serverTime: z.iso.datetime() });
export type Auction = z.infer<typeof auctionSchema>;
export type Bid = z.infer<typeof bidSchema>;
export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

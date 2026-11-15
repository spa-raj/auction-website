import { z } from 'zod';

export const categories = ['GPUs', 'CPUs', 'Memory', 'Chassis', 'Networking', 'Cooling'] as const;
export const conditions = ['New', 'Open box', 'Used', 'Refurbished'] as const;
export const userSchema = z.object({ id: z.number().int().positive(), name: z.string() });
export type DemoUser = z.infer<typeof userSchema>;
export const maximumStartingPriceCents = 100_000_000;
export const maximumStartingPriceMessage = 'The starting price must be at most $1,000,000.';
export const minimumStartingPriceMessage = 'The starting price must be at least $0.01.';
export const invalidClosingTimeMessage = 'Enter a valid closing date and time.';
export const futureClosingTimeMessage = 'Choose a future closing date and time.';

export const createAuctionSchema = z.object({
  title: z.string().trim().min(1, 'Enter a title.').max(120, 'Use at most 120 characters for the title.'),
  category: z.enum(categories),
  description: z.string().trim().min(1, 'Enter a description.').max(5000, 'Use at most 5,000 characters for the description.'),
  condition: z.enum(conditions),
  location: z.string().trim().min(1, 'Enter a location.').max(120, 'Use at most 120 characters for the location.'),
  startingPriceCents: z.number({ error: 'Enter a valid USD amount.' })
    .min(1, minimumStartingPriceMessage).max(maximumStartingPriceCents, maximumStartingPriceMessage)
    .refine(Number.isInteger, 'The starting price must use whole cents.'),
  closesAt: z.iso.datetime({ error: invalidClosingTimeMessage })
    .pipe(z.string().refine(value => Date.parse(value) > Date.now(), futureClosingTimeMessage)),
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

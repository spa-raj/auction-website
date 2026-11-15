import { z } from 'zod';

export const purchaseSchema = z.object({
  id: z.uuid(), auctionSlug: z.string(), amountCents: z.number().int().positive(),
  currency: z.literal('usd'), status: z.enum(['unpaid', 'paid']), paidAt: z.iso.datetime().nullable(),
});
export const purchaseResponseSchema = z.object({ purchase: purchaseSchema });
export const checkoutResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('checkout'), url: z.url() }),
  z.object({ status: z.literal('paid') }),
]);
export type Purchase = z.infer<typeof purchaseSchema>;

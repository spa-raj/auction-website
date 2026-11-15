import { z } from 'zod';

export const purchaseStatusSchema = z.object({
  auctionSlug: z.string(), amountCents: z.number().int().positive(),
  currency: z.literal('usd'), status: z.enum(['unpaid', 'paid']), paidAt: z.iso.datetime().nullable(),
});
export const purchaseSchema = purchaseStatusSchema.extend({ id: z.uuid() });
export const recoverySchema = z.enum(['none', 'confirmation_pending', 'checkout_missing', 'service_unavailable']);
export const purchaseResponseSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('winner'), purchase: purchaseSchema, recovery: recoverySchema }),
  z.object({ role: z.literal('seller'), purchase: purchaseStatusSchema, recovery: recoverySchema }),
]);
export const checkoutResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('checkout'), url: z.url() }),
  z.object({ status: z.literal('paid') }),
  z.object({ status: z.literal('confirmation_pending') }),
]);
export type Purchase = z.infer<typeof purchaseStatusSchema>;
export type PurchaseResponse = z.infer<typeof purchaseResponseSchema>;

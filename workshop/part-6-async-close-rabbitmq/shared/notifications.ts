import { z } from 'zod';
import { auctionClosedSchema } from './auction-closed.js';

export const recipientSchema = z.object({ userId: z.number().int().min(1).max(10) });
export const notificationSchema = z.object({
  id: z.uuid(), role: z.enum(['seller', 'winner']), event: auctionClosedSchema,
});
export const notificationsSchema = z.object({ notifications: z.array(notificationSchema) });
export type OutcomeNotification = z.infer<typeof notificationSchema>;
export interface NotificationEvents {
  'notifications:watching': (recipient: z.infer<typeof recipientSchema>) => void;
  'notifications:changed': (recipient: z.infer<typeof recipientSchema>) => void;
}

import { z } from 'zod';

export const auctionChangeSchema = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,180}$/) });
export type AuctionChange = z.infer<typeof auctionChangeSchema>;
export interface AuctionEvents {
  'auction:changed': (change: AuctionChange) => void;
  'auction:watching': (change: AuctionChange) => void;
}

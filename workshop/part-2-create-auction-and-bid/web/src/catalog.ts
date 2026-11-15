export { formatCurrency, categories, conditions } from '../../shared/auction';
export type { Auction, DemoUser, Bid } from '../../shared/auction';
export type ProductArtKind = 'gpu' | 'cpu' | 'memory' | 'chassis' | 'switch' | 'cooling';
export const artByCategory: Record<string, ProductArtKind> = { GPUs: 'gpu', CPUs: 'cpu', Memory: 'memory', Chassis: 'chassis', Networking: 'switch', Cooling: 'cooling' };
export function timeLeft(closesAt: string, now = Date.now()): string {
  const minutes = Math.ceil((Date.parse(closesAt) - now) / 60000);
  if (minutes <= 0) return 'Ended';
  if (minutes < 60) return `${minutes}m left`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m left`;
  return `${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h left`;
}

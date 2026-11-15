import { type Auction, formatCurrency, artByCategory, timeLeft } from '../catalog';
import { ProductArt } from './ProductArt';
export function ProductCard({ item, now }: { item: Auction; now: number }) {
  return <article className="product-card"><a className="product-image-link" href={`/items/${item.slug}`}><ProductArt kind={artByCategory[item.category]} label={`Illustration of ${item.title}`} /><span className="time-pill">{item.ended ? 'Ended' : timeLeft(item.closesAt, now)}</span></a><div className="product-card-body"><p className="product-category">{item.category}</p><h3><a href={`/items/${item.slug}`}>{item.title}</a></h3><p className="product-kicker">{item.kicker || item.condition}</p><div className="price-row"><strong>{formatCurrency(item.currentAmountCents)}</strong><span>{item.bidCount} bids</span></div></div></article>;
}

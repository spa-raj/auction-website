import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { detailSchema, listSchema, userSchema } from '../../shared/auction';
import { artByCategory, categories, formatCurrency, timeLeft, type Auction, type Bid, type DemoUser } from './catalog';
import { ApiError, fetchJson } from './api';
import { ProductArt } from './components/ProductArt';
import { ProductCard } from './components/ProductCard';
import { SiteHeader } from './components/SiteHeader';
import { NewAuctionPage } from './components/NewAuctionPage';
import { initialTabUser, rememberTabUser } from './demo-user';

function Message({ children }: { children: string }) { return <p role="alert" className="error-message">{children}</p>; }
function CatalogPage({ home }: { home: boolean }) {
  const params = new URLSearchParams(location.search);
  const [sort, setSort] = useState(params.get('sort') ?? 'newest');
  const [category, setCategory] = useState(params.get('category') ?? '');
  const [items, setItems] = useState<Auction[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, []);
  const query = params.get('q') ?? '';
  useEffect(() => {
    const controller = new AbortController();
    const filter = new URLSearchParams({ q: query, sort });
    if (category) filter.set('category',category);
    setLoading(true); setError('');
    fetchJson(`/api/auctions?${filter}`, listSchema, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setItems(result.auctions); setOffset(Date.parse(result.serverTime) - Date.now()); setNow(Date.now()); setLoading(false); } })
      .catch((error: unknown) => { if (!controller.signal.aborted) { setError(error instanceof Error ? error.message : 'Unable to load auctions.'); setLoading(false); } });
    return () => controller.abort();
  }, [query, sort, category]);
  return <>
    {home && <section className="hero container"><div><p className="eyebrow">Compute deserves a second life</p><h1>Serious hardware.<br />Less serious prices.</h1><p>Bid on tested server equipment from data centers and operators across the country.</p><a className="hero-action" href="/search">Browse all auctions <span>→</span></a></div><div className="hero-rack" aria-hidden="true"><span className="rack-light one" /><span className="rack-light two" /><span className="rack-light three" />{['GPU–08','CORE–96','MEM–1.5T'].map(name => <div className="rack-unit" key={name}><b>{name}</b><i /><i /><i /><i /></div>)}</div></section>}
    <main className="search-page container">
      <div className="search-heading"><div><p className="eyebrow">Catalog</p><h1>{home ? 'Equipment worth watching' : query ? `Results for “${query}”` : 'All auctions'}</h1><p>{loading ? 'Loading auctions…' : `${items.length} auctions · including ended listings`}</p></div>
        <div className="catalog-controls"><label>Category<select aria-label="Filter category" value={category} onChange={event => setCategory(event.target.value)}><option value="">All equipment</option>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
        <label>Sort<select aria-label="Sort auctions" value={sort} onChange={event => setSort(event.target.value)}><option value="newest">Newest</option><option value="closing">Closing soon</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option></select></label></div>
      </div>
      {error && <Message>{error}</Message>}
      {!loading && !error && !items.length && <div className="empty-state"><h2>No equipment found</h2><p>Try a broader search or another category.</p><a href="/search">View all auctions</a></div>}
      {!loading && !error && <div className="product-grid search-results">{items.map(item => <ProductCard key={item.slug} item={item} now={now + offset} />)}</div>}
    </main>
  </>;
}
function ItemPage({ slug, activeUser }: { slug: string; activeUser: DemoUser | undefined }) {
  const [item, setItem] = useState<Auction>();
  const [bids, setBids] = useState<Bid[]>([]);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [offset, setOffset] = useState(0);
  const [bidError,setBidError] = useState('');
  const [rejectedMinimum,setRejectedMinimum] = useState<number>();
  const [bidStatus,setBidStatus] = useState('');
  const [closedByServer,setClosedByServer] = useState(false);
  const expiryRefreshed = useRef<string | undefined>(undefined);
  const [bidValue,setBidValue] = useState('');
  const [pending,setPending] = useState(false);
  const [refresh,setRefresh] = useState(0);
  async function placeBid(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending || !activeUser || closedByServer || (item && (item.ended || Date.now() + offset >= Date.parse(item.closesAt)))) return;
    const raw=bidValue.replace(/,/g,'');
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) {setBidError('Enter a USD amount with at most two decimal places.');return;}
    const amountCents=Math.round(Number(raw)*100);
    if (!Number.isSafeInteger(amountCents) || amountCents>2147483647) {setBidError('The bid must be at most $21,474,836.47.');return;}
    setPending(true);setBidError('');setBidStatus('');
    try {await fetchJson(`/api/auctions/${encodeURIComponent(slug)}/bids`,z.object({accepted:z.boolean()}),{method:'POST',headers:{'content-type':'application/json','x-demo-user-id':String(activeUser.id)},body:JSON.stringify({amountCents})});setBidValue('');setRejectedMinimum(undefined);setBidStatus('Your bid was accepted.');}
    catch(error){
      if (error instanceof ApiError && error.code === 'BID_TOO_LOW') {
        setRejectedMinimum(error.minimumBidCents);
        setBidError(`${error.message} Review the updated amount before submitting again.`);
      } else {
        if (error instanceof ApiError && error.code === 'AUCTION_ENDED') setClosedByServer(true);
        setBidError(error instanceof Error ? error.message : 'Unable to confirm your bid. Refresh the history before submitting again.');
      }
    }
    finally{setPending(false);setRefresh(value=>value+1);}
  }
  useEffect(() => {
    let live = true;
    let inFlight = false;
    const controller = new AbortController();
    async function load() {
      // Keep slow responses eligible and avoid overlapping polling requests.
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await fetchJson(`/api/auctions/${encodeURIComponent(slug)}`, detailSchema, { signal: controller.signal });
        if (live) { setError(''); setItem(result.auction); setBids(result.bids); setOffset(Date.parse(result.serverTime) - Date.now()); setNow(Date.now()); }
      } catch (error) {
        if (live) setError(error instanceof Error ? error.message : 'Unable to load auction.');
      } finally { inFlight = false; }
    }
    void load();
    const poll = window.setInterval(() => void load(), 5000);
    return () => { live = false; controller.abort(); clearInterval(poll); };
  }, [slug, refresh]);
  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState !== 'visible') return;
      // Timers may have been throttled while hidden: update locally immediately,
      // then reconcile the price, final history, and server time over HTTP.
      setNow(Date.now());
      setRefresh(value => value + 1);
    };
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('focus', recheck);
    };
  }, [slug]);
  useEffect(() => {
    if (!item) return;
    let timer: number;
    const checkDeadline = () => {
      const currentTime = Date.now();
      setNow(currentTime);
      const remaining = Date.parse(item.closesAt) - (currentTime + offset);
      if (remaining > 0) timer = window.setTimeout(checkDeadline, Math.min(remaining, 2_147_483_647));
      else if (expiryRefreshed.current !== item.slug) {
        expiryRefreshed.current = item.slug;
        setRefresh(value => value + 1);
      }
    };
    checkDeadline();
    return () => clearTimeout(timer);
  }, [item?.slug, item?.closesAt, offset]);
  useEffect(() => { if (item) document.title = `${item.title} · Auction House`; }, [item]);
  if (error && !item) return <main className="container empty-state"><Message>{error}</Message><a href="/search">Browse auctions</a></main>;
  if (!item) return <main className="container empty-state">Loading auction…</main>;
  const ended = closedByServer || item.ended || now + offset >= Date.parse(item.closesAt);
  const minimum = Math.max(item.currentAmountCents + 100, rejectedMinimum ?? 0);
  return <main className="item-page container">
    {error && <Message>{`Unable to refresh auction details. Displayed information may be outdated. ${error}`}</Message>}
    <div className="breadcrumbs"><a href="/">Home</a><span>/</span><a href={`/search?category=${encodeURIComponent(item.category)}`}>{item.category}</a><span>/</span><span>{item.title}</span></div>
    <div className="item-layout"><div className="item-gallery"><ProductArt kind={artByCategory[item.category]} label={`Illustration of ${item.title}`} /><p className="art-caption">Category illustration</p></div>
      <section className="item-summary"><p className="product-category">{item.category} · {item.condition}</p><h1>{item.title}</h1>{item.kicker && <p className="item-kicker">{item.kicker}</p>}
        <div className="auction-panel"><div className="current-price"><span>{item.bidCount ? 'Current bid' : 'Starting price'}</span><strong>{formatCurrency(item.currentAmountCents)}</strong><small>{item.bidCount} bids</small></div>
          <div className="bidder"><span>{ended ? 'Winner' : 'Current bidder'}</span><strong>{ended && !item.ended ? 'Confirming final result…' : item.currentBidder?.name ?? 'No bids'}</strong></div>
          <div className="ending"><span>Status</span><strong>{ended ? 'ENDED' : timeLeft(item.closesAt, now + offset)}</strong></div>
          <p>Closes <time dateTime={item.closesAt}>{new Date(item.closesAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time> (your local time)</p>
          <form className="listing-form" onSubmit={placeBid}>
            <label htmlFor="bid-amount">Your bid (USD)</label>
            <input id="bid-amount" inputMode="decimal" value={bidValue} onChange={event=>setBidValue(event.target.value)} disabled={pending || ended || !activeUser || activeUser.id===item.seller.id} />
            <p>Minimum bid: {formatCurrency(minimum)}</p>
            {ended ? <p>This auction has ended.</p> : activeUser?.id===item.seller.id ? <p>You cannot bid on your own auction.</p> : null}
            {bidStatus && <p role="status">{bidStatus}</p>}
            {bidError && <p role="alert" className="error-message">{bidError}</p>}
            <button className="primary-button" disabled={pending || ended || !activeUser || activeUser.id===item.seller.id}>{pending?'Submitting…':'Place bid'}</button>
          </form>
        </div>
        <div className="seller-card"><span className="seller-avatar">{item.seller.name.charAt(0)}</span><div><small>Sold by</small><strong>{item.seller.name}</strong><span>{item.location}</span></div></div>
      </section>
    </div>
    <div className="item-details-grid"><section><p className="eyebrow">About this item</p><h2>The details</h2><p className="description">{item.description}</p></section>
      {item.specs.length > 0 && <section className="spec-list"><p className="eyebrow">Specifications</p>{item.specs.map(([label,value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>}
    </div>
    <section className="history-section"><p className="eyebrow">Auction activity</p><h2>Bid history</h2>{!bids.length ? <p>No bids yet.</p> : <div className="table-scroll"><table><thead><tr><th>Bidder</th><th>Amount</th><th>Time (local)</th></tr></thead><tbody>{bids.map(bid => <tr key={bid.id}><td>{bid.bidder.name}</td><td>{formatCurrency(bid.amountCents)}</td><td><time dateTime={bid.createdAt}>{new Date(bid.createdAt).toLocaleString()}</time></td></tr>)}</tbody></table></div>}</section>
  </main>;
}
function HealthPage() {
  const [message,setMessage] = useState('Checking database…');
  useEffect(() => { fetchJson('/api/health', z.object({ok:z.boolean(),db:z.string()})).then(value => setMessage(value.ok && value.db === 'ok' ? 'OK · PostgreSQL connected' : 'Database unavailable')).catch(() => setMessage('Database unavailable')); },[]);
  return <main className="container empty-state"><h1>Service health</h1><p role="status">{message}</p></main>;
}
export function App() {
  const [users,setUsers] = useState<DemoUser[]>([]);
  const [activeId,setActiveId] = useState<number>();
  const [error,setError] = useState('');
  useEffect(() => {
    document.title = 'Auction House';
    let live = true;
    fetchJson('/api/users', z.object({users:z.array(userSchema)})).then(result => {
      if (!live) return;
      setUsers(result.users);
      setActiveId(initialTabUser(result.users));
    }).catch((error: unknown) => { if (live) setError(error instanceof Error ? error.message : 'Unable to load demo users.'); });
    return () => { live = false; };
  },[]);
  function selectUser(id: number) { setActiveId(id); rememberTabUser(id); }
  const activeUser = users.find(user => user.id === activeId);
  const path = location.pathname;
  let page;
  if (path === '/auctions/new') page = <NewAuctionPage activeUser={activeUser} />;
  else if (path.startsWith('/items/')) page = <ItemPage activeUser={activeUser} slug={path.slice('/items/'.length)} />;
  else if (path === '/health') page = <HealthPage />;
  else if (path === '/' || path === '/search') page = <CatalogPage home={path === '/'} />;
  else page = <main className="container empty-state"><h1>Page not found</h1><a href="/">Home</a></main>;
  return <div className="app-shell"><SiteHeader activeUser={activeUser} initialQuery={new URLSearchParams(location.search).get('q') ?? ''} />{page}<footer><div className="container footer-content"><span>Auction House · <a href="/health">Service health</a></span><label>Demo user <select aria-label="Active demo user" value={activeId ?? ''} onChange={event => selectUser(Number(event.target.value))} disabled={!users.length}>{!users.length && <option value="">Loading users…</option>}{users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select><small>Demo identities · no sign-in</small></label>{error && <Message>{error}</Message>}</div></footer></div>;
}

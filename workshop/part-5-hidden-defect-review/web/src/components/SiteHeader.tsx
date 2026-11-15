import { type FormEvent, useState } from 'react';
import { categories, type DemoUser } from '../catalog';
export function SiteHeader({ initialQuery, activeUser }: { initialQuery: string; activeUser: DemoUser | undefined }) {
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState(new URLSearchParams(location.search).get('category') ?? '');
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim()); if (category) params.set('category',category);
    window.location.assign(`/search?${params}`);
  }
  return <header className="site-header"><div className="container header-main"><a className="brand" href="/" aria-label="Auction House home"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>Auction House</span></a><form className="search-form" role="search" onSubmit={search}><span className="search-icon" aria-hidden="true">⌕</span><input aria-label="Search auctions" maxLength={120} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search GPUs, memory, chassis, CPUs…" /><select aria-label="Search category" value={category} onChange={event => setCategory(event.target.value)}><option value="">All equipment</option>{categories.map(c => <option key={c}>{c}</option>)}</select><button type="submit">Search</button></form><div className="header-actions"><span className="active-user" role="status" aria-label="Active user"><span className="avatar" aria-hidden="true">{activeUser?.name.charAt(0) ?? '…'}</span><span className="user-name">{activeUser?.name ?? 'Loading user…'}</span></span><a className="sign-in" href="/auctions/new"><span className="avatar" aria-hidden="true">+</span><span>Sell</span></a></div></div><nav className="container category-nav" aria-label="Equipment categories"><a href="/search">Featured</a>{categories.map(category => <a key={category} href={`/search?category=${encodeURIComponent(category)}`}>{category}</a>)}</nav></header>;
}

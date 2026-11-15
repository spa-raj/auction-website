import { useEffect, useRef, useState } from 'react';
import { checkoutResponseSchema, purchaseResponseSchema, type Purchase } from '../../../shared/purchase';
import { fetchJson } from '../api';
import { formatCurrency, type DemoUser } from '../catalog';

export function PurchasePanel({ slug, user, winnerId }: { slug: string; user: DemoUser; winnerId: number }) {
  const [purchase, setPurchase] = useState<Purchase>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const refresh = useRef<() => void>(() => {});
  const alive = useRef(true);
  const returned = new URLSearchParams(location.search).get('checkout');
  useEffect(() => {
    alive.current = true;
    let live = true; let inFlight = false;
    const controller = new AbortController();
    async function load() {
      if (!live || inFlight) return;
      inFlight = true;
      try {
        const result = await fetchJson(`/api/auctions/${encodeURIComponent(slug)}/purchase`, purchaseResponseSchema,
          { headers: { 'x-demo-user-id': String(user.id) }, signal: controller.signal });
        if (live) { setPurchase(result.purchase); setError(''); }
      } catch (error) { if (live) setError(error instanceof Error ? error.message : 'Unable to load payment status.'); }
      finally { inFlight = false; }
    }
    refresh.current = () => void load();
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    const focus = () => { if (document.visibilityState === 'visible') void load(); };
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus);
    return () => { live = false; alive.current = false; controller.abort(); clearInterval(timer);
      window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); refresh.current = () => {}; };
  }, [slug, user.id]);
  async function checkout() {
    if (pending) return;
    setPending(true); setError('');
    try {
      const result = await fetchJson(`/api/auctions/${encodeURIComponent(slug)}/checkout`, checkoutResponseSchema,
        { method: 'POST', headers: { 'x-demo-user-id': String(user.id), 'content-type': 'application/json' }, body: '{}' });
      if (!alive.current) return;
      if (result.status === 'checkout') { location.assign(result.url); return; }
      refresh.current();
    } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : 'Unable to open checkout.'); }
    finally { if (alive.current) setPending(false); }
  }
  return <section className="purchase-panel" aria-label="Purchase payment">
    <h2>{purchase?.status === 'paid' ? 'Purchase paid' : 'Purchase payment'}</h2>
    <p role="status">{purchase ? `${purchase.status === 'paid' ? 'Paid' : 'Unpaid'} · ${formatCurrency(purchase.amountCents)}` : 'Loading payment status…'}</p>
    {purchase?.status === 'paid' ? <p>Payment confirmed. {purchase.paidAt && <time dateTime={purchase.paidAt}>{new Date(purchase.paidAt).toLocaleString()}</time>}</p> : <>
      {returned === 'success' && <p>Checking payment confirmation. Your purchase remains unpaid until confirmation is recorded.</p>}
      {returned === 'canceled' && <p>Checkout canceled. Your purchase is still unpaid and you can retry.</p>}
      {user.id === winnerId ? <><p>Pay your winning bid using local test checkout. No real money moves.</p><button className="primary-button" disabled={pending || !purchase} onClick={() => void checkout()}>{pending ? 'Opening checkout…' : 'Complete purchase'}</button></> : <p>Awaiting payment from the winning bidder.</p>}
    </>}
    {error && <p role="alert" className="error-message">{error} <button onClick={() => refresh.current()}>Refresh payment status</button></p>}
  </section>;
}

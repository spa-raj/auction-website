import { useEffect, useRef, useState } from 'react';
import { checkoutResponseSchema, purchaseResponseSchema, type PurchaseResponse } from '../../../shared/purchase';
import { fetchJson } from '../api';
import { formatCurrency, type DemoUser } from '../catalog';

export function PurchasePanel({ slug, user, winnerId }: { slug: string; user: DemoUser; winnerId: number }) {
  const [response, setResponse] = useState<PurchaseResponse>();
  const [statusError, setStatusError] = useState('');
  const [checkoutError, setCheckoutError] = useState('');
  const [pending, setPending] = useState(false);
  const refresh = useRef<() => void>(() => {});
  const alive = useRef(true);
  const returned = new URLSearchParams(location.search).get('checkout');
  const purchase = response?.purchase;
  const winner = response ? response.role === 'winner' : user.id === winnerId;
  const recovery = response?.recovery;
  useEffect(() => {
    alive.current = true;
    let live = true; let inFlight = false; let dirty = false;
    const controller = new AbortController();
    async function load() {
      if (!live) return;
      if (inFlight) { dirty = true; return; }
      inFlight = true;
      try {
        const result = await fetchJson(`/api/auctions/${encodeURIComponent(slug)}/purchase`, purchaseResponseSchema,
          { headers: { 'x-demo-user-id': String(user.id) }, signal: controller.signal });
        if (live) { setResponse(result); setStatusError(''); }
      } catch (error) { if (live) setStatusError(error instanceof Error ? error.message : 'Unable to load payment status.'); }
      finally { inFlight = false; if (live && dirty) { dirty = false; void load(); } }
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
    setPending(true); setCheckoutError('');
    try {
      const result = await fetchJson(`/api/auctions/${encodeURIComponent(slug)}/checkout`, checkoutResponseSchema,
        { method: 'POST', headers: { 'x-demo-user-id': String(user.id), 'content-type': 'application/json' }, body: '{}' });
      if (!alive.current) return;
      if (result.status === 'checkout') { location.assign(result.url); return; }
      // A completed provider session waits for its signed webhook; never offer
      // another payment while confirmation is outstanding.
      setResponse(current => current && result.status === 'confirmation_pending'
        ? { ...current, recovery: 'confirmation_pending' } : current);
      refresh.current();
    } catch (error) { if (alive.current) setCheckoutError(error instanceof Error ? error.message : 'Unable to open checkout.'); }
    finally { if (alive.current) setPending(false); }
  }
  return <section className="purchase-panel" aria-label={winner ? 'Purchase payment' : 'Seller payment status'}>
    <h2>{purchase?.status === 'paid' ? 'Purchase paid' : winner ? 'Purchase payment' : 'Seller payment status'}</h2>
    <p role="status">{purchase ? `${purchase.status === 'paid' ? 'Paid' : 'Unpaid'} · ${formatCurrency(purchase.amountCents)}` : 'Loading payment status…'}</p>
    {purchase?.status === 'paid' ? <p>{winner ? 'Payment confirmed.' : "The winner’s payment is confirmed."} {purchase.paidAt && <time dateTime={purchase.paidAt}>{new Date(purchase.paidAt).toLocaleString()}</time>}</p> : purchase && <>
      {winner && returned === 'success' && recovery !== 'confirmation_pending' && <p>Checking payment confirmation. Your purchase remains unpaid until confirmation is recorded.</p>}
      {winner && returned === 'canceled' && recovery !== 'confirmation_pending' && <p>Checkout canceled. Your purchase is still unpaid and you can retry.</p>}
      {recovery === 'confirmation_pending' && <p role="status">Payment received by the payment service. Confirmation is pending and retries automatically. No further payment is needed.</p>}
      {recovery === 'checkout_missing' && <p>{winner ? 'Your unpaid checkout session is no longer available. Restart checkout to continue with the same purchase and winning amount.' : 'The winner’s unpaid checkout session is no longer available. The winner can restart checkout.'}</p>}
      {recovery === 'service_unavailable' && <p role="alert">Payment service unavailable. Showing the last recorded purchase status. Refresh to check again.</p>}
      {winner ? <>
        {recovery !== 'confirmation_pending' && <p>Pay your winning bid using local test checkout. No real money moves.</p>}
        {recovery !== 'confirmation_pending' && <button className="primary-button" disabled={pending || recovery === 'service_unavailable'} onClick={() => void checkout()}>{pending ? 'Opening checkout…' : recovery === 'checkout_missing' ? 'Restart checkout' : 'Complete purchase'}</button>}
      </> : recovery !== 'confirmation_pending' && <p>Awaiting payment from the winning bidder.</p>}
    </>}
    {statusError && <p role="alert" className="error-message">Could not refresh payment status. {purchase && 'Displayed payment information may be outdated. '}{statusError}</p>}
    {checkoutError && <p role="alert" className="error-message">{checkoutError}</p>}
    <button type="button" onClick={() => refresh.current()}>Refresh payment status</button>
  </section>;
}

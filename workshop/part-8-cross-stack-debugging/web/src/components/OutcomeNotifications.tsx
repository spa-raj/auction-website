import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { z } from 'zod';
import { notificationsSchema, recipientSchema, type NotificationEvents, type OutcomeNotification } from '../../../shared/notifications';
import { formatCurrency, type DemoUser } from '../catalog';
import { fetchJson } from '../api';

export function OutcomeNotifications({ user, users, onSelectUser }: {
  user: DemoUser; users: DemoUser[]; onSelectUser: (id: number) => void;
}) {
  const [notifications, setNotifications] = useState<OutcomeNotification[]>([]);
  const [error, setError] = useState('');
  const [dismissError, setDismissError] = useState('');
  const [pending, setPending] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const retry = useRef<() => void>(() => {});
  const generation = useRef(0);
  const mounted = useRef(true);
  const notice = notifications[0];
  useEffect(() => {
    mounted.current = true;
    let live = true; let inFlight = false; let dirty = false;
    const controller = new AbortController();
    async function load() {
      if (!live) return;
      if (inFlight) { dirty = true; return; }
      inFlight = true;
      const started = generation.current;
      try {
        const result = await fetchJson('/api/notifications', notificationsSchema, {
          headers: { 'x-demo-user-id': String(user.id) }, signal: controller.signal,
        });
        if (live && started === generation.current) { setNotifications(result.notifications); setError(''); }
        else if (live) dirty = true;
      } catch (error) {
        if (live) setError(error instanceof Error ? error.message : 'Unable to refresh notifications.');
      } finally {
        inFlight = false;
        if (live && dirty) { dirty = false; void load(); }
      }
    }
    retry.current = () => void load();
    const socket: Socket<NotificationEvents> = io({ transports: ['websocket'], auth: { userId: user.id }, autoConnect: false });
    const signal = (value: unknown) => {
      const recipient = recipientSchema.safeParse(value);
      if (recipient.success && recipient.data.userId === user.id) void load();
    };
    socket.on('notifications:watching', signal);
    socket.on('notifications:changed', signal);
    socket.connect();
    void load();
    const poll = window.setInterval(() => void load(), 5000);
    const focus = () => { if (document.visibilityState === 'visible') void load(); };
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus);
    return () => {
      live = false; mounted.current = false; controller.abort(); socket.disconnect(); clearInterval(poll);
      window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus);
      retry.current = () => {};
    };
  }, [user.id]);
  useEffect(() => {
    if (!notice || !dialog.current) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const element = dialog.current;
    if (!element.open) element.showModal();
    element.querySelector<HTMLButtonElement>('[data-dismiss]')?.focus();
    return () => { element.close(); previous?.focus(); };
  }, [notice?.id]);
  async function dismiss() {
    if (!notice || pending) return;
    setPending(true); setDismissError('');
    try {
      await fetchJson(`/api/notifications/${notice.id}/dismiss`, z.object({ dismissed: z.literal(true) }), {
        method: 'POST', headers: { 'x-demo-user-id': String(user.id) },
      });
      if (!mounted.current) return;
      generation.current++;
      setNotifications(values => values.filter(value => value.id !== notice.id));
      retry.current();
    } catch (error) {
      if (mounted.current) setDismissError(error instanceof Error ? error.message : 'Unable to save dismissal. Please retry.');
    } finally { if (mounted.current) setPending(false); }
  }
  const sold = notice?.event.outcome.status === 'sold';
  const heading = notice?.role === 'winner' ? 'You won the auction' : sold ? 'Your auction sold' : 'Your auction ended without bids';
  return <>
    {error && !notice && <aside role="alert" className="notification-sync-error">Unable to refresh notifications. <button onClick={() => retry.current()}>Retry</button></aside>}
    {notice && <dialog ref={dialog} className="outcome-dialog" aria-labelledby="outcome-heading" aria-describedby="outcome-description" onCancel={event => event.preventDefault()}>
      <p className="eyebrow">Auction result · {user.name}</p>
      <h2 id="outcome-heading">{heading}</h2>
      <p className="outcome-item">{notice.event.title}</p>
      <p id="outcome-description">{sold ? `${notice.role === 'winner' ? 'Your winning bid' : 'Winning bid'}: ${formatCurrency(notice.event.outcome.winningAmountCents!)}` : 'No bids were placed. There is no winning bidder.'}</p>
      {notifications.length > 1 && <p className="outcome-count">{notifications.length - 1} more pending</p>}
      {error && <p role="alert">Notifications may be outdated. <button onClick={() => retry.current()}>Retry refresh</button></p>}
      {dismissError && <p role="alert" className="error-message">Could not save dismissal. {dismissError}</p>}
      <div className="outcome-actions"><a href={`/items/${notice.event.auctionSlug}`}>{notice.role === 'winner' ? 'View purchase' : 'View auction'}</a><button data-dismiss className="primary-button" disabled={pending} onClick={() => void dismiss()}>{pending ? 'Saving…' : 'Dismiss'}</button></div>
      <label className="outcome-user">Demo user <select aria-label="Notification demo user" value={user.id} onChange={event => onSelectUser(Number(event.target.value))}>{users.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
    </dialog>}
  </>;
}

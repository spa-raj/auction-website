import { SpanStatusCode, type Span } from '@opentelemetry/api';
import { captureTrace, contextFromCarrier, dbSpan, failed, outcome, ROOT_CONTEXT, sameTrace, traceHeaders, validCarrier, withSpan } from '../../shared/tracing.js';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from './db.js';
import { auctions, paymentEvents, purchases } from './schema.js';
import { purchaseResponseSchema, type PurchaseResponse } from '../../shared/purchase.js';

const userSchema = z.coerce.number().int().min(1).max(10);
const slugSchema = z.string().regex(/^[a-z0-9-]{1,180}$/);
const sessionSchema = z.object({
  id: z.string().regex(/^cs_test_[a-f0-9]+$/), object: z.literal('checkout.session'), url: z.url(),
  status: z.enum(['open', 'complete']), payment_status: z.enum(['unpaid', 'paid']), client_reference_id: z.uuid(),
  amount_total: z.number().int().positive().safe(), currency: z.literal('usd'),
});
const completionSchema = z.object({
  eventId: z.uuid(), eventType: z.literal('checkout.session.completed'), occurredAt: z.iso.datetime(),
  data: z.object({ object: z.object({
    id: z.string().regex(/^cs_test_[a-f0-9]+$/), object: z.literal('checkout.session'),
    status: z.literal('complete'), payment_status: z.literal('paid'), client_reference_id: z.uuid(),
    amount_total: z.number().int().positive().safe(), currency: z.literal('usd'),
  }) }),
});
export type PaymentOptions = {
  stripeUrl?: string; stripePublicUrl?: string; webUrl?: string; webhookSecret?: string;
};
export function registerPayments(app: FastifyInstance, db: Database, options: PaymentOptions = {}) {
  const stripeUrl = options.stripeUrl ?? process.env.STRIPE_API_URL ?? 'http://127.0.0.1:7108';
  const stripePublicUrl = options.stripePublicUrl ?? process.env.STRIPE_PUBLIC_URL ?? stripeUrl;
  const webUrl = options.webUrl ?? process.env.WEB_PUBLIC_URL ?? 'http://127.0.0.1:5108';
  const secret = options.webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_local_part_8';
  const readPurchase = async (slug: string) => (await db.select({ purchase: purchases, sellerId: auctions.sellerId })
    .from(purchases).innerJoin(auctions, eq(auctions.slug, purchases.auctionSlug))
    .where(eq(purchases.auctionSlug, slug)))[0];

  type StoredPurchase = typeof purchases.$inferSelect;
  function matches(session: z.infer<typeof sessionSchema>, purchase: StoredPurchase) {
    return session.client_reference_id === purchase.id && session.amount_total === purchase.amountCents
      && session.currency === purchase.currency
      && session.url === new URL(`/checkout/${session.id}`, stripePublicUrl).href
      && ((session.status === 'open' && session.payment_status === 'unpaid')
        || (session.status === 'complete' && session.payment_status === 'paid'));
  }
  async function inspect(purchase: StoredPurchase): Promise<PurchaseResponse['recovery']> {
    if (purchase.status === 'paid' || !purchase.sessionId) return 'none';
    try {
      const response = await fetch(new URL(`/v1/checkout/sessions/${purchase.sessionId}`, stripeUrl), { signal: AbortSignal.timeout(1500) });
      if (response.status === 404) return 'checkout_missing';
      if (!response.ok) throw new Error(`Mock lookup returned ${response.status}`);
      const session = sessionSchema.parse(await response.json());
      if (session.id !== purchase.sessionId || !matches(session, purchase)) throw new Error('Mock session does not match purchase');
      return session.payment_status === 'paid' ? 'confirmation_pending' : 'none';
    } catch { return 'service_unavailable'; }
  }

  app.get<{ Params: { slug: string } }>('/api/auctions/:slug/purchase', async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    const user = userSchema.safeParse(request.headers['x-demo-user-id']);
    if (!user.success || !slugSchema.safeParse(request.params.slug).success) return reply.code(400).send({ message: 'Select a valid demo user and auction.' });
    const row = await readPurchase(request.params.slug);
    if (!row) return reply.code(404).send({ message: 'There is no purchase for this auction.' });
    if (user.data !== row.purchase.winnerId && user.data !== row.sellerId) return reply.code(403).send({ message: 'Payment status is available to the winner and seller.' });
    const recovery = await inspect(row.purchase);
    // A webhook may commit during the provider lookup. Re-read before responding;
    // provider status itself never marks a purchase paid.
    const current = (await readPurchase(request.params.slug))!;
    const summary = { auctionSlug: current.purchase.auctionSlug, amountCents: current.purchase.amountCents,
      currency: current.purchase.currency, status: current.purchase.status, paidAt: current.purchase.paidAt?.toISOString() ?? null };
    const role = user.data === current.purchase.winnerId ? 'winner' : 'seller';
    return purchaseResponseSchema.parse({ role,
      purchase: role === 'winner' ? { ...summary, id: current.purchase.id } : summary,
      recovery: current.purchase.status === 'paid' ? 'none' : recovery });
  });

  app.post<{ Params: { slug: string } }>('/api/auctions/:slug/checkout', async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    const user = userSchema.safeParse(request.headers['x-demo-user-id']);
    if (!user.success || !slugSchema.safeParse(request.params.slug).success) return reply.code(400).send({ message: 'Select a valid demo winner and auction.' });
    // No browser-controlled amount, identity, currency or return URL is accepted.
    if (!z.object({}).strict().safeParse(request.body ?? {}).success) return reply.code(400).send({ message: 'Checkout details are owned by the server.' });
    const known = await readPurchase(request.params.slug);
    const authorized = known?.purchase.winnerId === user.data;
    return withSpan('winner.checkout', { 'participant.id': user.data, 'participant.role': authorized ? 'winner' : known?.sellerId === user.data ? 'seller' : 'bidder',
      'context.fallback': authorized && !validCarrier(known.purchase.traceContext),
      ...(authorized ? { 'purchase.id': known.purchase.id, 'amount.cents': known.purchase.amountCents } : {}) }, async span => {
    const checkoutTrace = captureTrace();
    const result = await dbSpan('TRANSACTION', 'purchases', () => db.transaction(async tx => {
      // The purchase lock serializes concurrent windows. Network calls have a deadline.
      const [purchase] = await dbSpan('SELECT FOR UPDATE', 'purchases', () => tx.select().from(purchases).where(eq(purchases.auctionSlug, request.params.slug)).for('update'));
      if (!purchase) return { code: 409, body: { message: 'Checkout is available after a winning result is recorded.' } };
      if (purchase.winnerId !== user.data) return { code: 403, body: { message: 'Only the recorded winner can complete this purchase.' } };
      if (purchase.status === 'paid') return { code: 200, body: { status: 'paid' } };
      const [auction] = await dbSpan('SELECT', 'auctions', () => tx.select({ title: auctions.title, telemetryId: auctions.telemetryId }).from(auctions).where(eq(auctions.slug, purchase.auctionSlug)));
      span.setAttribute('auction.id', auction.telemetryId);
      const returnUrl = new URL(`/items/${purchase.auctionSlug}`, webUrl).href;
      try {
        const recovery = await inspect(purchase);
        if (recovery === 'service_unavailable') throw new Error('Cannot verify the existing checkout session');
        if (recovery === 'confirmation_pending') return { code: 200, body: { status: 'confirmation_pending' } };
        // Only an authoritative 404 permits replacing a bound, unpaid session.
        // Reuse the same purchase UUID even when a previous response was lost.
        const response = await fetch(new URL('/v1/checkout/sessions', stripeUrl), {
          method: 'POST', headers: { 'content-type': 'application/json', ...traceHeaders() }, signal: AbortSignal.timeout(3000),
          body: JSON.stringify({ mode: 'payment', client_reference_id: purchase.id,
            line_items: [{ price_data: { currency: purchase.currency, product_data: { name: auction.title }, unit_amount: purchase.amountCents }, quantity: 1 }],
            success_url: `${returnUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${returnUrl}?checkout=canceled`,
          }),
        });
        if (!response.ok) throw new Error(`Mock checkout returned ${response.status}`);
        const session = sessionSchema.parse(await response.json());
        if (!matches(session, purchase) || (purchase.sessionId && session.id !== purchase.sessionId && recovery !== 'checkout_missing')) {
          throw new Error('Mock session does not match the stored purchase');
        }
        await dbSpan('UPDATE', 'purchases', () => tx.update(purchases).set({ sessionId: session.id, sessionUrl: session.url,
          traceContext: validCarrier(purchase.traceContext) ?? checkoutTrace }).where(eq(purchases.id, purchase.id)));
        span.setAttribute('payment.session.id', session.id);
        span.setAttribute('business.outcome', recovery === 'checkout_missing' ? 'recovered' : purchase.sessionId ? 'reused' : 'created');
        return session.payment_status === 'paid'
          ? { code: 200, body: { status: 'confirmation_pending' } }
          : { code: 200, body: { status: 'checkout', url: session.url } };
      } catch (error) {
        failed('provider_unavailable'); span.setStatus({ code: SpanStatusCode.ERROR }); span.setAttribute('error.type', 'provider_unavailable'); span.setAttribute('business.outcome', 'unavailable');
        request.log.error({ err: error, purchaseId: purchase.id }, 'Checkout unavailable');
        return { code: 503, body: { message: 'Payment service is unavailable. Your purchase is still outstanding. Retry checkout shortly.' } };
      }
    }));
    if (result.code === 403 || result.code === 409) outcome('rejected');
    if ('status' in result.body && result.body.status === 'paid') outcome('already_paid');
    if ('status' in result.body && result.body.status === 'confirmation_pending') outcome('confirmation_pending');
    return reply.code(result.code).send(result.body);
    }, authorized ? contextFromCarrier(known.purchase.traceContext) : ROOT_CONTEXT);
  });

  // Fastify encapsulation keeps raw bytes scoped to the webhook endpoint.
  app.register(async webhook => {
    webhook.removeContentTypeParser('application/json');
    webhook.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
    webhook.post('/api/webhooks/stripe', async (request, reply) => {
      const signature = request.headers['x-stripe-signature'];
      if (!Buffer.isBuffer(request.body) || typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) {
        return withSpan('winner.purchase.webhook', { 'business.outcome': 'rejected' }, async () => reply.code(400).send({ message: 'Invalid webhook signature.' }), ROOT_CONTEXT);
      }
      const expected = createHmac('sha256', secret).update(request.body).digest();
      if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return withSpan('winner.purchase.webhook', { 'business.outcome': 'rejected' }, async () => reply.code(400).send({ message: 'Invalid webhook signature.' }), ROOT_CONTEXT);
      let value: unknown;
      try { value = JSON.parse(request.body.toString('utf8')); }
      catch { return withSpan('winner.purchase.webhook', { 'business.outcome': 'rejected' }, async () => reply.code(400).send({ message: 'Invalid webhook body.' }), ROOT_CONTEXT); }
      const parsed = completionSchema.safeParse(value);
      if (!parsed.success) return withSpan('winner.purchase.webhook', { 'business.outcome': 'rejected' }, async () => reply.code(400).send({ message: 'Unsupported payment event.' }), ROOT_CONTEXT);
      const event = parsed.data;
      const session = event.data.object;
      const hash = createHash('sha256').update(request.body).digest('hex');
      const [known] = await db.select().from(purchases).where(eq(purchases.id, session.client_reference_id));
      const matchesPurchase = known && known.sessionId === session.id && known.amountCents === session.amount_total && known.currency === session.currency;
      const incoming = { traceparent: request.headers.traceparent, tracestate: request.headers.tracestate };
      const parent = matchesPurchase ? contextFromCarrier(sameTrace(known.traceContext, incoming) ? incoming : known.traceContext) : ROOT_CONTEXT;
      return withSpan('winner.purchase.webhook', { 'event.id': event.eventId,
        'context.invalid': !matchesPurchase || !sameTrace(known.traceContext, incoming),
        ...(matchesPurchase ? { 'purchase.id': known.id, 'payment.session.id': session.id, 'amount.cents': known.amountCents } : {}) }, async span => {
      const webhookTrace = captureTrace();
      const paidSpans: Span[] = []; let committed = false;
      try {
      const accepted = await dbSpan('TRANSACTION', 'payment_events', () => db.transaction(async tx => {
        const [purchase] = await dbSpan('SELECT FOR UPDATE', 'purchases', () => tx.select().from(purchases).where(eq(purchases.id, session.client_reference_id)).for('update'));
        if (!purchase || purchase.sessionId !== session.id || purchase.amountCents !== session.amount_total || purchase.currency !== session.currency) return false;
        const [prior] = await dbSpan('SELECT', 'payment_events', () => tx.select().from(paymentEvents).where(eq(paymentEvents.eventId, event.eventId)));
        if (prior) { span.setAttribute('business.outcome', 'duplicate'); span.setAttribute('event.duplicate', true); return prior.purchaseId === purchase.id && prior.bodySha256 === hash; }
        const inserted = await dbSpan('INSERT', 'payment_events', () => tx.insert(paymentEvents).values({ eventId: event.eventId, purchaseId: purchase.id, bodySha256: hash, traceContext: webhookTrace })
          .onConflictDoNothing().returning({ id: paymentEvents.eventId }));
        if (!inserted.length) return false;
        // A paid purchase never regresses, and duplicates cannot rewrite paid_at.
        if (purchase.status === 'unpaid') await withSpan('winner.purchase.paid', { 'purchase.id': purchase.id, 'winner.id': purchase.winnerId, 'amount.cents': purchase.amountCents, 'business.outcome': 'paid' },
          () => dbSpan('UPDATE', 'purchases', () => tx.update(purchases).set({ status: 'paid', paidAt: new Date() })
          .where(and(eq(purchases.id, purchase.id), eq(purchases.status, 'unpaid')))), undefined, undefined, paid => paidSpans.push(paid));
        span.setAttribute('business.outcome', purchase.status === 'unpaid' ? 'paid' : 'already_paid');
        return true;
      }));
      committed = true;
      if (!accepted) { outcome('conflict'); return reply.code(409).send({ message: 'Payment event conflicts with the recorded purchase or session.' }); }
      return { received: true };
      } finally {
        for (const paid of paidSpans) {
          paid.setAttribute('transaction.committed', committed);
          if (!committed) { paid.setStatus({ code: SpanStatusCode.ERROR }); paid.setAttribute('business.outcome', 'rolled_back'); }
          paid.end();
        }
      }
      }, parent);
    });
  });
}

import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import amqp, { type ConfirmChannel } from 'amqplib';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { InMemorySpanExporter, type ReadableSpan } from '@opentelemetry/sdk-trace';
import { startTelemetry, SafeExporter } from '../../shared/otel.js';
import { captureTrace, contextFromCarrier, ROOT_CONTEXT, validCarrier, withSpan } from '../../shared/tracing.js';
import { buildApp } from './app.js';
import { closeDueAuctions } from './close-auctions.js';
import { publishPendingOutbox } from './outbox.js';
import { publishConfirmed } from './broker.js';
import { recordNotifications } from './notifications.js';
import { buildStripeApp } from '../../stripe-service/src/app.js';
import { auctionClosedSchema, type AuctionClosed } from '../../shared/auction-closed.js';

const memory = new InMemorySpanExporter();
const telemetry = startTelemetry('auction-part-8-test', memory);
const schema = `tracing_${randomUUID().replaceAll('-', '')}`;
const url = new URL(process.env.DATABASE_URL ?? 'postgres://auction:auction@127.0.0.1:55432/auction_part_8_test');
const admin = new pg.Pool({ connectionString: url.href });
url.searchParams.set('options', `-c search_path=${schema}`);
const pool = new pg.Pool({ connectionString: url.href });
let api: ReturnType<typeof buildApp>;
let mock: ReturnType<typeof buildStripeApp>;
let mockAddress = ''; let delivered = false;
const directory = await mkdtemp(join(tmpdir(), 'part8-trace-test-'));
const secret = 'trace_test_secret';
let broker: Awaited<ReturnType<typeof amqp.connect>>;
let channel: ConfirmChannel;
let queue = '';
const exchange = `trace_${randomUUID()}`;
const deliveries: Array<{ body: string; headers?: Record<string, string> }> = [];
const makeMock = () => buildStripeApp({ logger: false, baseUrl: 'http://mock.test', stateFile: join(directory, 'sessions.json'),
  webhookSecret: secret, retryMs: 40, deliverWebhook: async (body, signature, headers) => {
    deliveries.push({ body, headers });
    if (!delivered) return false;
    return (await api.inject({ method: 'POST', url: '/api/webhooks/stripe', headers: { ...headers, 'content-type': 'application/json', 'x-stripe-signature': signature }, payload: body })).statusCode === 200;
  } });
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  for (const file of ['001_auctions.sql', '002_auction_outcomes.sql', '003_recipient_notifications.sql', '004_purchases.sql', '005_workflow_tracing.sql']) await pool.query(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  await pool.query('TRUNCATE auctions CASCADE');
  broker = await amqp.connect(process.env.RABBITMQ_URL ?? 'amqp://auction:auction@127.0.0.1:56726/auction_part_8_test');
  channel = await broker.createConfirmChannel();
  await channel.assertExchange(exchange, 'direct', { autoDelete: true });
  queue = (await channel.assertQueue('', { exclusive: true })).queue;
  await channel.bindQueue(queue, exchange, 'auction.closed');
  mock = makeMock(); mockAddress = await mock.listen({ port: 0, host: '127.0.0.1' });
  api = buildApp({ databaseUrl: url.href, payments: { stripeUrl: mockAddress, stripePublicUrl: 'http://mock.test', webhookSecret: secret } });
});
afterAll(async () => { await broker?.close(); await api.close(); await mock.close(); await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); await telemetry.shutdown(); await rm(directory, { recursive: true, force: true }); });
const spans = async () => { await telemetry.forceFlush(); return memory.getFinishedSpans(); };
async function fixture() {
  const result = await api.inject({ method: 'POST', url: '/api/auctions', headers: { 'x-demo-user-id': '1' }, payload: {
    title: `PRIVATE_TITLE_MARKER ${randomUUID()}`, category: 'GPUs', description: 'PRIVATE_PAYLOAD_MARKER', condition: 'Used', location: 'PRIVATE_NAME_MARKER', startingPriceCents: 10000, closesAt: new Date(Date.now() + 60_000).toISOString() } });
  expect(result.statusCode).toBe(201); return result.json<{ slug: string }>().slug;
}
const bid = (slug: string, amountCents: number, user = '2') => api.inject({ method: 'POST', url: `/api/auctions/${slug}/bids`, headers: { 'x-demo-user-id': user }, payload: { amountCents } });
const checkout = (slug: string) => api.inject({ method: 'POST', url: `/api/auctions/${slug}/checkout`, headers: { 'x-demo-user-id': '2' }, payload: {} });
const traceId = (carrier: unknown) => validCarrier(carrier)!.traceparent.slice(3, 35);

describe('durable winning workflow and safe export', () => {
  it('extends only the winning bid across commit, RabbitMQ headers, redelivery, checkout and restarted mock webhook retries', async () => {
    const slug = await fixture();
    expect((await bid(slug, 10100, '3')).statusCode).toBe(201);
    expect((await bid(slug, 10200)).statusCode).toBe(201);
    expect((await bid(slug, 10100, '3')).statusCode).toBe(409);
    const bids = (await pool.query('SELECT * FROM bids WHERE auction_slug=$1 ORDER BY amount_cents DESC', [slug])).rows;
    const winningTrace = traceId(bids[0].trace_context); const losingTrace = traceId(bids[1].trace_context);
    expect(winningTrace).not.toBe(losingTrace);
    await pool.query("UPDATE auctions SET closes_at=clock_timestamp()-interval '1 millisecond' WHERE slug=$1", [slug]);
    expect(await closeDueAuctions(pool)).toContain(slug);
    // Use a private exchange/queue in the test vhost so real publisher confirms
    // and actual channel-close redelivery cannot interfere with other suites.
    const publisher = new Proxy(channel, { get(target, key) {
      if (key === 'publish') return (_exchange: string, routing: string, content: Buffer, options: Parameters<ConfirmChannel['publish']>[3], callback: Parameters<ConfirmChannel['publish']>[4]) => target.publish(exchange, routing, content, options, callback);
      const value: unknown = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    await publishPendingOutbox(pool, (event, carrier) => publishConfirmed(publisher, event, carrier));
    const first = await channel.get(queue, { noAck: false }); expect(first).not.toBe(false);
    if (!first) throw new Error('Missing published event');
    const event: AuctionClosed = auctionClosedSchema.parse(JSON.parse(first.content.toString()));
    const headers: unknown = first.properties.headers;
    expect(traceId(headers)).toBe(winningTrace);
    expect(await recordNotifications(pool, event, headers)).toEqual([1, 2]);
    await channel.close(); // Commit happened, ACK did not: force actual redelivery.
    channel = await broker.createConfirmChannel();
    let replay = await channel.get(queue, { noAck: false });
    await expect.poll(async () => { replay = replay || await channel.get(queue, { noAck: false }); return !!replay; }).toBe(true);
    if (!replay) throw new Error('Missing redelivery');
    expect(replay.fields.redelivered).toBe(true);
    expect(await recordNotifications(pool, event, replay.properties.headers, true)).toEqual([1, 2]);
    channel.ack(replay);
    const notices = (await pool.query('SELECT * FROM recipient_notifications WHERE event_id=$1', [event!.eventId])).rows;
    expect(notices).toHaveLength(2); expect(notices.every(row => traceId(row.trace_context) === winningTrace)).toBe(true);
    const created = await checkout(slug); expect(created.statusCode).toBe(200);
    const id = new URL(created.json().url).pathname.split('/').at(-1)!;
    const decline = await mock.inject({ method: 'POST', url: `/v1/checkout/sessions/${id}/attempt`, payload: { cardNumber: '4000000000000002', expiry: '12/39', cvc: '123' } });
    expect(decline.statusCode).toBe(402);
    const pending = await mock.inject({ method: 'POST', url: `/v1/checkout/sessions/${id}/attempt`, payload: { cardNumber: '4242424242424242', expiry: '12/39', cvc: '123' } });
    expect(pending.statusCode).toBe(502);
    await mock.close(); delivered = true; mock = makeMock();
    await mock.listen({ port: Number(new URL(mockAddress).port), host: '127.0.0.1' });
    await expect.poll(async () => (await pool.query('SELECT status FROM purchases WHERE auction_slug=$1', [slug])).rows[0].status).toBe('paid');
    expect(new Set(deliveries.map(delivery => delivery.body)).size).toBe(1);
    expect(deliveries.every(delivery => traceId(delivery.headers) === winningTrace)).toBe(true);
    await expect.poll(async () => (await spans()).filter(span => span.name === 'mock-stripe.webhook.deliver' && span.spanContext().traceId === winningTrace).length).toBeGreaterThanOrEqual(2);
    const all = await spans(); const golden = all.filter(span => span.spanContext().traceId === winningTrace);
    for (const name of ['auction.bid', 'auction.close', 'auction.outbox.publish', 'auction.notification.process', 'auction.notification.recipient', 'winner.checkout', 'mock-stripe.checkout.create', 'mock-stripe.payment.attempt', 'mock-stripe.webhook.deliver', 'winner.purchase.webhook', 'winner.purchase.paid', 'postgres.operation']) expect(golden.some(span => span.name === name), name).toBe(true);
    expect(golden.filter(span => span.name === 'mock-stripe.webhook.deliver').length).toBeGreaterThanOrEqual(2);
    expect(new Set(golden.filter(span => span.name === 'mock-stripe.webhook.deliver').map(span => span.spanContext().spanId)).size).toBeGreaterThanOrEqual(2);
    expect(golden.filter(span => span.name === 'winner.purchase.paid')).toHaveLength(1);
    expect(golden.find(span => span.name === 'mock-stripe.payment.attempt' && span.attributes['business.outcome'] === 'declined')?.status.code).toBe(SpanStatusCode.UNSET);
    const losing = all.filter(span => span.spanContext().traceId === losingTrace);
    expect(losing.some(span => span.name === 'auction.close' || span.name.startsWith('winner.'))).toBe(false);
    expect(all.some(span => span.name === 'auction.bid' && span.attributes['business.outcome'] === 'too_low' && span.status.code === SpanStatusCode.UNSET)).toBe(true);
    expect(JSON.stringify(golden)).not.toMatch(/PRIVATE_|4242424242424242|4000000000000002|db\.statement|db\.query\.text|SELECT .*FROM/);
    const count = all.length;
    for (const path of ['/api/health', '/api/auctions', `/api/auctions/${slug}`, '/api/notifications', `/api/auctions/${slug}/purchase`]) await api.inject({ url: path, headers: { 'x-demo-user-id': '2' } });
    await closeDueAuctions(pool); await publishPendingOutbox(pool, async () => {});
    expect((await spans()).length).toBe(count);
  });
  it('retains explicit fallback and isolates no-bid/legacy workflows and malformed propagation', async () => {
    const slug = await fixture(); await bid(slug, 10100);
    await pool.query('UPDATE bids SET trace_context=$1 WHERE auction_slug=$2', [{ traceparent: 'invalid-PRIVATE_CONTEXT_MARKER' }, slug]);
    await pool.query("UPDATE auctions SET closes_at=clock_timestamp()-interval '1 millisecond' WHERE slug=$1", [slug]);
    await closeDueAuctions(pool);
    const row = (await pool.query('SELECT * FROM auction_outbox WHERE auction_slug=$1', [slug])).rows[0];
    await recordNotifications(pool, auctionClosedSchema.parse(row.payload), { traceparent: 'invalid' });
    const all = await spans(); const workflow = all.filter(span => span.spanContext().traceId === traceId(row.trace_context));
    expect(workflow.find(span => span.name === 'auction.close')?.attributes['context.fallback']).toBe(true);
    expect(workflow.find(span => span.name === 'auction.notification.process')?.attributes['context.invalid']).toBe(true);
    const noBid = await fixture();
    await pool.query("UPDATE auctions SET closes_at=clock_timestamp()-interval '1 millisecond' WHERE slug=$1", [noBid]);
    await closeDueAuctions(pool);
    const noBidRow = (await pool.query('SELECT * FROM auction_outcomes WHERE auction_slug=$1', [noBid])).rows[0];
    expect(noBidRow.status).toBe('no_bids'); expect(traceId(noBidRow.trace_context)).not.toBe(traceId(row.trace_context));
    expect((await pool.query('SELECT * FROM purchases WHERE auction_slug=$1', [noBid])).rowCount).toBe(0);
  });
  it('does not persist accepted context for rejected/rolled-back bids or report rolled-back closes as committed', async () => {
    const slug = await fixture();
    await pool.query(`CREATE FUNCTION ${schema}.reject_bid() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PRIVATE_SQL_MARKER'; END $$`);
    await pool.query('CREATE TRIGGER reject_trace_bid BEFORE INSERT ON bids FOR EACH ROW EXECUTE FUNCTION reject_bid()');
    expect((await bid(slug, 10100)).statusCode).toBe(500);
    await pool.query('DROP TRIGGER reject_trace_bid ON bids');
    expect((await pool.query('SELECT * FROM bids WHERE auction_slug=$1', [slug])).rowCount).toBe(0);
    await bid(slug, 10100);
    const parent = (await pool.query('SELECT trace_context FROM bids WHERE auction_slug=$1', [slug])).rows[0].trace_context;
    await pool.query("UPDATE auctions SET closes_at=clock_timestamp()-interval '1 millisecond' WHERE slug=$1", [slug]);
    await pool.query('CREATE TRIGGER reject_trace_outbox BEFORE INSERT ON auction_outbox FOR EACH ROW EXECUTE FUNCTION reject_bid()');
    await expect(closeDueAuctions(pool)).rejects.toThrow();
    await pool.query('DROP TRIGGER reject_trace_outbox ON auction_outbox');
    expect((await pool.query('SELECT * FROM auction_outcomes WHERE auction_slug=$1', [slug])).rowCount).toBe(0);
    const failed = (await spans()).find(span => span.name === 'auction.close' && span.spanContext().traceId === traceId(parent));
    expect(failed?.attributes['transaction.committed']).toBe(false);
    expect(failed?.attributes['business.outcome']).toBe('rolled_back'); expect(failed?.status.code).toBe(SpanStatusCode.ERROR);
    expect(JSON.stringify(await spans())).not.toContain('PRIVATE_SQL_MARKER');
  });
  it('retains the winning workflow when a known-unpaid mock session disappears and is replaced', async () => {
    const slug = await fixture(); await bid(slug, 10100);
    await pool.query("UPDATE auctions SET closes_at=clock_timestamp()-interval '1 millisecond' WHERE slug=$1", [slug]);
    await closeDueAuctions(pool);
    const purchase = (await pool.query('SELECT * FROM purchases WHERE auction_slug=$1', [slug])).rows[0];
    const id = traceId(purchase.trace_context);
    const opened = await checkout(slug); expect(opened.statusCode).toBe(200);
    const oldId = new URL(opened.json().url).pathname.split('/').at(-1)!;
    await mock.close();
    const file = join(directory, 'sessions.json');
    const stored = JSON.parse(await readFile(file, 'utf8')) as Array<{ id: string; status: string; payment_status: string }>;
    expect(stored.find(row => row.id === oldId)).toMatchObject({ status: 'open', payment_status: 'unpaid' });
    await writeFile(file, JSON.stringify(stored.filter(row => row.id !== oldId)));
    mock = makeMock(); await mock.listen({ port: Number(new URL(mockAddress).port), host: '127.0.0.1' });
    const replacement = await checkout(slug); expect(replacement.statusCode).toBe(200);
    const newId = new URL(replacement.json().url).pathname.split('/').at(-1)!; expect(newId).not.toBe(oldId);
    expect((await mock.inject({ method: 'POST', url: `/v1/checkout/sessions/${newId}/attempt`, payload: { cardNumber: '4242424242424242', expiry: '12/39', cvc: '123' } })).statusCode).toBe(200);
    const after = (await pool.query('SELECT * FROM purchases WHERE auction_slug=$1', [slug])).rows[0];
    expect(after.id).toBe(purchase.id); expect(traceId(after.trace_context)).toBe(id); expect(after.status).toBe('paid');
    const collected = (await spans()).filter(span => span.spanContext().traceId === id);
    expect(collected.some(span => span.name === 'winner.checkout' && span.attributes['business.outcome'] === 'recovered')).toBe(true);
    expect(collected.some(span => span.name === 'winner.purchase.paid')).toBe(true);
  });
  it('strips forbidden attributes, events, error text, baggage and unsafe tracestate at the exported-span boundary', async () => {
    const before = memory.getFinishedSpans().length;
    await withSpan('auction.bid', { 'auction.slug': 'PRIVATE_TITLE_MARKER', 'db.statement': 'SELECT PRIVATE_SQL_MARKER', 'url.full': 'https://PRIVATE_NAME_MARKER', 'amount.cents': 10300 }, async span => {
      span.recordException(new Error('PRIVATE_CARD_MARKER 4242424242424242'));
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'PRIVATE_ERROR_MARKER' });
      span.addEvent('PRIVATE_EVENT_MARKER', { data: 'PRIVATE_PAYLOAD_MARKER' });
      expect(validCarrier({ ...captureTrace(), tracestate: 'unsafe=PRIVATE_NAME_MARKER,auction=abcdef' })?.tracestate).toBe('auction=abcdef');
    }, ROOT_CONTEXT);
    const exported = (await spans()).slice(before);
    expect(JSON.stringify(exported)).not.toMatch(/PRIVATE_|4242424242424242|db\.statement|url\.full/);
    expect(exported[0].attributes['amount.cents']).toBe(10300); expect(exported[0].events).toEqual([]);
    expect(exported[0].resource.attributes).toEqual({ 'service.name': 'auction-part-8-test' });
    await withSpan('auction.bid', {}, async () => {
      await withSpan('auction.close', {}, async () => {}, contextFromCarrier({ traceparent: '00-' + '0'.repeat(32) + '-' + '1'.repeat(16) + '-01' }));
    }, ROOT_CONTEXT);
    expect(validCarrier({ traceparent: 'invalid' })).toBeNull();
  });
  it('an unavailable OTLP HTTP receiver cannot undo a committed bid', async () => {
    const slug = await fixture();
    expect((await bid(slug, 10100)).statusCode).toBe(201);
    const accepted = (await spans()).filter(span => span.name === 'auction.bid' && span.attributes['business.outcome'] === 'accepted').at(-1)!;
    const unavailable = new SafeExporter(new OTLPTraceExporter({ url: 'http://127.0.0.1:1/v1/traces', timeoutMillis: 100 }));
    await new Promise<void>(resolve => unavailable.export([accepted], result => { expect(result.code).toBe(1); resolve(); }));
    expect((await pool.query('SELECT * FROM bids WHERE auction_slug=$1', [slug])).rowCount).toBe(1);
    expect((await api.inject('/api/health')).statusCode).toBe(200);
    await unavailable.shutdown();
  });
  it('export failures never reject business work', async () => {
    const broken = new SafeExporter({ export() { throw new Error('PRIVATE_EXPORT_ERROR'); }, async shutdown() { throw new Error('PRIVATE_SHUTDOWN_ERROR'); } });
    await new Promise<void>(resolve => broken.export([memory.getFinishedSpans()[0] as ReadableSpan], result => { expect(result.code).toBe(1); expect(String(result.error)).not.toContain('PRIVATE'); resolve(); }));
    await expect(broken.shutdown()).resolves.toBeUndefined();
    const tracer = trace.getTracer('other-library'); const unapproved = tracer.startSpan('PRIVATE_FRAMEWORK_NOISE'); unapproved.end();
    expect((await spans()).some(span => span.name === 'PRIVATE_FRAMEWORK_NOISE')).toBe(false);
  });
});

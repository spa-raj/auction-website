import { SpanStatusCode, type Attributes, type SpanContext } from '@opentelemetry/api';
import { ExportResultCode, W3CTraceContextPropagator } from '@opentelemetry/core';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { AlwaysOnSampler, BatchSpanProcessor, type SpanExporter, type ReadableSpan } from '@opentelemetry/sdk-trace';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { spanNames } from './tracing.js';

const ids = new Set(['auction.id', 'purchase.id', 'event.id', 'notification.id']);
const numeric = new Set(['bid.id', 'participant.id', 'seller.id', 'winner.id', 'recipient.id', 'amount.cents', 'attempt.number']);
const outcomes = new Set(['accepted', 'invalid', 'not_found', 'ended', 'self_bid', 'too_low', 'sold', 'no_bids', 'published',
  'recorded', 'duplicate', 'signal_attempted', 'unavailable', 'reused', 'created', 'recovered', 'paid', 'declined',
  'unsupported', 'confirmation_pending', 'delivered', 'retry_pending', 'rejected', 'conflict', 'already_paid', 'committed', 'rolled_back']);
const collections = new Set(['auctions', 'bids', 'auction_outcomes', 'auction_outbox', 'recipient_notifications', 'purchases', 'payment_events']);
const operations = new Set(['SELECT', 'SELECT FOR UPDATE', 'SELECT FOR SHARE', 'INSERT', 'UPDATE', 'TRANSACTION']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function safeAttributes(attributes: Attributes): Attributes {
  const safe: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (ids.has(key) && typeof value === 'string' && uuid.test(value)) safe[key] = value;
    else if (numeric.has(key) && typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647 && (!key.endsWith(".id") || key === "bid.id" || value <= 10)) safe[key] = value;
    else if (key === 'payment.session.id' && typeof value === 'string' && /^cs_test_[0-9a-f]{24}$/.test(value)) safe[key] = value;
    else if (key === 'participant.role' && (value === 'seller' || value === 'winner' || value === 'bidder')) safe[key] = value;
    else if (key === 'business.outcome' && typeof value === 'string' && outcomes.has(value)) safe[key] = value;
    else if (key === 'db.system.name' && value === 'postgresql') safe[key] = value;
    else if (key === 'db.operation.name' && typeof value === 'string' && operations.has(value)) safe[key] = value;
    else if (key === 'db.collection.name' && typeof value === 'string' && collections.has(value)) safe[key] = value;
    else if (key === 'currency' && value === 'usd') safe[key] = value;
    else if (key === 'error.type' && typeof value === 'string' && ['operation_failed', 'database_failed', 'publish_failed', 'delivery_failed', 'provider_unavailable'].includes(value)) safe[key] = value;
    else if (['messaging.redelivered', 'event.duplicate', 'context.fallback', 'context.invalid', 'signal.attempted', 'transaction.committed'].includes(key) && typeof value === 'boolean') safe[key] = value;
  }
  return safe;
}
const safeContext = (span: SpanContext): SpanContext => ({ traceId: span.traceId, spanId: span.spanId, traceFlags: span.traceFlags });
export function sanitizeSpan(span: ReadableSpan): ReadableSpan | null {
  if (!(spanNames as readonly string[]).includes(span.name)) return null;
  const service = span.resource.attributes['service.name'];
  const name = typeof service === 'string' && /^auction-part-8-(api|close-worker|notification-worker|mock-stripe|test)$/.test(service) ? service : 'auction-part-8-test';
  return { name: span.name, kind: span.kind, startTime: span.startTime, endTime: span.endTime,
    duration: span.duration, ended: span.ended, droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount, droppedLinksCount: span.droppedLinksCount, spanContext: () => safeContext(span.spanContext()),
    parentSpanContext: span.parentSpanContext && safeContext(span.parentSpanContext), attributes: safeAttributes(span.attributes),
    events: [], links: span.links.map(link => ({ context: safeContext(link.context), attributes: safeAttributes(link.attributes ?? {}) })),
    status: { code: span.status.code === SpanStatusCode.ERROR ? SpanStatusCode.ERROR : SpanStatusCode.UNSET },
    resource: resourceFromAttributes({ 'service.name': name }), instrumentationScope: { name: 'auction-business', version: '1.0' } };
}
export class SafeExporter implements SpanExporter {
  constructor(private readonly delegate: SpanExporter) {}
  export(spans: ReadableSpan[], callback: Parameters<SpanExporter['export']>[1]): void {
    const safe = spans.map(sanitizeSpan).filter((span): span is ReadableSpan => span !== null);
    if (!safe.length) { callback({ code: ExportResultCode.SUCCESS }); return; }
    try { this.delegate.export(safe, callback); }
    catch { callback({ code: ExportResultCode.FAILED, error: new Error('Telemetry export failed') }); }
  }
  async shutdown() { try { await this.delegate.shutdown(); } catch { /* never fail application shutdown */ } }
  async forceFlush() { try { await this.delegate.forceFlush?.(); } catch { /* best effort */ } }
}
export function startTelemetry(service: string, exporter?: SpanExporter) {
  const processor = new BatchSpanProcessor({ exporter: new SafeExporter(exporter ?? new OTLPTraceExporter({ timeoutMillis: 1500 })),
    scheduledDelayMillis: 300, exportTimeoutMillis: 2000, maxQueueSize: 4096, maxExportBatchSize: 256 });
  const sdk = new NodeSDK({ resource: resourceFromAttributes({ 'service.name': service }), autoDetectResources: false,
    spanProcessors: [processor], sampler: new AlwaysOnSampler(), textMapPropagator: new W3CTraceContextPropagator(),
    instrumentations: [], metricReaders: [], logRecordProcessors: [] });
  sdk.start();
  return { async forceFlush() { try { await processor.forceFlush(); } catch { /* telemetry cannot fail business work */ } },
    async shutdown() {
      // Finish spans/transactions before calling this; explicitly drain batches
      // before SDK/exporter shutdown. Failure is bounded and never changes business state.
      try { await processor.forceFlush(); } catch { /* backend unavailable */ }
      try { await sdk.shutdown(); } catch { /* best effort */ }
    } };
}

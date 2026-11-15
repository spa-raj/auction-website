import { context, propagation, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace, type Attributes, type Context, type Span } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

export type TraceCarrier = { traceparent: string; tracestate?: string };
const propagator = new W3CTraceContextPropagator();
const getter = { keys: (carrier: Record<string, string>) => Object.keys(carrier), get: (carrier: Record<string, string>, key: string) => carrier[key] };
const setter = { set: (carrier: Record<string, string>, key: string, value: string) => { carrier[key] = value; } };
// Only this application's opaque vendor state is supported. Never pass arbitrary
// baggage/vendor data (which can contain personal information) through storage.
export function validCarrier(value: unknown): TraceCarrier | null {
  if (!value || typeof value !== 'object' || !('traceparent' in value) || typeof value.traceparent !== 'string') return null;
  const parent = value.traceparent;
  if (!/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/.test(parent) || /^00-0{32}-/.test(parent) || /^00-[0-9a-f]{32}-0{16}-/.test(parent)) return null;
  const state = 'tracestate' in value && typeof value.tracestate === 'string'
    ? value.tracestate.split(',').map(s => s.trim()).find(s => /^auction=[0-9a-f]{1,32}$/.test(s)) : undefined;
  return { traceparent: parent, ...(state ? { tracestate: state } : {}) };
}
export function contextFromCarrier(value: unknown): Context {
  const carrier = validCarrier(value);
  return carrier ? propagator.extract(ROOT_CONTEXT, carrier, getter) : ROOT_CONTEXT;
}
export function captureTrace(): TraceCarrier | null {
  const carrier: Record<string, string> = {};
  propagator.inject(context.active(), carrier, setter);
  return validCarrier(carrier);
}
export function traceHeaders(): Record<string, string> { return { ...(captureTrace() ?? {}) }; }
export function sameTrace(a: unknown, b: unknown): boolean {
  const first = validCarrier(a); const second = validCarrier(b);
  return !!first && !!second && first.traceparent.slice(3, 35) === second.traceparent.slice(3, 35);
}
export const spanNames = ['auction.bid', 'auction.close', 'auction.outbox.publish', 'auction.notification.process',
  'auction.notification.recipient', 'auction.notification.signal', 'winner.checkout', 'winner.purchase.webhook',
  'winner.purchase.paid', 'mock-stripe.checkout.create', 'mock-stripe.payment.attempt', 'mock-stripe.webhook.deliver',
  'postgres.operation', 'postgres.transaction', 'payment.status.failure'] as const;
export type SpanName = typeof spanNames[number];
export async function withSpan<T>(name: SpanName, attributes: Attributes, work: (span: Span) => PromiseLike<T>, parent: Context = context.active(), kind = SpanKind.INTERNAL, deferEnd?: (span: Span) => void): Promise<T> {
  const span = trace.getTracer('auction-business', '1.0').startSpan(name, { attributes, kind }, parent);
  return context.with(trace.setSpan(parent, span), async () => {
    try { return await work(span); }
    catch (error) { span.setStatus({ code: SpanStatusCode.ERROR }); span.setAttribute('error.type', 'operation_failed'); throw error; }
    finally { if (deferEnd) deferEnd(span); else span.end(); }
  });
}
export function outcome(value: string) { trace.getActiveSpan()?.setAttribute('business.outcome', value); }
export function failed(category: string) { trace.getActiveSpan()?.setStatus({ code: SpanStatusCode.ERROR }); trace.getActiveSpan()?.setAttribute('error.type', category); }
export function dbSpan<T>(operation: string, collection: string, work: () => PromiseLike<T>): Promise<T> {
  return withSpan('postgres.operation', { 'db.system.name': 'postgresql', 'db.operation.name': operation, 'db.collection.name': collection }, work, context.active(), SpanKind.CLIENT);
}
export { ROOT_CONTEXT, SpanKind };

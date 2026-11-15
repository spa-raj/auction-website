import type { Attributes, Context, Span } from '@opentelemetry/api';
import { captureTrace, contextFromCarrier, withSpan, type SpanName } from '../../shared/tracing.js';
export const activeTraceparent = () => captureTrace()?.traceparent ?? null;
export const contextFromTraceparent = (traceparent?: string): Context => contextFromCarrier({ traceparent });
export const withStripeSpan = <T>(name: SpanName, attributes: Attributes, parent: Context, work: (span: Span) => Promise<T>) => withSpan(name, attributes, work, parent);

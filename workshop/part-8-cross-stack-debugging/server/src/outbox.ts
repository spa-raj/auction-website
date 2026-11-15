import { asc, eq, isNull, sql } from 'drizzle-orm';
import type pg from 'pg';
import { SpanStatusCode, type Span } from '@opentelemetry/api';
import { captureTrace, contextFromCarrier, dbSpan, SpanKind, validCarrier, withSpan, type TraceCarrier } from '../../shared/tracing.js';
import { database } from './db.js';
import { auctions, outbox } from './schema.js';
import { auctionClosedSchema, type AuctionClosed } from '../../shared/auction-closed.js';

export async function publishPendingOutbox(pool: pg.Pool, publish: (event: AuctionClosed, carrier?: TraceCarrier | null) => Promise<void>): Promise<number> {
  const spans: Span[] = []; let committed = false;
  try {
    const result = await database(pool).transaction(async tx => {
      const pending = await tx.select({ eventId: outbox.eventId, payload: outbox.payload, traceContext: outbox.traceContext, auctionId: auctions.telemetryId }).from(outbox)
        .innerJoin(auctions, eq(auctions.slug, outbox.auctionSlug))
        .where(isNull(outbox.publishedAt)).orderBy(asc(outbox.createdAt), asc(outbox.eventId))
        .limit(25).for('update', { of: outbox, skipLocked: true });
      for (const row of pending) {
        const event = auctionClosedSchema.parse(row.payload);
        if (event.eventId !== row.eventId) throw new Error('Outbox event ID does not match its payload');
        await withSpan('auction.outbox.publish', { 'auction.id': row.auctionId, 'event.id': event.eventId,
          'context.fallback': !validCarrier(row.traceContext) }, async span => {
          await publish(event, captureTrace());
          await dbSpan('UPDATE', 'auction_outbox', () => tx.update(outbox).set({ publishedAt: sql`clock_timestamp()` }).where(eq(outbox.eventId, row.eventId)));
          span.setAttribute('business.outcome', 'published');
        }, contextFromCarrier(row.traceContext), SpanKind.PRODUCER, span => spans.push(span));
      }
      return pending.length;
    });
    committed = true; return result;
  } finally {
    for (const span of spans) {
      span.setAttribute('transaction.committed', committed);
      if (!committed) { span.setStatus({ code: SpanStatusCode.ERROR }); span.setAttribute('error.type', 'publish_failed'); }
      span.end();
    }
  }
}

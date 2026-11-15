import { and, eq } from 'drizzle-orm';
import { SpanStatusCode, type Span } from '@opentelemetry/api';
import { captureTrace, contextFromCarrier, dbSpan, sameTrace, SpanKind, validCarrier, withSpan } from '../../shared/tracing.js';
import { database } from './db.js';
import { auctions, notifications, outbox } from './schema.js';
import type pg from 'pg';
import { auctionClosedSchema, type AuctionClosed } from '../../shared/auction-closed.js';

export class InvalidCloseEvent extends Error {}
export function parseCloseEvent(content: Buffer): AuctionClosed {
  try { return auctionClosedSchema.parse(JSON.parse(content.toString('utf8')) as unknown); }
  catch { throw new InvalidCloseEvent('Malformed or unsupported auction close event'); }
}

/** Commit every recipient together; conflict handling preserves IDs and dismissals. */
export async function recordNotifications(pool: pg.Pool, event: AuctionClosed, carrier?: unknown, redelivered = false): Promise<number[]> {
  const spans: Span[] = []; let committed = false;
  try {
    const recipients = await database(pool).transaction(async tx => {
      const [stored] = await tx.select({ payload: outbox.payload, traceContext: outbox.traceContext, auctionId: auctions.telemetryId })
        .from(outbox).innerJoin(auctions, eq(auctions.slug, outbox.auctionSlug)).where(eq(outbox.eventId, event.eventId));
      if (!stored || JSON.stringify(auctionClosedSchema.parse(stored.payload)) !== JSON.stringify(event)) throw new InvalidCloseEvent('Close event does not match its recorded outbox event');
      const propagated = sameTrace(stored.traceContext, carrier);
      return withSpan('auction.notification.process', { 'auction.id': stored.auctionId, 'event.id': event.eventId,
        'messaging.redelivered': redelivered, 'context.invalid': !propagated, 'context.fallback': !validCarrier(stored.traceContext) }, async span => {
        const recipients: { userId: number; role: 'seller' | 'winner' }[] = [{ userId: event.sellerId, role: 'seller' }];
        if (event.outcome.status === 'sold' && event.outcome.winnerId !== event.sellerId) recipients.push({ userId: event.outcome.winnerId, role: 'winner' });
        for (const recipient of recipients) {
          await withSpan('auction.notification.recipient', { 'event.id': event.eventId, 'recipient.id': recipient.userId, 'participant.role': recipient.role }, async recipientSpan => {
            const recipientTrace = captureTrace();
            const inserted = await dbSpan('INSERT', 'recipient_notifications', () => tx.insert(notifications)
              .values({ eventId: event.eventId, recipientId: recipient.userId, role: recipient.role, traceContext: recipientTrace })
              .onConflictDoNothing({ target: [notifications.eventId, notifications.recipientId] }).returning({ id: notifications.id }));
            const id = inserted[0]?.id ?? (await dbSpan('SELECT', 'recipient_notifications', () => tx.select({ id: notifications.id }).from(notifications)
              .where(and(eq(notifications.eventId, event.eventId), eq(notifications.recipientId, recipient.userId)))))[0]?.id;
            if (id) recipientSpan.setAttribute('notification.id', id);
            recipientSpan.setAttribute('business.outcome', inserted.length ? 'recorded' : 'duplicate');
            recipientSpan.setAttribute('event.duplicate', !inserted.length);
          }, undefined, SpanKind.INTERNAL, span => spans.push(span));
        }
        span.setAttribute('business.outcome', 'recorded');
        return recipients.map(recipient => recipient.userId);
      }, contextFromCarrier(propagated ? carrier : stored.traceContext), SpanKind.CONSUMER, span => spans.push(span));
    });
    committed = true; return recipients;
  } finally {
    for (const span of spans) {
      span.setAttribute('transaction.committed', committed);
      if (!committed) { span.setStatus({ code: SpanStatusCode.ERROR }); span.setAttribute('business.outcome', 'rolled_back'); }
      span.end();
    }
  }
}

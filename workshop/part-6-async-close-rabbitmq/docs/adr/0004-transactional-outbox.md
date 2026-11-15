---
status: accepted
---

# Record auction outcomes and close events in one transaction

The requested workflow commits the final auction outcome and a durable outbox event in the same PostgreSQL transaction. A relay publishes committed events to RabbitMQ and marks publication only after broker confirmation. This avoids a database/broker dual-write gap: a crash after committing an outcome must not permanently suppress its notification, and a rolled-back outcome must not produce a close event.

Direct publication before commit risks announcing a rolled-back result; publication only after commit risks losing the event on process failure. A transactional outbox trades extra storage and relay operation for recoverable publication without a distributed transaction. Republishing after a crash remains possible, so consumers must tolerate duplicate event IDs; broker confirmation does not prove browser receipt.

Accepted design: consumers use idempotent processing and database uniqueness constraints; recipient notifications survive offline periods and require explicit durable dismissal. Dead-letter queues and elaborate retry infrastructure are deferred. The relay runs as an independent loop in the close-worker process; transient failures use capped backoff without blocking finalization. The separate notification worker commits unique recipient notifications before acknowledging the broker, then emits a realtime signal; HTTP reconciliation recovers a crash between acknowledgement and emission. Malformed or unsupported messages are rejected without requeue and logged for manual investigation. The user approved publication and notification delivery as Slice 2 after reviewing Slice 1.

References: [Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html), [RabbitMQ confirmations](https://www.rabbitmq.com/docs/confirms), [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/).

## Implemented guarantees

Migration 002 stores one outcome per auction and one versioned close event per outcome in one row-locked transaction. The independent relay loop claims pending events with SKIP LOCKED, sends persistent mandatory messages to durable RabbitMQ topology and waits for confirmation before setting published_at. A nack, return, timeout or channel loss rolls back publication marking. A crash after confirmation and before database commit can republish the same stable event ID.

Migration 003 enforces uniqueness of event ID and recipient. The separate notification worker verifies the event against the recorded outbox payload, inserts all recipients in one transaction, then ACKs RabbitMQ and emits through the Socket.IO Redis emitter. Redelivery leaves existing notification IDs and dismissals intact. Redis signals remain best effort; HTTP recovers undismissed notices after signal loss. Explicit dismissal persists per recipient and broadcasts an invalidation to that recipient’s windows.

Dead-letter queues remain deferred. Malformed, unsupported or mismatched events are rejected without requeue and logged for manual investigation; this is not durable quarantine. The local durable classic queue is not a highly available broker cluster.

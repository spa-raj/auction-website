# Part 6 — Current Approved Slice

Current authorization: issue #8 approves a behavior-preserving Part 6 Drizzle refactor and PR. Earlier slice review stops below are historical and do not block this refactor. All concurrency and notification guarantees remain required.

## Slice 1 — Authoritative closing and transactional outbox

Status: Implemented; verification and review results are in VERIFICATION.md. Stop for review.

The latest user instruction explicitly approves this backend checkpoint and supersedes the earlier full-popup Slice 1 proposal. Scope: copy only the Part 4 baseline without dependencies/generated output, isolate Part 6, preserve deadline/auction-row locking, claim due auctions with SKIP LOCKED, choose the highest accepted bid, and atomically create the durable outcome and unique outbox event. Verify concurrency, deadline behavior and repeated processing.

Delivered supporting browser behavior: distinguish expired-but-unfinalized auctions from persisted sold/no-bid results; disable bidding immediately at the deadline; show recorded winner/amount after finalization. Existing five-second detail reconciliation reads the authoritative outcome.

Check npm test, npm run build, HTTP health, browser finalizing/sold/no-bid states and persistence after reload. Tests cover duplicate constraints, bounded oldest-first batches, independent concurrent closers, skipped locked auctions, pre-deadline bids committing after expiry, queued late bids, repeated processing and outbox-failure rollback.

## Slice 2 — Confirmed delivery and recipient popups

Status: Implemented; stop for review after verification. Explicitly approved after Slice 1 review.

Deliver pending outbox publication to an isolated RabbitMQ vhost with persistent messages, durable topology, mandatory routing and publisher confirms. Mark published only after confirmation; retain stable IDs for retries. Keep the relay loop independent from auction closing and the notification worker in a separate process.

Commit unique seller/winner notifications before consumer ACK; no-bid events address only the seller. Reject invalid messages without requeue and log them; retry transient errors with capped backoff. Emit recipient-specific signals using the official Socket.IO Redis emitter and the API Redis adapter. Persist recipient dismissal; duplicate delivery cannot revive it.

Browser behavior: global explicitly dismissed modal queue, seller/winner content, auction navigation without dismissal, keyboard focus, no Escape/backdrop dismissal, demo identity switching, initial/reconnect/focus/five-second HTTP recovery and visible retry for failed synchronization/dismissal. Show matching results in multiple windows and synchronize dismissal.

Verify real publisher confirms, mandatory returns, actual redelivery after commit-before-ACK, unique recipient rows, no losing-bidder notices, no-bid selection, Redis-to-Socket.IO routing, popup behavior and offline recovery. Run npm test, npm run typecheck/build and browser verification. No dead-letter queues, elaborate retry infrastructure, real authentication, payments or multi-replica demonstration.

Stop for review. The original pre-implementation proposal remains historical in docs/original-two-slice-proposal.md.

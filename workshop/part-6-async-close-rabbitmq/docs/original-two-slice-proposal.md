# Part 6 — Asynchronous Close Feature Slices

Status: Proposed; awaiting approval. No application baseline copied or implementation started.

## Slice 1 — Final outcomes and durable recipient popups

Visible outcome: an auction stops accepting bids at its existing deadline, briefly shows “Auction ended · finalizing result” if needed, then displays a permanent result. The seller and winning bidder receive explicitly dismissible popups anywhere in the app. An auction with no bids produces a seller-only “Ended without bids” notification.

Deliver the entire flow: isolated Part 4 baseline; migrations; one-second polling close worker; outcome/outbox atomicity; independently scheduled relay; confirmed persistent RabbitMQ publication to durable topology; separate notification worker; validated versioned event; idempotent durable recipient records; Redis-to-Socket.IO recipient signals; global modal queue; outcome HTTP reads; pending and dismissal endpoints; demo identity switching; initial/reconnect/focus/five-second reconciliation; cross-window durable dismissal; simple reconnect/backoff; component health; documented npm/Docker commands and graceful shutdown. Navigation must not dismiss notifications. A failed dismissal retains the modal with retry feedback. Include keyboard focus handling and preserve existing bidding and realtime behavior.

Copy only Part 4 source/config/lockfiles; recursively exclude dependencies, build output, caches, logs, browser captures/profiles, local environment files and other generated output. Preserve the current Part 6 design documents. Archive inherited Part 4 design and verification records as historical; replace active instructions and runtime references for Part 6. Do not read or copy Part 5, modify earlier parts, or modify root Compose. Isolate production and test databases, ports, browser storage, Redis channels, RabbitMQ vhost/topology and service names.

Verification: npm test; npm run build (strict type checks); browser /health and affected flows. Add meaningful integration checks for rollback atomicity, one outcome under concurrent close workers, late bids and a bid holding the auction lock across the deadline, confirm-before-published behavior, duplicate event consumption, nullable no-bid results, recipient isolation and idempotent dismissal. Independently observe actual RabbitMQ consumption and Redis publication; prove healthy-path browser delivery by Socket.IO with notification polling disabled. Verify seller, winner, losing bidder, app navigation, reload, offline return, identity switching and cross-window dismissal. Keep normal recovery enabled outside targeted realtime tests. Put browser evidence in temporary directories. Run requested browser demonstrations headed in Chrome/Edge, tiled separate windows, left open for review.

Review steps: create a short auction as seller; bid from another window; leave one recipient on the catalog; watch the deadline and result; inspect both recipient popups; dismiss in one window and reload; repeat without bids. Return as an offline recipient to review a pending result.

Stop after this complete, tested slice. Report changes, validation and concrete browser URLs/steps; wait for review confirmation before Slice 2. All baseline reliability behavior above belongs to Slice 1 and is not deferred to Slice 2.

## Slice 2 — Visible recovery during interruptions

Visible outcome: users can understand interrupted result/notification synchronization and recover without losing an outcome, pending popup or bid draft. Add clear reconnecting/stale feedback and a user-invoked retry when notification HTTP synchronization fails; clear feedback after a successful recovery. Preserve the basic correctness and recovery already delivered in Slice 1.

Deliver the browser feedback and recovery interactions end to end, supported by deterministic fault-injection integration/browser scenarios. Demonstrate a broker outage at closing (bidding stops and outcome persists, popup arrives after recovery), notification worker downtime (queue catches up), missed Redis signals (HTTP recovers pending notices), close-worker downtime (finalizing state then backlog catch-up), API/HTTP read failure (honest stale feedback and retry), and duplicate delivery after a processing crash (no duplicate notification or revived dismissal). Verify multiple pending popups are not dropped. No new retry infrastructure, dead-letter queues or multi-replica deployment.

Verification: npm test; npm run build; browser /health in healthy and relevant degraded states; browser fault/recovery flows with persisted outcomes, outbox state and recipient records checked against visible results. Verify failed dismissal feedback and successful retry, focus/draft preservation, identity-switch races and restored cross-window convergence. Do not stop shared services used by earlier parts: prefer Part 6 process/client fault injection and isolated resources. Requested demonstrations follow the same headed Chrome/Edge, tiled-window and temporary-capture rules.

Review steps: observe an auction close while Part 6 publication is interrupted, restore publication and inspect the original result/popups; disconnect/reconnect a recipient; trigger a pending-notification read failure and use Retry; restart the worker with overdue auctions and inspect sequential notifications. Explicitly dismiss a notification and verify replay cannot restore it.

Stop after this complete, verified slice and provide browser review steps.

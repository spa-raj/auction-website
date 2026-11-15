# Part 6 — Asynchronous Close and Recipient Popups

The close worker records final auction outcomes and outbox events atomically. Its independent relay publishes through RabbitMQ with publisher confirms. A separate notification worker persists seller/winner notices and signals their browser windows through the Socket.IO Redis emitter and API Redis adapter. PostgreSQL remains authoritative for results, pending notifications and dismissal.

## Run

From this directory:

```sh
npm ci
npm start
```

`npm start` prepares shared PostgreSQL, Redis and RabbitMQ through existing root Compose services, creates Part 6 resources, applies migrations, then starts API, web, close/relay and notification workers. Existing data is preserved, including unpublished Slice 1 events; starting Slice 2 delivers that backlog. Root Compose and earlier parts are unchanged.

- Web: http://localhost:5106
- Browser health: http://localhost:5106/health
- API health: http://localhost:3106/api/health
- PostgreSQL: auction_part_6 on localhost:55432
- Redis: localhost:56379; adapter prefix auction-part-6:socket.io
- RabbitMQ: localhost:56726; management localhost:15676; vhost auction_part_6

```sh
npm run db:up
npm run redis:up
npm run rabbitmq:up
npm run migrate
npm run dev
npm run worker:close
npm run worker:notifications
npm test
npm run typecheck
npm run build
npm run test:notifications
```

`dev` starts all four processes; individual worker commands are available for recovery/review when not already supervised. Ctrl+C cancels polling and consumption, finishes active work and closes connections. `db:reset` recreates only the application database; normal startup preserves it. Tests use auction_part_6_test, an isolated RabbitMQ test vhost and Redis test prefix. Run infrastructure commands before tests. RabbitMQ setup is idempotent and grants the local auction account access only to the two Part 6 virtual hosts; it does not change earlier resources.

Runtime defaults can be overridden with DATABASE_URL, REDIS_URL, REDIS_CHANNEL_PREFIX and RABBITMQ_URL. RabbitMQ setup additionally accepts RABBITMQ_MANAGEMENT_URL, RABBITMQ_USER and RABBITMQ_PASSWORD. Defaults use the existing local Compose account. The application RabbitMQ URL ends with `/auction_part_6?heartbeat=5`; tests explicitly use `/auction_part_6_test`.

## Guarantees and recovery

Closing retains auction-row locking and the original post-lock acceptance-time deadline check. A pre-deadline bid can commit after expiry and still be included. Due auctions are claimed oldest first in bounded batches with SKIP LOCKED; the highest accepted bid becomes the permanent sold result, or an auction records no bids with no winner/amount. Outcomes and stable-ID outbox events commit together. Unique constraints prevent duplicate closes/events; composite foreign keys tie sold results to the precise winning bid.

The relay sends persistent mandatory `auction.closed` v1 messages to durable exchange `auction.events` and queue `auction.notifications`. Publication is marked only after broker confirmation. An unroutable return, nack, timeout or channel loss leaves events pending. A crash after confirmation but before publication marking can resend the same event; transport is at least once, not exactly once. Closing continues independently during broker outages. `npm run dev` can run against already prepared resources while RabbitMQ is unavailable; `npm start` first prepares/checks infrastructure.

The notification worker validates messages with Zod and checks them against the recorded outbox event. It commits seller/winner notices before ACK, using uniqueness on event and recipient; no bids means seller only. Duplicate processing cannot reset a dismissal. Invalid/unsupported/mismatched messages are rejected without requeue and logged; transient failures use capped backoff and reconnection. No dead-letter queue or elaborate retry topology is included.

The worker emits a small recipient signal through Redis/Socket.IO; browser contents come from HTTP. Missing a signal cannot lose a durable notice. Initial load, subscription/reconnect, focus/visibility and five-second reconciliation fetch pending notices. A crash after ACK but before Redis emission is recovered by HTTP. A Redis outage does not prevent recording notifications. API health checks PostgreSQL/Redis and does not establish close/relay/notification worker progress; worker logs report separate activity/failures. This uses the existing application-clock convention; API and worker hosts must have synchronized clocks.

## Popups

Seller and winner notices appear anywhere in the app, one at a time, in all windows using the recipient’s demo identity. Losing bidders receive no popup. Show item title, result, winning amount where applicable and an auction link. Following the link keeps the notice pending. Only Dismiss acknowledges it; no automatic timeout, Escape or backdrop dismissal. Saving failures retain the modal with retry feedback. Dismissal persists across reload and signals other recipient windows. A demo user selector inside the modal allows switching without dismissing someone else’s notice; switching clears the prior participant immediately. Demo selection and recipient rooms are routing, not authentication.

HTTP endpoints use the existing x-demo-user-id header: GET /api/notifications lists up to 50 pending notices oldest first; POST /api/notifications/:id/dismiss idempotently dismisses only that recipient’s notice. Subsequent reads refill the queue so larger backlogs are not discarded. Auction detail responses retain nullable finalOutcome and distinguish deadline expiry from recorded finalization. Existing bid realtime behavior is preserved.

## Browser verification and review

`npm run test:notifications` requires a graphical desktop and Chrome. It opens four separate windows in a 2×2 arrangement and leaves the final review state open until Ctrl+C. `npm run test:notifications -- --headless` is intended for normal automated self-verification. Screenshots/evidence are written under an OS temporary directory. The check uses seller 4, winner 5 and losing bidder 6; reruns dismiss only earlier notices titled “Popup review — …” for these participants, preserve other data and create fresh auctions. Healthy-path polling is disabled inside its test contexts and actual WebSocket frames are required. It checks duplicate replay, failed-dismissal retry, cross-window dismissal, no-bid delivery, queued notices, identity changes, offline return/reload and mobile layout.

For manual review, open two windows at /search, select seller Bare Metal Matchmakers (4) and winner Layer Eight Supply (5). Pending review results appear immediately. Select Cool Story Systems (6) to check the losing-bidder case. Create another short auction and bid from a different participant to review a fresh result. A five-second HTTP reconciliation may be needed after a missed signal; a healthy realtime signal prompts an immediate read. Stop and restart only Part 6 workers when reviewing recovery; do not interrupt shared services used by other parts.

See VERIFICATION.md for actual checks/evidence, GRILL.md for accepted decisions and docs/adr/0004-transactional-outbox.md for trade-offs. Earlier-part records and Slice 1 verification under docs/ are historical.

`npm run test:bidding-war` now also verifies the authoritative SOLD outcome, confirmed outbox publication and actual seller/winner modals. It runs headed in four separate, geometrically verified 2×2 Chrome windows and keeps the final state open. It clears only earlier generated review notices for its demo identities; unrelated pending notices cause it to stop rather than dismiss them. Bid and popup assertions require Socket.IO with fallback polling/focus refresh disabled. A final explicit HTTP catch-up confirms recorded results on every mounted page without a reload. See VERIFICATION.md for observed results and temporary evidence paths.

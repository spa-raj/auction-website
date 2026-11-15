# Cross-stack Debugging with OpenTelemetry and Jaeger

Follow one winning bid through authoritative closing, RabbitMQ publication, recipient notification, checkout, local mock payment, signed webhook and the recorded paid purchase. The same trace ID survives database transactions, worker delivery, delayed checkout and mock restart/retry. Other bids stay short. The application behavior remains that of completed Part 7 at commit `58037bfda8da2ac8685b01db61b907fefa0ea25f`.

## Run

From this directory:

```sh
npm ci
npm start
```

Startup prepares the existing root Docker Compose PostgreSQL, Redis, RabbitMQ and Jaeger services, creates Part 8 resources, applies explicit migrations and starts API, web, close/relay worker, notification worker and the copied local Stripe-shaped mock. Earlier parts, the shared mock and root Compose are unchanged. Normal startup preserves data. No real money moves.

| Component | Address / identity |
| --- | --- |
| React/Vite web app | http://127.0.0.1:5108 |
| API | http://127.0.0.1:3108/api/health |
| Web health | http://127.0.0.1:5108/health |
| Local mock payment service | http://127.0.0.1:7108/health |
| Jaeger UI | http://127.0.0.1:16686 |
| OTLP HTTP traces | http://127.0.0.1:4318/v1/traces |
| PostgreSQL | `auction_part_8`, schema `winner_checkout`, port 55432 |
| Test PostgreSQL | `auction_part_8_test`; test suites also use disposable schemas |
| RabbitMQ | port 56726; vhosts `auction_part_8` / `auction_part_8_test` |
| Redis | port 56379; prefix `auction-part-8:socket.io` / separate test prefix |
| Demo identity key | `auction-part-8-active-user` |

Distinct trace services are `auction-part-8-api`, `auction-part-8-close-worker` (including its independent relay), `auction-part-8-notification-worker` and `auction-part-8-mock-stripe`. SDKs send OTLP directly to the existing Jaeger service; no separate collector or tracing screen was added.

Useful commands:

```sh
npm test
npm run build
npm run test:checkout
npm run test:payment-recovery
npm run test:notifications -- --headless
npm run test:golden-trace
```

The first three browser self-verification commands use headless Chrome. `test:golden-trace` is a headed demonstration described below. `npm run test:golden-trace -- --headless` runs the same full assertions as normal automated self-verification. `npm run test:bidding-war` runs the headed four-window concurrency/deadline/popup demonstration, then waits for the winning trace to be collected before showing it in the former losing-bidder window. It leaves seller top-left, Jaeger top-right, unpaid $104 winner bottom-left and separate $51 decline purchase bottom-right. The bidding participants are kept in all four windows until every bidding/result assertion finishes.

Individual infrastructure/process commands remain: `db:up`, `redis:up`, `rabbitmq:up`, `rabbitmq:setup`, `jaeger:up`, `migrate`, `dev`, `worker:close`, `worker:notifications`. Prepare infrastructure/migrations before `dev`. `db:down` and `db:reset` explicitly drop the entire Part 8 database; they are not service-restart commands. Root workspace `package-lock.json` owns dependencies for all workspaces.

## Complete golden-trace browser walkthrough

### Reproducible headed demonstration

With `npm start` running, execute:

```sh
npm run test:golden-trace
```

This opens four independent sandboxed Chrome windows, verifies their 2×2 geometry and leaves them open after success:

| Window | Role / result |
| --- | --- |
| Top-left | Seller, demo user 1; final payment status paid |
| Top-right | Winner, demo user 2; completed purchase |
| Bottom-left | Other bidder, demo user 3; public sold result, no payment panel |
| Bottom-right | Jaeger; the full winning-bid trace |

The runner creates a short auction through the actual web form. Winner bids $101; the other bidder bids $102; the winner bids $103. A stale $102 attempt is rejected. It waits for authoritative closing and actual seller/winner outcome notices, dismisses its notices, opens winner checkout, submits the decline card, cancels, reopens the same purchase and submits the success card. Both seller and winner must show paid; the other bidder must have no payment panel.

It reads the durable winning context from Part 8's database and opens its exact Jaeger trace URL. It requires all four service identities and the complete span chain, compares the shorter losing-bid trace, checks that decline is a business outcome, inspects collected telemetry for forbidden data and verifies that repeated routine health/detail/status reads add no workflow spans. Trace JSON, screenshots and evidence.json are written under a printed OS temp directory. No captures or profiles are written into this source tree. Ctrl+C closes only this demonstration's windows and profiles. If a graphical desktop, sandboxed Chrome or tiling is unavailable, do not substitute a headless demonstration.

### Inspect in Jaeger

1. Use the exact `Jaeger: .../trace/<traceID>` URL printed by the runner. Alternatively open Search, choose `auction-part-8-api`, operation `auction.bid`, and narrow by the opaque `auction.id` from evidence.json. Titles/slugs/handles are deliberately not searchable trace tags.
2. The root is `auction.bid`, outcome `accepted`, for the eventual winning amount. Its short duration is the request duration; it is not held open until the auction closes. The overall trace includes the real time gap until later work.
3. Follow `auction.close` in the close-worker service. Inspect `bid.id`, `winner.id`, `amount.cents`, `event.id` and `transaction.committed=true`. Under database spans, inspect `db.operation.name` and `db.collection.name` for locks, reads and writes. There is no SQL text or bind data.
4. Follow `auction.outbox.publish` and then `auction.notification.process`, recipient spans and `auction.notification.signal`. Publication is confirmed before its stored marker; recipient records commit before broker ACK. A signal attempt does not claim browser display/read. The actual popups were checked in the application windows.
5. Find `winner.checkout`, then `mock-stripe.checkout.create` and `mock-stripe.payment.attempt`. The declined attempt has `business.outcome=declined` without an automatic error status. Cancellation leaves the purchase unpaid; reopening checkout reuses the session. No card values are span attributes.
6. Follow the successful payment's `mock-stripe.webhook.deliver`, `winner.purchase.webhook` and `winner.purchase.paid`, plus the event insert and paid update. Only a matching signed webhook can mark paid. Query parameters and trace headers have no payment authority.
7. Expand/collapse the timeline rows or use Jaeger's Find field for an operation such as `winner.purchase.paid`. Widen the Service & Operation column if service names are truncated. Checkout and notification work may be branches of the same winning trace rather than a fabricated linear delivery chain.
8. Open `losingTraceID` from evidence.json as another Jaeger trace. It contains only that bid's work. No close/payment descendants should appear there.

### Manual repeat

Use separate browser windows with seller, winner and another demo identity. Publish an auction with a near closing time; place competing bids, let the winner finalize, then choose **Complete purchase** as the recorded winner. The seller can read payment status and refresh, but cannot initiate checkout. Other participants cannot read the payment endpoint or see a payment panel.

- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`
- Future expiry such as `12 / 39`, CVC `123`

A decline/cancel remains unpaid and retryable. A paid purchase is terminal; use a new auction for another manual payment. To investigate a manual trace, search Jaeger by service/operation and time range, then inspect its safe opaque IDs. Do not put titles/handles into span tags merely to simplify searching.

## Durable propagation and retries

| Boundary | Context owner / behavior |
| --- | --- |
| Accepted bid | Stores the bid root context atomically with the accepted bid; rejected/rolled-back bids leave no accepted-bid row |
| Authoritative close | Resumes the selected winner's context; outcome, purchase and outbox share that workflow context and commit together |
| Outbox publication | Restores durable outbox context; every attempt has a fresh span; confirmed messages carry current W3C context headers and a stable event ID |
| RabbitMQ consumption | Validates the event against its database record; accepts compatible propagated context or falls back to the trusted stored context; real redelivery is idempotent |
| Recipient notification | Stores recipient processing context without resetting dismissed rows; signal spans restore it after commit/ACK |
| Checkout | Uses stored purchase context after winner eligibility checks; delayed actions, session reuse and known-unpaid-session replacement stay on the winning trace |
| Mock session | Persists checkout context with the session, separate from customer/item/card content |
| Mock completion | Persists completion context with the stable event before delivery; each foreground/background delivery restores it and starts a fresh attempt span, including after restart |
| Signed webhook | Verifies raw HMAC/body and purchase/session/amount/currency binding before choosing trusted ancestry; receipt and paid update commit atomically; replay cannot repeat the paid effect |

Optional trace carriers are added by migration 005; an opaque auction UUID is backfilled/generated there. Existing outcome/bidding/payment rules and migrations remain authoritative. Trace context never replaces row locks, signatures, database uniqueness or authorization. No-bid outcomes start their own close trace and create no purchase. Legacy/malformed stored context starts a classified fallback root rather than inventing a winning ancestor. Only the application's bounded opaque `auction` tracestate entry is supported; arbitrary baggage/vendor state is dropped.

Missing unpaid checkout sessions are replaced only after an explicit provider 404, retaining purchase identity/amount/context. Outages and completed sessions do not permit another payment. Preserve evidence of completed payments; do not delete live mock state to test recovery. `test:payment-recovery` and tracing tests use disposable state for this scenario.

## Signal, privacy and failure policy

All telemetry is explicit business instrumentation. There is no blanket HTTP/PG/framework instrumentation, console span export, SQL capture or automatic card-decline error mapping. Routine health/catalog/status/polling, empty worker scans, socket heartbeats and filesystem/DNS operations are quiet. Actual business work retains finite PostgreSQL operation/transaction spans, including lock wait, writes and rollback/commit evidence.

The final exporter filters span names, attributes, events, links, status descriptions and resources. Allowed values are opaque/numeric IDs, integer amounts, roles, currency, bounded outcomes/error categories and constant database operations/tables. It excludes names/handles, titles/descriptions, raw slugs/full URLs/query strings, cards/expiry/CVC, raw payloads, SQL/parameters, connection strings/secrets/signatures and raw exception messages/stacks. The application keeps normal business data; this policy controls exported tracing data.

Expected stale/late/self bids, declines, duplicates, no-bid results, reuse and recovery are business outcomes. Real transport, publication and database failures remain errors with safe categories. Retries use distinct span IDs under durable context; stable business IDs and database constraints prevent duplicate effects.

All meaningful business traces are recorded, because the eventual winner is unknown when a bid arrives. Export is asynchronous/best effort and bounded; an unavailable exporter must not change business results. The existing Jaeger configuration stores traces in memory: restarting Jaeger loses exported spans, and an interrupted process can lose unexported SDK buffers. Database/mock context survives service restarts; it does not reconstruct missing historical telemetry. Keep Jaeger running during a debugging investigation.

## Configuration and evidence

Existing DATABASE_URL/Redis/RabbitMQ overrides remain supported. Keep the database URL's `options=-csearch_path%3Dwinner_checkout`. API/web/mock defaults are isolated to Part 8. Mock state defaults to `stripe-service/.data/sessions.json`, with one writer, and can be redirected with STRIPE_STATE_FILE. API and mock share local webhook secret `whsec_local_part_8` by default. Standard OTLP HTTP endpoint overrides `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` / `OTEL_EXPORTER_OTLP_ENDPOINT` are supported; default export is localhost:4318. Service identities remain fixed to Part 8.

See AGENTS.md for required commands, VERIFICATION.md for actual results and golden trace links, OBSERVABILITY_PLAN.md for the design and GRILL.md for approval history.


## Local machine time and telemetry shutdown

Jaeger stores absolute epoch timestamps; changing their numeric values to apply a timezone would corrupt the trace. Its UI renders absolute times in the browser timezone, while timeline offsets remain durations. The bidding-war browser contexts explicitly use `Intl.DateTimeFormat().resolvedOptions().timeZone` from the local machine. The runner verifies the exact displayed Trace Start against the collected span timestamp converted with that timezone. On this machine that is `Asia/Calcutta` (IST, UTC+05:30). The span-evidence file includes both UTC and local times for bid/close/publish/consume, so the conversion is independently inspectable.

The runner polls Jaeger's read API until the required completed spans actually arrive instead of shutting services down after an arbitrary sleep. It saves `winning-trace.json`, `spanEvidence` in evidence.json, and a Jaeger screenshot with local time. It verifies that the winning bid's stored context selects the correct trace and that the collected parent span IDs connect bid → close → publish → consume.

When stopping application services, stop accepting new work, finish active transactions/consumer work, then allow the SDK to force-flush queued spans before shutdown. API/mock close hooks and worker `finally` blocks await telemetry shutdown; the shared shutdown helper explicitly awaits batch flush before SDK/exporter shutdown. Do not force-kill a healthy process immediately after an action. Export failure remains bounded and cannot roll back business work. The review scripts close only their own browser/database clients; they leave application services and Jaeger running unless explicitly asked otherwise.

The latest actual bidding-war span times, durations, parent IDs and local-time conversion are recorded in [TRACE_EVIDENCE.md](TRACE_EVIDENCE.md).

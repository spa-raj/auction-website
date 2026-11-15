# Winner Checkout

Part 7 builds on Part 6's authoritative auction closing, transactional outbox and recipient notifications. A sold auction creates one purchase for its recorded winner and winning USD amount. The winner can complete the purchase on a locally hosted Stripe-shaped payment page. No real money moves.

## Run and check

Use the existing Node/npm environment and root Docker Compose services. From this directory:

```sh
npm ci
npm start
```

Startup preserves data, prepares the Part 7 PostgreSQL database and RabbitMQ vhosts, applies explicit migrations, and starts API, web, close/relay worker, notification worker and the copied local payment mock.

- Web: http://127.0.0.1:5107
- Browser health: http://127.0.0.1:5107/health
- API health: http://127.0.0.1:3107/api/health
- Mock health: http://127.0.0.1:7107/health
- Database: `auction_part_7`, schema `winner_checkout` on port 55432
- Tests: `auction_part_7_test`, schema `winner_checkout`, plus per-suite disposable schemas
- RabbitMQ: port 56726; vhosts `auction_part_7` and `auction_part_7_test`
- Redis: port 56379; prefix `auction-part-7:socket.io` (separate test prefix)
- Browser identity: `auction-part-7-active-user`

The dedicated schema preserves older unrelated tables already present in the Part 7 database. Earlier parts and the shared `../stripe-service` source are unchanged. The default database URLs include `options=-csearch_path%3Dwinner_checkout`; preserve this schema option when overriding DATABASE_URL.

```sh
npm test
npm run build
npm run test:checkout
npm run test:payment-recovery
npm run test:bidding-war
```

`test:checkout` is automated self-verification in headless Chrome. It checks hosted decline, cancellation, same-session retry, paid persistence, participant visibility, transient failure feedback and mobile layout. `test:payment-recovery` checks seller live status, actual disappearance of an unpaid session, replacement checkout, outages, pending confirmation and identity isolation. It runs the actual API and web app with a disposable schema in the test database, a disposable mock and temporary state, using web port 5187 by default (`PAYMENT_RECOVERY_WEB_PORT` overrides it). It never deletes live mock state. `test:bidding-war` is the headed manual-review demonstration: four independent Chrome windows tiled in a 2×2 grid. It verifies real Socket.IO updates, bidding concurrency/deadline behavior and seller/winner popups, then dismisses only its generated notices and leaves two unpaid purchases available. Bottom-left: auction winner (demo user 3), $104. Bottom-right: separate decline review (demo user 4), $51. Part 7 browser scripts enable Chrome’s sandbox (`chromiumSandbox: true`); the bidding war also checks that `--no-sandbox` is absent. Chrome and a sufficiently large graphical desktop are required; failures never silently switch to headless. The process holds the windows open until Ctrl+C. All screenshots, profiles and evidence use temporary directories.

Individual commands from Part 6 remain: `db:up`, `redis:up`, `rabbitmq:up`, `rabbitmq:setup`, `migrate`, `dev`, `worker:close`, `worker:notifications`, `test:notifications`, `test:closing-time`, `test:realtime`. Run infrastructure/migrations before `dev`. `db:down`/`db:reset` explicitly drop the entire Part 7 database, including older tables: do not use them to restart services or clear review data. Mock state is separately preserved on disk.

## Browser review

Open the winner's auction, dismiss the outcome notice if necessary, and click **Complete purchase**. Test checkout shows the item and the server-owned winning amount.

- Successful payment: `4242 4242 4242 4242`
- Declined payment: `4000 0000 0000 0002`
- Expiry: a future date such as `12 / 39`; CVC: `123`

A decline keeps checkout open and the purchase unpaid. Cancel navigates back without changing payment status; Complete purchase reuses the same session. A successful payment sends a signed webhook, then returns to an authoritative paid status. Reload preserves it; the seller sees the same status. Other participants cannot start this purchase or read its payment details. Demo-user selection is not authentication, and the hosted checkout URL is a bearer capability.

## Payment guarantees and recovery

The close transaction commits the final outcome, unpaid purchase and outbox event together. A migration backfills purchases for existing sold outcomes. Database uniqueness enforces one purchase per auction, and a composite foreign key ties its winner and amount to the precise recorded outcome.

The checkout endpoint accepts an empty body and requires the selected winner. It derives amount, USD currency, purchase UUID, item title and return URLs from server data/configuration. A purchase row lock serializes concurrent checkout requests. Creation has a three-second timeout and can safely retry: the mock uses purchase UUID as its session-reuse key. The API validates the returned purchase reference, session ID and checkout URL before storing the session and returning its URL. A previously paid purchase does not reopen checkout. Bound unpaid sessions are looked up before reuse. Only an explicit mock 404 permits binding a replacement; the same purchase UUID, recorded winning amount and fixed return URLs are retained. Timeout, 5xx, malformed/mismatched responses and already-completed provider sessions never permit another payment. Concurrent recovery is serialized by the purchase lock, and retired-session webhooks cannot change the purchase.

Only `checkout.session.completed` with valid HMAC, paid/complete state and matching stored purchase/session/amount/currency marks paid. The webhook verifies HMAC-SHA256 over exact raw request bytes using timing-safe comparison, before parsing JSON/Zod validation. Recording a unique event ID/body digest and marking paid commit atomically. Identical valid replay is acknowledged; conflicting event IDs or mismatches do not change payment state. Replays cannot rewrite the paid timestamp. A browser success/cancel query parameter has no payment authority.

This mock uses custom `eventId`, `eventType`, `occurredAt` fields and `x-stripe-signature` containing a hex HMAC; do not use the real Stripe SDK verifier against it. It has no timestamp freshness scheme. Durable deduplication and strict purchase/session binding provide replay safety.

The copied mock writes sessions and stable completion-event bodies to `stripe-service/.data/sessions.json` using serialized mutations, flushed temporary-file writes and atomic replacement. It persists payment completion before webhook delivery. A background loop retries failed delivery with capped backoff (up to ten seconds) and a two-second HTTP timeout, even if the browser closes. Restart restores open/completed sessions and pending events. A crash after delivery but before recording acknowledgement can resend the same event, which the API handles idempotently. Failed storage stops further mock mutations and reports unhealthy; resolve storage failure and restart. Card values are not stored.

The state file requires one mock writer/process on a persistent filesystem. Do not delete it to recover a payment or run multiple writers against it. Restart the mock instead. Unpaid-session disappearance is recoverable through an explicit mock 404 and the winner’s Restart checkout action. Preserve completed-session/event evidence: disappearance of unrecorded completed payments is not an unpaid-session recovery scenario. Paid application purchases remain terminal even if their mock sessions later disappear.

The purchase panel reads authoritative state on load, focus, visibility and every five seconds, and offers Refresh payment status to both roles. Sellers see recorded amount/status/payment time and recovery guidance; they cannot initiate or restart checkout. Seller responses omit the purchase UUID and all checkout/session/event details. Unrelated participants get no payment panel and cannot read the payment endpoint; public catalog/detail responses contain no purchase state. Role-specific responses use private, no-store caching.

A completed mock session whose webhook is still outstanding shows confirmation pending to both roles and removes the winner’s payment action. This provider observation never marks the purchase paid; only the verified signed webhook does. Mock autonomous retries eventually update both panels. Provider outages preserve the recorded status with explicit unavailable feedback. Failed status reads retain the last known display with a stale-state error and refresh action. Switching demo identities unmounts the prior participant’s payment panel. No new payment broker topology is needed. Existing auction-result popups remain explicitly dismissible and durable.

## Configuration

Application overrides: DATABASE_URL (including schema option), API_PORT, WEB_PORT, WEB_PUBLIC_URL (default `http://127.0.0.1:5107`), STRIPE_API_URL and STRIPE_PUBLIC_URL (default `http://127.0.0.1:7107`), STRIPE_WEBHOOK_SECRET. Existing REDIS_URL, REDIS_CHANNEL_PREFIX and RABBITMQ_URL remain available.

Mock overrides: STRIPE_PORT, STRIPE_HOST (default loopback), STRIPE_PUBLIC_URL, AUCTION_WEBHOOK_URL (default `http://127.0.0.1:3107/api/webhooks/stripe`), STRIPE_WEBHOOK_SECRET and STRIPE_STATE_FILE. Keep API/mock secret and checkout public URL configuration aligned. Default local secret is `whsec_local_part_7`.

See GRILL.md for decisions, IMPLEMENTATION_PLAN.md for the reviewed Slice 1 and approved Slice 2 scope, CONTEXT.md for domain vocabulary, and VERIFICATION.md for observed checks.

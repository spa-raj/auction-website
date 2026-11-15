# Winner Checkout — Two Slices

## Slice 1 — Winner completes a purchase (approved)

Copy Part 6 and isolate runtime resources. At authoritative sold finalization, create one purchase tied to the exact winner/amount; backfill existing sold outcomes. Winner-only Complete purchase creates/reuses hosted mock checkout with server-owned amount, currency and return URLs. Winner and seller see persisted payment status on auction detail. Verified, matching signed webhook completion atomically marks paid with durable event deduplication. Decline/cancel remain unpaid and retryable. Implement durable single-process mock state, autonomous retries and request timeouts so browser closure/restart cannot strand completed payment confirmation.

Test eligibility, tampering, raw-body signatures, replay and mismatches, concurrent requests, decline, cancel, retry and restart recovery. Preserve Part 6 tests, run build/health/browser checks. Run a headed tiled bidding war with windows held open and the winner's purchase left unpaid; provide a separate unpaid decline example. Stop for user browser review before any further slice.

## Slice 2 — Seller payment status and recovery (approved)

The latest instruction reviews Slice 1 and approves seller payment status and recovery, superseding the earlier optional purchase-overview proposal. No purchase-overview screen is included.

Show authoritative unpaid/paid state to the seller and winner, with explicit pending-confirmation, missing-checkout and provider-unavailable feedback. Recover via initial/reload/focus/visibility/five-second reads and an explicit refresh control. Keep status-fetch failures separate from checkout-action errors. Only the winner can create or restart checkout. Seller summaries omit purchase UUIDs, session IDs/URLs and event details; public auctions never expose payment state.

For a still-unpaid purchase, look up its bound session before creating/reusing checkout. Only a definite provider 404 permits rebinding a new session, retaining purchase identity, recorded amount and server-owned return URLs. A timeout, 5xx, malformed/mismatched response or existing paid/complete provider session must not open a replacement payment path. Completed sessions await the durable signed webhook; paid purchases remain terminal. Serialize concurrent recovery with the purchase lock; reject old-session webhooks after replacement.

Test missing-session recovery (including concurrent requests and paid/pending safeguards), failures, role projections and browser behavior across seller/winner/loser views. Document important verification commands, including the headed bidding war, in AGENTS.md. Run relevant tests, build, health and browser checks, then stop for Slice 2 browser review.

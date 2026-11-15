# Winner Checkout — Two Slices

## Slice 1 — Winner completes a purchase (approved)

Copy Part 6 and isolate runtime resources. At authoritative sold finalization, create one purchase tied to the exact winner/amount; backfill existing sold outcomes. Winner-only Complete purchase creates/reuses hosted mock checkout with server-owned amount, currency and return URLs. Winner and seller see persisted payment status on auction detail. Verified, matching signed webhook completion atomically marks paid with durable event deduplication. Decline/cancel remain unpaid and retryable. Implement durable single-process mock state, autonomous retries and request timeouts so browser closure/restart cannot strand completed payment confirmation.

Test eligibility, tampering, raw-body signatures, replay and mismatches, concurrent requests, decline, cancel, retry and restart recovery. Preserve Part 6 tests, run build/health/browser checks. Run a headed tiled bidding war with windows held open and the winner's purchase left unpaid; provide a separate unpaid decline example. Stop for user browser review before any further slice.

## Slice 2 — Purchase overview (proposal only; not approved)

Provide a dedicated participant purchase view so winners can find their outstanding and paid purchases without locating each auction manually. Each row links to authoritative auction detail and its checkout/status, including recovery after reload and identity switching. Keep seller visibility on auction detail. Validate browser navigation, status consistency and identity isolation. Confirm this proposed scope after Slice 1 review before implementation.

All payment correctness and recovery required by Slice 1 are completed in Slice 1. Slice 2 is an optional discoverability increment.

# Part 4 — Feature Slices

Status: Slice 1 implemented and verified; stopped for user review. See VERIFICATION.md.

## Slice 1 — Live auction-detail updates (approved)

Visible outcome: a bid accepted in one browser updates another browser's price, current bidder, minimum and history immediately, without discarding its draft. A reconnect catches up through HTTP.

Includes isolated Part 4 configuration; Socket.IO auction subscriptions; real Redis Pub/Sub adapter; startup/readiness checks; post-COMMIT invalidation; validated small events; race-safe HTTP refetch; polling/focus/visibility/deadline preservation; connection feedback; regression and realtime integration tests; and two-browser verification against one application instance.

Acceptance: npm test; npm run build (includes server/web/scripts strict type checks); browser /health; receive a Socket.IO frame and refreshed state with watcher polling disabled; preserve drafts; recover missed changes after reconnect; follow up an in-flight stale fetch. Independently observe the Redis publication and prove rejected bids produce no notifications.

Stop after this slice and report concrete browser review steps. No additional slice is approved.

## Slice 2 — Recovery under service interruption (proposal only)

Visible outcome: users can review and recover from Redis/API interruption and failed HTTP reads with clear feedback and usable drafts. Extend browser fault-injection coverage, refine any resulting user feedback, and verify continued bidding protection during recovery. Existing reconnect and polling behavior is already required in Slice 1; this proposal adds explicit service-interruption scenarios.

Do not implement without user approval. A multi-replica demonstration is outside the agreed scope.

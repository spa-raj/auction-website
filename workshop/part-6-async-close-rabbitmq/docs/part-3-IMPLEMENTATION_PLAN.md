# Implementation Slices

Status: Both slices are implemented and verified. The user authorized Slice 2 after reviewing Slice 1; work stopped after Slice 2 as requested.

## Slice 1 — Serialized bidding and stale-bid recovery

Visible outcome: competing bidders see only valid accepted bids. A stale rejection shows updated price/history/minimum, clear feedback and a preserved amount the bidder can deliberately edit and submit again.

Implementation:

- Use one PostgreSQL connection and transaction per bid; lock the auction row before reading the current price and validating the bid, then insert and commit.
- Revalidate ownership and closure in the serialized path; retain working deadline protection throughout this slice. Slice 2 changes the clock source and proves precise boundaries.
- Roll back rejected/failed transactions and always release connections. Keep different auctions independently biddable.
- Distinguish stale and ended responses. Refresh state, preserve failed input and never automatically resubmit.
- Keep detail summary and history consistent under concurrent updates; preserve the page and draft with visible feedback if refresh fails.
- Replace Part 3 duplicate-reproduction assertions with protected-behavior assertions. Adapt synchronization so it does not wait for serialized contenders to reach insertion together. Preserve Part 2's reproduction.

Verification: real-PostgreSQL tests for equal bids (one acceptance), differing amounts, updated-minimum rejection, independent auctions and successful bidding after rejection/rollback. Run `npm test`, `npm run build`, and browser checks including `/health`.

Browser review:

1. Open one active auction in two windows with distinct non-seller demo users.
2. Submit the same valid amount concurrently. Inspect one acceptance and one stale rejection, refreshed price/history/minimum and preserved rejected input.
3. Explicitly submit a higher valid amount; reload both windows and inspect persisted history.

Stop with results and browser review steps. Wait for acceptance and authorization before Slice 2.

## Slice 2 — Testable clock and closing-time behavior

Visible outcome: the UI switches to “Ended” and disables bidding at the deadline. Requests checked at or after closing are rejected, including those arriving earlier but waiting for the lock. Refreshed final history shows the winner or “No bids.”

Implementation:

- Inject an application clock with a real-time default and a controllable test implementation. Do not add a public clock-control endpoint or special production setup.
- Read acceptance time after acquiring the auction-row lock. Reject at or after the stored closing instant.
- Align related API time/status responses and accepted-bid timestamps with this clock. Wait for in-flight accepted bids before reporting final detail state. Do not let transaction-start timestamps or independent database-clock checks override the injected decision.
- Use the API time reference for the browser countdown. Recheck time and fetch fresh state immediately on visibility/focus activation. Switch to “Ended” and disable bidding at expiry, refresh final state, and explain late ended rejections without resubmission.
- Preserve fixed deadlines and winner/no-bids behavior. Defer idempotency keys and extra retry mechanisms.

Verification: deterministic tests immediately before, exactly at, and after closing. Advance the injected clock while a request is blocked on the auction-row lock; after release verify rejection and no persisted bid. Verify pre-deadline acceptance and consistent timestamps/status/history. Run `npm test`, `npm run build`, and browser checks including `/health`.

Browser review:

1. Post a short-lived auction and open it as seller and bidder in separate windows.
2. Bid before closing; watch both windows reach “Ended,” disable bidding and refresh to the accepted history and winner.
3. Verify rejection of an API bid at/after closing, and inspect a separate auction ending with “No bids.”
4. Review the deterministic test proving rejection of a request waiting across the deadline.

Stop with results and browser review steps.

# Part 3 Verification

Status: both agreed slices are complete. Slice 2 is implemented and verified; stopped as requested. Part 2 remains unchanged.

## Final Part 3 bidding-war verification

After both slices were complete, `npm run test:bidding-war` passed against the final Part 3 app in four headed Google Chrome windows tiled 2×2. `npm run typecheck` passed after adding the evidence assertions. Part 2 source hashes are unchanged.

- Three simultaneous $101 bids: HTTP statuses **409 / 409 / 201**; exactly one $101 bid persisted.
- Closing instant: `2026-11-15T12:07:43.000Z`. A $105 attempt at `2026-11-15T12:07:43.250Z` returned **409**; zero $105 bids persisted.
- Before reloading, all four live pages were observed at **ENDED**, with bidding disabled. This verifies the deadline transition rather than only the state after a reload.
- Final history: exactly four accepted bids ($101, $102, $103, $104); winner Heap & Sons at $104.
- Screenshots and structured evidence: `/tmp/bidding-war-results-LvZ3Rj/`, including `evidence.json` and seller/bidder screenshots. Visually inspected bidder-3.png.
- All four final Chrome windows remain open until explicitly closed or Ctrl+C.
- Auction: http://127.0.0.1:5103/items/bidding-war-cc84b4-998cc0d7-07a1-4875-a61f-4f9b68e8ccd9

## Slice 2 — Testable clock and closing-time behavior

- `buildApp({ clock })` injects an application clock, defaulting to real time. No public clock-control endpoint is provided.
- Each bid uses one connection and transaction: BEGIN → SELECT auction row FOR UPDATE → latest-price read → one clock reading → validate → INSERT with that reading as created_at → COMMIT.
- Bids checked at or after closing are rejected, including bids that arrived earlier but waited for the lock. Rejections and failures roll back.
- Catalog/detail ended status and serverTime use the injected clock. Posting retains its existing future-date validation.
- Detail reads acquire a shared auction-row lock before reading summary/history. This waits for an accepted bid still committing and prevents an incorrect final winner/no-bids response. Shared readers remain compatible with one another.
- The frontend schedules an explicit deadline check using the API time reference. It switches to Ended, disables the bid form, guards submission and requests final state at expiry.
- Until the API confirms closure, the frontend shows “Confirming final result…” instead of asserting a winner from stale data. An ended rejection also closes the form immediately.
- Visibility and focus activation update local time immediately and request fresh details; polling remains a fallback. No automatic bid resubmission or extra retry mechanism was added.

## Slice 2 checks

- `npm test`: passed, **44 backend tests and 37 frontend tests**. Log: `/tmp/part-3-slice-2-final-tests.log`.
- Eight new backend clock tests cover one millisecond before, exactly at and one millisecond after closing; a single clock reading for acceptance/timestamp; an injected historical clock overriding the database wall clock; real lock waits crossing to exactly closing and after closing; and final detail reads waiting for an accepted bid's commit.
- Accepted timestamp precision, no persisted rejected bids, API ended status/serverTime, final winner and no-bids state were verified against PostgreSQL.
- Existing concurrency, posting, browsing and frontend unit regressions all pass.
- `npm run build`: passed, strict TypeScript checks and production Vite build.
- `npm run typecheck`: passed again after the final browser-harness changes.
- `npm run test:closing-time`: **passed in headed Google Chrome** with two independent processes/profiles and side-by-side windows; actual window bounds verified by CDP. Both `/health` pages reported OK; no page errors occurred.
- Foreground check: one pre-deadline form bid accepted; form disabled within 750 ms of the deadline while the final detail response was deliberately held. The final winner appeared after release, and a direct late API bid returned 409 without adding a bid.
- Background check: a temporary blank tab hid the bidder's auction; the test verified the actual hidden visibility state. Another user bid while it was hidden. After the deadline, returning to the auction immediately disabled bidding and triggered a detail request within 1.5 seconds, then reconciled the accepted history/winner.
- No-bids check: a separate auction ended with No bids and disabled controls.
- Harness note: Playwright's normal launch forces visibility/focus behavior. The final harness launches real headed Chrome and connects with `noDefaults: true` to exercise genuine hidden/visible transitions, without mocking application visibility events. Earlier unsuccessful harness attempts were corrected before the passing run.
- Screenshots: `/tmp/closing-time-results-PHZL6s/no-bids.png` and `/tmp/closing-time-results-PHZL6s/resumed-winner.png`. Both visually inspected; UI, ended controls and history are readable.
- Part 2 source hashes match the original preparation manifest. All edits remain in Part 3. No database schema migration was needed.

## Slice 2 browser review (earlier handoff)

The app remains available at http://localhost:5103. The earlier Slice 2 handoff showed these two results; the current four held-open windows are recorded in the final bidding-war section above:

1. No-bids result: http://127.0.0.1:5103/items/closing-review-no-bids-925cd19f-da0e-41a5-95f8-179be51b8fd3
2. Resumed bidder result: http://127.0.0.1:5103/items/closing-review-resumed-bidder-12c5b2ba-39da-47ba-981a-e546339f597b

Inspect Ended and disabled bidding in both, No bids in the first, and Heap & Sons at $101 with one history row in the second. For a manual timing review, post a short future auction using Sell, open it as another user, background the bidder tab through closing and return. The form should immediately disable and refresh the outcome.

Windows remain open until explicitly closed or the test receives Ctrl+C. Test screenshots/profiles are outside the repository. Work stops here as requested.

---

## Historical Slice 1 verification

Status at the Slice 1 handoff: implemented and verified. The user subsequently authorized Slice 2, completed above.

## Changes

- Bid transaction uses one connection: BEGIN → SELECT auction row FOR UPDATE → separate latest-price read → business validation → INSERT → COMMIT.
- Rejected and failed transactions roll back; connections are released. Rules are enforced across independent API instances using PostgreSQL locks.
- Detail summary/history use one repeatable-read snapshot.
- Structured stale/ended responses support preserved input, refreshed price/history/minimum, explicit resubmission and accepted-bid confirmation.
- Refresh failure leaves the page and draft visible with feedback; subsequent refresh can recover.
- Part 3 bidding-war now requires protected behavior and uses a pre-validation auction-row barrier. It adds no database triggers.
- Existing real database-clock deadline guards remain. Injected application clock and deterministic closing-time behavior are deferred to Slice 2.

## Checks

- Installed dependencies in Part 3 using npm ci; no dependencies were copied from Part 2.
- npm run db:up and npm run migrate: passed; isolated auction_part_3 database prepared without resetting other parts.
- npm test: passed, 36 backend tests and 37 frontend tests.
- Five new real-PostgreSQL concurrency tests: equal-bid contention across independent API pools; reading a price committed during a lock wait; different competing amounts; independent auctions; insertion failure rollback and later recovery.
- npm run build: passed, strict TypeScript checks and production Vite build.
- npm run typecheck after the final browser-script changes: passed.
- npm run test:bidding-war: passed in headed Google Chrome, four independent windows tiled 2×2. Actual window bounds were checked by CDP, and all four health pages reported OK.
- Three simultaneous $101 bids returned one 201 and two 409 responses; only one persisted. Both rejected drafts retained 101 and showed the $102 minimum, current price and one-row history.
- Simulated detail refresh failure preserved the page/draft; an explicit $102 submission succeeded and cleared refresh feedback.
- Staggered stale rejection and $103 acceptance passed. Existing before-deadline $104 acceptance and after-deadline $105 rejection passed as regressions, not as Slice 2 completion.
- Final result: four persisted bids ($101, $102, $103, $104), winner demo user 3, ended state, disabled bid buttons and visible history in every window.
- Screenshots: /tmp/bidding-war-results-fqHZ0C. Visually inspected bidder-1.png; history and ended controls are readable.
- Part 2 source hashes compared with the preparation manifest: unchanged. Part 2's duplicate-reproduction script is preserved.

## Review

At the Slice 1 handoff, four Chrome windows showed the completed result. Those windows were closed before Slice 2 browser verification; the current two windows are described above.

Demonstration auction: http://127.0.0.1:5103/items/bidding-war-a04feb-6c9fbe0a-a849-4ce7-b292-7abf7a1a019a

Inspect the four accepted amounts, single $101 row and final winner. For an interactive review, open the regular app in two browser windows, post a future auction via Sell, select distinct non-seller demo users via the footer switcher and submit competing amounts. Inspect stale feedback and preserved input, explicitly submit a higher bid, then reload both windows to confirm persistence. The headed test provides deterministic simultaneous contention.

The user subsequently authorized Slice 2; its completed verification is recorded above.

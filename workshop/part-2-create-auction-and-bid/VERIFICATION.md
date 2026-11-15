# Slice 3 Verification

Slice 3 is ready for review. Bidding uses sequential API validation only; simultaneous-bid protection remains explicitly deferred to Part 3.

- `npm test`: 31 real-PostgreSQL API tests and 37 web validation/identity tests passed.
- `npm run build`: strict TypeScript checks and production build passed.
- API regression verifies seller rejection (403), $1 first/subsequent increment, accepted bids and leader rebids, malformed amounts/identities, newest-first persisted history, missing auctions and deadline rejection (409).
- Chrome verified disabled seller controls and direct API rejection, insufficient-bid error with retained input, accepted bids, updates in another tab within five seconds, reload persistence/history order, mobile layout and healthy database.
- Chrome also verified stale-price rejection refreshes amount/minimum without automatic resubmission, and ended auctions disable bidding, reject requests and show the accepted winner or No bids.
- The bid form was visually inspected. Screenshot: `/tmp/part2-bid-form.png`; temporary scripts are under `/tmp/auction-playwright-check`.
- Existing auctions were preserved. Review auctions were added for open bidding and closing behavior; no reset was run.

Review the open auction at http://localhost:5102/items/bidding-review-1794736451886-d84528a3-6a00-41ad-8e91-1ee88f819bd4 . Select seller Decommissioned Dreams to check self-bid blocking, then select another user and bid at least $1 above the displayed amount. Reload and inspect history. Open a second tab to check automatic updates. Stop for user review.

---

## Earlier verification record

# Part 2 Verification

Verified on November 15, 2026. Slice 1 (browsing/users) is accepted. Slice 2 (posting) is ready for review. Slice 3 (bidding) has not started. This follows the user's latest slice numbering, replacing the earlier combined browsing/posting checkpoint.

## Slice 2 changes

- Kept the end-to-end Sell → `/auctions/new` → PostgreSQL → new detail flow.
- Added accessible field-level errors, first-invalid-field focus, friendly text/price messages and correction feedback.
- Preserved draft values after a failed request, disabled form controls during publication and guarded duplicate in-flight submissions.
- Parsed USD dollars/fractional cents separately before sending integer cents.
- Retained tab-local demo identity, seller attribution, category illustrations, UTC deadlines and hidden empty specifications.
- Updated GRILL.md, AGENTS.md, README.md and the implementation plan to make posting Slice 2 and bidding Slice 3.

## Required checks

- `npm test`: **30 PostgreSQL API integration cases and 37 web validation/identity tests passed**.
- `npm run build`: strict TypeScript checks and production Vite build passed. Zod dependency annotation warnings do not affect the build.
- API tests cover immediate catalog visibility, selected-seller attribution despite conflicting body fields, price boundaries ($0.01 and $1,000,000), Unicode/punctuation, unique detail URLs for duplicate titles, validation, persistence, searches and seed histories.
- Tests clean up their own fixtures and pass alongside user-created catalog data.

## Headed Chrome verification

Two separate Chrome windows were tiled side by side and left open: the posting form on the left, the posted auction detail on the right.

Passed:

1. Sell navigation and selected seller shown in the form/header.
2. Empty/whitespace title, invalid price precision, below-minimum price and past deadline produce field errors. Focus moves to the first invalid field. Editing highlighted fields clears stale feedback.
3. Changing the footer user before submission changes the seller to that selected user.
4. A simulated HTTP 503 preserves title, price and deadline; a successful retry works.
5. Pending form controls are disabled. Two additional submit events during the pending request do not create additional requests or auctions.
6. Successful publication opens the new detail, showing the category illustration, seller, $149.99 price, no bids and no empty specifications section.
7. Entering January 2, 2030 at 3:45 PM in Asia/Kolkata stores `2030-01-02T10:15:00.000Z` and displays the agreed local time.
8. Reload retains the posted auction and tab identity. The other window finds the auction through catalog search and opens its detail.
9. Mobile form has no horizontal page overflow; desktop/mobile screenshots were visually inspected.
10. `/health` shows `OK · PostgreSQL connected`. No JavaScript page errors were observed.

All seven pre-existing auctions were preserved. One review auction was added, titled `Posting review — 4U chassis 1794735165139`, sold by Layer Eight Supply. No database reset was run for this slice.

Temporary screenshots, browser scripts and results are outside the repository at `/tmp/part2-posting-review` and `/tmp/auction-playwright-check`.

## Amount and calendar-date correction

The form displays the agreed $0.01–$1,000,000 USD range. Extremely long amounts are rejected before numeric conversion; both client and API report the product cap rather than JavaScript's safe-integer limit.

Closing-time validation distinguishes required, invalid calendar/native input, and valid-but-past values. Calendar components are checked before constructing a Date, preventing February 31 from rolling into March. UTC API timestamps must pass calendar validation before the future-time rule runs.

Added 20 frontend validation regression cases and 4 API cases. Chrome reproduced the screenshot's native February 31 state (`value=''`, `badInput=true`) and verified the invalid-date message alongside the huge-amount cap message. Separate checks cover missing dates, valid past dates, leap days, exact cents and invalid forms sending no API request. `/health` passed. No auctions were created or reset during this correction. The screenshot is at `/tmp/part2-validation-review/invalid.png`.

## Live price formatting

Starting price groups thousands while typing or pasting (for example `12345.67` → `12,345.67`) and preserves decimal points/trailing zeros. Cursor placement, selected-text deletion and Backspace/Delete around separators were verified in Chrome. Formatted amounts convert to exact integer cents before submission; malformed text, precision and the $1,000,000 cap remain validated.

The required tests and production build passed. Chrome confirmed that `12,345.67` sends `1234567` cents and survives a failed request without losing formatting. `/health` passed. This verification did not save an auction.

## Earlier verified behavior

Initial database setup, pending migrations, normal restart preservation and explicit Part 2 reset were verified at the earlier checkpoint. The tab-identity follow-up verified random initial users, ignoring old localStorage selection, navigation/reload persistence, independent tabs and footer/header synchronization. The current suite retains those five identity tests.

## Remaining limits

Bid submission and five-second refresh ship in Slice 3. Demo identities are not authenticated. Concurrent-bid protection remains deferred to Part 3.

The earlier `npm audit --omit=dev` reported 37 inherited OpenTelemetry dependency-tree findings (31 moderate, 5 high, 1 critical, including protobufjs). The recommended major OpenTelemetry upgrades were not part of this posting change. Earlier audit output is at `/tmp/part2-audit.json`.

## Review

1. Open <http://localhost:5102/auctions/new>, select a user in the footer and confirm the seller name.
2. Submit an empty form, then try an invalid amount or past closing time and inspect the feedback.
3. Complete all fields, publish, inspect the new detail and reload.
4. Search for the new listing in the catalog; inspect its illustration, seller, price and local deadline.

Stop here for review before Slice 3.

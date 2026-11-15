# Implementation Slices

Status: Slice 1 accepted. Slice 2 (posting) implemented and verified, ready for review. Stop for review before Slice 3 (bidding). This numbering follows the user's latest instruction and supersedes the earlier two-slice plan that grouped posting with browsing. Behavior is defined in [GRILL.md](GRILL.md).

## Slice 1 — Browse persisted auctions and select a demo user (accepted)

Visible outcome: browse the six seeded auctions through the PostgreSQL-backed catalog and details, search/filter/sort, and inspect seeded bid histories, specifications and ended status. Each new tab starts as a random demo user, with tab-local persistence, a footer switcher and the active name in the header.

The foundation, explicit migrations, ten seeded users, seed/reset behavior, health page, commands and initial checks are complete. Normal startup preserves changes. Explicit reset restores Part 2 data only. Keep Part 1 and the shared Compose configuration unchanged.

Browser checkpoint: browse the catalog and a seed detail, change filters and sorting, then check user selection across reload/navigation and independent tabs.

## Slice 2 — Post an auction (current review checkpoint)

Visible outcome: Sell opens `/auctions/new`; completing and submitting the form publishes immediately under the active user, opens its persisted detail page, and makes it discoverable in the catalog.

Required fields: title, category, description, condition, location, starting price and future local closing time. Validate on both client and API, trim text, use integer USD cents and store UTC closing instants. Derive ownership from the selected demo user rather than accepting a seller in the body. Show category illustrations; no uploads. New listings have no required specifications, so hide that section when empty.

Show accessible field-level validation, focus the first invalid field, prevent duplicate in-flight submissions, and preserve input on request failure. These support a complete posting flow; do not add bid submission.

Browser checkpoints:

1. Select a user in the footer. Follow Sell to `/auctions/new` and confirm the displayed seller matches the header.
2. Submit an empty form; inspect required-field feedback and keyboard focus. Try a whitespace-only title, an invalid price and a past closing time.
3. Fill valid values, switch the footer user before publishing, and confirm posting attributes the auction to that selected user.
4. Publish and inspect the new detail's title, illustration, seller, integer-cent USD price, local deadline and no empty specifications section.
5. Reload the detail and find the listing in the catalog. Verify local-time entry corresponds to the stored UTC instant.
6. Simulate a failed request during verification; confirm draft values survive, then retry successfully. Check narrow mobile layout and `/health`.

Required checks: `npm test`, `npm run build` (strict TypeScript and production Vite build), real-PostgreSQL posting/validation/ownership tests, and browser checks above. Preserve user-created data; no reset is needed for this checkpoint. Temporary screenshots/scripts belong outside the repository.

Stop after complete verification and clear review instructions. Wait for confirmation before Slice 3.

## Slice 3 — Bid and inspect the outcome (not started)

Visible outcome: another demo user bids on a posted auction and sees persisted history, updates and closing outcomes.

Add direct bidding with the $1 minimum increase, no self-bids and server-enforced deadline. Allow the leader to bid again. Show history newest first. Refresh details every five seconds and after a bid, explain stale-price rejections, and never automatically resubmit. Disable bidding at expiry and show the winner or “No bids.” No payments, notifications, editing, cancellation or withdrawal. Concurrent-bid protection remains deferred to Part 3.

Browser checkpoints: bid as a non-seller, test minimum and self-bid rejection, reload to confirm history persistence, use separate browser windows for sequential bidding/refresh, and inspect ended auctions with and without bids.

Run relevant PostgreSQL tests and browser checks. If a browser demonstration is requested, use headed Chrome/Edge with separate tiled windows and leave them open.

# Implementation Slices

Status: slice definitions approved. Slice 1 implemented and verified; Slice 2 awaits user confirmation after review. Behavior is defined in [GRILL.md](GRILL.md). Results are in [VERIFICATION.md](VERIFICATION.md).

## Slice 1 — Post and browse persisted auctions (ready for review)

Visible outcome: select a demo user, browse the six seeded auctions, post a new auction, and open its persisted detail page.

Copy the foundation into Part 2 without generated dependencies or historical logs. Configure the isolated `auction_part_2` database and proposed ports API 3102/web 5102. Keep the shared root Compose file and Part 1 unchanged. Preserve the existing UI conventions and health page.

Deliver the schema, explicit migrations, ten demo users, consistent seed auctions and bid histories, normal-startup preservation, and explicit Part 2 seed reset. Connect the catalog and detail views to PostgreSQL through Fastify. Include search, category filtering, sorting, a random initial user per tab, footer selection persisted in sessionStorage, the active user’s name in the top-right header, and `/auctions/new` with boundary validation and post-success navigation. Preserve seeded specifications and hide the section for new listings without specifications.

Render seeded bid history, current amount, and ended status accurately. Until bid submission ships in Slice 2, show bidding as unavailable rather than expose an inert form. Posting, browsing, and persistence must be fully functional at this checkpoint.

Browser checkpoint:

1. Open `http://localhost:5102`; browse the six seeded auctions, search, filter, and change sort order.
2. Change the footer user; reload and confirm the selection is remembered.
3. Choose Sell; submit missing/invalid values and confirm useful validation. Then create a valid auction with a future local closing time.
4. Confirm navigation to its detail page, selected seller, category illustration, correct USD price and deadline, and hidden empty specifications.
5. Reload and restart normally; confirm the auction persists. Run the explicit reset and reload; confirm the six seed auctions and ten users are restored and the posted auction is removed.

Verification: run `npm test`, strict TypeScript checks, real-PostgreSQL migration/seed/persistence/reset and API validation tests, and browser checks for the health page, catalog, user selection, and posting flow. Establish Part 2's commands and required checks in its AGENTS.md and README as part of this slice.

Stop for review and confirmation before Slice 2.

## Slice 2 — Bid and inspect the outcome

Visible outcome: another demo user can bid on a posted auction, see accepted bids and history persist, and receive clear rejection messages for disallowed bids.

Add the direct-bid API and form. Validate identity references and integer-cent amounts; enforce the $1 minimum increase, no seller self-bids, and the deadline in the API. Allow repeat bids by the current leader. Persist accepted bids and display bidder, amount, and time newest first. Refresh details every five seconds and after submission; preserve useful input on errors, update outdated prices and minimums, and never automatically retry a rejected bid.

Complete the deadline experience: disable bidding at expiry, reject late requests in the API, and show the winner or “No bids.” Deadline behavior is determined from server time, without a close worker. No payment, notification, editing, cancellation, withdrawal, or concurrent-bid guarantee is included.

Browser checkpoint:

1. Create a $100 auction as one user and switch to another. Confirm the minimum first bid is $101; submit $101 and inspect the updated amount and history.
2. Reload and confirm persistence. Submit an equal or insufficient bid and confirm rejection; submit a valid increase as the current leader.
3. Switch back to the seller and confirm self-bidding is unavailable. Verify the API also rejects a seller's direct request.
4. Use two separate browser sessions with different selected users. Bid sequentially and confirm the other session updates within five seconds. With a stale amount, confirm a clear rejection and refreshed minimum, without automatic resubmission.
5. Post short-duration auctions with and without bids. Observe expiry, disabled bidding, and the winner or “No bids”; verify the API rejects late requests. Search and filter to find the ended auctions.

Verification: run all required tests and strict TypeScript checks, real-PostgreSQL tests for valid/invalid sequential bids, self-bids, missing/invalid identities, bid history ordering, and deadline boundaries. Verify posting-to-bidding and ended-auction behavior in the browser. Concurrent-write correctness tests belong to Part 3.

Stop for review; report changes, checks, and browser steps. If a browser demonstration is requested, use headed Chrome/Edge, separate tiled windows, and leave them open. Any requested captures go to a separate temporary directory.

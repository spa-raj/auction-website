# Auction House — Part 3

Slice 1 implements serialized bidding and stale-bid recovery. Slice 2 adds a testable application clock, exact closing rules and deadline/tab-activation refresh. Part 2 remains the unchanged bug-reproduction version.

```sh
npm install
npm start
```

Open <http://localhost:5103> (API: <http://localhost:3103>, health: <http://localhost:5103/health>).

`npm start` starts the shared PostgreSQL service through `../docker-compose.yml`, ensures the isolated `auction_part_3` database exists on port 55432, applies pending migrations and starts both apps. Normal startup preserves listings, history and deadlines.

## Behavior

Browse/search/filter/sort persisted auctions, select a tab-local demo user, and use **Sell** to post an auction. User selection is stored under `auction-part-3-active-user`; it is not authentication. Prices use integer USD cents; closing times are stored as UTC and displayed locally.

Bids must increase the current amount by at least $1, including the first bid. Sellers cannot bid on their own auctions. Each bid uses one database transaction: lock its auction row, read the latest price, validate, insert and commit. Equal concurrent bids yield one acceptance; rejected bids are rolled back. Different auctions can accept bids independently.

Stale rejection preserves input, explains the updated minimum and refreshes price/history. A valid higher amount requires explicit submission; bids are never automatically resubmitted. Detail reads hold a shared auction-row lock while reading summary/history, so they wait for in-flight accepted bids and return consistent final results. Failed refreshes preserve the page and draft and show feedback; polling continues every five seconds. Successful bids show confirmation.

The API reads an injected application clock once after acquiring the auction lock and reading the latest price. At or after the closing instant, the bid is rejected. Accepted bids store that same reading as their timestamp. The default clock is real time; catalog/detail ended status and serverTime use the same clock dependency.

The browser uses the API time reference, switches to Ended and disables bidding at the deadline, and requests final details immediately. Until the API confirms closure it shows “Confirming final result…” rather than an unconfirmed winner. Returning to a backgrounded tab or focusing its window immediately rechecks time and refreshes state. Polling remains a fallback; submissions are never automatically retried.

## Commands

- `npm run db:up`: ensure shared PostgreSQL and the Part 3 database exist.
- `npm run migrate`: apply pending migrations, including initial seeds.
- `npm run dev`: start API and web after database setup.
- `npm run db:down`: drop only the Part 3 database; shared PostgreSQL remains running.
- `npm run db:reset`: **delete all Part 3 data** and restore seed users/auctions/history. Stop dev first, reset, then restart.
- `npm test`: real-PostgreSQL backend tests and frontend unit tests; run setup/migrations first. Tests clean up their own fixtures.
- `npm run typecheck`: strict TypeScript checks for server, web and scripts.
- `npm run build`: strict checks and production Vite build.
- `npm run test:bidding-war`: protected-behavior test in headed Google Chrome.
- `npm run test:closing-time`: headed foreground deadline, background-tab resume, final winner and no-bids verification.

## Headed bidding-war test

With the app running, use another terminal in this directory:

```sh
npm run test:bidding-war
```

Requires Google Chrome and a desktop at least 1200×900. Four independent Chrome windows (seller and three bidders) are tiled in a 2×2 grid. The test checks `/health`, posts through the real form with a deadline about 45 seconds away, and holds that auction's row lock while three $101 bids queue. It releases the lock only after observing all three requests waiting. Exactly one bid must return 201, two must return 409, and only one $101 bid may persist.

The test verifies updated minimum/history, preserved rejected drafts, a failed refresh preserving the page, and explicit higher-bid recovery. Staggered and near-deadline submissions retain coverage of existing deadline guards. Final assertions require four persisted bids, one $101 bid, the $104 winner, ended status, disabled buttons and visible history in all windows. Exact deadline boundaries and lock waits are covered by deterministic backend tests; background-tab activation is covered by `test:closing-time`.

The test adds no database triggers. The row-lock barrier is released on success, failure or ordinary signal cleanup. Screenshots and browser profiles go into OS temporary directories. Presentation-only styles and an activity panel are injected by Playwright; the auction and bid forms are the real UI.

After printing PASS, all four windows remain open until Ctrl+C or until you ask to close them. Ctrl+C closes the windows and removes temporary profiles. The ended auction remains for inspection; unrelated data is preserved. `BIDDING_WAR_BASE_URL` and `DATABASE_URL` can override the defaults and must target the same Part 3 app. The old Part 2 `BIDDING_WAR_HOLD_MS` behavior is not used here.

## Headed closing-time test

With the app running, run `npm run test:closing-time`. It uses two separate Chrome windows side by side, with the real application UI. One temporary blank tab backgrounds the bidder during its auction deadline; it is closed after resuming. The test launches headed Google Chrome via the `google-chrome` command and attaches with Playwright's `noDefaults: true` option, so genuine visibility events are exercised without forced-focus emulation.

The test holds final detail responses to verify that local expiry disables bidding before the network returns, then confirms the final winner. A bid accepted while the bidder tab is hidden must appear immediately after activation, and an auction without bids must end with “No bids.” Both `/health` pages must report OK. Screenshots/profiles go into OS temporary directories. The two final windows remain open until Ctrl+C or an explicit request to close them.

Backend tests inject time immediately before, exactly at and after closing, advance time during a real PostgreSQL lock wait, verify the stored acceptance timestamp, and verify final reads wait for an accepted bid's commit. No production clock-control endpoint is added.

## Design and verification

See [decisions](GRILL.md), [glossary](CONTEXT.md), [implementation slices](IMPLEMENTATION_PLAN.md), and [verification](VERIFICATION.md). Historical Part 2 records under `docs/part-2-*.md` describe the source version, not Part 3 verification.

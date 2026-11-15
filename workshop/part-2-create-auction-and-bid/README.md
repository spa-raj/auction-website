# Auction House — Part 2

```sh
npm install
npm start
```

Open <http://localhost:5102> (Fastify API: <http://localhost:3102>, health page: <http://localhost:5102/health>).

`npm start` ensures the shared PostgreSQL service in `../docker-compose.yml` and the isolated `auction_part_2` database on port 55432 are ready, applies pending SQL migrations, and starts both apps. Normal startup preserves listings, bid histories and closing times. Part 1 is unchanged.

## Slice 1 — Browsing and users

Browse, search, filter and sort the six persisted seed auctions. Each fresh tab randomly selects one of ten demo users and remembers that selection in sessionStorage under `auction-part-2-active-user`. The header shows the active user’s name. The footer switcher changes the selection for that tab, preserving it through navigation and reloads. These identities are not authenticated.

## Slice 2 — Posting

Use **Sell** to open `/auctions/new`, enter the required fields and publish immediately as the selected user. The form shows field-level validation and preserves entered values after a request failure. A successful post opens `/items/:slug`. Category illustrations are automatic. Seeded listings preserve specifications; new listings hide that section. Details show persisted bid history and ended status. Slice 3 adds direct bids, newest-first history and five-second detail refresh. Sellers cannot bid on their own auctions; every bid must exceed the current amount by at least $1, including the first bid. Ended auctions reject bids and display a winner or No bids. Stale bids are rejected with the new minimum; they are never automatically retried. Bid values must fit PostgreSQL integer cents (at most $21,474,836.47). Simultaneous-bid protection remains deferred to Part 3.

Starting prices are USD with at most two decimal places ($0.01–$1,000,000), stored as integer cents. Closing time is entered in your local timezone, sent and stored as UTC, and displayed in the viewer's local timezone. The API enforces the deadline being in the future at insertion.

## Commands

- `npm run db:up`: ensure shared PostgreSQL and Part 2 database exist.
- `npm run migrate`: apply unapplied migrations, including initial seeds.
- `npm run dev`: start API and web after database setup.
- `npm run db:down`: drop only Part 2's database; shared PostgreSQL remains running.
- `npm run db:reset`: **delete all Part 2 data** and restore ten users, six auctions and seed bid histories. Seed deadlines are recalculated only on initial seeding or reset. Stop dev first, reset, then restart.
- `npm test`: real-PostgreSQL API integration tests (run setup/migrations first); tests clean up their own listings.
- `npm run typecheck`: strict TypeScript checks for both apps.
- `npm run build`: typecheck and production Vite build.

## Design

See [agreed decisions](GRILL.md), [domain glossary](CONTEXT.md), [ADRs](docs/adr/), and [implementation slices](IMPLEMENTATION_PLAN.md). Part 2 handles sequential bidding only; concurrency protection is deferred to Part 3.

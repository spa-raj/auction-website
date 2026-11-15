# Part 5 — Auction Review

Auction-detail pages refresh immediately after an accepted bid through Socket.IO with a Redis Pub/Sub adapter. PostgreSQL and the HTTP detail API remain authoritative. The single application instance uses API port 3105, web port 5105 and database `auction_part_5`; earlier parts remain independent.

## Run

From this directory:

```sh
npm install
npm start
```

`npm start` starts shared PostgreSQL and Redis through the root Docker Compose configuration, creates Part 5's database when missing, applies migrations, then runs Fastify and Vite. Existing data is preserved.

- Web: http://localhost:5105
- Browser health: http://localhost:5105/health
- API health: http://localhost:3105/api/health
- Redis: `redis://127.0.0.1:56379` (override with `REDIS_URL`)

Redis publisher and subscriber must connect before the API starts listening. Startup fails after five seconds without Redis. API health returns 503 if PostgreSQL or Redis is unavailable. Redis uses the isolated `auction-part-5:socket.io` adapter prefix and is not a database for auction state.

## Commands

```sh
npm run db:up
npm run redis:up
npm run migrate
npm run dev
npm test
npm run typecheck
npm run build
npm run test:realtime
```

`npm run db:reset` drops/recreates only Part 5's database. `npm run db:down` drops only that database; it does not stop shared services. Stop `npm run dev` with Ctrl+C. Both Socket.IO and Redis connections close during API shutdown.

## Browser review

`npm run test:realtime` requires a graphical desktop and Google Chrome. It opens two separate, side-by-side headed Chrome windows against one app instance and leaves them open after success. Captures and profiles go to OS temp directories. Ctrl+C stops the verification and closes its windows. Existing `test:bidding-war` and `test:closing-time` scripts remain available with Part 5 ports/storage.

The realtime check verifies a real Socket.IO notification and HTTP refetch with watcher polling disabled, a preserved draft, reconnect catch-up, and a notification arriving during an already-running HTTP fetch. For normal manual use with five-second reconciliation polling, open the review URL in a fresh browser window; the automated watcher context disables that polling on each navigation.

To review manually, open the same auction in two windows, select different non-seller demo users, type a draft in one, then submit a valid bid in the other. Watch the first window's price, bidder, minimum and history update while its draft stays unchanged. Reconnect after a missed bid to see current state fetched again. Catalog cards keep their existing behavior.

## Behavior and limits

Bids are expected to enforce the minimum increment, seller restriction and closing deadline under concurrent submissions. Only successful COMMIT triggers `auction:changed` with an auction slug. Each detail page watches a public auction room and disconnects when unmounted. Socket events never submit bids or carry authoritative prices.

Every subscription/reconnect performs a catch-up fetch. Socket notifications trigger immediate HTTP detail reads; overlapping triggers queue a follow-up read. Five-second reconciliation, focus/visibility refresh and closing-time refresh remain enabled. External updates preserve drafts; bidders must explicitly submit again after rejection.

Delivery is best effort. Publication failure is logged and does not change an already-committed bid's success. There is no durable outbox or replay guarantee. The adapter delivers locally and publishes to Redis; this version demonstrates one application instance only. Tests independently observe the real Redis channel.

See GRILL.md for review scope and IMPLEMENTATION_PLAN.md for handoff constraints. Earlier-part records under docs/ are historical; run checks against Part 5 rather than relying on those results.

## Bidding-war realtime assertions

`npm run test:bidding-war` launches four headed Chrome windows in a 2×2 grid and leaves them open. The seller posts a short-lived auction; three bidders submit equal bids behind a PostgreSQL row-lock barrier. Assertions retain one acceptance, two stale rejections, preserved drafts on refresh failure, explicit higher bids, and rejection after closing.

No synchronization reloads are used. The test disables five-second polling and focus/visibility refreshes in its own browser contexts, observes real Socket.IO auction-change frames, and waits for every mounted page to show the latest price, bidder, minimum and history after each accepted bid. It counts document navigations after initial auction load and requires zero. Closing-time timers remain active. Evidence includes notification counts and navigation counts per window, persisted bids, and the late-bid rejection. Test-only browser changes do not alter normal application behavior.

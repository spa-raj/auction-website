# Part 6 — Authoritative Auction Closing

- Read GRILL.md, CONTEXT.md and IMPLEMENTATION_PLAN.md. Slice 1 is reviewed. Slice 2 is approved: confirmed outbox publication, separate notification worker, idempotent recipient records, Redis/Socket.IO popups, tests and browser verification. Stop for review after Slice 2.
- Work only here. Part 4 is the baseline; never use Part 5. Historical instructions under docs/part-* are not current approvals.
- Keep strict TypeScript, Fastify, Zod, PostgreSQL and React/Vite; explicit migrations only.
- Preserve auction-row locking and the post-lock bid acceptance-time check. Claim due auctions with FOR UPDATE SKIP LOCKED; outcome and outbox commit together.
- Isolate API 3106, web 5106, database auction_part_6, test database auction_part_6_test, browser identity auction-part-6-active-user, Redis prefix auction-part-6:socket.io and tracing service names. Do not modify root Compose.
- Required checks: npm test, npm run build, HTTP /health and browser verification of finalizing, sold and no-bid outcomes. Test concurrency, deadline behavior, repeated processing, uniqueness and transaction rollback. Slice 2 additionally requires confirm-before-publication marking, real broker redelivery, recipient selection and Redis/Socket.IO popup verification.
- User-requested demonstrations use headed Chrome/Edge, tiled separate windows left open. Normal self-verification may be headless. Captures go to temp directories.

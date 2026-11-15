# Part 2 — Auctions and Bids

- Read GRILL.md, CONTEXT.md, and IMPLEMENTATION_PLAN.md before changes.
- Keep changes in this directory; shared PostgreSQL comes from `../docker-compose.yml`.
- Database: `auction_part_2` on 55432. API: 3102. Web: 5102.
- Preserve the foundation's UI conventions; use strict TypeScript, Fastify, Zod, pg and React/Vite.
- Keep schema and seed changes in explicit SQL migrations. Normal startup must preserve data; `npm run db:reset` explicitly restores this part only.
- Demo user selection is not authentication. Never describe Part 2 as safe for concurrent bidding.
- Required checks: `npm test`, `npm run build` (includes strict TypeScript checks), and browser verification of `/health` plus the affected user flows.
- Stable commands: `npm install`, `npm run db:up`, `npm run db:down`, `npm run db:reset`, `npm run migrate`, `npm run dev`, `npm start`, `npm test`.
- Slice 1 is implemented and verified. Stop for user review; do not implement Slice 2 until the user confirms.

# Part 5 — Auction Review

- Read CONTEXT.md, GRILL.md and IMPLEMENTATION_PLAN.md before changes.
- Work only in this directory. Preserve Part 4 unchanged. Do not commit without a user request.
- Keep strict TypeScript, PostgreSQL, Docker Compose, Fastify, Zod and React/Vite and existing UI conventions.
- Keep database changes in explicit migrations. Demo user selection is not authentication.
- Isolation: API 3105, web 5105, database auction_part_5, tab identity auction-part-5-active-user, Redis adapter prefix auction-part-5:socket.io. Shared PostgreSQL port 55432; Redis loopback port 56379.
- Use documented npm and Docker commands. Do not edit the root Compose file. Normal startup preserves data; db:reset affects Part 5 only.
- Required checks: npm test, npm run build (includes strict type checks), browser /health and affected flows. Report failures accurately; do not weaken assertions.
- User-requested Playwright runs use headed Chrome/Edge with separate tiled windows, left open for review. Save captures and test evidence in a separate temp directory.
- Historical decisions and verification from earlier parts are under docs/ and do not establish Part 5 correctness.

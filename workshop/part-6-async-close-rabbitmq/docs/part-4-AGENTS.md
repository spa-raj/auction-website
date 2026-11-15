# Part 4 — Realtime Auction Details

- Read GRILL.md, CONTEXT.md and IMPLEMENTATION_PLAN.md before changes.
- Work only in this directory. Preserve Part 3 unchanged.
- Baseline copied from Part 3 without dependencies or generated output. Historical Part 3 instructions and verification are under docs/part-3-*.md.
- Slice 1 is approved: live auction-detail updates. Implement and verify it, then stop for review. Additional slices require user approval.
- Preserve strict TypeScript, PostgreSQL, Docker Compose, Fastify, Zod and React/Vite and current UI conventions.
- Keep database changes in explicit migrations. Demo user selection is not authentication.
- Isolation: API 3104, web 5104, database auction_part_4, tab identity auction-part-4-active-user, Redis channel prefix auction-part-4:socket.io. Redis on loopback port 56379 is required before readiness.
- Required implementation checks: npm test, npm run build, browser verification of /health and affected flows; verify real Redis publication and two browsers on one application instance. The user explicitly excluded multi-replica demonstrations.
- Preserve npm and Docker command conventions. Do not edit the shared root Compose file; use existing shared services through Part 4 commands.
- User-requested Playwright demonstrations must use headed Chrome/Edge, separate tiled windows, left open for review. Put captures in a separate temp directory.

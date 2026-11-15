# Part 3 — Business Rules and Concurrency

- Read GRILL.md, CONTEXT.md, and IMPLEMENTATION_PLAN.md before changes.
- Work only in this directory. Preserve Part 2 as the bug reproduction version.
- Shared PostgreSQL comes from ../docker-compose.yml; database auction_part_3 on 55432. API 3103; web 5103.
- Preserve the existing UI conventions and strict TypeScript, Fastify, Zod, pg, React/Vite stack.
- Keep database changes in explicit SQL migrations. Normal startup preserves data; db:reset affects Part 3 only.
- Demo user selection is not authentication.
- Feature implementation requires explicit user approval. Complete one vertical slice, verify it, and stop for review before the next.
- Required checks: npm test, npm run build, browser verification of /health and affected user flows.
- Stable commands: npm install, npm run db:up, npm run db:down, npm run db:reset, npm run migrate, npm run dev, npm start, npm test.
- Both slices are implemented and verified. Stop after Slice 2; further feature work requires a new user request.
- Part 3 test:bidding-war requires protected behavior (one equal bid accepted, two rejected); it always runs headed Chrome in four tiled windows and leaves them open until explicitly closed. Preserve Part 2’s duplicate-reproduction test.

- Slice 2 browser check: npm run test:closing-time uses two headed Chrome windows, verifies genuine hidden/visible tab transitions and leaves final windows open until explicitly closed.

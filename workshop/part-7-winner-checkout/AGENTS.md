# Part 7 — Winner Checkout

- Current authorization: Slice 1 only, approved after Round 1 recommendations. Implement full winner checkout, signed replay-safe completion, and minimal durable/retrying mock fixes, then stop for browser review. Slice 2 is proposed, not approved.
- Build from Part 6; preserve bidding locks, post-lock deadline checks, outcome/outbox atomicity, Drizzle runtime access and recipient notifications. Historical Part 6 approvals do not apply here.
- Work only here, including the copied stripe-service. Preserve the shared original and root Compose.
- Isolate API 3107, web 5107, mock 7107, database auction_part_7, test database auction_part_7_test, RabbitMQ vhosts, Redis prefixes, demo identity key and tracing names.
- Explicit migrations; strict types and Zod boundary validation. The raw webhook body must be verified before parsing. Only matching signed completion events can mark purchases paid.
- Required checks: npm test, npm run build, HTTP health, npm run test:checkout and browser review. Cover winner eligibility, server-owned amount/return URLs, signature validation, replay/mismatch, concurrent checkout, decline, cancel, retry and mock restart recovery.
- Requested bidding war runs headed in Chrome/Edge, four separate geometrically verified windows in a 2×2 grid. Leave browsers open and winner unpaid for manual checkout. If headed execution or tiling is unavailable, report before attempting the demonstration; never substitute headless.
- Normal self-verification can be headless. Captures and evidence go to OS temp directories.

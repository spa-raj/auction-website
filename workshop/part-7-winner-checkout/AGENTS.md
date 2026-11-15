# Part 7 — Winner Checkout

- Current authorization: Slice 1 reviewed; implement Slice 2 seller payment status and recovery, including an unpaid mock session disappearing. This supersedes the earlier optional purchase-overview proposal. Keep information restricted by role, verify the complete slice, then stop for browser review. Do not add the purchase overview.
- Build from Part 6; preserve bidding locks, post-lock deadline checks, outcome/outbox atomicity, Drizzle runtime access and recipient notifications. Historical Part 6 approvals do not apply here.
- Work only here, including the copied stripe-service. Preserve the shared original and root Compose.
- Isolate API 3107, web 5107, mock 7107, database auction_part_7, test database auction_part_7_test, RabbitMQ vhosts, Redis prefixes, demo identity key and tracing names.
- Explicit migrations; strict types and Zod boundary validation. The raw webhook body must be verified before parsing. Only matching signed completion events can mark purchases paid.
- Required checks: npm test, npm run build, HTTP health, npm run test:checkout and browser review. Cover winner eligibility, server-owned amount/return URLs, signature validation, replay/mismatch, concurrent checkout, decline, cancel, retry and mock restart recovery.
- Requested bidding war runs headed in Chrome/Edge, four separate geometrically verified windows in a 2×2 grid. Leave browsers open and winner unpaid for manual checkout. If headed execution or tiling is unavailable, report before attempting the demonstration; never substitute headless.
- Enable `chromiumSandbox: true` for Part 7 Playwright launches. Do not add `--no-sandbox` or hide its warning; the headed bidding war checks the browser command line.
- Normal self-verification can be headless. Captures and evidence go to OS temp directories.

## Verification commands

Run from `part-7-winner-checkout`:

- `npm start`: prepare shared Docker services and isolated Part 7 resources, migrate, and run API/web/workers/mock. Use `npm run dev` with already prepared resources.
- `npm test`: server/web/mock suites, including concurrency, webhook signatures/replay, role visibility, missing-session recovery, pending confirmation and mock restart/retry cases. Test resources are isolated.
- `npm run build`: strict server/web/script/mock typechecks and production web build. `npm run typecheck` is available separately.
- `npm run test:checkout`: automated headless Chrome checkout self-verification (decline, cancel, retry, paid reload, seller/winner visibility and mobile layout).
- `npm run test:payment-recovery`: automated Chrome self-verification of seller live status, lost unpaid session replacement, pending confirmation, transient outages and role isolation. Uses a disposable mock and temporary state; never deletes live mock state.
- `npm run test:bidding-war`: headed Chrome, four separate geometrically verified 2×2 windows, real Socket.IO bidding/deadline/result/popup checks, then unpaid winner and decline purchases held open for browser review. Never silently use headless. Close demonstration windows only on request or before rerunning the demonstration.
- `npm run test:notifications -- --headless`: automated recipient popup and recovery checks. Without `--headless`, this is a headed manual-review demonstration that leaves windows open.
- `npm run test:closing-time` and `npm run test:realtime`: existing focused browser checks; inspect their headed requirements before running a requested demonstration.
- HTTP smoke checks: API `http://127.0.0.1:3107/api/health`, web-proxied `http://127.0.0.1:5107/api/health`, browser `http://127.0.0.1:5107/health`, mock `http://127.0.0.1:7107/health`.

Keep DATABASE_URL's `winner_checkout` schema option. Preserve older tables already in `auction_part_7`. Do not use `db:down` or `db:reset` to restart services: those explicitly drop the entire database. Write verification evidence under an OS temp directory and record observed results in VERIFICATION.md.

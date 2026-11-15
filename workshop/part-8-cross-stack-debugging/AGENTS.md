# Part 8 — Cross-stack Debugging

- Current authorization: Part 7 is complete, verified and committed. The user explicitly approved the observability plan as one cohesive implementation, superseding planning-only gates and the earlier stop between slices. Implement and verify the entire workflow, then hand off for review.
- Baseline: Part 7 at commit 58037bfda8da2ac8685b01db61b907fefa0ea25f. Preserve all behavior and earlier parts.
- Work only in this directory. Preserve Part 7 and root Docker Compose.
- Read GRILL.md and OBSERVABILITY_PLAN.md for agreed scope. The latest explicit approval authorizes one cohesive implementation; earlier planning gates and the two-slice stop are historical.
- The winning bid anchors the workflow; other bids have short traces. Persist and propagate context across PostgreSQL records, RabbitMQ and checkout/payment boundaries.
- Preserve meaningful PostgreSQL operation spans while excluding SQL text, parameters, raw payloads, names, handles and card data. Raw auction slugs and URLs may contain user-entered titles and must not be exported.
- Trace explicit business work, not routine polling or framework internals. IDs, amounts, roles and outcomes use a strict attribute allowlist. Expected rejection/decline is a business outcome, not an automatic error span.
- Use Jaeger for investigation; no application tracing screen. Preserve all Part 7 correctness, privacy, concurrency, signature and recovery behavior.
- Preserve the stack, use explicit migrations and isolate API 3108, web 5108, mock 7108, databases/schema, RabbitMQ vhosts, Redis prefixes, identity key and trace service names. Do not modify root Compose. Verify the complete approved implementation; no intermediate slice approval is required.


## Run and verify

Run these commands from `part-8-cross-stack-debugging`:

- `npm ci` then `npm start`: prepare shared Docker services (including existing Jaeger), create only Part 8 database/vhosts, migrate, run API/web/close-relay/notification/mock. `npm run dev` starts already-prepared resources.
- `npm test`: inherited business suites plus durable tracing, rollback, real RabbitMQ confirms/redelivery, restarted mock retries, unpaid-session recovery, privacy/idle-noise and export-failure checks.
- `npm run build`: strict server/web/scripts/mock checking and Vite production build. `npm run typecheck` is available separately.
- `npm run test:golden-trace`: complete **headed** browser workflow and collected Jaeger trace verification, four separate sandboxed Chrome windows geometrically tiled 2×2 and left open. Seller top-left, winner top-right, other bidder bottom-left, Jaeger bottom-right. Verify full winning workflow, shorter losing trace, business decline, four service identities, exported-data privacy and quiet routine reads. Do not silently fall back to headless. Chrome/desktop/tiling failures must be reported before a requested demonstration.
- `npm run test:golden-trace -- --headless`: normal automated self-verification only; same workflow assertions, no held windows.
- `npm run test:checkout`, `npm run test:payment-recovery`, `npm run test:notifications -- --headless`: normal browser self-verification of preserved payment, role/privacy, missing-session/status recovery, recipient delivery and dismissal behavior. Recovery uses disposable mock state and a private test schema; never delete live payment evidence.
- `npm run test:bidding-war`: headed 2×2 concurrency/deadline/result/popup demonstration; after all assertions it waits for the actual winning trace in Jaeger, verifies bid→close→publish→consume ancestry and machine-local timestamp rendering, and leaves seller/Jaeger/unpaid winner/decline windows open. Keep Chrome sandbox enabled; close held demo windows only when asked or before rerunning the demonstration.
- Health: API `http://127.0.0.1:3108/api/health`, web proxy `http://127.0.0.1:5108/api/health`, browser `http://127.0.0.1:5108/health`, mock `http://127.0.0.1:7108/health`. Jaeger UI `http://127.0.0.1:16686`; OTLP HTTP `http://127.0.0.1:4318/v1/traces`.

Retain DATABASE_URL's `winner_checkout` schema option. Use explicit migration 005 for opaque auction IDs and optional trace carriers; never schema-push/regenerate existing migrations. Test databases, vhosts, Redis prefix, schema and disposable state must remain isolated. Screenshots/profiles/exported trace evidence go under OS temp directories. Record observed checks in VERIFICATION.md and the full Jaeger walkthrough in README.md.

Do not restore blanket auto-instrumentation, a console span exporter, raw exception capture or unrestricted baggage. All process SDKs use shared tracing/export filtering. Preserve actual PostgreSQL operation spans. Exporter/backend outages must not change business results. Jaeger currently stores spans in memory; durable context is not durable telemetry storage.

- Finish active work and await telemetry force-flush/SDK shutdown before terminating application processes. Do not force-kill immediately after a workflow action. Preserve UTC epoch timestamps; display machine-local wall-clock times in Jaeger and record both UTC/local values in review evidence.

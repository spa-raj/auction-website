# Cross-stack Observability — One-round Design Interview

Status: the user confirmed Part 7 is complete/verified/committed and approved the observability plan as one cohesive implementation. Baseline: 58037bfda8da2ac8685b01db61b907fefa0ea25f. Planning-only and between-slice stops below are historical; implement and verify the complete golden workflow, then hand off for review.

## Fixed decisions

- Use completed committed Part 7 as the baseline; the later explicit instruction authorizes copying it into isolated Part 8.
- The winning bid anchors the full workflow; all other bids have shorter traces.
- Persist and propagate trace context across database records, RabbitMQ messages and checkout boundaries.
- Preserve meaningful PostgreSQL operation spans. Suppress routine polling and framework noise.
- Record IDs, amounts, roles and outcomes.
- Exclude names, handles, card data, raw payloads and SQL text.
- Expected bid rejection and card decline are business outcomes, not automatic error spans.
- Show traces in Jaeger; no tracing screen in the application.
- The initial request was planning only. Its no-copy gate is superseded by the later explicit implementation approval.

## Findings from inspection

Initially inspected Part 7 at commit `58037bf` during planning; the user later confirmed it complete/verified/committed and authorized this exact baseline. The cohesive implementation and golden workflow checks are complete; observed results are in VERIFICATION.md.

- API enables broad Node auto-instrumentation and a console exporter in `../part-7-winner-checkout/server/src/otel.ts`. It needs selective instrumentation and OTLP export.
- Close and notification worker entry points have no telemetry bootstrap. Their business work is currently disconnected from API traces.
- Bid/outcome/outbox/notification/purchase/payment-event records have no durable trace context. Winner selection provides the authoritative point at which one accepted bid's trace becomes the long workflow.
- RabbitMQ publication sends stable message IDs but no W3C context headers; consumption does not extract context.
- Checkout currently has no persisted winning-workflow context or explicit propagation to the mock.
- The copied mock partially supports traceparent extraction, durable session context and payment-attempt restoration. It lacks tracestate handling, and background webhook retries lack explicit restored context/attempt spans.
- Notification records are durable before ACK; Redis/Socket.IO emits best-effort signals. None of these proves that a browser displayed/read a popup.
- Auction slugs embed user-entered titles. Exporting a raw slug or full URL would violate the requested exclusion of names/handles. Use an opaque auction correlation ID and route templates.
- Root Compose already provides Jaeger all-in-one 1.76.0, OTLP HTTP on 4318 and UI on 16686, without configured durable trace storage. Stored workflow context and retained Jaeger spans are separate concerns.

## Short-round recommendations and resolution

1. Instrumentation boundary: recommend API, workers and mock only. Browser review verifies application behavior separately; notification traces stop at durable recording/signal attempt, without claiming browser receipt. Add explicit browser action/render spans only if requested.
2. Collection/retention: recommend SDK OTLP HTTP export directly to the existing Jaeger service, distinguished by Part 8 service names. No new collector or Jaeger storage changes. Exported traces may be lost when Jaeger restarts; application context must still survive service restarts.
3. Sampling: recommend retaining every business bid/workflow trace for this local configuration, because the future winning bid is unknown at bid time. Exclude routine poll/health/framework work rather than sampling away a possible workflow anchor.
4. Future review split: recommend two complete increments: bid through recorded result/message/recipient notification in Jaeger, then checkout through mock payment/signed webhook/paid purchase in the same winning workflow. Every slice includes failure/recovery and privacy/noise verification. This confirms structure only, not permission to implement.

## Current authorization

The latest user instruction approves the whole observability plan as one cohesive implementation after completion/commit of Part 7. Backend/worker/mock instrumentation, direct export to existing Jaeger and retaining all meaningful business traces are accepted. The two proposed increments are implementation areas within one handoff, not separate approval checkpoints. Preserve business behavior, run relevant checks and document the complete golden-trace browser walkthrough.

# Part 8 Verification

Date: 2026-11-15. Baseline: completed Part 7 commit `58037bfda8da2ac8685b01db61b907fefa0ea25f`. The user approved one cohesive implementation; no intermediate slice review was required.

## Implementation verified

Part 8 is self-contained with API 3108, web 5108, mock 7108, `auction_part_8`/`auction_part_8_test`, Part 8 RabbitMQ vhosts/Redis prefixes/identity keys and four distinct trace service names. Earlier parts, shared mock and root Compose are unchanged. Migration 005 adds an opaque auction UUID and optional durable carriers to bids/outcomes/outbox/notifications/purchases/payment events.

Selective business and PostgreSQL spans preserve the winning bid as the workflow root. Outbox headers, consumer extraction/fallback, recipient records, purchase/session reuse/recovery and mock completion/retry state continue that trace. Stable event IDs/uniqueness/signatures still own business effects. Expected rejection/decline remain outcomes; rollback, publication and transport failures remain sanitized errors. Export filtering excludes raw SQL, names/handles, title-derived slugs/URLs, cards/payloads/secrets and raw exceptions. Routine successful polling/health/framework work is quiet.

## Checks and evidence

- `npm test`: **132 passed**: 89 server, 37 web, 6 mock. Includes inherited concurrency/deadline/close/outbox/notification/payment/role/recovery behavior and seven dedicated tracing tests.
- Tracing tests exercise **real RabbitMQ publisher confirms and actual channel-close redelivery** in a private exchange/queue in the test vhost, durable context across a restarted mock and automatic completion retry, missing-unpaid-session replacement on the same winning trace, malformed/legacy/no-bid fallback, transaction rollback, exported-span privacy, idle suppression, a throwing exporter and an actually unreachable OTLP HTTP receiver. No duplicate paid/recipient effects.
- `npm run build`: strict server/web/script/mock checks and Vite production build passed.
- `npm run test:checkout`: passed hosted decline, cancel, same-session retry, paid reload, seller/loser role visibility, identity switching, mobile layout and no-bid behavior. Evidence `/tmp/part8-checkout-hnZo9K/`.
- `npm run test:payment-recovery`: passed seller status, actual known-unpaid-session disappearance/replacement, outage feedback, pending confirmation/no second payment, autonomous signed completion, reload and role switching with disposable state/schema. Evidence `/tmp/part8-payment-recovery-nVzYZE/`.
- `npm run test:notifications -- --headless`: passed real Socket.IO delivery, seller/winner selection, losing bidder exclusion, dismissal/retry/cross-window behavior, actual broker duplicate replay, no-bid queueing and offline/mobile recovery. An inherited test locator expected the pre-checkout winner link label; it was updated to the current `View purchase` label and the complete check passed. Evidence `/tmp/part6-notifications-fTGPZt/` (the inherited temp prefix is cosmetic).
- API, web-proxied API, mock and Jaeger health/read endpoints returned HTTP 200.
- Working/staged whitespace checks passed. All source/configuration changes are inside Part 8.

Logs: `/tmp/part8-tests.log`, `/tmp/part8-build.log`, `/tmp/part8-checkout.log`, `/tmp/part8-payment-recovery.log`, `/tmp/part8-notifications.log`.

## Complete golden trace — collected and inspected

Both normal headless self-verification and a headed four-window Chrome walkthrough passed. The headed run used four independent sandboxed Chrome processes, verified 1280×720 bounds in a 2×2 grid on the 2560×1440 display and left the final app/Jaeger windows open. No page JavaScript errors were observed.

- Golden trace: `e950dfc4351c70e936bae4e3a5adbf24`
- Jaeger: http://127.0.0.1:16686/trace/e950dfc4351c70e936bae4e3a5adbf24
- Shorter losing-bid trace: `b5b1c3794897486edb31bc4c695099f5`
- Opaque auction ID: `0943f5eb-ce70-44fb-b8f2-aaa28d81573b`
- Purchase ID: `7a8d0e77-3960-487d-b839-a63e193af301`
- Evidence: `/tmp/part8-golden-trace-I0DDXg/` (trace.json, evidence.json and screenshots); log `/tmp/part8-golden-headed.log`.
- Earlier headless trace: `c9955f8587f50fe40e6946806b1eefc5`; evidence `/tmp/part8-golden-trace-MSImMy/`.

The collected headed trace has 41 spans across the API, close worker, notification worker and mock Stripe services, anchored at the accepted $103 winning bid. It includes close, confirmed publish, consumer/recipient/signal work, checkout/session creation/reuse, declined and successful payment attempts, signed webhook delivery/process and one paid transition, with meaningful database child spans. The losing bid has no close/payment descendants. The decline is not an error. Collected trace JSON contains none of the synthetic private title/location/payload markers, participant names, card values, SQL/raw-URL/exception fields. Repeated healthy polling reads add no workflow spans.

The actual Jaeger view and seller paid-state screenshots were visually inspected. The complete reproducible browser walkthrough, commands, span interpretation, retry semantics and retention limits are in README.md. No application tracing screen was added.

## Limits

Jaeger currently retains spans in memory. Stored workflow context survives service restarts but cannot reconstruct spans lost from Jaeger or an interrupted SDK buffer. Notifications record durable recipient work and best-effort signal attempts, not browser read receipts. Demo-user selection remains the existing routing/eligibility model; hosted mock URLs remain bearer capabilities. Only verified signed completion changes purchase status.

## Additional request — local time and headed bidding-war trace

`npm run test:bidding-war` passed in headed sandboxed Chrome with four verified 1280×720 windows in a 2×2 grid and left them open. It verified real socket-only bid/result/recipient updates, protected equal-bid concurrency (201/409/409), rejected the late $105 bid, selected bid 118 / winner 3 / $104, then waited for the actual winning trace to be collected. The losing-bidder review window now shows Jaeger; seller and both unpaid checkout examples remain open.

Winning trace `ec501b0bca6c8847a9d0591fd178cd65` contains the verified bid→close→publish→consume parent IDs. Jaeger shows local machine time `November 15 2026, 22:19:08.505` in `Asia/Calcutta` (IST, UTC+05:30), matching collected UTC `2026-11-15T16:49:08.505Z`. SDK epoch timestamps remain unchanged. Exact times, durations, outcomes and IDs are documented in TRACE_EVIDENCE.md; raw collected evidence and screenshot are in `/tmp/bidding-war-results-QN2MDc/`, log `/tmp/part8-bidding-war.log`. The local-time Jaeger screenshot was visually inspected.

Shutdown ordering explicitly drains API/mock work before telemetry force-flush and SDK shutdown; workers flush after active loops/transactions finish. The supervisor allows a 15-second graceful budget. No application services or Jaeger were shut down for the final handoff. Final tests still pass (132); final build/typechecks and whitespace checks pass.

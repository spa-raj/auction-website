# Part 6 — Slice 2 Verification

Verified 2026-11-15. Slice 1 reviewed; Slice 2 explicitly approved and completed. Stop for review. Slice 1 evidence is preserved in docs/slice-1-VERIFICATION.md.

## Checks run

- Added locked amqplib, its TypeScript definitions and the official Socket.IO Redis emitter. Read the maintained amqplib API and RabbitMQ confirmation documentation before implementation.
- Started the existing shared RabbitMQ service, provisioned only auction_part_6 and auction_part_6_test virtual hosts/permissions, and applied migration 003. Earlier parts and root Compose unchanged.
- Final `npm test`: **103 passing tests** — 66 server tests in six files, 37 web tests in two files. Real PostgreSQL, RabbitMQ and Redis are used with isolated test database/vhost/channel prefix. The expected unavailable-Redis readiness test logs connection failures.
- `npm run typecheck`: passed, including scripts/notifications.mts.
- Final `npm run build`: passed strict server/web/scripts type checks and Vite production build (153 modules).
- `npm run test:notifications -- --headless`: passed twice in actual Google Chrome, including a safe rerun with existing review results. No browser page errors. This was normal self-verification, not a requested headed demonstration.
- Visually inspected desktop seller and mobile winner screenshots. Captures, evidence JSON and logs are outside the repository. Final browser evidence: /tmp/part6-notifications-43goTh/evidence.json; earlier visually inspected evidence: /tmp/part6-notifications-9pvsx2/. Final logs: /tmp/part6-slice2-tests-final.log, /tmp/part6-slice2-browser-final.log. The running stack logs to /tmp/part6-slice2-dev.log.

## Messaging tests

Nine integration tests verify:

1. Publication remains unmarked while a confirmation promise is pending; rejection leaves a stable event ID for retry, and already published events are skipped.
2. Real persistent broker publication with publisher confirms, expected message ID/content and subsequent publication marking.
3. Real mandatory routing returns leave events pending even when the exchange accepts the publish.
4. Seller/winner selection for sold auctions; seller only for no bids; losing bidder receives no pending notice.
5. Four concurrent processing attempts create exactly two stable recipient records, idempotent dismissal persists, replay cannot revive it, and another recipient cannot dismiss it.
6. Failure inserting the second recipient rolls back both recipients; retry succeeds without partial notification delivery.
7. Malformed/unsupported payloads and forged recipient data are rejected; notification HTTP boundaries validate identity/IDs.
8. Actual RabbitMQ unacknowledged redelivery after committing recipient rows, closing the connection, reconnecting and consuming the redelivered message. Record IDs and prior dismissal are preserved.
9. Official Redis emitter publications traverse the real adapter to matching seller/winner Socket.IO rooms, not a losing bidder. Dismissal signals target only that recipient.

All existing close, concurrency, deadline, rollback, API, realtime and frontend tests remain green.

## Browser assertions

The test disables five-second polling inside healthy-path contexts and requires actual notifications:changed WebSocket frames before accepting recipient popups. Separate seller, winner, losing-bidder and duplicate-seller sessions verify:

- Seller and winner receive correct catalog-page modals and $102.00 winning amount; losing bidder receives none.
- Escape does not dismiss. Explicit seller dismissal clears both seller sessions via realtime signals.
- View auction navigation keeps the notice pending. Switching identities clears the prior popup; switching back restores the undismissed notice.
- Injected HTTP 503 on dismissal retains the modal with error/retry feedback. Retry persists dismissal.
- Replaying the original close event through the actual RabbitMQ queue is consumed by the running notification worker without creating extra records or reopening dismissed modals.
- No-bid outcome produces only a seller popup. A subsequent result queues behind it rather than replacing it.
- Winner disconnected before closing receives the pending result on return and after reload. The mobile modal fits a 390px viewport without horizontal overflow.

The final frame counts were seller 7, winner 4, loser 0 and duplicate seller 7. Browser /health was verified in Slice 1; API /api/health returns 200 in the Slice 2 browser check. No headed demonstration was run; the provided script defaults to headed, separate 2×2 Chrome windows and leaves final state open when explicitly run for a demonstration.

## Review now

API, frontend, independent close/relay loops and separate notification worker remain running under `npm run dev`.

Open http://localhost:5106/search in two windows. Use Bare Metal Matchmakers (4) for the seller and Layer Eight Supply (5) for the winner; if a popup is already open, its internal demo selector lets you switch identities. Both have an undismissed “Popup review — offline winner” notice. Select Cool Story Systems (6) to confirm the losing bidder has no popup. Open another seller window and dismiss once to check convergence; reload to check persistence. Following View auction keeps the notice pending.

Latest result: http://localhost:5106/items/popup-review-offline-winner-19b13124-2a60-46ae-91d3-16d333a6be45.
No-bid result: http://localhost:5106/items/popup-review-no-bids-204df8d9-71a0-434d-a4b9-7947645f4ff6.

For a fresh end-to-end result, post an auction with a short closing time and bid as another participant. Observe seller/winner popup content and explicit dismissal. Allow HTTP reconciliation after a missed signal.

## Limits retained by design

Transport can redeliver; no exactly-once claim. Broker confirmation proves acceptance/routing, not browser receipt. Redis signals are best effort; durable records and HTTP provide recovery. The local durable classic queue is not a replicated broker deployment. Invalid messages are rejected without requeue and logged for manual investigation; no dead-letter queue or elaborate retries. Demo identity is not authentication. API health does not assert worker progress. No destructive shared-service outage demonstration or multi-replica demonstration was run.

## Headed bidding war — 2026-11-15, 19:46 IST

Ran `npm run test:bidding-war` in **headed Google Chrome**, four separate persistent browser processes/windows. CDP verified a 2×2 desktop layout with 1280×720 windows at (0,0), (1280,0), (0,720), (1280,720). Windows and both recipient modals remain open on the final result; the runner is intentionally still active.

The script was updated from the inherited ENDED-only checks to assert authoritative SOLD state, database outcome/outbox publication and seller/winner recipient modals. It explicitly dismissed four earlier machine-created review notices as setup, leaving unrelated notices untouched; their IDs are listed in evidence.json. No application behavior changed.

Actually checked in this run:

- Three $101 bids were simultaneously queued behind the auction row lock. Responses were 409/409/201; exactly one $101 bid persisted. Rejected drafts survived, and later explicit higher bids succeeded.
- A deliberately failed HTTP detail refresh preserved the draft and displayed error feedback; explicit $102 retry succeeded.
- $102, $103 and then $104 were accepted. All four windows received four actual auction:changed frames and showed matching price/history while five-second polling and focus refresh were disabled. No document navigations occurred after opening the auction.
- The $104 bid was accepted at 14:16:40.539 UTC, before the 14:16:42.000 UTC deadline. A $105 attempt at deadline +250ms returned 409 and did not persist. All four bidding forms disabled without reload.
- PostgreSQL contains one sold outcome and one outbox event for this auction: winner user 3 (Heap & Sons), $104.00, four accepted bids. Finalization was recorded at 14:16:42.364 UTC; publication marked at 14:16:43.241 UTC. The HTTP finalOutcome matches the database result.
- Seller user 1 saw the real modal titled **Your auction sold**. Winner user 3 (bidder 2, bottom-left window) saw **You won the auction**, the winner/congratulations modal. Both show this auction title and $104.00. Both were left undismissed.
- Exactly two durable recipient records exist, seller 1 and winner 3, both undismissed. The seller/winner windows each received one notifications:changed WebSocket frame; losing bidder windows received zero and showed no modal.
- After socket-only bid and popup assertions, the test explicitly requested one HTTP reconciliation of final results in all four mounted pages. Thus final SOLD rendering is verified through HTTP catch-up, not claimed as an auction-close socket broadcast. Every page then displayed SOLD and four bids; zero browser page errors.
- Inspected saved seller and winner screenshots. Full evidence/screenshots: `/tmp/bidding-war-results-xrxXJN/`. Auction: http://127.0.0.1:5106/items/bidding-war-7ab8f1-e1cc5f1b-0901-44e9-bff8-2db32adbf8d6.
- After the verification-script update, `npm run typecheck`, `npm test` (103 passing) and `npm run build` passed. Regression logs: `/tmp/part6-headed-war-tests.log` and `/tmp/part6-headed-war-build.log`.

This headed run did not test no-bid outcomes, broker outages, duplicate replay or offline recovery; those are separate Slice 2 checks above.

# Slice 1 Verification

Verified on November 15, 2026. Slice 1 is ready for review; Slice 2 has not started.

## Tab identity follow-up

Changed initial identity to a random demo user per fresh tab, persisted in sessionStorage through navigation and reloads. The footer switcher changes only that tab, and the top-right header displays its active user's name. Updated GRILL.md, the identity ADR, glossary, README and slice plan to match.

- `npm test`: 22 PostgreSQL API cases and 5 new web identity tests passed.
- `npm run build`: strict TypeScript checks and production build passed.
- Chrome browser checks passed for independent initial selection in two tabs, ignoring the legacy localStorage selection, navigation/reload persistence, footer/header synchronization, isolation of switches between tabs, matching seller identity on the posting page, and the health page.
- Desktop and mobile screenshots were visually inspected; mobile has no horizontal overflow and shows the active user's full name and Sell link. No JavaScript page errors were observed. Screenshots are outside the repository at `/tmp/part2-tab-review`.
- No Slice 2 behavior was added.

## Automated checks

- `npm test`: passed all 22 real-PostgreSQL API integration cases. The inherited web test command reports no unit tests; browser verification covers the user flows below.
- `npm run build`: passed strict TypeScript checks for both apps and the Vite production build. Vite emits harmless annotation warnings from Zod dependencies.
- `npm start`: verified the documented command creates/uses the database, runs pending migrations, and starts API 3102 and web 5102.
- Normal application stop/start preserved a browser-posted auction, seller, integer-cent amount and exact UTC deadline. Pending migrations were not rerun.
- `npm run db:reset`: passed; restored six seed auctions, ten users and consistent seed bid histories, removed the browser-posted listing, and regenerated future seed deadlines. Normal startup was then verified again.

## Headed Google Chrome checks

- `/health` shows `OK · PostgreSQL connected`.
- Catalog shows six seed listings, supports text search, category filters and price sorting. All supported sort orders also have API integration coverage.
- Footer user selection survives reload; the selected user is attributed as seller when posting.
- Seed detail shows real bid history (the H100 has 22 rows) and preserved specifications.
- Posting validates whitespace-only title and past closing time, then redirects a successful listing to its detail page.
- New detail shows the correct seller, $100.25 starting price, no bids, category illustration and no empty specifications section. Reload preserves it.
- Desktop detail and mobile posting were visually inspected. The mobile form has no horizontal page overflow, and Sell remains visible and accessible.
- After reset, the removed listing shows a useful not-found message; the catalog, user list and health page remain functional.
- Browser checks observed no JavaScript page errors.

Screenshots and temporary browser scripts are outside the repository in `/tmp/part2-browser-review` and `/tmp/auction-playwright-check`.

## Remaining limits

Follow-up: corrected the search test's assumption that only seed listings match NVIDIA/GPUs. It now exercises additional uniquely named listings, category exclusion and literal percent matching, and cleans up only its own records. Removed a separate rejection test's dependence on another test's listing count. All 22 cases and the production build passed with a user-created NVIDIA RTX listing present; that listing was verified preserved.

Bid submission and five-second detail refresh ship in Slice 2. Demo identities are not authenticated; concurrent-bid protection remains explicitly deferred to Part 3.

`npm audit --omit=dev` reports 37 inherited OpenTelemetry dependency-tree findings (31 moderate, 5 high, 1 critical, including protobufjs). npm recommends major OpenTelemetry upgrades; these have not been applied as part of this slice. The audit output is retained at `/tmp/part2-audit.json`.

## Review steps

1. Open <http://localhost:5102> and try search, category filters and sort choices.
2. Inspect a seed listing's illustration, description, specifications and bid history.
3. Select a demo user in the footer; reload to confirm the selection persists.
4. Choose Sell, fill the required fields and publish with a future closing time. Confirm the detail page's seller, price and local deadline, then reload.
5. Check <http://localhost:5102/health>.

The application and one headed Chrome window are left running on the reset seed catalog. Stop here for user review before Slice 2.

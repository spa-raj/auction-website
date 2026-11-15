# Practice auction site

## Preserve

- Keep this a React + Vite app using JavaScript/JSX, plain CSS, and Lucide icons. Reuse CSS theme variables rather than adding a styling framework.
- Keep the scope to a homepage with six sample auctions and individual auction detail pages, with three themes selectable on the homepage.
- Preserve client-side navigation, responsive layouts, keyboard focus indicators, and browser-local persistence. Bidding remains a clearly labeled demo; do not introduce real payments or a backend unless requested.
- Edit source files, not generated `dist/` output. Keep npm's lockfile in sync with dependency changes.

## Commands

Run from `lot-and-found/`:

```sh
npm ci           # Install locked dependencies
npm run dev      # Start the development server
npm run build    # Check the production build
npm run preview  # Serve the built output after building
```

There are no configured test or lint scripts. Do not claim those checks ran or use the temporary Playwright script outside the repository as a project command.

## Browser verification

After changes affecting UI, navigation, themes, or auction behavior, use Playwright in a visible Chrome or Edge window against the URL printed by the running development server:

- With search and filters reset and watchlist mode off, verify exactly six auction cards appear.
- Select an auction and verify its detail URL and matching title; verify returning home, browser Back/Forward, and reloading the detail URL.
- Select all three themes and confirm each visibly changes the page and marks its control selected. Confirm the selection survives navigation and reload.
- Exercise any changed search, filter, sort, watchlist, or demo-bidding behavior. For bidding changes, check minimum-bid validation and the updated price/count.
- For layout changes, inspect desktop and narrow mobile widths for overflow and usable controls. Check keyboard focus, loaded images, and browser errors.

Use an isolated browser context for clean demo state. Report passes, problems, and any checks that could not be completed.

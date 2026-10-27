# Contributing

Thanks for helping. The most valuable contributions right now:

1. **Bug reports with a Diagnostics paste** (popup → ⚙ → Diagnostics). It contains tag names and attribute names only, never message text.
2. **Site profiles** and fixes to existing ones (`lib/sites.js`). Sites change their markup; keeping a profile current is a small PR.
3. **Tests** for anything that broke.

## Setup

```bash
npm install
npm test
npm run build
```

Load `dist/chromium` (Chrome: `chrome://extensions` → Developer mode → Load unpacked) or `dist/firefox/manifest.json` (Firefox: `about:debugging`) and reload your chat tabs after each build.

## Ground rules

- No runtime dependencies, no bundler, no network requests. This is part of the product's promise.
- Keep site-specific code in `lib/sites.js`. The rest must not know which site it is on.
- Never read or store message text outside the user's own highlights, and never include message text in diagnostics.
- Storage keys and the backup `format` tag are part of users' data. Do not rename them; add optional fields instead.
- Every behaviour change comes with a test: pure logic in `test/*.test.js`, interaction in `test/e2e/`.
- `npm test` and `npm run lint:firefox` must pass; run `npm run test:e2e` when you touch the content script or UI.

## Pull requests

Small and focused. Say what you ran. For UI changes, regenerate screenshots with `node scripts/media/shots.mjs` and include the before and after.

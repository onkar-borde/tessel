# Store listing

Copy-paste text and form answers for the Chrome Web Store, Microsoft Edge Add-ons and Firefox Add-ons (AMO).
Positioning: **Claude first**. ChatGPT works but is labelled beta until the signed-in layout issue is fixed.

## Assets

| What | File | Used by |
| --- | --- | --- |
| Package | `dist/tessel-chromium-<v>.zip` | Chrome, Edge, Opera |
| Package | `dist/tessel-firefox-<v>.zip` | Firefox |
| Store icon 128x128 | `icons/icon128.png` | Chrome, Edge, Firefox |
| Screenshots 1280x800 (upload in this order) | `docs/store/screenshot-1-highlights.png` … `screenshot-5-share.png` | all |
| Small promo tile 440x280 | `docs/store/promo-small-440x280.png` | Chrome (required), Edge |
| Marquee 1400x560 | `docs/store/promo-marquee-1400x560.png` | Chrome (optional) |
| Privacy policy URL | https://github.com/onkar-borde/tessel/blob/main/PRIVACY.md | all |
| Homepage / support URL | https://github.com/onkar-borde/tessel (issues: https://github.com/onkar-borde/tessel/issues) | all |

Regenerate the store images with `CHROME_PATH=/path/to/chrome node scripts/media/store.mjs`.

## Name
Tessel: Highlights & Comments for Claude (from `name` in `manifest.json`; the popup and Library show `short_name`, "Tessel")

## Summary (Chrome 132 chars max, Firefox 250 max)
Permanent highlights and comments for your Claude chats. Keyboard-first, searchable library, shareable export. No account, no servers.

## Category
- Chrome: Productivity → Workflow & Planning
- Edge: Productivity
- Firefox: Other (first choice), Productivity / Search Tools if offered

## Description

Your best AI answers scroll away. Tessel keeps the parts that matter.

Select any passage in a Claude chat and press a key. It stays highlighted, permanently, every time you come back. Add a comment, give your colours a meaning, and find everything again in one searchable library.

HIGHLIGHT WITH ONE KEY
• Select text and press 1–4 for four colours, H for the last colour, or C to add a comment.
• A small toolbar appears next to the selection if you prefer the mouse.
• Highlights survive reloads, long chats and streaming answers.

COMMENTS AND COLOURS WITH MEANING
• Attach a note to any highlight; click it later to edit, recolour, copy or delete.
• Rename the colours (Claim, Evidence, Term, To check…) and add up to four custom ones.

KEYBOARD-FIRST
• Alt+↓ / Alt+↑ jump between highlights in a chat.
• Alt+Shift+L opens a panel listing every highlight in reading order.

ONE SEARCHABLE LIBRARY
• Every annotated chat in one place, with stars, tags and colour filters.
• Full-text search across highlights, comments, titles and tags.
• Export a chat or a whole view as Markdown.

SHARE A CHAT
• Export a conversation as a single HTML page with your highlights and comments. Readers can toggle either.
• "Continue in Claude / ChatGPT" copies the conversation as a prompt and opens a new chat.

PRIVATE BY DESIGN
• No account, no servers, no analytics. The extension makes no network requests.
• Everything is stored locally in your browser, mirrored to a safety copy, and optionally backed up to files in your Downloads folder.

SUPPORTED SITES
• claude.ai: fully supported.
• chatgpt.com: beta. Works in most layouts; some signed-in pages are not supported yet.

Free and open source (MIT): https://github.com/onkar-borde/tessel
Bug reports and ideas are welcome on GitHub.

Tessel is an independent project, not affiliated with or endorsed by Anthropic or OpenAI.

## Chrome Web Store: Privacy practices tab

**Single purpose:** Let people highlight and comment on passages in their AI chats on claude.ai and chatgpt.com, keep them permanently on their device, and find, export or share them.

**Permission justifications**
- `storage`: saves the user's highlights, comments, tags and settings on the device.
- `unlimitedStorage`: long-time users can have thousands of highlights; this avoids hitting the default storage cap and losing data.
- `contextMenus`: adds a "Tessel" right-click menu on selected text (highlight in a colour, or highlight and add a comment).
- `alarms`: schedules the optional automatic backup a few minutes after a change.
- Host permission `https://claude.ai/*`, `https://chatgpt.com/*`: the content script that shows the selection toolbar, paints highlights and reads the selected text to anchor them. No other sites.
- `downloads` (optional, requested only when the user turns on automatic backups): writes backup files to a folder in Downloads.

**Remote code:** No, I am not using remote code. All code is in the package.

**Data usage:** tick **none** of the data-type boxes. The extension does not collect or transmit any user data; highlights stay in local browser storage.
Tick all three certifications (not sold to third parties; not used for unrelated purposes; not used for creditworthiness or lending).

## Firefox Add-ons (AMO)

- Add-on id: `tessel@onkar-borde.github.io` (set in `scripts/build.mjs`; never change it).
- Upload `dist/tessel-firefox-<v>.zip`, "On this site" (listed).
- Compatibility: tick **Firefox** only and untick **Firefox for Android**. The manifest keeps a `gecko_android` version so `web-ext lint` passes, but phones are not a target.
- Source code: answer **No**. The package is the plain, unminified, unbundled source, so no separate source upload is needed.
- Data collection: the manifest declares `data_collection_permissions: none`.
- License: MIT. Privacy policy: paste the text of `PRIVACY.md`.
- Reviewer notes: "No build step: the package is the repository's source files, copied as-is by scripts/build.mjs (only the manifest differs from the Chrome build). Open any claude.ai chat, select text and press 1 to test."

## Before each release
1. Bump `version` in `manifest.json` and `package.json`, add a `CHANGELOG.md` entry.
2. `npm test`, `npm run lint:firefox`, `CHROME_PATH=… npm run test:e2e`.
3. `npm run build`, then upload both zips and create a GitHub release with them.

# Changelog

## 0.8.1

- Store-ready packaging: permanent Firefox add-on id (`tessel@onkar-borde.github.io`), store name "Tessel: Highlights & Comments for Claude" (the extension itself still shows "Tessel").
- Store screenshots and promo images in `docs/store/`, rendered by `scripts/media/store.mjs`.

## 0.8.0

- Custom colours: add up to four of your own (Library, Settings), each with a name; quick keys 5 to 8. They work in the toolbar, comment box, panel, filters, Markdown, exports and backups.
- Fix: automatic backup failed on Firefox ("Access denied for URL data:"). Firefox now gets a blob: URL; Chrome keeps the data: URL.

## 0.7.1

- Exported pages: the "Continue in Claude/ChatGPT" buttons are now filled and labelled; the share-link button moved to the end of the chat with a one-line explanation.
- Exported pages: links inside the conversation are no longer shown in browser-default cyan.

## 0.7.0
- Share link: paste a link made with the site's Share button; exports get an "Open the chat" button.
- Continue in Claude / ChatGPT from the popup (move a chat between platforms).
- Renamed to Tessel.

## 0.6.x
- "Continue in ..." buttons in exported files; the prompt never mentions highlights.

## 0.5.0
- Data safety: unlimited storage, safety copy mirrored on every edit, optional automatic backup files in Downloads, restore banner on an empty Library.

## 0.4.x
- Library page, redesigned popup, highlights panel, colour names, undo, copy as Markdown, toolbar badge, diagnostics, backup v2, stars and tags.
- Chat identity read from the page, not only the address.

## 0.3.0
- ChatGPT support through per-site profiles.

## 0.2.0
- Cross-browser build (Chromium and Firefox from one codebase), keyboard shortcuts.

## 0.1.0
- First release: permanent highlights and comments on claude.ai, shareable HTML export.

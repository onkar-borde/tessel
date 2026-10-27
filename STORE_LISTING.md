# Store listing notes (fill the name in everywhere once chosen)

## Single purpose
Let people highlight and comment on passages in their AI chats, keep them permanently, and share them.

## Permission justifications
- `storage`, `unlimitedStorage`: save highlights and comments on the device without a size cap.
- Host access to claude.ai and chatgpt.com: the content script that shows the selection toolbar and paints highlights.
- `contextMenus`: right-click "Highlight" on selected text.
- `alarms`: schedule the optional automatic backup a couple of minutes after a change.
- `downloads` (optional, requested only when the user turns on automatic backups): write backup files to the Downloads folder.
- No remote code. No data collection. Data-collection declaration: none.

## Short description (132 characters max)
Permanent highlights and comments for your AI chats, with keyboard shortcuts, a searchable library and a shareable export.

## Checklist before submitting
1. Pick the name; update `manifest.json` (name, action title), the context-menu title in `background.js`, `lib/export.js` footer, icons, `BACKUP_DIR` in `lib/durability.js` and the Library text; re-render `video/render.mjs <Name>`.
2. Firefox: `GECKO_ID=<your-id> npm run build` and keep that id forever.
3. Chrome: upload the chromium zip; Edge accepts the same zip.
4. Screenshots: 1280x800, from the Library, the page toolbar and the shared export.
5. Host the privacy policy at a public URL (a GitHub Pages link to PRIVACY.md works).

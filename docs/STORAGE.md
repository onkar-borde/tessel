# Storage model

Everything lives in `storage.local` of the extension, in the browser profile on your device. Nothing is sent anywhere.

## Keys

| Key | Value |
| --- | --- |
| `chat:<id>` | A Claude chat record |
| `gpt:<id>` | A ChatGPT chat record |
| `settings` | `{ showHighlights, showComments, selectionToolbar, quickKeys, colorNames? }` |
| `snapshot` | Safety copy: `{ at, schema, chats: { <key>: record } }` |
| `autoBackup` | `true` when automatic backup files are on |
| `lastBackup`, `lastAutoBackup`, `lastAutoSig`, `backupError` | Backup bookkeeping |
| `schemaVersion` | Data layout version (currently 2) |
| `lastColor`, `panelOpen`, `pendingJump` | Small UI state |

Prefixes belong to site profiles (`keyPrefix` in `lib/sites.js`); they never change once released, because they are part of the stored data.

## Chat record

```json
{
  "id": "…", "title": "…", "url": "https://claude.ai/chat/…", "updated": 1790000000000,
  "starred": true, "tags": ["research"], "shareUrl": "https://claude.ai/share/…",
  "highlights": [
    { "id": "uuid", "color": "yellow|green|blue|pink", "exact": "selected text",
      "prefix": "≤40 chars before", "suffix": "≤40 chars after",
      "comment": "", "created": 0, "updated": 0 }
  ]
}
```

A chat with no highlights, no star, no tag and no share link is not stored.

## Rules that protect data

- Records change only through the user's actions (highlight, comment, delete, tag, star, restore).
- Restore **merges**: it adds highlights whose ids are not present and never overwrites or removes anything.
- Every write to a chat record is mirrored to `snapshot` right away (including deletions). At startup, if no chat record exists at all while the snapshot has some, they are restored. A chat the user deleted is deleted from the snapshot too, so it cannot come back.
- Updates never rewrite records; new fields are optional and old files keep loading. `schemaVersion` exists so a future change can migrate explicitly.

## Backup file (format `highlighter-for-claude`, version 2)

Plain JSON: `{ format, version: 2, exportedAt, settings?: { colorNames }, chats: { "<storage key>": { title, url, updated, starred, tags, shareUrl?, highlights } } }`. The format tag keeps its original name so that old backups restore. Version 1 files (Claude only, bare chat ids) are still read.

Automatic backups write `Downloads/Tessel backups/highlights-backup-latest.json` and `highlights-backup-<mon…sun>.json` (overwritten weekly), a couple of minutes after a change.

## Size

`unlimitedStorage` is requested, so there is no 10 MB cap. A highlight is a few hundred bytes; thousands of highlights are a few MB.

## Where the data is deleted

On uninstall or when the browser profile is removed. Clearing browsing history or cookies does not clear extension storage (this is how browsers treat extension data; the author has relied on it in Chrome and Firefox).

# Security

Tessel makes no network requests and keeps all data in the browser's extension storage. Exported HTML files are rebuilt from a sanitised copy of the page (allow-listed attributes, no scripts from the site).

To report a vulnerability, please use GitHub's private vulnerability reporting for this repository (Security tab → Report a vulnerability) instead of a public issue. Include steps to reproduce and the browser and version. You will get an answer within a few days.

Areas of particular interest: the export sanitiser (`lib/export.js`), the handling of pasted share links (`lib/sites.js`), and the content script's message handlers.

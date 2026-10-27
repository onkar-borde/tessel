# Publishing checklist

Build first: `npm run build` (or `node scripts/build.mjs`), which writes `dist/tessel-chromium-<v>.zip` and `dist/tessel-firefox-<v>.zip`.
Listing text, screenshots and the privacy statement are in `STORE_LISTING.md`, `docs/img/` and `PRIVACY.md`.

| Store | Cost | What you need | Upload |
|---|---|---|---|
| Chrome Web Store | one-time US$5 developer fee | a Google account, 2-step verification on | the Chromium zip; screenshots 1280x800; privacy policy URL (the repo's PRIVACY.md) |
| Microsoft Edge Add-ons | free | a Microsoft account | the same Chromium zip |
| Firefox (AMO) | free | a Mozilla account; a real add-on id | the Firefox zip, plus the source zip if asked; build with `GECKO_ID=you@yourdomain node scripts/build.mjs` |
| Opera, Brave, Vivaldi | free / none | Opera add-ons takes the Chromium zip; Brave and Vivaldi install from the Chrome store | |
| Safari | US$99 / year | Apple developer account, Xcode conversion | not covered here |

Review times: Chrome a few days (broad host access is not requested; only claude.ai and chatgpt.com), Firefox usually under a day to a few days.
Account creation, payment and the final Submit click are yours; nobody else can do them for you.

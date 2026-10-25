# Existing Chrome 0.1.1 reload and lookup verification

Client date/timezone: 2026-10-14 America/Los_Angeles. The user requested updating their currently installed Chrome extension to 0.1.1 while retaining vocabulary, then checking popup and selected-word translation.

The actual existing Chrome toolbar popup initially displayed 63 vocabulary words. Its details page identified Remember Me · Local, version 0.1.1, extension ID `blmbjchnpodecheenfmajdjfpmgimdcj`, loaded from the original `.output/chrome-mv3-feedback` directory. The files had already been built to 0.1.1 by the existing local watcher. The same installed entry was reloaded once to ensure Chrome used those current files; no second installation, directory change or new extension identity was introduced.

After the actual Reload action, Chrome showed “Reloaded”. The real toolbar popup opened normally and again displayed 63 words. There was no file-not-found page or stuck vocabulary loading state. This verifies visible vocabulary retention and unchanged installation identity; no private vocabulary export/snapshot or exhaustive byte-level comparison was performed.

In an ordinary synthetic local test page opened in this same everyday Chrome, selecting serendipity displayed Chinese translation attributed to Hermes, English meanings and US/UK IPA. The bookmark counter stayed 0. Escape closed the card. No save/right-click-record, delete, reset, import, export or account action was performed; real vocabulary was not used as a mutation fixture. The API address and login setup were not displayed.

The current installation remains the original local feedback variant at 0.1.1, using its existing updater. It was not silently replaced with the production ZIP or a different identity. The separately accepted production ZIP and its upgrade test remain documented in `2026-10-15-011-package-upgrade.md` (that record uses Asia/Shanghai).

`npm run local:status` passed actual process/HTTP/disk/toolchain health. No code or dependency change was needed for this installed-browser verification, so application suites were not rerun. Screenshot `installed-011-current-chrome.jpg` in this chat's artifacts shows only the synthetic test page and actual successful selection card, rather than private saved histories.

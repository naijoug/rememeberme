# Installed Chrome Forget button verification

Executed 2026-10-14 America/Los_Angeles in the user's everyday Chrome through native browser input. This checks the actual installed extension, separately from the component preview and mocked tests. The existing local feedback service passed `npm run local:status`; no watcher, extension identity or browser profile was replaced.

The temporary loopback HTML fixture contained only text and CSS, including the synthetic word `forgetbuttonfixture`. It had no Vue app, simulated card, vocabulary access or save logic. Double-clicking its word opened the installed extension's real closed-shadow card. Native screenshots and coordinate clicks exercised the card without exposing or modifying its closed shadow root.

| Action | Observed result |
| --- | --- |
| Select the synthetic word | Outline bookmark, count 0 |
| Click the counter five times in one input sequence | Solid bookmark, count 1, Records 1; card remained open |
| Click five more times after success | Count and Records remained 1 |
| Close using X, then select the same word again | Outline bookmark, persisted count 1, Records 1; opening itself did not increment |
| Click the reopened counter five times | Solid bookmark, count 2, Records 2 |
| Click five more times and expand Records | Count remained 2; exactly two history rows, #2 and #1, both from the loopback fixture |

The two history rows displayed local times 22:48:05 and 22:48:52 on 2026-10-14. Only this synthetic word was saved, with two records retained in the installed vocabulary. Existing vocabulary was not reset, deleted, imported or exported. The temporary page was removed and its test tab closed afterward.

Evidence in this chat's artifact directory:

- `forget-installed-before.png`: initial count 0.
- `forget-installed-first.png`: first success and repeated-click count 1.
- `forget-installed-reopened.png`: reopened outline bookmark with count 1.
- `forget-installed-final-full.png`: full fixture viewport with count 2 and two expanded history rows.
- `forget-installed-final.png`: final card and surrounding fixture text.

The invented word had no packaged IPA and the live lookup displayed unavailable/timeout feedback. This verifies counter/history behavior even when lookup is unavailable; it does not establish live dictionary availability. Persistence was fast enough that the loading spinner was not captured in a native screenshot; spinner rendering remains covered by the component regression, not claimed as independently observed in this installed-browser run. Browser restart and toolbar behavior were outside this check.

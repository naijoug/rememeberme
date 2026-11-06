# PR 7 native review candidate acceptance

Date: 2026-10-27 (America/Los_Angeles). All review data was synthetic, with UUID-guarded test stores. Updater and notifications are disabled by the existing test-store guard. No installed native distribution was replaced.

## Fixes and executed acceptance

The first light-mode SDK audit reported eight low/near-threshold contrast elements in the review sheet. Supporting text and button/link tint were adjusted for both themes. A later normal dark-mode audit exposed the shared definition-source label; its supporting color was also fixed. At accessibility text sizes, the title now scrolls with content and statistics/answers stack instead of squeezing into horizontal rows.

Largest-text contrast scans additionally produced invalid measurements for offscreen/partially scrolled text; exported attachments included blank element screenshots. Those failures are retained as diagnostic evidence, not counted as a pass. The final test separately performs full contrast/name/clipping audits with text visible in normal light and dark layouts, then verifies maximum accessibility text growth, hidden-answer semantics, scrolling, names and clipping. It does not claim a reliable offscreen contrast measurement at maximum size.

| Check | Result |
| --- | --- |
| RememberMeUI package tests after fixes | 39 passed |
| Final Mac candidate build | Passed |
| iPhone 17 Pro Simulator / iOS 26.5 original-sentence and accessibility cases | 2 passed, 0 failures |
| Actual Mac candidate | Cmd-Shift-R, Space, 3, hidden/revealed saved meaning, count 3 and Records 1 retained |
| Actual Mac appearance | System/light inspection and dark inspection; initial preference restored; final dark check used launch-only override |

The rebuilt final Mac candidate was checked again after the visual fixes, using a new test store. The app was then quit. Source URLs were not opened, account sign-in was not used, and test words were not added to real vocabulary.

Test cleanup removed this task's temporary Mac app registration from LaunchServices and re-registered the verified existing `/Users/guojian/Applications/Remember Me.app` (`com.rememberme.app.mac`, version 0.2.0). Both commands succeeded; the installed app retains the `rememberme:` URL claim. The installed binary and user data were not replaced.

Evidence: Mac final front: `../../.qa/verification/2026-10-27-pr7/mac-final-dark-front.png` (local-only), Mac revealed: `../../.qa/verification/2026-10-27-pr7/mac-final-dark-revealed.png` (local-only), Mac count/history: `../../.qa/verification/2026-10-27-pr7/mac-final-count-history.png` (local-only), simulator light front: `../../.qa/verification/2026-10-27-pr7/ios-review-front.png` (local-only), simulator dark contrast: `../../.qa/verification/2026-10-27-pr7/ios-dark-contrast.png` (local-only), maximum text: `../../.qa/verification/2026-10-27-pr7/ios-maximum-text.png` (local-only).

## Physical device and signing boundary

The paired device named naijoug is reachable and developer mode is enabled. The initial sandboxed signing query reported zero identities; an unsandboxed public-metadata query found valid identities. The exact matching `Apple Development: jian guo (LAHT37C8NQ)` certificate belongs to Honoululu Inc., Team `N7VU72TZB8`, and expires 2027-01-06. A partial-name query initially returned an older expired certificate; it was not used.

The workspace defaults to personal accounts. The user had agreed to using a personal signing identity, which is not treated as approval for this company team. A separate unsigned QA app was prepared at `/private/tmp/rememberme-pr7-device-candidate/Build/Products/Debug-iphoneos/RememberMeAcceptance.app`, bundle ID `com.naijoug.rememberme.releaseacceptance`, without the Share target or App Group. It cannot replace the installed app. The user explicitly chose to defer company-team signing and continue only with a personal team. No company certificate has been used. A personal Team ID and usable signing identity remain unverified; the unsigned QA candidate is retained for that path.

Physical iPhone execution and native installer distribution are not marked passed. VoiceOver Utility was inspected but its control response was very slow; actual VoiceOver navigation/speech was not exercised and no VoiceOver/AppleScript-control settings were changed. SDK accessibility checks and Mac accessibility-tree inspection are not substituted for a listening test.

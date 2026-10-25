# Word learning checkpoint (2026-10-14)

The shared native learning sheet now has a direct **Learn words** toolbar entry
and Command-Shift-R shortcut on Mac. Options → Today’s review and reminder
routing retain the same entry point. Existing review-v1 persistence, the daily
20-new-word limit and account outbox contracts are reused without schema changes.

Cards hide meanings/examples and notes until revealed. The sheet displays the
full due count, remaining new-word allowance, this session’s committed answer
totals and the last answered word’s next due time. Same-card changes reset
revelation; conflicts do not increase totals. Loads reject superseded replies
and offer retry on failure. Session totals are transient; review schedules and
admission limits remain durable.

## Automated checks

- The RememberMeUI SwiftPM suite passed **24 tests**, including four new learning
  model tests, using disposable SQLite stores and no live accounts/providers.
- The new tests cover reveal-before-answer, committed-only totals/receipts,
  count/history preservation, admission persistence after reopening, a competing
  answer conflict, an edit to the same card, and a 55-due-word queue refilled in
  bounded batches of 50.
- `RememberMeMac` built successfully for macOS/arm64 with signing disabled and
  DerivedData at `/tmp/rememberme-learning-mac-build`.
- `RememberMeiOS` built successfully for the generic iOS Simulator destination
  with signing disabled and DerivedData at `/tmp/rememberme-learning-ios-build`.
- The focused `testManualEditAndReviewDoNotRewriteEncounterOrForgottenCount`
  UI regression passed on iPad Pro 11-inch (M5), iOS 26.5 Simulator. The result
  bundle reports exactly **1 passed / 0 failed / 0 skipped**. It exercised the
  direct Learn words button, hidden/revealed meaning, Remembered answer,
  session summary and unchanged forgotten count. This is simulator evidence,
  not an installed physical-device check.
- `git diff --check` passed.

The SwiftPM command ran from `Packages/RememberMeUI`:

```sh
env CLANG_MODULE_CACHE_PATH=/tmp/rememberme-learning-modules \
  SWIFTPM_MODULECACHE_OVERRIDE=/tmp/rememberme-learning-modules \
  swift test --disable-sandbox --scratch-path /tmp/rememberme-learning-ui-build \
  --cache-path /tmp/rememberme-learning-cache
```

The focused simulator command ran from `frontend/apple`:

```sh
xcodebuild -quiet -project RememberMe.xcodeproj -scheme RememberMeiOS \
  -destination 'platform=iOS Simulator,id=52DE7123-D5D7-4DDE-B2F1-7E2E5D7D1B64,arch=arm64' \
  -derivedDataPath /tmp/rememberme-learning-ios-build \
  -resultBundlePath /tmp/rememberme-learning-ios-ui.xcresult \
  -only-testing:RememberMeiOSUITests/VocabularyUITests/testManualEditAndReviewDoNotRewriteEncounterOrForgottenCount \
  CODE_SIGNING_ALLOWED=NO test
```

The initial Xcode build was blocked by sandbox writes to Xcode/SwiftPM caches.
The normal local build passed after allowing those cache accesses; neither build
used a signing team, installed production data or contacted an account backend.

## Actual Mac UI observations

Launched the newly built app with a unique `ui-UUID` test-store argument, which
opened an empty disposable vocabulary. Added the synthetic word `synthetic`
with manual meaning `Literal learning fixture` and notes `Literal notes fixture`.
No lookup/login/notification request was made.

Observed through native accessibility state and screenshots:

- The toolbar exposed Learn words. Opening it showed the synthetic word with
  both the meaning and notes hidden and an allowance of 20 new words.
- Space revealed the exact saved meaning and notes, alongside the three answers.
- Pressing 3 submitted Remembered. The completed sheet showed one answered,
  Forgot 0 / Fuzzy 0 / Remembered 1, an allowance of 19, and next review on
  October 15 at the corresponding local answer time.
- Closing the sheet returned to Forgotten: Not recorded and Records (0).
- Command-Shift-R reopened the sheet with no due card, allowance still 19 and no
  previous session summary.

This is actual local Mac UI evidence for the synthetic fixture, distinct from
model tests. It does not verify the user’s previously installed package,
VoiceOver, notification delivery, hosted login, or extension-to-Mac sync. Public
account synchronization remains subject to the separately recorded deployment
and installed-client acceptance limitations.

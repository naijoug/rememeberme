# Original-sentence review first-round verification

Date: 2026-10-26 (America/Los_Angeles). Base: `ca60d0e` plus this implementation. The app/repository model, review-v1 algorithm, forgotten count, encounter persistence and sync ownership remain unchanged.

## Implemented behavior

`ReviewCardContent` derives a presentation from at most 20 recent encounters for the active card, using case-insensitive literal whole-term matching. It keeps the first matching encounter's source and saved meaning; missing historical meaning falls back to the current meaning, and absent context falls back to the ordinary word card. Long display text is bounded around the match, without altering saved history. Unsafe source URLs are not linked.

`ReviewModel` guards queue/history replies by load generation, clears pending presentation on disappearance, hides answers when the source changes, and lets history failures recover through ordinary-card review or explicit retry. The existing root owner-change handler dismisses the review view. No API request, storage migration, export change or additional encounter is needed.

## Executed checks

| Check | Result |
| --- | --- |
| RememberMeUI `swift test` with disposable scratch/module caches | 39 tests passed |
| Unsigned generic iOS Simulator build | Passed |
| Targeted `testOriginalSentenceReviewHidesMeaningUntilRevealAndPreservesCount` | Passed: 1 test, 0 failures |
| Target | iPad Pro 13-inch (M5), iOS 26.5 Simulator |

Package tests cover the 20-record bound, literal repeated/case/apostrophe/hyphen matching, missing meanings, unsafe URLs, long contexts, history failure, late/closed-view replies, changed-source concealment and existing count/history/review invariants. The targeted UI test uses a fresh UUID test store under the existing DEBUG-only test mechanism; it cannot seed a normal store or Release build.

The UI test observes the original sentence before reveal, verifies neither saved nor current meaning is present in the accessibility tree before reveal, shows the saved encounter meaning after reveal, submits Remembered, and verifies forgotten count 3 and one history record remain unchanged. It never opens the source URL or signs in.

- [Before reveal](assets/2026-10-26-original-sentence-review/front.png).
- [After reveal](assets/2026-10-26-original-sentence-review/revealed.png).

The first Swift command was issued outside the package and exited before running tests; rerunning in RememberMeUI passed. Restricted Xcode initially failed on simulator/cache access; the same unsigned build and targeted test passed with access. No source workaround or security-setting change was made for these environment failures.

## Commands and limits

```sh
# In frontend/apple/Packages/RememberMeUI
CLANG_MODULE_CACHE_PATH=/private/tmp/rememberme-round1-modules \
SWIFTPM_MODULECACHE_OVERRIDE=/private/tmp/rememberme-round1-modules \
swift test --disable-sandbox --scratch-path /private/tmp/rememberme-round1-ui \
  --cache-path /private/tmp/rememberme-round1-cache

# In frontend/apple
xcodebuild -project RememberMe.xcodeproj -scheme RememberMeiOS \
  -destination 'platform=iOS Simulator,id=2876EDEA-CE26-4994-B657-EC73AD13D415' \
  -derivedDataPath /private/tmp/rememberme-round1-ios \
  -only-testing:RememberMeiOSUITests/VocabularyUITests/testOriginalSentenceReviewHidesMeaningUntilRevealAndPreservesCount \
  CODE_SIGNING_ALLOWED=NO test
```

The screenshots were visually inspected after exporting test attachments. Mac installation/keyboard routing, VoiceOver speech, signed iPhone, dark mode/dynamic type, physical-device small-screen behavior and formal distribution were not verified. No installed Mac app was replaced. The first-round implementation and local tests are complete; those remaining release checks stay open in the [implementation plan](../../../../docs/read-frog-adoption-plan.md).

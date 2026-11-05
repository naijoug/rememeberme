# Installed browser / macOS sync recheck — 2026-10-26

## Observed initial state

- Actual Chrome extension `blmbjchnpodecheenfmajdjfpmgimdcj`: GitHub `@naijoug`, account vocabulary selected, zero account words, **Cloud sync off / Paused**. Six pre-sign-in device words were separate.
- Read-only Mac database: same account/origin, sync enabled, phase ready, cursor 5, no pending/conflicting operations and zero active account words.
- Read-only production database: Remember Me Browser and Remember Me Mac belong to the same naijoug user, both unrevoked with active refresh sessions. Zero active cloud words, last change sequence 5.
- The native macOS UI control connection failed with a closed-pipe error. Chrome native UI and browser-tab control remained usable. Explicit permission to use AppleScript/accessibility as a Mac UI fallback was requested and is pending.

## Executed actions and results

1. Enabled Cloud sync through the actual Chrome Settings switch. It changed to Up to date; the six device words were not copied or imported.
2. Verified `codexsyncprobe` was not an active account word. Created a temporary plain HTML fixture and used the installed extension's normal selection/record control.
3. One record click showed count 1 and Records 1. Production read-only verification confirmed a new entry, count 1, version 2 and exactly one encounter. No direct database/API write was used to seed the test.
4. Mac still had cursor 5 and no test entry. This does not verify a failed transfer: the expected foreground/manual pull could not be driven through the unavailable Mac UI tool.
5. Deleted only the temporary entry through Chrome's normal Delete confirmation. Production confirmed its tombstone (version 3), latest sequence 8 and zero active account words. The final Chrome UI showed zero account words, Cloud sync on, Up to date, and the original six device words.
6. Closed the agent-created test tab and removed the temporary HTML fixture. No test word remains active.

The synthetic token intentionally has no dictionary entry. Its lookup failure was not used as evidence about synchronization; recording persisted and uploaded independently of lookup.

## Initial result (superseded by the completed round trip below)

Chrome → cloud creation and deletion passed. The Chrome pause was found and corrected. Mac identity/session and baseline configuration match, but **fresh Chrome → Mac and Mac → Chrome propagation are not yet verified in this recheck**. Finish the foreground pull, a Mac-origin change and cleanup after native UI access is restored or the requested AppleScript fallback is explicitly authorized. Earlier acceptance records remain historical evidence and do not substitute for this missing round trip.

Evidence:

- [Chrome record count 1](assets/2026-10-26-sync-recheck/chrome-sync-count1.png)
- [Final Chrome sync enabled, empty account, six device words retained](assets/2026-10-26-sync-recheck/chrome-sync-enabled-clean.png)


## Completed round trip after explicit AppleScript authorization

The user explicitly authorized AppleScript/accessibility operation of the normal
Mac and Chrome interfaces for `codexsyncprobe`. No credential extraction or direct
production writes were used. Read-only Mac/production SQLite queries corroborated
UI results; all mutations went through normal product controls.

The earlier test entry was already deleted. This round created a new lifecycle,
`9EF29621-90C0-4EC9-9325-09CA27C23A5D`, under the same naijoug account.

| Normal product action | Observed result |
| --- | --- |
| Mac Add word saves the new temporary token | Cloud version 1; Chrome lists the word as Not recorded, Records 0 |
| Chrome selection card records once | Cloud version 2, count 1, one encounter |
| Mac Account → Sync now | Mac detail shows Forgotten 1 / Records (1); its active repository confirms the same |
| Mac Record once forgotten | Cloud version 3, count 2, two encounters; Chrome detail shows Forgotten 2 times / Records 2 |
| Mac Reset count, then Chrome Sync now | Both clients show count 0 while retaining two records; cloud version 4 |
| Mac Delete word → normal Delete confirmation | Cloud version 5 tombstone, count 0, two retained server encounters; zero active account words |
| Chrome's open popup refreshes after deletion | Test entry disappears without another explicit sync action; Settings shows account words 0, sync on and Up to date |

Final checks: Mac account vocabulary has zero active words, sync enabled, phase
ready and only confirmed operations (no pending/conflicting operations). Chrome
has zero account words, sync on, Up to date, and the original six separate device
words. The temporary HTML page and agent-created tab were removed.

The Mac pull in this round was explicitly triggered with Sync now. Foreground
activation alone did not produce an immediately observed refresh during the UI
automation attempts, so immediate foreground/background refresh is not claimed.
The confirmed result is actual bidirectional data synchronization through the
installed clients, including count/history preservation and deletion propagation.
The initial Chrome pause was corrected and left enabled.

The nonexistent synthetic token has no dictionary definition. No successful
online lookup or definition-edit propagation is claimed. Accessibility value
assignment to the editor's optional fields did not commit them, so those fields
were omitted from the assertions; the persisted test word had an empty definition
and notes. Real dictionary content and existing vocabulary were not used as fixtures.

Additional evidence:

- [Mac receives the Chrome encounter](assets/2026-10-26-sync-recheck/mac-sync-received-one.png)
- [Chrome receives the second Mac encounter](assets/2026-10-26-sync-recheck/chrome-sync-received-two.png)
- [Mac reset preserves history](assets/2026-10-26-sync-recheck/mac-reset-keeps-history.png)
- [Chrome reset preserves history](assets/2026-10-26-sync-recheck/chrome-reset-keeps-history.png)
- [Final Chrome cleanup and retained device words](assets/2026-10-26-sync-recheck/chrome-sync-final-clean.png)
- [Final Mac cleanup](assets/2026-10-26-sync-recheck/mac-sync-final-clean.png)

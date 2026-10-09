# 2026-10-09 import recovery and bounded copying

Work began on October 8 and completed these checks after midnight on October 9, Asia/Shanghai. This record extends the previous local-feature record; the full Apple implementation goal remains active.

Implemented durable private import plans, restart discovery and explicit Resume/Discard/Finish cleanup UI. Existing-store copying saves bounded row chunks with its cursor. Staging reuses the frozen plan and operation IDs, rejects changed chunks/revisions, and never exposes partial results. Cancellation cleanup and old-generation pruning are bounded; active state, latest recovery point and in-flight candidates/sources stay protected. Original user-selected source files are not modified. Private plans can include sensitive history/operations and remain local; they are excluded from vocabulary backups.

Large plan storage uses per-entry JSON lines with SHA-256 integrity and explicit operation order. Older full-JSON plans remain supported. Normal startup only discovers jobs and does not resume or publish automatically. This changes receipt payloads, not the Core Data model version.

## Verification

- 50 core Swift Testing tests passed, including 10 new recovery/compatibility/pruning cases against disposable SQLite stores.
- 7 presentation-model tests passed, including resumed import discovery and stale-plan discard without overwriting newer data.
- The iOS Simulator recovery flow passed with the existing regression flows: terminate/relaunch during a prepared import, Resume, verify the imported count exactly once and no invented history. Simulator test results do not establish physical-device or Mac automation acceptance.
- Independent probe processes exited during copy, mid-staging and ready-before-publication; another process resumed from disk. Each retained the original 1 word/1 operation before publication and ended with exactly 3 words/3 operations. Existing publication and sharing-recovery checks also passed.
- Mac compilation passed. Shared ID/normalization fixtures were retained; the hexadecimal encoding optimization did not change digest/key bytes or cross-language identity.

Commands are in [testing](../testing.md). The UI fixture path is guarded by DEBUG, a test-store argument and a unique `ui-…` temporary directory; it cannot seed a normal Application Support vocabulary. No production vocabulary, account, live provider or real device was used.

## Performance evidence

On the development Apple Silicon Mac, macOS 26.5.2 / Xcode 26.6 / Swift 6.3.3, using a debug probe and 10,000 synthetic entries/100,000 encounters:

| Metric | Final observed result | Existing budget |
| --- | --- | --- |
| Generate/preview/plan/stage/publish | 83.44 seconds | <= 90 seconds |
| Peak process RSS across import and append | 472,432,640 bytes (450.5 MiB) | <= 512 MiB |
| First-page search p95, 30 queries | 12.98 ms | <= 300 ms |
| Append one word through existing-store copy | 11.19 seconds / 241 copy chunks | Recorded baseline; no prior append-time budget |

An initial full-plan JSON encoding attempt measured 878,952,448 bytes and failed the memory/time budgets. Streaming lowered memory to 334,544,896 bytes in the next attempt, but its 95.06-second initial import still failed the time budget. Per-chunk operation checks and byte-based hexadecimal encoding then produced the final passing values above. Neither failed attempt is counted as acceptance; budgets were not loosened to conceal them.

These values cover one specific debug fixture and a small append to a large existing store. Full 10,000-entry merge/backup restore, a single unusually large history, release builds, UI scrolling and physical iPhone memory remain unverified. Mac UI automation, signed App Groups/actual sharing, notification delivery, account authentication and unified backend sync retain their previous pending status.

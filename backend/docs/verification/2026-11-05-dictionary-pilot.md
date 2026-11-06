# Independent dictionary pilot — 2026-11-05

## Result

Implemented the independent SQLite dictionary and batch-generation CLI, then ran
the complete 1,000-word pilot against the verified personal server's private
Magpie gateway. Build: `e49d8bd831cac4d6caa719c3`.

- 1,000 unique entries and 2,839 senses generated and structurally validated.
- 999 unapproved drafts; one explicitly rejected entry; zero approved entries.
- No pending, generating or terminal generation-failure jobs remain.
- 1,022 attempts: 1,000 successes, 17 invalid/truncated completions, three
  invalid entries and two explicitly cancelled requests when changing concurrency.
- Actual response headers identified `deepseek/deepseek-flash` / `deepseek` on
  1,020 attempts. The two cancelled requests have unknown model/usage metadata.
- Reported usage: 287,071 input tokens and 713,411 output tokens; the two
  cancelled calls may have incurred unreported usage. No billing-total claim.
- Conservative output reservations: 1,635,200 of 1,920,000 tokens; request limit
  1,200 and per-word attempt limit three were respected.

Generation ran on November 5 in `America/Los_Angeles` (timestamps and hashes in
the [structured receipt](2026-11-05-dictionary-pilot.json)). This is a common-word
editorial selection, not an official exam inventory or measured frequency list.

## Quality boundary

Nine purposive sample entries were inspected: `a`, `the`, `they`, `be`, `run`,
`person`, `body`, `bread`, and `device`. The alphabet sense of `a` incorrectly
claimed that `cat` begins with `a`. That exact content hash was rejected through
the CLI, with the original entry and review reason retained. The other entries
remain drafts; this small, non-random sample does not establish an accuracy rate
or substitute for complete semantic review. No dictionary release was published.

## Verification

- Pinned local Node `22.22.3`; actual generation host Node `22.23.2` (within the
  existing package's supported Node 22 range).
- `npm ci` succeeded after repairing missing optional peer lockfile entries.
  Existing dependency versions and platform metadata were preserved.
- `npm test`: 18 files, 115 passing tests, including 16 dictionary tests.
  The loopback tests initially hit sandbox `EPERM`, then passed with localhost
  access. These tests use disposable databases and mocked providers.
- `npm run typecheck`, `npm run dict:build`, and `npm run build` passed.
- Dictionary tests cover protected database refusal, idempotent initialization,
  resume, worker leases, interrupted-call accounting, durable budgets, retries,
  concurrency caps, schema and response boundaries, timeouts, history provenance,
  hash-bound reviews, publication gates and verified backup recovery.
- A completed live build was run again: zero new attempts, total remaining 1,022.
- `VACUUM INTO` backup passed integrity, foreign-key and application-ID checks.
  Its downloaded SHA-256 exactly matched the server backup.
- Local full-data audit confirmed all 1,000 selected words in order, all content
  hashes and sense IDs, schema validity, attempt limits, no active attempts,
  released worker lease, and the rejection audit. JSONL contains 1,000 records.

The backup hash and local working-database hash differ because opening the
working copy enables WAL; the original downloaded backup is retained unchanged.
Both artifacts' hashes are recorded. No browser or Apple acceptance was claimed.

## Artifacts and recovery

Local generated data is Git-ignored:

- `backend/data/dictionary/pilot-1000.sqlite`: usable working database.
- `backend/data/dictionary/pilot-1000.backup.sqlite`: verified original backup.
- `backend/data/dictionary/pilot-1000.review.jsonl`: entries with content hashes,
  provenance and review status; not an approved release.

The server retains the independent database and CLI under
`/home/ubuntu/.local/share/rememberme-dictionary/pilot-20261105/`.
That server database is the pilot master. The local database is an independent
snapshot for inspection; local review changes do not synchronize back to the
server. Apply authoritative review decisions to the master, or explicitly choose
a replacement master before editing both copies.
This pilot used the existing private configuration only for the model credential;
it did not change gateway routing, live API deployment, service listeners,
account/sync data, or client lookup behavior. No credentials were copied locally.

Source files and commands are described in the [operating guide](../dictionary-build.md).
Resume/review the recorded build rather than initializing a duplicate to bypass
limits. Complete semantic review and correction before publishing or integrating
the new source into clients.

## Verified documentation and installation discrepancies

1. `docs/architecture.md` described `local:translationCache`, 500 entries and a
   single seven-day TTL. `services/translation-cache.ts` actually uses IndexedDB,
   10,000 entries, source-dependent freshness and a 30-day maximum age. The
   architecture diagram/table now follow the code and retain the legacy store
   only as a migration source.
2. The same architecture document described Hermes as the current sole primary
   translation path. `backend/src/node-runtime.ts` selects the provider by config
   and supports Magpie as well as legacy Hermes. Current-provider descriptions
   and the diagram were corrected; dated Hermes verification evidence remains.
3. `backend/README.md` instructed `npm ci`, but the checked-in lockfile lacked
   optional peer packages required by the pinned toolchain's resolver. Added the
   missing lockfile entries, kept existing versions, and reran standard `npm ci`
   successfully. No new direct runtime dependency was added.

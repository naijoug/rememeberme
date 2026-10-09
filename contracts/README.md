# Shared contracts

These files specify the Apple local model and unified wire protocol. Current browser-extension storage/messages remain unchanged. Implementation and deployment evidence must be read separately from schema files.

Update 2026-10-09: the [wire API v1](api-v1.md) has a local Worker/D1 implementation, schemas and shared Swift/TypeScript fixtures. Native account ownership, selection and explicit sync controls are connected. Real native HTTP integration now passes against local workerd/D1 with separate synthetic device processes; the service is not deployed and hosted/signed-device acceptance remains unfinished. The extension has no cloud sender. Local operations and server wire requests remain distinct; explicit duplicate lifecycles and retained/timestamp/version-bound history are implemented. See [ownership evidence](../frontend/apple/docs/verification/2026-10-09-account-ownership.md) and [native HTTP evidence](../frontend/apple/docs/verification/2026-10-09-native-http.md).

- `legacy-word-entry.schema.json` describes the current permissive JSON import shape. Optional legacy definition fields and unknown fields remain unrestricted. The executable validator also checks finite numbers and ECMAScript trimming; generic schema validation alone cannot prove these language-specific conditions.
- `backup-v1.schema.json` describes complete local backups, including tombstones and source identity. Missing optional count is accepted as unknown on read; writers must not infer it from history. Unknown count and explicit zero are distinct. Credentials, sessions, operation queues and sync checkpoints are excluded.
- `operations-v1.schema.json` describes durable logical operations. Its payload is still subject to operation-specific runtime validation. It is not a published HTTP endpoint schema; the backend phase must define and test the request/response envelopes before enabling sync.
- `fixtures/` contains synthetic data only. Example URLs use `example.test`. `legacy-expected.json` freezes the byte digest and identity results independently computed by Node's crypto/JSON implementation.

Identity uses SHA-256 over the selected file's **exact original bytes**, including whitespace. ID inputs are compact JSON arrays encoded as UTF-8 without escaped `/`, with no Unicode normalization. Prefixes are `entry:`, `encounter:` and `seed:` followed by lowercase hexadecimal SHA-256. Array positions are zero-based. Each intentional legacy merge uses a new batch identity; retrying that batch retains it.

Old finite nonnegative numbers use binary64 values, including fractions and large values. Time fields are Unix milliseconds. Legacy text normalization matches JavaScript `trim().toLowerCase()` and normalized-key identity compares UTF-8 bytes. Review-v1 uses elapsed 24-hour intervals; local dates affect admission limits/reminders, not interval duration.

Backup-v1 uses the same trim/lowercase key rule for all four entry types. Internal phrase whitespace is retained; display spelling/capitalization and type remain independent of the key. Changing this rule requires a new versioned normalization contract and migration; do not silently collapse whitespace or Unicode forms. Runtime backup validation checks the stored key against its word.

New entity/review version tokens are integers from 0 through 9,007,199,254,740,991; mutation rejects an exhausted token instead of overflowing. This limit does not narrow legacy count/time values. Backup versions are provenance for conflicts, not local/server CAS values to replay: newly restored IDs start a local lifecycle version, and replacing existing IDs advances their local tokens. Optional `reviewRevision` keeps CAS monotonic even if a restore clears the studied state. Confirmed sharing preserves `captureOrigin` in full backups; legacy export omits it without inventing history.

Run the reference checks from the repository root using the extension's `.nvmrc` Node version:

```sh
node --experimental-strip-types contracts/reference.ts
```

The runner imports the extension's actual `isDefinition` validator rather than redefining optional definition constraints. Swift tests consume the same fixtures. See [Apple verification](../frontend/apple/docs/testing.md) for the disk and separate-process checks.

Native epoch recovery now stages confirmed choices with new server bases/checkpoint/requests, performs an online recheck and publishes atomically while retaining the old private generation. Missing lifecycle input stays a conflict or becomes an explicitly chosen separate lifecycle. Current account-day admission IDs reconcile review quota without replaying historical answers. Local epochOrphan records are conflicts, not HTTP operations. See [epoch recovery evidence](../frontend/apple/docs/verification/2026-10-09-epoch-recovery.md).

Account backup merge now uses a frozen native restoreAccount candidate with current server bases/version expectations, explicit selected fields and new logical request IDs. Offline previews cannot confirm; old backup queues/checkpoints are rejected. Existing active queues are retained independently, and history/review audits do not advance count/schedule/admission state. See [account backup evidence](../frontend/apple/docs/verification/2026-10-09-account-backup.md).

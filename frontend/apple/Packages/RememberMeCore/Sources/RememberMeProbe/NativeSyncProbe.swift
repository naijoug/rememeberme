import Foundation
import RememberMeCore

private struct NativeFixture: Codable {
    var format: String
    var origin: String
    var credentials: APICredentials
}
private final class FixtureVault: CredentialVault, @unchecked Sendable {
    private let lock = NSLock()
    private let file: URL
    init(file: URL, initial: APICredentials) throws {
        self.file = file
        if !FileManager.default.fileExists(atPath: file.path) { try save(initial) }
    }
    func load() throws -> APICredentials? {
        try lock.withLock {
            guard FileManager.default.fileExists(atPath: file.path) else { return nil }
            return try JSONDecoder().decode(APICredentials.self, from: Data(contentsOf: file))
        }
    }
    func save(_ value: APICredentials) throws {
        try lock.withLock {
            try value.validate(); try JSONValue.encoder().encode(value).write(to: file, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        }
    }
    func clear() throws { try lock.withLock { if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) } } }
}

/// Explicit executable-only integration harness. Normal apps have no fixture
/// credentials, filesystem vault or loopback setting. No test HTTP route exists.
enum NativeSyncProbe {
    static func run(_ arguments: [String]) async throws {
        guard arguments.count == 2 else { throw ClientError.invalidData("native-sync FIXTURE_CONFIG ACTION") }
        let file = URL(fileURLWithPath: arguments[0]).standardizedFileURL
        let directory = file.deletingLastPathComponent(), root = directory.deletingLastPathComponent()
        guard root.lastPathComponent.hasPrefix("rememberme-native-sync-"),
              FileManager.default.fileExists(atPath: root.appendingPathComponent("synthetic-fixture-only").path) else {
            throw ClientError.invalidData("dedicated synthetic fixture directory required")
        }
        let fixture = try JSONDecoder().decode(NativeFixture.self, from: Data(contentsOf: file))
        guard fixture.format == "rememberme-native-sync-fixture", fixture.credentials.userId.hasPrefix("synthetic-"),
              fixture.credentials.deviceId.hasPrefix("synthetic-") else { throw ClientError.invalidData("synthetic identity required") }
        let origin = try APIOrigin(fixture.origin, allowLoopbackHTTP: true)
        guard origin.url.scheme == "http", origin.url.host == "127.0.0.1" else { throw ClientError.invalidData("fixture API must use IPv4 loopback") }
        let vault = try FixtureVault(file: directory.appendingPathComponent("credentials.json"), initial: fixture.credentials)
        let session = NativeSession(origin: origin, vault: vault)
        let identity = ConnectedIdentity(origin: origin.string, userId: fixture.credentials.userId, deviceId: fixture.credentials.deviceId)
        let repository = try LocalRepository(url: directory.appendingPathComponent("vocabulary.sqlite"), owner: SyncConfiguration.owner(for: identity))
        let api = NativeSyncAPI(client: AuthenticatedAPIClient(session: session))
        // Recovery commands advance only the coordinator's test retry clock,
        // avoiding sleeps while preserving actual HTTP/authentication clocks.
        let coordinator = SyncCoordinator(repository: repository, api: api, clock: { Date().timeIntervalSince1970 * 1000 + 120_000 })
        let action = arguments[1]
        if ["source-enable", "source-backfill", "source-clear", "source-clear-loss-exit", "source-freeze"].contains(action) {
            guard let configuration = try await repository.syncConfiguration(), let epoch = configuration.epoch else { throw ClientError.invalidData("source fixture sync configuration") }
            if action == "source-enable" {
                try await api.setSourcePrivacy(.init(context: true, urls: true), timezone: "UTC")
                try await repository.initializeSyncEpoch(api.account())
                try await repository.configureSync(identity: identity, enabled: false, privacy: .init(context: true, urls: true))
            } else if action == "source-backfill" {
                let entry = try await sharedEntry(repository)
                for offset in stride(from: 0, to: entry.history.count, by: 25) { _ = try await repository.backfillSources(entryId: entry.id, offset: offset) }
            } else if action == "source-freeze" {
                let entry = try await sharedEntry(repository)
                try await repository.configureSync(identity: identity, enabled: true, privacy: configuration.privacy)
                _ = try await repository.record(entry.id, context: "Synthetic frozen source", url: "https://example.test/frozen",
                    definition: entry.definition, timestamp: 3000, eventID: "synthetic-frozen-source")
                guard try await repository.nextSyncWire() != nil else { throw ClientError.invalidData("source request not frozen") }
            } else {
                let request = try await repository.beginSourceRemoval()
                do {
                    let revision = try await api.clearSources(request, epoch: epoch)
                    try await repository.finishSourceRemoval(request, revision: revision)
                } catch is URLError {
                    guard action == "source-clear-loss-exit" else { throw ClientError.invalidData("unexpected source reply loss") }
                    _exit(0)
                }
            }
            try await report(repository); try await repository.close(); return
        }
        if action == "backup-save" {
            try JSONValue.encoder().encode(try await repository.backup()).write(to: directory.appendingPathComponent("account-backup.json"), options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: directory.appendingPathComponent("account-backup.json").path)
            try await report(repository); try await repository.close(); return
        }
        if action == "backup-ready-exit" {
            try await repository.configureSync(identity: identity, enabled: false, privacy: try await repository.syncConfiguration()?.privacy ?? SyncPrivacy())
            let snapshot = try await ServerSnapshotLoader(api: api).download()
            try await repository.initializeSyncEpoch(snapshot.account)
            let entry = try await sharedEntry(repository)
            let preview = try await repository.previewAccountBackup(Data(contentsOf: directory.appendingPathComponent("account-backup.json")), snapshot: snapshot,
                choices: [entry.id: .init(.useBackup, fields: [.count])])
            guard preview.plan.conflicts.isEmpty, preview.plan.operations.count == 1 else { throw ClientError.invalidData("synthetic account restore preview") }
            try await repository.begin(preview.plan); try await repository.stageImportToReady(preview.id)
            _exit(0)
        }
        if action == "backup-resume" {
            guard let job = try await repository.recoverableImports().first(where: { $0.mode == .restoreAccount }) else { throw ClientError.invalidData("no staged account backup") }
            try await repository.stageImportToReady(job.id)
            let snapshot = try await ServerSnapshotLoader(api: api).download()
            try await repository.verifyAccountRestorePublication(job.id, snapshot: snapshot)
            try await repository.publish(job.id)
            try await report(repository); try await repository.close(); return
        }
        if action == "recover-resume" {
            guard let job = try await repository.recoverableImports().first(where: { $0.mode == .reconcileEpoch }) else { throw ClientError.invalidData("no staged epoch recovery") }
            try await repository.stageImportToReady(job.id)
            let currentAccount = try await api.account()
            try await repository.verifyEpochRecoveryPublication(job.id, account: currentAccount, identity: identity)
            try await repository.publish(job.id)
            try await report(repository); try await repository.close(); return
        }
        if ["recover", "recover-ready-exit"].contains(action) {
            let snapshot = try await ServerSnapshotLoader(api: api).download()
            let existing = try await repository.backup()
            let cloudIds = Set(snapshot.entries.map { $0.state.id })
            var choices: [String: EpochRecoveryChoice] = [:]
            for entry in existing.entries where !cloudIds.contains(entry.id) { choices[entry.id] = .newLifecycle }
            let preview = try await repository.previewEpochRecovery(snapshot, choices: choices)
            guard preview.plan.conflicts.isEmpty else { throw ClientError.conflict("synthetic recovery choices") }
            try await repository.begin(preview.plan); try await repository.stageImportToReady(preview.id)
            if action == "recover-ready-exit" { _exit(0) }
            let currentAccount = try await api.account()
            try await repository.verifyEpochRecoveryPublication(preview.id, account: currentAccount, identity: identity)
            try await repository.publish(preview.id)
            try await report(repository); try await repository.close(); return
        }
        if action == "snapshot" {
            let snapshot = try await ServerSnapshotLoader(api: api).download()
            let state = try await repository.syncStatus()
            let result: JSONValue = .object(["epoch": .string(snapshot.account.epoch), "boundary": .number(Double(snapshot.boundary)),
                "localPending": .number(Double(state.pending)), "localPhase": .string(state.configuration?.phase ?? "none"),
                "entries": .array(snapshot.entries.map { value in .object(["id": .string(value.state.id), "word": .string(value.state.word),
                    "count": value.state.count.map(JSONValue.number) ?? .null, "deleted": .bool(value.state.deleted),
                    "historyCount": .number(Double(value.history.count)), "eventIds": .array(value.history.map { .string($0.id) })]) })])
            try FileHandle.standardOutput.write(contentsOf: JSONValue.encoder().encode(result))
            try FileHandle.standardOutput.write(contentsOf: Data([10])); try await repository.close(); return
        }
        if action == "prepare" {
            let anonymous = try LocalRepository(url: repository.storageURL)
            let bytes = try Data(contentsOf: root.appendingPathComponent("legacy.json"))
            let migration = try await anonymous.previewLegacy(bytes, mode: .firstMigration)
            try await anonymous.begin(migration); try await anonymous.resumeImport(migration.id)
            guard let entry = migration.entries.first else { throw ClientError.invalidData("fixture migration") }
            _ = try await anonymous.record(entry.id, context: "Synthetic private click " + identity.deviceId,
                url: "https://example.test/private", definition: entry.definition, timestamp: 1000, eventID: identity.deviceId + ":click-one")
            try await repository.configureSync(identity: identity)
            for _ in 0..<20 {
                if !(try await coordinator.pullForOwnershipPreview()).needsContinuation { break }
            }
            let preview = try await repository.previewAnonymousOwnership()
            guard preview.plan.entries.count == 1, preview.plan.conflicts.isEmpty else { throw ClientError.invalidData("fixture ownership") }
            try await repository.begin(preview.plan); try await repository.resumeImport(preview.id)
            try await repository.configureSync(identity: identity, enabled: true)
            try await anonymous.close()
        } else if action == "lose-response-exit" {
            let first = SyncCoordinator(repository: repository, api: api)
            do { _ = try await first.run(); throw ClientError.invalidData("expected a committed response loss") }
            catch is URLError {
                guard let frozen = try await repository.nextSyncWire(now: Date().timeIntervalSince1970 * 1000 + 120_000) else { throw ClientError.invalidData("lost request not persisted") }
                try JSONValue.encoder().encode(JSONValue.object(["operationId": .string(frozen.id), "requestDigest": .string(LegacyCodec.digest(frozen.body))]))
                    .write(to: directory.appendingPathComponent("lost-response.json"), options: .atomic)
                // Force process death without repository/session teardown. The
                // next command reopens this store and the rotated fixture vault.
                _exit(0)
            }
        } else if ["record", "offline-record"].contains(action) {
            let entry = try await sharedEntry(repository)
            _ = try await repository.record(entry.id, context: "Synthetic later private click", url: "https://example.test/private/later",
                definition: entry.definition, timestamp: 2000, eventID: identity.deviceId + (action == "record" ? ":later-click" : ":offline-old-click"))
        } else if action == "reset" { _ = try await repository.reset(try await sharedEntry(repository).id, timestamp: 1500) }
        else if action == "delete" { try await repository.delete(try await sharedEntry(repository).id) }
        else if action == "merge" {
            let preview = try await repository.previewLegacy(Data(contentsOf: root.appendingPathComponent("legacy.json")), mode: .legacyMerge)
            try await repository.begin(preview); try await repository.resumeImport(preview.id)
        } else if action == "create-unknown" {
            try await repository.create(VocabularyEntry(id: "synthetic-unknown", word: "synthetic-unknown", timestamp: 1))
        } else if action == "create-after-epoch" {
            try await repository.create(VocabularyEntry(id: "synthetic-pending-epoch", word: "synthetic-pending-epoch", timestamp: 1))
        } else if action == "review" {
            let entry = try await sharedEntry(repository)
            _ = try await repository.answerReview(entry.id, result: .remembered, expectedReviewVersion: entry.effectiveReviewVersion,
                timestamp: Date().timeIntervalSince1970 * 1000, timeZoneID: "UTC", eventID: identity.deviceId + ":synthetic-review")
        } else if action == "use-cloud" {
            for conflict in try await repository.syncConflicts() { try await repository.acceptRemoteForConflict(conflict.id) }
        } else if action == "connect-empty" { try await repository.configureSync(identity: identity, enabled: true) }
        else if action == "enable" {
            try await repository.configureSync(identity: identity, enabled: true, privacy: try await repository.syncConfiguration()?.privacy ?? SyncPrivacy())
        }
        else if !["sync", "inspect"].contains(action) { throw ClientError.invalidData("unknown native fixture command") }
        if ["sync", "connect-empty"].contains(action) {
            for _ in 0..<20 {
                let result = try await coordinator.run()
                if !result.needsContinuation || (result.submitted == 0 && result.pulledPages == 0 && result.historyPages == 0) { break }
                if try await repository.syncStatus().conflicts > 0 { break }
            }
        }
        try await report(repository)
        try await repository.close()
    }
    private static func sharedEntry(_ repository: LocalRepository) async throws -> VocabularyEntry {
        guard let entry = try await repository.backup().entries.first(where: { $0.word == "synthetic-shared" }) else { throw ClientError.invalidData("synthetic shared entry missing") }
        return entry
    }
    private static func report(_ repository: LocalRepository) async throws {
        let state = try await repository.syncStatus(), backup = try await repository.backup()
        let entries = backup.entries + backup.tombstones
        let allowance = try await repository.reviewQueue().remainingNewAllowance
        let result: JSONValue = .object(["pending": .number(Double(state.pending)), "conflicts": .number(Double(state.conflicts)),
            "reviewAllowance": .number(Double(allowance)),
            "phase": .string(state.configuration?.phase ?? "none"), "cursor": .number(Double(state.configuration?.cursor ?? 0)),
            "entries": .array(entries.map { entry in .object([
                "id": .string(entry.id), "word": .string(entry.word), "count": entry.count.map(JSONValue.number) ?? .null,
                "deleted": .bool(entry.deleted), "historyCount": .number(Double(entry.history.count)),
                "reviewStep": entry.review.map { .number(Double($0.step)) } ?? .null,
                "eventIds": .array(entry.history.map { .string($0.id) }), "privateHistoryCount": .number(Double(entry.history.filter { !$0.context.isEmpty }.count))]) }),
            "conflictCodes": .array(try await repository.syncConflicts().map { .string($0.code) })])
        try FileHandle.standardOutput.write(contentsOf: JSONValue.encoder().encode(result))
        try FileHandle.standardOutput.write(contentsOf: Data([10]))
    }
}

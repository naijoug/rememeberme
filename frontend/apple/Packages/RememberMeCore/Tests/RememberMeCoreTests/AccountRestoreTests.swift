import Foundation
import Testing
@testable import RememberMeCore

private let accountIdentity = ConnectedIdentity(origin: "https://backup.example.test", userId: "synthetic-user", deviceId: "synthetic-device")
private let backupDefinition: JSONValue = .object(["word": .string("synthetic"), "phonetics": .array([]), "meanings": .array([])])
private func backupURL() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent("rememberme-account-backup-\(UUID().uuidString)/store.sqlite") }
private func cloudEntry(id: String = "fixture", word: String = "synthetic", count: Double? = 7, version: Int = 3, deleted: Bool = false) -> APIEntry {
    .init(id: id, word: word, normalizedKey: LegacyCodec.normalize(word), kind: .word, count: count, definition: backupDefinition,
        notes: "current note", createdAtMs: 1, updatedAtMs: 1, version: version, deleted: deleted, review: nil, reviewVersion: 4, historyOrdering: "retained")
}
private func backupSnapshot(entry: APIEntry = cloudEntry()) -> ServerSnapshot {
    .init(identity: accountIdentity, account: .init(userId: accountIdentity.userId, deviceId: accountIdentity.deviceId, epoch: "epoch", timezone: "UTC",
        syncContext: false, syncURLs: false, syncCapabilities: ["history-order-v1", "history-version-v1", "explicit-lifecycles-v1"]), boundary: 3,
        entries: [.init(state: entry, history: [.init(id: "current-event", timestamp: 1, definition: backupDefinition, context: nil, url: nil, position: 1)])])
}
private func setupBackup(_ url: URL, state: APIEntry = cloudEntry()) async throws -> LocalRepository {
    let repository = try LocalRepository(url: url, owner: SyncConfiguration.owner(for: accountIdentity))
    try await repository.configureSync(identity: accountIdentity)
    let snapshot = backupSnapshot(entry: state)
    try await repository.initializeSyncEpoch(snapshot.account)
    try await repository.applySyncPage(.init(epoch: "epoch", boundary: 3, nextCursor: 3, hasMore: false, changes: [.init(sequence: 3, entry: state)]), snapshot: true,
        histories: [state.id: snapshot.entries[0].history])
    return repository
}
private func backupBytes(id: String = "fixture", word: String = "synthetic", deleted: Bool = false, changedEvent: Bool = false) throws -> Data {
    var incoming = VocabularyEntry(id: id, word: word, count: 0.5, timestamp: 1, definition: backupDefinition)
    incoming.notes = "backup note"; incoming.version = 999; incoming.deleted = deleted
    incoming.review = ReviewState(step: 2, dueAtMs: 1_800_000_000_000, version: 987); incoming.reviewRevision = 987
    incoming.history = [Encounter(id: "current-event", timestamp: changedEvent ? 99 : 1, context: "private backup source", url: "https://example.test/private", definition: backupDefinition),
        Encounter(id: "imported-event", timestamp: 2, context: "private imported", url: "https://example.test/private", definition: backupDefinition)]
    incoming.reviewEvents = [.init(id: "historical-answer", result: .remembered, answeredAtMs: 1, baseReviewVersion: 986)]
    return try JSONValue.encoder().encode(Backup(entries: [incoming], importSources: [], exportedAtMs: 1))
}
private func publishBackup(_ repository: LocalRepository, _ preview: AccountRestorePreview, snapshot: ServerSnapshot = backupSnapshot()) async throws {
    try await repository.begin(preview.plan); try await repository.stageImportToReady(preview.id)
    try await repository.verifyAccountRestorePublication(preview.id, snapshot: snapshot); try await repository.publish(preview.id)
}
@Test func accountBackupKeepsCurrentFieldsWhileImportingHistoryWithoutCountOrReviewReplay() async throws {
    let url = backupURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try await setupBackup(url)
    let preview = try await repository.previewAccountBackup(backupBytes(), snapshot: backupSnapshot())
    #expect(preview.items.first?.selection.action == .keepCurrent)
    #expect(preview.plan.operations.map(\.kind) == ["associateHistory"])
    try await publishBackup(repository, preview)
    let entry = try #require(try await repository.entry("fixture"))
    #expect(entry.count == 7); #expect(entry.review == nil); #expect(entry.notes == "current note")
    #expect(entry.history.count == 2); #expect(entry.history.first?.context == "private backup source")
    #expect(entry.reviewEvents.map(\.id) == ["historical-answer"])
    #expect(try await repository.reviewQueue(at: 1000, timeZoneID: "UTC").remainingNewAllowance == 20)
    try await repository.close()
}
@Test func accountBackupSelectedFieldsUseCurrentServerVersionsAndFreshIdsRatherThanBackupCAS() async throws {
    let url = backupURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try await setupBackup(url)
    let choice = AccountRestoreSelection(.useBackup, fields: [.count, .review])
    let preview = try await repository.previewAccountBackup(backupBytes(), snapshot: backupSnapshot(), choices: ["fixture": choice])
    try await publishBackup(repository, preview)
    #expect(try await repository.entry("fixture")?.count == 0.5); #expect(try await repository.entry("fixture")?.notes == "current note")
    #expect(try await repository.entry("fixture")?.review?.step == 2)
    try await repository.configureSync(identity: accountIdentity, enabled: true)
    let wire = try #require(try await repository.nextSyncWire())
    let request = try JSONDecoder().decode(APIOperation.self, from: wire.body)
    #expect(request.kind == "restore"); #expect(request.baseVersion == 3); #expect(request.payload["baseReviewVersion"]?.number == 4)
    #expect(request.payload["count"]?.number == 0.5)
    #expect(try await repository.reviewQueue(at: 1000, timeZoneID: "UTC").remainingNewAllowance == 20)
    try await repository.close()
}
@Test func accountBackupOfflinePreviewCannotBeConfirmedAndUnknownEnvelopeRequestsAreRejected() async throws {
    let url = backupURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try await setupBackup(url)
    let offline = try await repository.previewAccountBackup(backupBytes())
    #expect(!offline.online); #expect(offline.plan.accountRestore == nil)
    await #expect(throws: (any Error).self) { try await repository.begin(offline.plan) }
    var data = try JSONDecoder().decode(JSONValue.self, from: backupBytes()).fields!
    data["outbox"] = .array([])
    await #expect(throws: (any Error).self) { try await repository.previewAccountBackup(JSONValue.encoder().encode(JSONValue.object(data)), snapshot: backupSnapshot()) }
    #expect(try await repository.entry("fixture")?.count == 7)
    try await repository.close()
}
@Test func accountBackupRejectsImmutableEventChangesButExplicitKeepCanSkipTheBadItem() async throws {
    let url = backupURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try await setupBackup(url)
    let preview = try await repository.previewAccountBackup(backupBytes(changedEvent: true), snapshot: backupSnapshot())
    #expect(preview.plan.conflicts.count == 1)
    let kept = try await repository.previewAccountBackup(backupBytes(changedEvent: true), snapshot: backupSnapshot(), choices: ["fixture": .init(.keepCurrent)])
    #expect(kept.plan.conflicts.isEmpty); #expect(kept.plan.entries.isEmpty)
    let separate = try await repository.previewAccountBackup(backupBytes(changedEvent: true), snapshot: backupSnapshot(), choices: ["fixture": .init(.newLifecycle)])
    try await publishBackup(repository, separate)
    #expect(try await repository.entry("fixture")?.history.first?.timestamp == 1)
    let created = try #require(try await repository.entries().first { $0.id != "fixture" })
    #expect(try await repository.entry(created.id)?.history.first?.timestamp == 99)
    try await repository.close()
}
@Test func accountBackupDoesNotResurrectTombstonesAndOnlyDeletesAfterExplicitChoice() async throws {
    let url = backupURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try await setupBackup(url, state: cloudEntry(deleted: true))
    let refused = try await repository.previewAccountBackup(backupBytes(), snapshot: backupSnapshot(entry: cloudEntry(deleted: true)), choices: ["fixture": .init(.useBackup)])
    #expect(refused.plan.conflicts.count == 1)
    #expect(try await repository.entry("fixture")?.deleted == true)
    try await repository.close()
    let otherURL = backupURL(); defer { try? FileManager.default.removeItem(at: otherURL.deletingLastPathComponent()) }
    let other = try await setupBackup(otherURL)
    let kept = try await other.previewAccountBackup(backupBytes(deleted: true), snapshot: backupSnapshot())
    #expect(kept.plan.operations.isEmpty)
    let selected = try await other.previewAccountBackup(backupBytes(deleted: true), snapshot: backupSnapshot(), choices: ["fixture": .init(.useBackup)])
    #expect(selected.plan.operations.map(\.kind) == ["delete"])
    try await publishBackup(other, selected)
    #expect(try await other.entry("fixture")?.deleted == true)
    try await other.close()
}
@Test func accountBackupKeepsUnrelatedLocalOutboxButCannotOverrideAffectedPendingFields() async throws {
    let url = backupURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try await setupBackup(url)
    try await repository.create(VocabularyEntry(id: "unrelated", word: "unrelated", count: 2, timestamp: 1))
    let unrelated = try #require(try await repository.pendingOperations().first?.id)
    let preview = try await repository.previewAccountBackup(backupBytes(), snapshot: backupSnapshot(), choices: ["fixture": .init(.useBackup)])
    try await publishBackup(repository, preview)
    #expect(try await repository.pendingOperations().contains { $0.id == unrelated })
    #expect(try await repository.entry("unrelated")?.count == 2)
    let entry = try #require(try await repository.entry("fixture"))
    _ = try await repository.update("fixture", expectedVersion: entry.version, definition: backupDefinition, notes: "later local input")
    let blocked = try await repository.previewAccountBackup(backupBytes(), snapshot: backupSnapshot(), choices: ["fixture": .init(.useBackup)])
    #expect(blocked.plan.conflicts.count == 1)
    try await repository.close()
}
@Test func accountBackupFrozenRestartRechecksCloudVersionsAndActualSaveFailureRollsBackPublication() async throws {
    let url = backupURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try await setupBackup(url)
    let preview = try await repository.previewAccountBackup(backupBytes(), snapshot: backupSnapshot(), choices: ["fixture": .init(.useBackup)])
    try await repository.begin(preview.plan); try await repository.stageImportToReady(preview.id)
    try await repository.close()
    let reopened = try LocalRepository(url: url, owner: SyncConfiguration.owner(for: accountIdentity))
    await #expect(throws: ClientError.stalePreview) { try await reopened.verifyAccountRestorePublication(preview.id, snapshot: backupSnapshot(entry: cloudEntry(version: 4))) }
    await #expect(throws: (any Error).self) { try await reopened.publish(preview.id) }
    try await reopened.verifyAccountRestorePublication(preview.id, snapshot: backupSnapshot())
    await #expect(throws: (any Error).self) { try await reopened.publish(preview.id, fault: .invalidSave) }
    #expect(try await reopened.entry("fixture")?.count == 7)
    try await reopened.publish(preview.id)
    #expect(try await reopened.entry("fixture")?.count == 0.5)
    try await reopened.close()
}
@Test func accountBackupDifferentSourceCanAssociateHistoryWithoutAddingCountOrMakingUpEvents() async throws {
    let url = backupURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try await setupBackup(url)
    var incoming = VocabularyEntry(id: "different-source", word: "synthetic", count: 99, timestamp: 1, definition: backupDefinition)
    incoming.history = [.init(id: "new-source-history", timestamp: 2, context: "private", url: "", definition: backupDefinition)]
    let data = try JSONValue.encoder().encode(Backup(entries: [incoming], importSources: [], exportedAtMs: 1))
    let refused = try await repository.previewAccountBackup(data, snapshot: backupSnapshot(), choices: [incoming.id: .init(.useBackup)])
    #expect(refused.plan.conflicts.count == 1)
    let preview = try await repository.previewAccountBackup(data, snapshot: backupSnapshot(), choices: [incoming.id: .init(.associateHistory, targetId: "fixture")])
    try await publishBackup(repository, preview)
    #expect(try await repository.entry("fixture")?.count == 7)
    #expect(try await repository.entry("fixture")?.history.count == 2)
    #expect(try await repository.entry(incoming.id) == nil)
    #expect(try await repository.pendingOperations().map(\.kind) == ["associateHistory"])
    try await repository.close()
}
@Test func accountBackupOutOfRangeReviewAndOversizedNotesCanBeExplicitlyExcluded() async throws {
    let url = backupURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try await setupBackup(url)
    var incoming = VocabularyEntry(id: "fixture", word: "synthetic", count: 0.5, timestamp: 1, definition: backupDefinition)
    incoming.notes = String(repeating: "n", count: 16_385)
    incoming.review = .init(step: 1, dueAtMs: 1e100, version: 3); incoming.reviewRevision = 3
    let data = try JSONValue.encoder().encode(Backup(entries: [incoming], importSources: [], exportedAtMs: 1))
    let refused = try await repository.previewAccountBackup(data, snapshot: backupSnapshot(), choices: [incoming.id: .init(.useBackup)])
    #expect(refused.plan.conflicts.count == 1)
    let preview = try await repository.previewAccountBackup(data, snapshot: backupSnapshot(), choices: [incoming.id: .init(.useBackup, fields: [.count])])
    #expect(preview.plan.conflicts.isEmpty)
    try await publishBackup(repository, preview)
    #expect(try await repository.entry("fixture")?.count == 0.5); #expect(try await repository.entry("fixture")?.review == nil)
    #expect(try await repository.entry("fixture")?.notes == "current note")
    try await repository.close()
}

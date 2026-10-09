import Foundation
import Testing
@testable import RememberMeCore

private let ownedIdentity = ConnectedIdentity(origin: "https://ownership.example.test", userId: "synthetic-owner", deviceId: "synthetic-device")
private func ownerURL() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent("rememberme-ownership-\(UUID().uuidString)/vocabulary.sqlite") }
private func ownedEntry(id: String, count: Double?, version: Int = 1, deleted: Bool = false) -> APIEntry {
    APIEntry(id: id, word: "synthetic", normalizedKey: "synthetic", kind: .word, count: count,
        definition: .object(["word": .string("synthetic"), "phonetics": .array([]), "meanings": .array([])]), notes: "cloud note",
        createdAtMs: 1, updatedAtMs: 1, version: version, deleted: deleted, review: nil, reviewVersion: 0, historyOrdering: "retained")
}
private func ownerSetup(_ url: URL, remote: APIEntry? = nil) async throws -> (LocalRepository, LocalRepository) {
    let anonymous = try LocalRepository(url: url)
    let account = try LocalRepository(url: url, owner: SyncConfiguration.owner(for: ownedIdentity))
    try await account.configureSync(identity: ownedIdentity)
    try await account.initializeSyncEpoch(APIAccountIdentity(userId: ownedIdentity.userId, deviceId: ownedIdentity.deviceId, epoch: "owned-epoch", timezone: "UTC", syncContext: false, syncURLs: false))
    try await account.applySyncPage(.init(epoch: "owned-epoch", boundary: remote == nil ? 0 : 1, nextCursor: remote == nil ? 0 : 1,
        hasMore: false, changes: remote.map { [.init(sequence: 1, entry: $0)] } ?? []), snapshot: true,
        histories: remote.map { [$0.id: []] } ?? [:])
    return (anonymous, account)
}
private func ownCommit(_ account: LocalRepository, _ preview: OwnershipPreview) async throws {
    try await account.begin(preview.plan); try await account.resumeImport(preview.id)
}
@Test func ownershipCopiesCurrentNonSourceSnapshotWithoutReplayingAnonymousCounts() async throws {
    let url = ownerURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let (anonymous, account) = try await ownerSetup(url)
    let entry = VocabularyEntry(id: "local", word: "synthetic", count: 3, timestamp: 1)
    try await anonymous.create(entry)
    _ = try await anonymous.record(entry.id, context: "private", url: "https://example.test/private", definition: entry.definition, timestamp: 2, eventID: "local-event")
    let preview = try await account.previewAnonymousOwnership()
    #expect(preview.plan.entries.first?.count == 4); #expect(preview.plan.operations.map(\.kind) == ["create"])
    #expect(try await account.entries().isEmpty); #expect(try await account.pendingOperations().isEmpty)
    try await ownCommit(account, preview)
    try await account.publish(preview.id)
    #expect(try await account.entry(entry.id)?.count == 4); #expect(try await anonymous.entry(entry.id)?.count == 4)
    #expect(try await account.pendingOperations().count == 1); #expect(try await anonymous.pendingOperations().count == 2)
    #expect(try await account.syncConfiguration()?.enabled == false)
    let repeated = try await account.previewAnonymousOwnership()
    #expect(repeated.items.first?.selection.action == .keepAnonymous); #expect(repeated.plan.entries.isEmpty)
    try await anonymous.close(); try await account.close()
}
@Test func ownershipPreservesTheOriginalSourceSeedAndLaterIndependentIntent() async throws {
    let url = ownerURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let (anonymous, account) = try await ownerSetup(url)
    let bytes = try LegacyCodec.export([VocabularyEntry(word: "synthetic", count: 0.5, timestamp: 1)])
    let migration = try await anonymous.previewLegacy(bytes, mode: .firstMigration)
    try await anonymous.begin(migration); try await anonymous.resumeImport(migration.id)
    let id = migration.entries[0].id
    _ = try await anonymous.record(id, context: "private", url: "", definition: migration.entries[0].definition, timestamp: 2, eventID: "post-migration-click")
    let preview = try await account.previewAnonymousOwnership()
    #expect(preview.items.first?.sharedBaselineAvailable == true)
    #expect(preview.plan.operations.map(\.kind) == ["legacySeed", "record"])
    #expect(preview.plan.operations[0].payload["count"]?.number == 0.5)
    #expect(preview.plan.operations[0].id == migration.operations[0].id)
    try await ownCommit(account, preview)
    #expect(try await account.entry(id)?.count == 1.5)
    #expect(try await account.backup().importSources == [LegacyCodec.digest(bytes)])
    try await anonymous.close(); try await account.close()
}
@Test func ownershipSharedSourceKeepsAnOfflineResetBaseInsteadOfRebasingToNewCloudData() async throws {
    let url = ownerURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let (anonymous, account) = try await ownerSetup(url)
    let bytes = try LegacyCodec.export([VocabularyEntry(word: "synthetic", count: 3, timestamp: 1)])
    let migration = try await anonymous.previewLegacy(bytes, mode: .firstMigration)
    try await anonymous.begin(migration); try await anonymous.resumeImport(migration.id)
    let id = migration.entries[0].id
    _ = try await anonymous.reset(id, timestamp: 2)
    try await account.applySyncPage(.init(epoch: "owned-epoch", boundary: 5, nextCursor: 5, hasMore: false,
        changes: [.init(sequence: 5, entry: ownedEntry(id: id, count: 9, version: 5))]), snapshot: false, histories: [id: []])
    let preview = try await account.previewAnonymousOwnership(); try await ownCommit(account, preview)
    let reset = try #require(try await account.pendingOperations().first { $0.kind == "reset" })
    #expect(reset.observedRemoteVersion == 1); #expect(reset.observedVersionFloor == 0)
    try await account.configureSync(identity: ownedIdentity, enabled: true)
    let seed = try #require(try await account.nextSyncWire())
    try await account.acknowledgeSyncWire(seed.id, result: .init(operationId: seed.id, status: "applied", entry: ownedEntry(id: id, count: 3), cursor: 1))
    let wire = try #require(try await account.nextSyncWire())
    #expect(try JSONDecoder().decode(APIOperation.self, from: wire.body).baseVersion == 1)
    try await anonymous.close(); try await account.close()
}
@Test func ownershipDifferentSourcesRequireChoicesAndAssociationDoesNotAddCount() async throws {
    let url = ownerURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let (anonymous, account) = try await ownerSetup(url, remote: ownedEntry(id: "cloud", count: 7))
    var entry = VocabularyEntry(id: "local", word: "synthetic", count: 3, timestamp: 1)
    entry.history = [Encounter(id: "source-event", timestamp: 1, context: "private", url: "", definition: entry.definition)]
    try await anonymous.create(entry)
    let initial = try await account.previewAnonymousOwnership()
    #expect(initial.items.first?.selection.action == .keepAnonymous); #expect(initial.plan.entries.isEmpty)
    let preview = try await account.previewAnonymousOwnership(choices: [entry.id: .init(.associate, targetId: "cloud")])
    #expect(preview.plan.entries.first?.count == 7)
    try await ownCommit(account, preview)
    #expect(try await account.entry("cloud")?.count == 7); #expect(try await account.entry("cloud")?.history.count == 1)
    #expect(try await account.pendingOperations().map(\.kind) == ["associateHistory"])
    try await anonymous.close(); try await account.close()
}
@Test func ownershipExplicitSeparateLifecycleUsesNewEventIDsAndDuplicatePermission() async throws {
    let url = ownerURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let (anonymous, account) = try await ownerSetup(url, remote: ownedEntry(id: "cloud", count: 7))
    var entry = VocabularyEntry(id: "local", word: "synthetic", count: 3, timestamp: 1)
    entry.history = [Encounter(id: "source-event", timestamp: 1, context: "private", url: "", definition: entry.definition)]
    try await anonymous.create(entry)
    let preview = try await account.previewAnonymousOwnership(choices: [entry.id: .init(.newLifecycle)])
    let copy = try #require(preview.plan.entries.first)
    #expect(copy.id != entry.id && copy.id != "cloud"); #expect(copy.history.first?.id != "source-event")
    try await ownCommit(account, preview)
    try await account.configureSync(identity: ownedIdentity, enabled: true)
    let wire = try #require(try await account.nextSyncWire())
    #expect(try JSONDecoder().decode(APIOperation.self, from: wire.body).payload["allowDuplicate"] == .bool(true))
    #expect(try await account.entries().count == 2)
    try await anonymous.close(); try await account.close()
}
@Test func ownershipPublicationFailureAndChangedSourceCannotPublishPartialData() async throws {
    let url = ownerURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let (anonymous, account) = try await ownerSetup(url)
    try await anonymous.create(VocabularyEntry(id: "local", word: "synthetic", count: 3, timestamp: 1))
    let preview = try await account.previewAnonymousOwnership()
    try await account.begin(preview.plan); try await account.stage(preview.plan, start: 0)
    await #expect(throws: (any Error).self) { try await account.publish(preview.id, fault: .invalidSave) }
    #expect(try await account.entries().isEmpty); #expect(try await account.pendingOperations().isEmpty)
    _ = try await anonymous.reset("local", timestamp: 2)
    await #expect(throws: ClientError.stalePreview) { try await account.publish(preview.id) }
    #expect(try await anonymous.entry("local")?.count == 0); #expect(try await account.entries().isEmpty)
    try await anonymous.close(); try await account.close()
}
@Test func ownershipInterruptedCandidateResumesFromFrozenChoicesAcrossReopening() async throws {
    let url = ownerURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let (anonymous, account) = try await ownerSetup(url)
    try await anonymous.create(VocabularyEntry(id: "local", word: "synthetic", count: 3, timestamp: 1))
    let preview = try await account.previewAnonymousOwnership()
    try await account.begin(preview.plan)
    try await anonymous.close(); try await account.close()
    let reopened = try LocalRepository(url: url, owner: SyncConfiguration.owner(for: ownedIdentity))
    let frozen = try await reopened.loadImportPlan(preview.id)
    #expect(frozen.ownership == preview.plan.ownership)
    try await reopened.resumeImport(preview.id)
    #expect(try await reopened.entry("local")?.count == 3)
    #expect(try await reopened.pendingOperations().count == 1)
    try await reopened.close()
}
@Test func ownershipACloudTombstoneCannotBeResurrectedByAssociationOrReplacement() async throws {
    let url = ownerURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let (anonymous, account) = try await ownerSetup(url, remote: ownedEntry(id: "local", count: 7, deleted: true))
    try await anonymous.create(VocabularyEntry(id: "local", word: "synthetic", count: 3, timestamp: 1))
    let initial = try await account.previewAnonymousOwnership()
    #expect(initial.items.first?.selection.action == .keepAnonymous)
    let chosen = try await account.previewAnonymousOwnership(choices: ["local": .init(.replaceFields, targetId: "local")])
    #expect(chosen.plan.conflicts.count == 1)
    await #expect(throws: (any Error).self) { try await account.begin(chosen.plan) }
    #expect(try await account.entry("local")?.deleted == true)
    try await anonymous.close(); try await account.close()
}

@Test func conflictSeparateCopyUsesNewLifecycleAndPreservesCloudDataWithAnewRequest() async throws {
    let url = ownerURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let (anonymous, account) = try await ownerSetup(url, remote: ownedEntry(id: "cloud", count: 7))
    let local = try #require(try await account.entry("cloud"))
    _ = try await account.update("cloud", expectedVersion: local.version, definition: local.definition, notes: "unsent local meaning")
    try await account.configureSync(identity: ownedIdentity, enabled: true)
    let edit = try #require(try await account.nextSyncWire())
    try await account.rejectSyncWire(edit.id, code: "VERSION_CONFLICT", retryable: false)
    let conflicted = try #require(try await account.entry("cloud"))
    await #expect(throws: ClientError.stalePreview) { try await account.copyConflictAsSeparateLifecycle(edit.logicalId, expectedLocalVersion: conflicted.version - 1) }
    let copy = try await account.copyConflictAsSeparateLifecycle(edit.logicalId, expectedLocalVersion: conflicted.version)
    #expect(copy != "cloud")
    #expect(try await account.entry("cloud")?.notes == "cloud note")
    #expect(try await account.entry(copy)?.notes == "unsent local meaning")
    #expect(try await account.syncConflicts().isEmpty)
    let creation = try #require(try await account.nextSyncWire())
    let wire = try JSONDecoder().decode(APIOperation.self, from: creation.body)
    #expect(wire.kind == "create"); #expect(wire.entryId == copy); #expect(wire.payload["allowDuplicate"] == .bool(true))
    try await anonymous.close(); try await account.close()
}

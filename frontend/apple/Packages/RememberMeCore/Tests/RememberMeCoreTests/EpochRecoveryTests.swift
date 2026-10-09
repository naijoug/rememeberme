import Foundation
@preconcurrency import CoreData
import Testing
@testable import RememberMeCore

private let recoveryIdentity = ConnectedIdentity(origin: "https://recovery.example.test", userId: "synthetic-user", deviceId: "synthetic-device")
private let definition: JSONValue = .object(["word": .string("synthetic"), "phonetics": .array([]), "meanings": .array([])])
private func fixtureURL() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent("rememberme-epoch-\(UUID().uuidString)/store.sqlite") }
private func profile(_ epoch: String) -> APIAccountIdentity {
    .init(userId: recoveryIdentity.userId, deviceId: recoveryIdentity.deviceId, epoch: epoch, timezone: "UTC", syncContext: false, syncURLs: false,
        syncCapabilities: ["history-order-v1", "history-version-v1", "explicit-lifecycles-v1"],
        reviewDay: try! ReviewDate.localDay(Date().timeIntervalSince1970 * 1000, timeZoneID: "UTC"), reviewAdmissionIds: [])
}
private func remote(_ version: Int, count: Double, deleted: Bool = false) -> APIEntry {
    .init(id: "fixture", word: "synthetic", normalizedKey: "synthetic", kind: .word, count: count, definition: definition,
        notes: "cloud note", createdAtMs: 1, updatedAtMs: 1, version: version, deleted: deleted, review: nil, reviewVersion: 0, historyOrdering: "retained")
}
private func snapshot(deleted: Bool = false, history: Bool = true) -> ServerSnapshot {
    .init(identity: recoveryIdentity, account: profile("new-epoch"), boundary: 50,
        entries: [.init(state: remote(1, count: 2, deleted: deleted), history: history ? [.init(id: "base-event", timestamp: 1, definition: definition, context: nil, url: nil, position: 1)] : [])])
}
private func setup(_ url: URL, pending: Bool = true) async throws -> LocalRepository {
    let repository = try LocalRepository(url: url, owner: SyncConfiguration.owner(for: recoveryIdentity))
    try await repository.configureSync(identity: recoveryIdentity, enabled: true)
    try await repository.initializeSyncEpoch(profile("old-epoch"))
    try await repository.applySyncPage(.init(epoch: "old-epoch", boundary: 3, nextCursor: 3, hasMore: false,
        changes: [.init(sequence: 3, entry: remote(3, count: 7))]), snapshot: true,
        histories: ["fixture": [.init(id: "base-event", timestamp: 1, definition: definition, context: "private original", url: "https://example.test/private", position: 1)]])
    if pending {
        let entry = try #require(try await repository.entry("fixture"))
        _ = try await repository.update(entry.id, expectedVersion: entry.version, definition: definition, notes: "unsent local note")
        _ = try await repository.record(entry.id, context: "private unsent", url: "https://example.test/private", definition: definition, timestamp: 2, eventID: "old-pending-click")
        _ = try #require(try await repository.nextSyncWire())
    }
    try await repository.initializeSyncEpoch(profile("new-epoch"))
    return repository
}
private func publish(_ repository: LocalRepository, preview: EpochRecoveryPreview) async throws {
    try await repository.begin(preview.plan); try await repository.stageImportToReady(preview.id, chunkSize: 1)
    try await repository.verifyEpochRecoveryPublication(preview.id, account: profile("new-epoch"), identity: recoveryIdentity)
    try await repository.publish(preview.id)
}
@Test func epochCloudChoiceAtomicallyPublishesNewCheckpointAndRetainsOldPrivateQueue() async throws {
    let url = fixtureURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try await setup(url)
    let oldOperations = try await repository.pendingOperations().map(\.id)
    let preview = try await repository.previewEpochRecovery(snapshot())
    #expect(preview.previousPendingCount == 2); #expect(preview.plan.operations.isEmpty)
    #expect(try await repository.entry("fixture")?.count == 8)
    try await repository.begin(preview.plan); try await repository.stageImportToReady(preview.id)
    #expect(try await repository.entry("fixture")?.count == 8); #expect(try await repository.syncConfiguration()?.phase == "epochConflict")
    await #expect(throws: (any Error).self) { try await repository.publish(preview.id) }
    try await repository.verifyEpochRecoveryPublication(preview.id, account: profile("new-epoch"), identity: recoveryIdentity)
    await #expect(throws: (any Error).self) { try await repository.publish(preview.id, fault: .invalidSave) }
    #expect(try await repository.pendingOperations().map(\.id) == oldOperations)
    try await repository.publish(preview.id); try await repository.publish(preview.id)
    #expect(try await repository.entry("fixture")?.count == 2)
    #expect(try await repository.entry("fixture")?.history.count == 2)
    #expect(try await repository.entry("fixture")?.history[0].context == "private original")
    #expect(try await repository.pendingOperations().isEmpty)
    #expect(try await repository.syncConfiguration()?.epoch == "new-epoch")
    #expect(try await repository.syncConfiguration()?.cursor == 50)
    #expect(try await repository.syncConfiguration()?.enabled == false)
    try await repository.close()
    let coordinator = NSPersistentStoreCoordinator(managedObjectModel: StoreModelV4.make())
    let disk = try coordinator.addPersistentStore(ofType: NSSQLiteStoreType, configurationName: nil, at: url)
    let context = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType); context.persistentStoreCoordinator = coordinator
    try context.performAndWait {
        let request = NSFetchRequest<NSManagedObject>(entityName: "Operation")
        let operations = try context.fetch(request)
        #expect(Set(operations.compactMap { $0.value(forKey: "id") as? String }) == Set(oldOperations))
        let wires = NSFetchRequest<NSManagedObject>(entityName: "SyncRecord"); wires.predicate = NSPredicate(format: "id BEGINSWITH %@", "wire:")
        let count = try context.count(for: wires); #expect(count == 1)
    }
    try coordinator.remove(disk)
}
@Test func epochFieldRestoreUsesFreshRequestsAndTheNewServerCASInsteadOfOldVersions() async throws {
    let url = fixtureURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try await setup(url)
    let oldIds = Set(try await repository.pendingOperations().map(\.id))
    let preview = try await repository.previewEpochRecovery(snapshot(), choices: ["fixture": .restoreLocalFields])
    try await publish(repository, preview: preview)
    #expect(try await repository.entry("fixture")?.count == 8)
    #expect(try await repository.pendingOperations().allSatisfy { !oldIds.contains($0.id) })
    try await repository.configureSync(identity: recoveryIdentity, enabled: true)
    let wire = try #require(try await repository.nextSyncWire())
    #expect(wire.epoch == "new-epoch")
    let operation = try JSONDecoder().decode(APIOperation.self, from: wire.body)
    #expect(operation.kind == "restore"); #expect(operation.baseVersion == 1)
    #expect(operation.payload["count"]?.number == 8); #expect(operation.payload["baseReviewVersion"]?.number == 0)
    #expect(operation.payload["notes"]?.text == "unsent local note")
    try await repository.close()
}
@Test func epochKeptLocalAndMissingCloudWordsRemainConflictsWithoutAutomaticUpload() async throws {
    let url = fixtureURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try await setup(url)
    let empty = ServerSnapshot(identity: recoveryIdentity, account: profile("new-epoch"), boundary: 0, entries: [])
    let preview = try await repository.previewEpochRecovery(empty)
    #expect(preview.items.first?.choice == .keepLocalPending)
    try await publish(repository, preview: preview)
    #expect(try await repository.entry("fixture")?.count == 8)
    #expect(try await repository.syncConflicts().count == 1)
    try await repository.configureSync(identity: recoveryIdentity, enabled: true)
    #expect(try await repository.nextSyncWire() == nil)
    let conflict = try #require(try await repository.syncConflicts().first)
    #expect(conflict.localOperation.kind == "epochOrphan")
    try await repository.close()
}
@Test func epochTombstonesCannotBeResurrectedAndSeparateCopiesGetNewHistoryIDs() async throws {
    let url = fixtureURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try await setup(url)
    let refused = try await repository.previewEpochRecovery(snapshot(deleted: true), choices: ["fixture": .restoreLocalFields])
    #expect(refused.plan.conflicts.count == 1)
    let preview = try await repository.previewEpochRecovery(snapshot(deleted: true), choices: ["fixture": .newLifecycle])
    try await publish(repository, preview: preview)
    #expect(try await repository.entry("fixture")?.deleted == true)
    let new = try #require(try await repository.entries().first)
    #expect(new.id != "fixture"); #expect(new.count == 8)
    let copy = try #require(try await repository.entry(new.id))
    #expect(copy.history.allSatisfy { !["base-event", "old-pending-click"].contains($0.id) })
    try await repository.close()
}
@Test func epochLocalDeletionCannotBeImplicitlyUndoneByRestoredLiveCloudState() async throws {
    let url = fixtureURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try await setup(url, pending: false)
    try await repository.delete("fixture")
    let refused = try await repository.previewEpochRecovery(snapshot(), choices: ["fixture": .useCloud])
    #expect(refused.plan.conflicts.count == 1)
    let preview = try await repository.previewEpochRecovery(snapshot())
    try await publish(repository, preview: preview)
    #expect(try await repository.entry("fixture")?.deleted == true)
    #expect(try await repository.syncConflicts().first?.localOperation.kind == "delete")
    try await repository.close()
}
@Test func epochRecoveryReopensFrozenChoicesAndRequiresARecheckedServerBeforePublication() async throws {
    let url = fixtureURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try await setup(url)
    let preview = try await repository.previewEpochRecovery(snapshot(), choices: ["fixture": .restoreLocalFields])
    try await repository.begin(preview.plan); try await repository.stageImportToReady(preview.id)
    try await repository.close()
    let reopened = try LocalRepository(url: url, owner: SyncConfiguration.owner(for: recoveryIdentity))
    let frozen = try await reopened.loadImportPlan(preview.id)
    #expect(frozen.remoteBases == preview.plan.remoteBases); #expect(frozen.epochRecovery == preview.plan.epochRecovery)
    await #expect(throws: (any Error).self) { try await reopened.resumeImport(preview.id) }
    await #expect(throws: ClientError.stalePreview) { try await reopened.verifyEpochRecoveryPublication(preview.id, account: profile("another-restore"), identity: recoveryIdentity) }
    try await reopened.verifyEpochRecoveryPublication(preview.id, account: profile("new-epoch"), identity: recoveryIdentity)
    try await reopened.publish(preview.id)
    #expect(try await reopened.entry("fixture")?.count == 8)
    try await reopened.close()
}
@Test func epochRecoveryCannotReplaceWorkSavedAfterThePreview() async throws {
    let url = fixtureURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try await setup(url)
    let preview = try await repository.previewEpochRecovery(snapshot())
    try await repository.begin(preview.plan); try await repository.stageImportToReady(preview.id)
    _ = try await repository.record("fixture", context: "private later", url: "", definition: definition, timestamp: 3, eventID: "later-edit")
    await #expect(throws: ClientError.stalePreview) { try await repository.verifyEpochRecoveryPublication(preview.id, account: profile("new-epoch"), identity: recoveryIdentity) }
    #expect(try await repository.entry("fixture")?.count == 9)
    #expect(try await repository.syncConfiguration()?.phase == "epochConflict")
    try await repository.close()
}
@Test func epochRecoveryReplacesOldLocalQuotaWithKnownServerAdmissionsWithoutReplayingAnswers() async throws {
    let url = fixtureURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try await setup(url, pending: false)
    let now = Date().timeIntervalSince1970 * 1000
    let entry = try #require(try await repository.entry("fixture"))
    _ = try await repository.answerReview("fixture", result: .remembered, expectedReviewVersion: entry.effectiveReviewVersion,
        timestamp: now, timeZoneID: "UTC", eventID: "old-epoch-review")
    #expect(try await repository.reviewQueue(at: now, timeZoneID: "UTC").remainingNewAllowance == 19)
    var restored = snapshot()
    restored.account.reviewDay = try ReviewDate.localDay(now, timeZoneID: "UTC")
    restored.account.reviewAdmissionIds = ["server-admission-one", "server-admission-two"]
    let preview = try await repository.previewEpochRecovery(restored)
    try await repository.begin(preview.plan); try await repository.stageImportToReady(preview.id)
    try await repository.verifyEpochRecoveryPublication(preview.id, account: restored.account, identity: recoveryIdentity)
    try await repository.publish(preview.id)
    #expect(try await repository.reviewQueue(at: now, timeZoneID: "UTC").remainingNewAllowance == 18)
    #expect(try await repository.entry("fixture")?.review == nil)
    #expect(try await repository.entry("fixture")?.reviewEvents.map(\.id) == ["old-epoch-review"])
    #expect(try await repository.pendingOperations().isEmpty)
    try await repository.close()
}
@Test func epochRecoveryDoesNotSilentlyOverwriteDifferentImmutableSnapshotsOnTheSameEventID() async throws {
    let url = fixtureURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try await setup(url)
    var changed = snapshot(); changed.entries[0].history[0].timestamp = 99
    let initial = try await repository.previewEpochRecovery(changed)
    #expect(initial.items[0].historyConflicts == 1); #expect(initial.items[0].choice == .keepLocalPending)
    let refused = try await repository.previewEpochRecovery(changed, choices: ["fixture": .useCloud])
    #expect(refused.plan.conflicts.count == 1)
    let copy = try await repository.previewEpochRecovery(changed, choices: ["fixture": .newLifecycle])
    #expect(copy.plan.conflicts.isEmpty)
    try await publish(repository, preview: copy)
    let localCopy = try #require(try await repository.entries().first { $0.id != "fixture" })
    #expect(try await repository.entry("fixture")?.history[0].timestamp == 99)
    #expect(try await repository.entry(localCopy.id)?.history[0].timestamp == 1)
    try await repository.close()
}

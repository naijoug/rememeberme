import Foundation
@preconcurrency import CoreData
import Testing
@testable import RememberMeCore

private let identity = ConnectedIdentity(origin: "https://sync.example.test", userId: "synthetic-user", deviceId: "synthetic-device")
private let empty: JSONValue = .object(["word": .string("synthetic"), "phonetics": .array([]), "meanings": .array([])])
private func temporaryURL() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent("rememberme-sync-storage-\(UUID().uuidString)/store.sqlite") }
private func cleanup(_ url: URL) { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
private func remote(id: String = "fixture", count: Double? = nil, version: Int = 1, notes: String = "") -> APIEntry {
    APIEntry(id: id, word: "synthetic", normalizedKey: "synthetic", kind: .word, count: count, definition: empty,
        notes: notes, createdAtMs: 1, updatedAtMs: 1, version: version, deleted: false, review: nil, reviewVersion: 0)
}
private func make(_ url: URL, enabled: Bool = true) async throws -> LocalRepository {
    let repository = try LocalRepository(url: url, owner: SyncConfiguration.owner(for: identity))
    try await repository.configureSync(identity: identity, enabled: enabled)
    try await repository.initializeSyncEpoch(APIAccountIdentity(userId: identity.userId, deviceId: identity.deviceId, epoch: "epoch-A", timezone: "UTC", syncContext: false, syncURLs: false))
    try await repository.applySyncPage(SyncCheckpointPage(epoch: "epoch-A", boundary: 0, nextCursor: 0, hasMore: false, changes: []), snapshot: true)
    return repository
}
private func acknowledge(_ repository: LocalRepository, wire: SyncWireItem, entry: APIEntry, cursor: Int = 1) async throws {
    try await repository.acknowledgeSyncWire(wire.id, result: APIOperationResult(operationId: wire.id, status: "applied", entry: entry, cursor: cursor))
}

@Test func wireProjectionIsFrozenBeforeFirstSendAndSurvivesReopening() async throws {
    let url = temporaryURL(); defer { cleanup(url) }
    let repository = try await make(url)
    try await repository.create(VocabularyEntry(id: "fixture", word: "synthetic", count: 0.5, timestamp: 1, definition: empty))
    let frozen = try #require(try await repository.nextSyncWire())
    let decoded = try JSONDecoder().decode(APIOperation.self, from: frozen.body)
    #expect(decoded.kind == "create"); #expect(decoded.payload["count"]?.number == 0.5)
    #expect(decoded.payload["notes"]?.text == "")
    try await repository.rejectSyncWire(frozen.id, code: "NETWORK_UNAVAILABLE", retryable: true, now: 1000)
    #expect(try await repository.nextSyncWire(now: 1001) == nil)
    try await repository.close()
    let reopened = try LocalRepository(url: url, owner: SyncConfiguration.owner(for: identity))
    let retry = try #require(try await reopened.nextSyncWire(now: 10_000))
    #expect(retry.body == frozen.body); #expect(retry.id == frozen.id); #expect(retry.logicalId == frozen.logicalId)
    #expect(retry.attempts == 1)
    try await acknowledge(reopened, wire: retry, entry: remote(count: 0.5))
    #expect(try await reopened.syncStatus().pending == 0)
    #expect(try await reopened.nextSyncWire() == nil)
    try await reopened.close()
}
@Test func pullPreservesPendingFieldsAndCheckpointCommitsAtomically() async throws {
    let url = temporaryURL(); defer { cleanup(url) }
    let repository = try await make(url)
    let baseline = remote(count: 3)
    try await repository.applySyncPage(SyncCheckpointPage(epoch: "epoch-A", boundary: 1, nextCursor: 1, hasMore: false,
        changes: [.init(sequence: 1, entry: baseline)]), snapshot: false, histories: ["fixture": []])
    let local = try #require(try await repository.entry("fixture"))
    _ = try await repository.update(local.id, expectedVersion: local.version, definition: empty, notes: "unsent local edit")
    let next = remote(count: 5, version: 2, notes: "other device edit")
    let page = SyncCheckpointPage(epoch: "epoch-A", boundary: 2, nextCursor: 2, hasMore: false, changes: [.init(sequence: 2, entry: next)])
    await #expect(throws: (any Error).self) { try await repository.applySyncPage(page, snapshot: false, fault: .invalidSave) }
    #expect(try await repository.syncConfiguration()?.cursor == 1)
    #expect(try await repository.remoteEntry("fixture")?.version == 1)
    try await repository.applySyncPage(page, snapshot: false, histories: ["fixture": []])
    #expect(try await repository.entry("fixture")?.count == 5)
    #expect(try await repository.entry("fixture")?.notes == "unsent local edit")
    let wire = try #require(try await repository.nextSyncWire())
    let request = try JSONDecoder().decode(APIOperation.self, from: wire.body)
    #expect(request.baseVersion == 1)
    try await repository.rejectSyncWire(wire.id, code: "VERSION_CONFLICT", retryable: false)
    #expect(try await repository.syncConflicts().count == 1)
    #expect(try await repository.nextSyncWire() == nil)
    try await repository.acceptRemoteForConflict(wire.logicalId)
    #expect(try await repository.entry("fixture")?.notes == "other device edit")
    #expect(try await repository.syncStatus().conflicts == 0)
    try await repository.close()
}
@Test func delayedAcknowledgementCannotOverwriteNewerPulledStateOrLaterLocalClicks() async throws {
    let url = temporaryURL(); defer { cleanup(url) }
    let repository = try await make(url)
    try await repository.applySyncPage(.init(epoch: "epoch-A", boundary: 1, nextCursor: 1, hasMore: false, changes: [.init(sequence: 1, entry: remote(count: 0))]), snapshot: false, histories: ["fixture": []])
    _ = try await repository.record("fixture", context: "private source", url: "https://example.test/private", definition: empty, timestamp: 2, eventID: "event-one")
    let wire = try #require(try await repository.nextSyncWire())
    let request = try JSONDecoder().decode(APIOperation.self, from: wire.body)
    #expect(request.payload["event"]?["context"] == nil); #expect(request.payload["event"]?["url"] == nil)
    _ = try await repository.record("fixture", context: "private source", url: "https://example.test/private", definition: empty, timestamp: 3, eventID: "event-two")
    let imported = APIHistoryPage.Event(id: "event-one", timestamp: 2, definition: empty, context: nil, url: nil)
    try await repository.applySyncPage(.init(epoch: "epoch-A", boundary: 3, nextCursor: 3, hasMore: false,
        changes: [.init(sequence: 3, entry: remote(count: 4, version: 3))]), snapshot: false, histories: ["fixture": [imported]])
    #expect(try await repository.entry("fixture")?.count == 5)
    try await acknowledge(repository, wire: wire, entry: remote(count: 1, version: 2), cursor: 2)
    #expect(try await repository.remoteEntry("fixture")?.version == 3)
    #expect(try await repository.entry("fixture")?.count == 5)
    #expect(try await repository.entry("fixture")?.history.first?.context == "private source")
    try await repository.close()
}
@Test func disabledConnectionAndEpochChangeDoNotSendPersistedOperations() async throws {
    let url = temporaryURL(); defer { cleanup(url) }
    let repository = try await make(url, enabled: false)
    try await repository.create(VocabularyEntry(id: "fixture", word: "synthetic", timestamp: 1))
    #expect(try await repository.nextSyncWire() == nil)
    try await repository.configureSync(identity: identity, enabled: true)
    #expect(try await repository.nextSyncWire() != nil)
    try await repository.initializeSyncEpoch(.init(userId: identity.userId, deviceId: identity.deviceId, epoch: "epoch-B", timezone: "UTC", syncContext: false, syncURLs: false))
    #expect(try await repository.syncConfiguration()?.phase == "epochConflict")
    #expect(try await repository.syncConfiguration()?.enabled == false)
    #expect(try await repository.nextSyncWire() == nil)
    #expect(try await repository.syncStatus().pending == 1)
    try await repository.close()
}
@Test func localChangeAndLogicalSequenceAreSavedTogetherAndNotExportedAsSyncMetadata() async throws {
    let url = temporaryURL(); defer { cleanup(url) }
    let repository = try await make(url)
    try await repository.create(VocabularyEntry(id: "fixture", word: "synthetic", timestamp: 1))
    _ = try await repository.record("fixture", context: "", url: "", definition: empty, timestamp: 2, eventID: "one")
    _ = try await repository.reset("fixture", timestamp: 3)
    let operations = try await repository.pendingOperations()
    #expect(operations.map(\.sequence) == [0, 1, 2])
    let reset = try #require(operations.first(where: { $0.kind == "reset" }))
    #expect(reset.observedRemoteVersion == 2)
    let data = try JSONValue.encoder().encode(try await repository.backup())
    let exported = try JSONDecoder().decode(JSONValue.self, from: data)
    #expect(exported["syncConfiguration"] == nil); #expect(exported["checkpoint"] == nil); #expect(exported["wire"] == nil)
    try await repository.close()
}

@Test func syncBackoffBlocksDependentRequestsWhileOtherEntriesCanProceed() async throws {
    let url = temporaryURL(); defer { cleanup(url) }
    let repository = try await make(url)
    try await repository.create(VocabularyEntry(id: "fixture", word: "synthetic", timestamp: 1, definition: empty))
    _ = try await repository.record("fixture", context: "", url: "", definition: empty, timestamp: 2)
    try await repository.create(VocabularyEntry(id: "another", word: "another", timestamp: 1))
    let first = try #require(try await repository.nextSyncWire())
    try await repository.rejectSyncWire(first.id, code: "NETWORK_UNAVAILABLE", retryable: true, now: 1000)
    let other = try #require(try await repository.nextSyncWire(now: 1001))
    #expect(other.entryId == "another")
    #expect(try await repository.pendingOperations().first(where: { $0.kind == "record" })?.wireCount == nil)
    try await repository.close()
}

@Test func syncMultiChunkNoOpAcknowledgementsSetTheActualDependentCASVersion() async throws {
    let url = temporaryURL(); defer { cleanup(url) }
    let repository = try await make(url)
    var entry = VocabularyEntry(id: "fixture", word: "synthetic", count: 0.5, timestamp: 1, definition: empty)
    entry.history = (0..<26).map { Encounter(id: "history-\($0)", timestamp: Double($0), context: "private", url: "", definition: empty) }
    try await repository.create(entry)
    _ = try await repository.reset(entry.id, timestamp: 30)
    let create = try #require(try await repository.nextSyncWire()); try await acknowledge(repository, wire: create, entry: remote(count: 0.5))
    #expect(try await repository.syncStatus().pending == 2)
    let firstHistory = try #require(try await repository.nextSyncWire())
    let body = try JSONDecoder().decode(APIOperation.self, from: firstHistory.body)
    #expect(body.kind == "importHistory"); #expect(body.payload["events"]?.items?.count == 25)
    try await acknowledge(repository, wire: firstHistory, entry: remote(count: 0.5, version: 2))
    let secondHistory = try #require(try await repository.nextSyncWire())
    // A distinct history request containing only an already present event does
    // not advance the server version. Dependent reset must use 2, not 3.
    try await acknowledge(repository, wire: secondHistory, entry: remote(count: 0.5, version: 2))
    let reset = try #require(try await repository.nextSyncWire())
    #expect(try JSONDecoder().decode(APIOperation.self, from: reset.body).baseVersion == 2)
    try await acknowledge(repository, wire: reset, entry: remote(count: 0, version: 3))
    #expect(try await repository.syncStatus().pending == 0)
    #expect(try await repository.entry(entry.id)?.count == 0)
    #expect(try await repository.entry(entry.id)?.history.count == 26)
    try await repository.close()
}

@Test func syncPartialLegacyMergeDoesNotApplyCountAgainWhileHistoryRemainsUnsent() async throws {
    let url = temporaryURL(); defer { cleanup(url) }
    let repository = try await make(url)
    try await repository.applySyncPage(.init(epoch: "epoch-A", boundary: 1, nextCursor: 1, hasMore: false,
        changes: [.init(sequence: 1, entry: remote(count: 3))]), snapshot: false, histories: ["fixture": []])
    let events: [JSONValue] = (0..<26).map { .object(["timestamp": .number(Double($0)), "context": .string("private"), "url": .string(""), "definition": empty]) }
    let data = try JSONValue.encoder().encode(JSONValue.array([.object(["word": .string("synthetic"), "count": .number(0.5),
        "createdAt": .number(1), "updatedAt": .number(1), "history": .array(events)])]))
    let preview = try await repository.previewLegacy(data, mode: .legacyMerge)
    try await repository.begin(preview); try await repository.resumeImport(preview.id)
    let merge = try #require(try await repository.nextSyncWire())
    #expect(try JSONDecoder().decode(APIOperation.self, from: merge.body).kind == "legacyMerge")
    try await acknowledge(repository, wire: merge, entry: remote(count: 3.5, version: 2))
    #expect(try await repository.entry("fixture")?.count == 3.5)
    #expect(try await repository.syncStatus().pending == 1)
    try await repository.close()
    let reopened = try LocalRepository(url: url, owner: SyncConfiguration.owner(for: identity))
    let history = try #require(try await reopened.nextSyncWire())
    try await acknowledge(reopened, wire: history, entry: remote(count: 3.5, version: 3))
    #expect(try await reopened.entry("fixture")?.count == 3.5)
    let last = try #require(try await reopened.nextSyncWire())
    try await acknowledge(reopened, wire: last, entry: remote(count: 3.5, version: 4))
    #expect(try await reopened.syncStatus().pending == 0)
    try await reopened.close()
}

@Test func syncHistoryAndCursorRollbackTogetherAndResumeWithoutDoubleProjection() async throws {
    let url = temporaryURL(); defer { cleanup(url) }
    let repository = try await make(url)
    try await repository.applySyncPage(.init(epoch: "epoch-A", boundary: 1, nextCursor: 1, hasMore: false,
        changes: [.init(sequence: 1, entry: remote(count: 0))]), snapshot: false, histories: ["fixture": []])
    _ = try await repository.record("fixture", context: "local private", url: "", definition: empty, timestamp: 2, eventID: "event-one")
    try await repository.applySyncPage(.init(epoch: "epoch-A", boundary: 2, nextCursor: 2, hasMore: false,
        changes: [.init(sequence: 2, entry: remote(count: 1, version: 2))]), snapshot: false)
    #expect(try await repository.entry("fixture")?.count == 1)
    #expect(try await repository.nextSyncWire() == nil)
    let checkpoint = try #require(try await repository.pendingSyncHistory())
    let page = APIHistoryPage(nextCursor: "event-one", hasMore: false, events: [.init(id: "event-one", timestamp: 2, definition: empty, context: nil, url: nil)])
    await #expect(throws: (any Error).self) { try await repository.applySyncHistoryPage(page, checkpoint: checkpoint, epoch: "epoch-A", fault: .invalidSave) }
    #expect(try await repository.pendingSyncHistory() == checkpoint)
    try await repository.close()
    let reopened = try LocalRepository(url: url, owner: SyncConfiguration.owner(for: identity))
    try await reopened.applySyncHistoryPage(page, checkpoint: checkpoint, epoch: "epoch-A")
    #expect(try await reopened.pendingSyncHistory() == nil)
    #expect(try await reopened.entry("fixture")?.count == 1)
    #expect(try await reopened.entry("fixture")?.history.first?.context == "local private")
    #expect(try await reopened.nextSyncWire() != nil)
    try await reopened.close()
}

@Test func syncRejectedReviewRollsBackScheduleAndAdmissionWhileRetainingTheEvent() async throws {
    let url = temporaryURL(); defer { cleanup(url) }
    let repository = try await make(url)
    try await repository.applySyncPage(.init(epoch: "epoch-A", boundary: 1, nextCursor: 1, hasMore: false,
        changes: [.init(sequence: 1, entry: remote(count: 7))]), snapshot: false, histories: ["fixture": []])
    let time: Double = 1_700_000_000_000
    let local = try #require(try await repository.entry("fixture"))
    let answered = try await repository.answerReview("fixture", result: .remembered, expectedReviewVersion: local.effectiveReviewVersion,
        timestamp: time, timeZoneID: "UTC", eventID: "quota-rejected-review")
    let wire = try #require(try await repository.nextSyncWire())
    #expect(answered.review?.step == 0)
    try await repository.rejectSyncWire(wire.id, code: "DAILY_NEW_LIMIT", retryable: false)
    #expect(try await repository.entry("fixture")?.review == nil)
    #expect(try await repository.entry("fixture")?.count == 7)
    #expect(try await repository.entry("fixture")?.reviewEvents.map(\.id) == ["quota-rejected-review"])
    #expect(try await repository.reviewQueue(at: time, timeZoneID: "UTC").remainingNewAllowance == 20)
    #expect(try await repository.syncConflicts().first?.code == "DAILY_NEW_LIMIT")
    try await repository.close()
}

@Test func syncPullOfAlreadyAppliedReviewDoesNotAdvanceThePendingAnswerAgain() async throws {
    let url = temporaryURL(); defer { cleanup(url) }
    let repository = try await make(url)
    try await repository.applySyncPage(.init(epoch: "epoch-A", boundary: 1, nextCursor: 1, hasMore: false,
        changes: [.init(sequence: 1, entry: remote(count: 7))]), snapshot: false, histories: ["fixture": []])
    let time: Double = 1_700_000_000_000
    let local = try #require(try await repository.entry("fixture"))
    let answered = try await repository.answerReview("fixture", result: .remembered, expectedReviewVersion: local.effectiveReviewVersion,
        timestamp: time, timeZoneID: "UTC", eventID: "pending-review")
    var server = remote(count: 7, version: 2)
    server.review = APIReview(algorithmVersion: "review-v1", step: 0, dueAtMs: answered.review!.dueAtMs); server.reviewVersion = 1
    try await repository.applySyncPage(.init(epoch: "epoch-A", boundary: 2, nextCursor: 2, hasMore: false,
        changes: [.init(sequence: 2, entry: server)]), snapshot: false, histories: ["fixture": []])
    #expect(try await repository.entry("fixture")?.review?.step == 0)
    #expect(try await repository.entry("fixture")?.review?.dueAtMs == answered.review?.dueAtMs)
    let wire = try #require(try await repository.nextSyncWire())
    #expect(try JSONDecoder().decode(APIOperation.self, from: wire.body).baseVersion == 1)
    try await acknowledge(repository, wire: wire, entry: server, cursor: 2)
    #expect(try await repository.entry("fixture")?.review?.step == 0)
    try await repository.close()
}

@Test func syncV3UpgradePreservesCapturesAndEstablishesDurableOperationOrder() async throws {
    let url = temporaryURL(); defer { cleanup(url) }
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    let coordinator = NSPersistentStoreCoordinator(managedObjectModel: StoreModelV3.make())
    let old = try coordinator.addPersistentStore(ofType: NSSQLiteStoreType, configurationName: nil, at: url)
    let context = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType); context.persistentStoreCoordinator = coordinator
    let draft = CaptureDraft(text: "synthetic durable capture", createdAtMs: 1)
    try context.performAndWait {
        let partition = NSEntityDescription.insertNewObject(forEntityName: "Partition", into: context)
        partition.setValue("anonymous", forKey: "owner"); partition.setValue("old-generation", forKey: "generation"); partition.setValue(0, forKey: "revision")
        let entry = VocabularyEntry(id: "fixture", word: "synthetic", count: 0.5, timestamp: 1, definition: empty)
        try LocalRepository.writeEntry(entry, context, "anonymous", "old-generation")
        for operation in [PendingOperation(id: "reset-old", owner: "anonymous", entryID: entry.id, kind: "reset", baseVersion: 1, payload: .object([:])),
            PendingOperation(id: "create-old", owner: "anonymous", entryID: entry.id, kind: "create", baseVersion: 0, payload: try LocalRepository.json(entry))] {
            let row = NSEntityDescription.insertNewObject(forEntityName: "Operation", into: context)
            row.setValue("anonymous", forKey: "owner"); row.setValue("old-generation", forKey: "generation"); row.setValue(operation.id, forKey: "id")
            row.setValue(try JSONValue.encoder().encode(operation), forKey: "payload")
        }
        let capture = NSEntityDescription.insertNewObject(forEntityName: "Capture", into: context)
        capture.setValue("anonymous", forKey: "owner"); capture.setValue(draft.id, forKey: "id"); capture.setValue("pending", forKey: "state")
        capture.setValue(1.0, forKey: "createdAt"); capture.setValue(try JSONValue.encoder().encode(draft), forKey: "payload")
        try context.save(); context.reset()
    }
    try coordinator.remove(old)
    let migrated = try LocalRepository(url: url)
    #expect(try await migrated.captureDrafts() == [draft])
    #expect(try await migrated.pendingOperations().map(\.id) == ["create-old", "reset-old"])
    #expect(try await migrated.pendingOperations().map(\.sequence) == [0, 1])
    _ = try await migrated.record("fixture", context: "", url: "", definition: empty, timestamp: 2, eventID: "new-event")
    #expect(try await migrated.pendingOperations().map(\.sequence) == [0, 1, 2])
    #expect(try await migrated.entry("fixture")?.count == 1.5)
    #expect(FileManager.default.fileExists(atPath: url.deletingLastPathComponent().appendingPathComponent("pre-upgrade-recovery.sqlite").path))
    try await migrated.close()
}

@Test func syncAdditiveAcknowledgementCannotRebaseAnEditOverUnseenRemoteChanges() async throws {
    let url = temporaryURL(); defer { cleanup(url) }
    let repository = try await make(url)
    try await repository.applySyncPage(.init(epoch: "epoch-A", boundary: 1, nextCursor: 1, hasMore: false,
        changes: [.init(sequence: 1, entry: remote(count: 0))]), snapshot: false, histories: ["fixture": []])
    let clicked = try await repository.record("fixture", context: "", url: "", definition: empty, timestamp: 2, eventID: "local-click")
    _ = try await repository.update("fixture", expectedVersion: clicked.version, definition: empty, notes: "local edit based on version one")
    let record = try #require(try await repository.nextSyncWire())
    // Two remote changes committed before this additive click. Its successful
    // version 4 acknowledgement does not authorize overwriting those changes.
    try await acknowledge(repository, wire: record, entry: remote(count: 3, version: 4, notes: "unseen other-device edit"))
    let edit = try #require(try await repository.nextSyncWire())
    #expect(try JSONDecoder().decode(APIOperation.self, from: edit.body).baseVersion == 2)
    try await repository.rejectSyncWire(edit.id, code: "VERSION_CONFLICT", retryable: false)
    #expect(try await repository.syncConflicts().count == 1)
    #expect(try await repository.entry("fixture")?.notes == "local edit based on version one")
    try await repository.close()
}

@Test func syncHistoryRestoresSourceOrderAndStableTimestampOrderAfterAllIdPages() async throws {
    let url = temporaryURL(); defer { cleanup(url) }
    let repository = try await make(url)
    var baseline = remote(count: 3); baseline.historyOrdering = "retained"
    try await repository.applySyncPage(.init(epoch: "epoch-A", boundary: 1, nextCursor: 1, hasMore: false,
        changes: [.init(sequence: 1, entry: baseline)]), snapshot: false)
    let first = try #require(try await repository.pendingSyncHistory())
    let a = APIHistoryPage.Event(id: "a-second", timestamp: 10, definition: empty, context: nil, url: nil, position: 2)
    let m = APIHistoryPage.Event(id: "m-third", timestamp: 10, definition: empty, context: nil, url: nil, position: 3)
    let z = APIHistoryPage.Event(id: "z-first", timestamp: 30, definition: empty, context: nil, url: nil, position: 1)
    try await repository.applySyncHistoryPage(.init(nextCursor: "a-second", hasMore: true, events: [a]), checkpoint: first, epoch: "epoch-A")
    try await repository.close()
    let reopened = try LocalRepository(url: url, owner: SyncConfiguration.owner(for: identity))
    let next = try #require(try await reopened.pendingSyncHistory())
    try await reopened.applySyncHistoryPage(.init(nextCursor: "z-first", hasMore: false, events: [m, z]), checkpoint: next, epoch: "epoch-A")
    #expect(try await reopened.entry("fixture")?.history.map(\.id) == ["z-first", "a-second", "m-third"])
    var merged = baseline; merged.historyOrdering = "timestamp"; merged.version = 2
    try await reopened.applySyncPage(.init(epoch: "epoch-A", boundary: 2, nextCursor: 2, hasMore: false,
        changes: [.init(sequence: 2, entry: merged)]), snapshot: false)
    let final = try #require(try await reopened.pendingSyncHistory())
    try await reopened.applySyncHistoryPage(.init(nextCursor: "z-first", hasMore: false, events: [a, m, z]), checkpoint: final, epoch: "epoch-A")
    #expect(try await reopened.entry("fixture")?.history.map(\.id) == ["a-second", "m-third", "z-first"])
    #expect(try await reopened.entry("fixture")?.count == 3)
    try await reopened.close()
}

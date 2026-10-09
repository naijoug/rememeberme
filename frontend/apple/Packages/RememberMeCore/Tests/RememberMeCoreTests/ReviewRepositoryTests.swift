import Foundation
@preconcurrency import CoreData
import Testing
@testable import RememberMeCore

private func storeURL() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent("rememberme-review-\(UUID().uuidString)/store.sqlite") }
private func cleanup(_ url: URL) { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }

@Test func reviewIsAtomicIdempotentAndIndependentFromForgottenCount() async throws {
    let url = storeURL(); defer { cleanup(url) }
    let store = try LocalRepository(url: url)
    try await store.create(VocabularyEntry(id: "fixture", word: "synthetic", count: 7, timestamp: 1))
    let time: Double = 1_700_000_000_000
    let initial = try await store.reviewQueue(at: time, timeZoneID: "Asia/Shanghai")
    #expect(initial.entries.count == 1); #expect(initial.dueCount == 0); #expect(initial.remainingNewAllowance == 20)
    await #expect(throws: (any Error).self) {
        try await store.answerReview("fixture", result: .remembered, expectedReviewVersion: 0,
            timestamp: time, timeZoneID: "Asia/Shanghai", eventID: "failed-event", fault: .invalidSave)
    }
    #expect(try await store.reviewQueue(at: time, timeZoneID: "Asia/Shanghai").remainingNewAllowance == 20)
    #expect(try await store.entry("fixture")?.review == nil)
    let first = try await store.answerReview("fixture", result: .remembered, expectedReviewVersion: 0,
        timestamp: time, timeZoneID: "Asia/Shanghai", eventID: "review-1")
    #expect(first.count == 7); #expect(first.history.isEmpty); #expect(first.review?.step == 0)
    #expect(first.reviewEvents.count == 1)
    _ = try await store.answerReview("fixture", result: .remembered, expectedReviewVersion: 0,
        timestamp: time, timeZoneID: "Asia/Shanghai", eventID: "review-1")
    #expect(try await store.pendingOperations().count == 2)
    #expect(try await store.reviewQueue(at: time, timeZoneID: "Asia/Shanghai").entries.isEmpty)
    await #expect(throws: (any Error).self) {
        try await store.answerReview("fixture", result: .forgot, expectedReviewVersion: 0, timestamp: time)
    }
    try await store.close()
    let reopened = try LocalRepository(url: url)
    #expect(try await reopened.reviewQueue(at: time, timeZoneID: "Asia/Shanghai").remainingNewAllowance == 19)
    let boundary = time + ReviewAlgorithm.dayMs
    #expect(try await reopened.reviewQueue(at: boundary - 1, timeZoneID: "Asia/Shanghai").dueCount == 0)
    #expect(try await reopened.reviewQueue(at: boundary, timeZoneID: "Asia/Shanghai").dueCount == 1)
    let next = try await reopened.answerReview("fixture", result: .remembered, expectedReviewVersion: 1, timestamp: boundary)
    #expect(next.review?.step == 1); #expect(next.review?.dueAtMs == boundary + 3 * ReviewAlgorithm.dayMs)
    #expect(next.count == 7); try await reopened.close()
}

@Test func newWordQuotaAndDueOrderingUsePersistedLocalDate() async throws {
    let url = storeURL(); defer { cleanup(url) }
    let store = try LocalRepository(url: url)
    let time: Double = 1_700_000_000_000
    for index in 0..<23 { try await store.create(VocabularyEntry(id: "fixture-\(index)", word: "synthetic\(index)", timestamp: Double(index))) }
    #expect(try await store.reviewQueue(at: time, timeZoneID: "Asia/Shanghai").entries.count == 20)
    for index in 0..<20 {
        _ = try await store.answerReview("fixture-\(index)", result: .forgot, expectedReviewVersion: 0,
            timestamp: time, timeZoneID: "Asia/Shanghai")
    }
    #expect(try await store.reviewQueue(at: time, timeZoneID: "Asia/Shanghai").entries.isEmpty)
    await #expect(throws: (any Error).self) {
        try await store.answerReview("fixture-20", result: .forgot, expectedReviewVersion: 0, timestamp: time, timeZoneID: "Asia/Shanghai")
    }
    let tomorrow = try await store.reviewQueue(at: time + ReviewAlgorithm.dayMs, timeZoneID: "Asia/Shanghai")
    #expect(tomorrow.dueCount == 20); #expect(tomorrow.entries.count == 23)
    #expect(tomorrow.entries.prefix(20).allSatisfy { $0.review != nil })
    try await store.close()
}

@Test func reviewCalendarAndElapsedIntervalsHandleDST() throws {
    let formatter = ISO8601DateFormatter()
    let time = formatter.date(from: "2026-03-08T06:30:00Z")!.timeIntervalSince1970 * 1000
    #expect(try ReviewDate.localDay(time, timeZoneID: "America/New_York") == "2026-03-08")
    #expect(try ReviewDate.localDay(time, timeZoneID: "America/Los_Angeles") == "2026-03-07")
    let result = try ReviewAlgorithm.next(nil, result: .forgot, at: time)
    #expect(result.dueAtMs - time == ReviewAlgorithm.dayMs)
    #expect(throws: (any Error).self) { try ReviewDate.localDay(time, timeZoneID: "invalid") }
}

@Test func earlierStoreModelMigratesWithoutDiscardingValues() async throws {
    let url = storeURL(); defer { cleanup(url) }
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    let coordinator = NSPersistentStoreCoordinator(managedObjectModel: StoreModelV1.make())
    let sqlite = try coordinator.addPersistentStore(ofType: NSSQLiteStoreType, configurationName: nil, at: url)
    let context = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType); context.persistentStoreCoordinator = coordinator
    try context.performAndWait {
        let partition = NSEntityDescription.insertNewObject(forEntityName: "Partition", into: context)
        partition.setValue("anonymous", forKey: "owner"); partition.setValue("generation-v1", forKey: "generation"); partition.setValue(0, forKey: "revision")
        let entry = VocabularyEntry(id: "old-fixture", word: "synthetic", count: 0.5, timestamp: 1)
        let row = NSEntityDescription.insertNewObject(forEntityName: "Entry", into: context)
        row.setValue("anonymous", forKey: "owner"); row.setValue("generation-v1", forKey: "generation"); row.setValue(entry.id, forKey: "id")
        row.setValue(entry.word, forKey: "word"); row.setValue(LegacyCodec.keyBytes(entry.word), forKey: "keyBytes")
        row.setValue(entry.count, forKey: "count"); row.setValue(entry.updatedAt, forKey: "updatedAt"); row.setValue(false, forKey: "deleted")
        row.setValue(try JSONValue.encoder().encode(entry), forKey: "payload"); try context.save(); context.reset()
    }
    try coordinator.remove(sqlite)
    let migrated = try LocalRepository(url: url)
    #expect(try await migrated.entry("old-fixture")?.count == 0.5)
    #expect(try await migrated.reviewQueue(at: 1000).entries.first?.id == "old-fixture")
    #expect(FileManager.default.fileExists(atPath: url.deletingLastPathComponent().appendingPathComponent("pre-upgrade-recovery.sqlite").path))
    try await migrated.close()
}

@Test func reminderDatesSkipPastTimesAndUseCalendarDaysAcrossDST() throws {
    let formatter = ISO8601DateFormatter()
    let now = formatter.date(from: "2026-03-08T06:00:00Z")!
    let dates = try ReminderPlan.dates(after: now, hour: 2, minute: 30, timeZoneID: "America/New_York")
    #expect(dates.count == 7)
    #expect(dates.allSatisfy { $0 > now })
    #expect(Set(try dates.map { try ReviewDate.localDay($0.timeIntervalSince1970 * 1000, timeZoneID: "America/New_York") }).count == 7)
    let afterTime = formatter.date(from: "2026-10-08T14:00:00Z")!
    let local = try ReminderPlan.dates(after: afterTime, hour: 20, minute: 0, timeZoneID: "Asia/Shanghai", days: 1)
    #expect(try ReviewDate.localDay(local[0].timeIntervalSince1970 * 1000, timeZoneID: "Asia/Shanghai") == "2026-10-09")
    #expect(throws: (any Error).self) { try ReminderPlan.dates(after: now, hour: 24, minute: 0, timeZoneID: "Asia/Shanghai") }
}

@Test func unsupportedStoreVersionFailsWithoutDeletingOriginal() throws {
    let url = storeURL(); defer { cleanup(url) }
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    let model = NSManagedObjectModel()
    let entity = NSEntityDescription(); entity.name = "UnknownFutureEntity"; entity.managedObjectClassName = "NSManagedObject"
    let attribute = NSAttributeDescription(); attribute.name = "text"; attribute.attributeType = .stringAttributeType; attribute.isOptional = true
    entity.properties = [attribute]; model.entities = [entity]
    let coordinator = NSPersistentStoreCoordinator(managedObjectModel: model)
    let store = try coordinator.addPersistentStore(ofType: NSSQLiteStoreType, configurationName: nil, at: url)
    try coordinator.remove(store)
    #expect(throws: (any Error).self) { try LocalRepository(url: url) }
    let metadata = try NSPersistentStoreCoordinator.metadataForPersistentStore(ofType: NSSQLiteStoreType, at: url, options: nil)
    #expect(model.isConfiguration(withName: nil, compatibleWithStoreMetadata: metadata))
}

@Test func restoringEarlierScheduleCreatesNewReviewVersion() throws {
    var current = VocabularyEntry(id: "fixture", word: "synthetic")
    current.review = ReviewState(step: 3, dueAtMs: 1000, version: 5)
    var older = current; older.review = ReviewState(step: 1, dueAtMs: 2000, version: 1)
    let result = try RestorePlanner.merge(current: [current], backup: Backup(entries: [older], importSources: [], exportedAtMs: 1),
        choices: [current.id: .useBackup])
    #expect(result.entries[0].review?.version == 6)
    #expect(result.entries[0].review?.dueAtMs == 2000)
}

@Test func restoringUnstudiedStateDoesNotReuseZeroReviewVersion() async throws {
    let url = storeURL(); defer { cleanup(url) }
    let repository = try LocalRepository(url: url)
    let original = VocabularyEntry(id: "fixture", word: "synthetic", timestamp: 1)
    try await repository.create(original)
    let backup = try JSONValue.encoder().encode(try await repository.backup(timestamp: 1))
    _ = try await repository.answerReview(original.id, result: .remembered, expectedReviewVersion: 0, timestamp: 1000)
    let preview = try await repository.previewBackup(backup, mode: .restoreMerge, choices: [original.id: .useBackup])
    try await repository.begin(preview); try await repository.stage(preview, start: 0); try await repository.publish(preview.id)
    #expect(try await repository.entry(original.id)?.review == nil)
    #expect(try await repository.entry(original.id)?.effectiveReviewVersion == 2)
    await #expect(throws: (any Error).self) {
        try await repository.answerReview(original.id, result: .remembered, expectedReviewVersion: 0, timestamp: 1001)
    }
    let fresh = try await repository.answerReview(original.id, result: .remembered, expectedReviewVersion: 2, timestamp: 1001)
    #expect(fresh.review?.version == 3)
    try await repository.close()
}

@Test func reviewAdmissionSurvivesV2ToCaptureModelUpgrade() async throws {
    let url = storeURL(); defer { cleanup(url) }
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    let coordinator = NSPersistentStoreCoordinator(managedObjectModel: StoreModelV2.make())
    let old = try coordinator.addPersistentStore(ofType: NSSQLiteStoreType, configurationName: nil, at: url)
    let context = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType); context.persistentStoreCoordinator = coordinator
    let timestamp: Double = 1_700_000_000_000
    let day = try ReviewDate.localDay(timestamp, timeZoneID: "Asia/Shanghai")
    try context.performAndWait {
        let partition = NSEntityDescription.insertNewObject(forEntityName: "Partition", into: context)
        partition.setValue("anonymous", forKey: "owner"); partition.setValue("old-generation", forKey: "generation"); partition.setValue(0, forKey: "revision")
        let admission = NSEntityDescription.insertNewObject(forEntityName: "ReviewAdmission", into: context)
        admission.setValue("anonymous", forKey: "owner"); admission.setValue(day, forKey: "day")
        admission.setValue("old-review-event", forKey: "id"); admission.setValue("old-entry", forKey: "entryID")
        try context.save(); context.reset()
    }
    try coordinator.remove(old)
    let migrated = try LocalRepository(url: url)
    #expect(try await migrated.reviewQueue(at: timestamp, timeZoneID: "Asia/Shanghai").remainingNewAllowance == 19)
    #expect(try await migrated.captureDrafts().isEmpty)
    try await migrated.close()
}

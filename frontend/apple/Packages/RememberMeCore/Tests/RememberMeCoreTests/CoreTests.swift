import Foundation
import Testing
@testable import RememberMeCore

private let fixtures = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    .appendingPathComponent("../../../../../../contracts/fixtures").standardizedFileURL
private func fixture(_ name: String) throws -> Data { try Data(contentsOf: fixtures.appendingPathComponent(name)) }
private func temporaryURL() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent("rememberme-test-\(UUID().uuidString)/vocabulary.sqlite")
}
private func cleanup(_ url: URL) { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
private let definition: JSONValue = .object(["word": .string("synthetic"), "phonetics": .array([]), "meanings": .array([])])

@Test func legacyValidationMatchesCurrentExtension() throws {
    let cases = try JSONDecoder().decode(JSONValue.self, from: fixture("legacy-validation.json")).items!
    for test in cases {
        let bytes = try JSONValue.encoder().encode(test["data"]!)
        let expected = test["valid"] == .bool(true)
        do { _ = try LegacyCodec.decode(bytes); #expect(expected, "\(test["name"]!.text!)") }
        catch { #expect(!expected, "\(test["name"]!.text!): \(error)") }
    }
}

@Test func javascriptNormalizationUsesByteIdentity() throws {
    let cases = try JSONDecoder().decode(JSONValue.self, from: fixture("normalization.json")).items!
    for test in cases {
        #expect(Array(LegacyCodec.normalize(test["input"]!.text!).utf8) == Array(test["expected"]!.text!.utf8))
    }
    #expect(LegacyCodec.keyBytes(LegacyCodec.normalize("E\u{0301}")) != LegacyCodec.keyBytes(LegacyCodec.normalize("É")))
}

@Test func legacyRoundTripPreservesFractionsHistoryAndOptionalFields() throws {
    let decoded = try LegacyCodec.decode(fixture("legacy-shared.json"))
    #expect(decoded[0].count == 0.5)
    #expect(decoded[0].history.count == 2)
    #expect(decoded[0].history[0].id != decoded[0].history[1].id)
    #expect(decoded[0].history[1].navigableURL == nil)
    #expect(decoded[0].history[0].navigableURL?.host == "example.test")
    #expect(decoded[1].createdAt == 1e100)
    let exported = try JSONDecoder().decode(JSONValue.self, from: LegacyCodec.export(decoded)).items!
    let original = try JSONDecoder().decode(JSONValue.self, from: fixture("legacy-shared.json")).items!
    for (index, row) in original.enumerated() {
        #expect(exported[index]["history"] == row["history"])
        #expect(exported[index]["count"] == row["count"])
        #expect(exported[index]["createdAt"] == row["createdAt"])
    }
}

@Test func crossLanguageSourceAndEventIDs() throws {
    let expected = try JSONDecoder().decode(JSONValue.self, from: fixture("legacy-expected.json"))
    let bytes = try fixture("legacy-shared.json")
    #expect(LegacyCodec.digest(bytes) == expected["sourceDigest"]!.text!)
    let entries = try LegacyCodec.decode(bytes)
    for (entry, golden) in zip(entries, expected["entries"]!.items!) {
        #expect(entry.id == golden["id"]!.text!)
        #expect(entry.history.map(\.id) == golden["encounters"]!.items!.map { $0.text! })
    }
}

@Test func reviewMatchesSharedBoundaryFixtures() throws {
    let cases = try JSONDecoder().decode(JSONValue.self, from: fixture("review-v1.json")).items!
    for test in cases {
        let step = Int(test["step"]!.number!)
        let current = step < 0 ? nil : ReviewState(step: step, dueAtMs: 0, version: 1)
        let next = try ReviewAlgorithm.next(current, result: ReviewResult(rawValue: test["result"]!.text!)!, at: test["answeredAtMs"]!.number!)
        #expect(next.step == Int(test["nextStep"]!.number!))
        #expect(next.dueAtMs == test["dueAtMs"]!.number!)
    }
}

@Test func diskSaveAndOutboxRecoverTogetherAndResetRetainsHistory() async throws {
    let url = temporaryURL(); defer { cleanup(url) }
    let store = try LocalRepository(url: url)
    let entry = VocabularyEntry(id: "fixture", word: "synthetic")
    try await store.create(entry)
    let saved = try await store.record(entry.id, context: "<script>literal</script>", url: "file:///synthetic",
        definition: definition, timestamp: 1000, eventID: "event-1")
    #expect(saved.count == 1)
    _ = try await store.record(entry.id, context: "<script>literal</script>", url: "file:///synthetic",
        definition: definition, timestamp: 1000, eventID: "event-1")
    #expect(try await store.pendingOperations().count == 2)
    try await store.close()
    let reopened = try LocalRepository(url: url)
    #expect(try await reopened.entry(entry.id)?.history.count == 1)
    let reset = try await reopened.reset(entry.id, timestamp: 2000)
    #expect(reset.count == 0); #expect(reset.history.count == 1)
    #expect(reset.history[0].context == "<script>literal</script>")
    try await reopened.delete(entry.id)
    #expect(try await reopened.entries().isEmpty)
    #expect(try await reopened.entry(entry.id)?.deleted == true)
    #expect(try await reopened.pendingOperations().count == 4)
    try await reopened.close()
}

@Test func actualCoreDataSaveFailureRollsBackBothEntryAndOperation() async throws {
    let url = temporaryURL(); defer { cleanup(url) }
    let store = try LocalRepository(url: url)
    try await store.create(VocabularyEntry(id: "fixture", word: "synthetic"))
    await #expect(throws: (any Error).self) {
        try await store.record("fixture", context: "", url: "", definition: definition, timestamp: 1, fault: .invalidSave)
    }
    #expect(try await store.entry("fixture")?.count == nil)
    #expect(try await store.entry("fixture")?.history.isEmpty == true)
    #expect(try await store.pendingOperations().count == 1)
    try await store.close()
    let reopened = try LocalRepository(url: url)
    #expect(try await reopened.pendingOperations().count == 1)
    #expect(try await reopened.entry("fixture")?.history.isEmpty == true)
    try await reopened.close()
}

@Test func candidateFailureAndAtomicPublicationSurviveReopening() async throws {
    let url = temporaryURL(); defer { cleanup(url) }
    let store = try LocalRepository(url: url)
    let preview = try await store.previewLegacy(fixture("legacy-shared.json"), mode: .firstMigration)
    try await store.begin(preview)
    try await store.stage(preview, start: 0, limit: 1)
    #expect(try await store.entries().isEmpty)
    #expect(try await store.pendingOperations().isEmpty)
    await #expect(throws: (any Error).self) { try await store.stage(preview, start: 1, limit: 1, fault: .invalidSave) }
    #expect(try await store.entries().isEmpty)
    try await store.close()
    let reopened = try LocalRepository(url: url)
    #expect(try await reopened.entries().isEmpty)
    try await reopened.stage(preview, start: 1)
    await #expect(throws: (any Error).self) { try await reopened.publish(preview.id, fault: .invalidSave) }
    #expect(try await reopened.entries().isEmpty)
    #expect(try await reopened.batchState(preview.id) == "ready")
    try await reopened.publish(preview.id)
    try await reopened.publish(preview.id)
    #expect(try await reopened.entries().count == 3)
    #expect(try await reopened.pendingOperations().count == 3)
    try await reopened.close()
    let final = try LocalRepository(url: url)
    #expect(try await final.entries().count == 3)
    #expect(try await final.previewLegacy(fixture("legacy-shared.json"), mode: .firstMigration).alreadyImported)
    try await final.close()
}

@Test func revisionChangeCannotOverwriteConcurrentLocalWork() async throws {
    let url = temporaryURL(); defer { cleanup(url) }
    let store = try LocalRepository(url: url)
    let preview = try await store.previewLegacy(fixture("legacy-shared.json"), mode: .firstMigration)
    try await store.begin(preview); try await store.stage(preview, start: 0)
    try await store.create(VocabularyEntry(id: "newer", word: "newer"))
    await #expect(throws: ClientError.stalePreview) { try await store.publish(preview.id) }
    #expect(try await store.entries().map(\.id) == ["newer"])
    try await store.cancel(preview.id)
    #expect(try await store.batchState(preview.id) == "cancelled")
    try await store.close()
}

@Test func ownerPartitionsCannotReadEachOthersVocabularyOrOutbox() async throws {
    let url = temporaryURL(); defer { cleanup(url) }
    let first = try LocalRepository(url: url, owner: "test-user-A")
    try await first.create(VocabularyEntry(id: "fixture", word: "synthetic"))
    try await first.close()
    let second = try LocalRepository(url: url, owner: "test-user-B")
    #expect(try await second.entries().isEmpty)
    #expect(try await second.pendingOperations().isEmpty)
    try await second.close()
}

@Test func countPrecisionFailureDoesNotCreateEncounter() async throws {
    let url = temporaryURL(); defer { cleanup(url) }
    let store = try LocalRepository(url: url)
    try await store.create(VocabularyEntry(id: "large", word: "synthetic", count: 1e20))
    await #expect(throws: ClientError.invalidNumber) {
        try await store.record("large", context: "", url: "", definition: definition, timestamp: 1)
    }
    #expect(try await store.entry("large")?.count == 1e20)
    #expect(try await store.entry("large")?.history.isEmpty == true)
    #expect(try await store.pendingOperations().count == 1)
    try await store.close()
}

@Test func oldBackupRequiresExplicitChoiceAndNeverResurrectsTombstones() async throws {
    let url = temporaryURL(); defer { cleanup(url) }
    let store = try LocalRepository(url: url)
    let entry = VocabularyEntry(id: "fixture", word: "synthetic", count: 3)
    try await store.create(entry)
    let old = try JSONValue.encoder().encode(try await store.backup(timestamp: 1))
    _ = try await store.reset(entry.id, timestamp: 2)
    let conflict = try await store.previewBackup(old, mode: .restoreMerge)
    #expect(conflict.conflicts.count == 1)
    await #expect(throws: (any Error).self) { try await store.begin(conflict) }
    #expect(try await store.entry(entry.id)?.count == 0)
    let confirmed = try await store.previewBackup(old, mode: .restoreMerge, choices: [entry.id: .useBackup])
    try await store.begin(confirmed); try await store.stage(confirmed, start: 0); try await store.publish(confirmed.id)
    #expect(try await store.entry(entry.id)?.count == 3)
    #expect(try await store.entry(entry.id)?.version == 2)
    try await store.delete(entry.id)
    let tombstone = try await store.previewBackup(old, mode: .restoreMerge)
    #expect(tombstone.conflicts.count == 1)
    #expect(tombstone.conflicts[0].canUseBackup == false)
    let keep = try await store.previewBackup(old, mode: .restoreMerge, choices: [entry.id: .keepCurrent])
    #expect(keep.entries.isEmpty)
    #expect(keep.conflicts.isEmpty)
    #expect(try await store.entry(entry.id)?.deleted == true)
    let backup = try JSONDecoder().decode(JSONValue.self, from: JSONValue.encoder().encode(try await store.backup()))
    #expect(backup["outbox"] == nil); #expect(backup["checkpoint"] == nil)
    try await store.close()
}

@Test func restoringHistoricalEventsDoesNotReplayCountOrReview() throws {
    var existing = VocabularyEntry(id: "fixture", word: "synthetic", count: 0)
    existing.review = ReviewState(step: 1, dueAtMs: 123, version: 2)
    var incoming = existing
    incoming.history = [Encounter(id: "old-event", timestamp: 1, context: "", url: "", definition: definition)]
    incoming.reviewEvents = [ReviewEvent(id: "old-review", result: .remembered, answeredAtMs: 1, baseReviewVersion: 0)]
    let backup = Backup(entries: [incoming], importSources: [], exportedAtMs: 2)
    let result = try RestorePlanner.merge(current: [existing], backup: backup)
    #expect(result.conflicts.isEmpty)
    #expect(result.entries.first?.history.count == 1)
    #expect(result.entries.first?.count == 0)
    #expect(result.entries.first?.review == existing.review)
    let twice = try RestorePlanner.merge(current: result.entries, backup: backup)
    #expect(twice.entries.isEmpty)
}

@Test func changedImmutableEventCannotBeOverwrittenByBackup() throws {
    var existing = VocabularyEntry(id: "fixture", word: "synthetic", count: 1)
    existing.history = [Encounter(id: "same-ID", timestamp: 1, context: "original", url: "", definition: definition)]
    var incoming = existing; incoming.history[0].context = "different"
    let result = try RestorePlanner.merge(current: [existing], backup: Backup(entries: [incoming], importSources: [], exportedAtMs: 2),
        choices: [existing.id: .useBackup])
    #expect(result.entries.isEmpty)
    #expect(result.conflicts.first?.canUseBackup == false)
}

@Test func explicitLegacyMergeAccumulatesButMigrationRetryDoesNot() async throws {
    let url = temporaryURL(); defer { cleanup(url) }
    let store = try LocalRepository(url: url)
    let bytes = try fixture("legacy-shared.json")
    let seed = try await store.previewLegacy(bytes, mode: .firstMigration)
    try await store.begin(seed); try await store.stage(seed, start: 0); try await store.publish(seed.id)
    let merge = try await store.previewLegacy(bytes, mode: .legacyMerge)
    try await store.begin(merge); try await store.stage(merge, start: 0); try await store.publish(merge.id)
    #expect(try await store.entry(seed.entries[0].id)?.count == 1)
    #expect(try await store.entry(seed.entries[0].id)?.history.count == 4)
    #expect(try await store.previewLegacy(bytes, mode: .firstMigration).alreadyImported)
    let changedBytes = bytes + Data("\n".utf8)
    let newSource = try await store.previewLegacy(changedBytes, mode: .firstMigration)
    #expect(newSource.conflicts.count == 3)
    try await store.close()
}

@Test func newBackupDecodeRejectsUnsupportedAndMalformedRecords() throws {
    let entry = VocabularyEntry(id: "fixture", word: "synthetic")
    let backup = Backup(entries: [entry], importSources: [], exportedAtMs: 1)
    let bytes = try JSONValue.encoder().encode(backup)
    #expect(try BackupCodec.decode(bytes).entries[0].count == nil)
    var fields = try JSONDecoder().decode(JSONValue.self, from: bytes).fields!
    fields["schemaVersion"] = .number(2)
    #expect(throws: ClientError.unsupportedVersion) { try BackupCodec.decode(JSONValue.encoder().encode(JSONValue.object(fields))) }
}

@Test func backupDowngradeAndRestoreMatchCrossLanguageFixtures() throws {
    let backup = try BackupCodec.decode(fixture("backup-v1.json"))
    #expect(backup.entries[0].count == nil)
    let legacy = try JSONDecoder().decode(JSONValue.self, from: LegacyCodec.export(backup.entries))
    let expected = try JSONDecoder().decode(JSONValue.self, from: fixture("backup-legacy-expected.json"))
    #expect(legacy == expected)
    for test in try JSONDecoder().decode(JSONValue.self, from: fixture("restore-v1.json")).items! {
        var current = VocabularyEntry(id: "fixture", word: "synthetic", count: test["currentCount"]!.number!)
        current.deleted = test["deleted"] == .bool(true)
        var incoming = current; incoming.count = test["backupCount"]!.number!; incoming.deleted = false
        let choice = test["choice"]?.text.flatMap(RestoreChoice.init(rawValue:))
        let choices = choice.map { [current.id: $0] } ?? [:]
        let result = try RestorePlanner.merge(current: [current], backup: Backup(entries: [incoming], importSources: [], exportedAtMs: 1), choices: choices)
        #expect(!result.conflicts.isEmpty == (test["conflict"] == .bool(true)))
        if let canUse = test["canUseBackup"] { #expect(result.conflicts.first?.canUseBackup == (canUse == .bool(true))) }
        if test["conflict"] == .bool(false) {
            #expect((result.entries.first ?? current).count == test["expectedCount"]?.number)
        }
    }
}

@Test func overlappingClientsUseOneActorWithoutLosingIntentionalClicks() async throws {
    let url = temporaryURL(); defer { cleanup(url) }
    let store = try LocalRepository(url: url)
    try await store.create(VocabularyEntry(id: "fixture", word: "synthetic"))
    try await withThrowingTaskGroup(of: Void.self) { group in
        for index in 0..<50 {
            group.addTask {
                _ = try await store.record("fixture", context: "same sentence", url: "", definition: definition,
                    timestamp: 1, eventID: "intentional-click-\(index)")
            }
        }
        try await group.waitForAll()
    }
    #expect(try await store.entry("fixture")?.count == 50)
    #expect(try await store.entry("fixture")?.history.count == 50)
    #expect(try await store.pendingOperations().count == 51)
    await #expect(throws: ClientError.conflict("encounter ID reused")) {
        try await store.record("fixture", context: "different content", url: "", definition: definition,
            timestamp: 1, eventID: "intentional-click-0")
    }
    try await store.close()
}

@Test func malformedBackupVersionAndNormalizedKeyAreRejectedBeforePublication() throws {
    let entry = VocabularyEntry(id: "fixture", word: "synthetic")
    let backup = Backup(entries: [entry], importSources: [], exportedAtMs: 1)
    var root = try JSONDecoder().decode(JSONValue.self, from: JSONValue.encoder().encode(backup)).fields!
    var fields = root["entries"]!.items![0].fields!
    fields["version"] = .number(1e18); root["entries"] = .array([.object(fields)])
    #expect(throws: (any Error).self) { try BackupCodec.decode(JSONValue.encoder().encode(JSONValue.object(root))) }
    fields["version"] = .number(0); fields["normalizedKey"] = .string("different")
    root["entries"] = .array([.object(fields)])
    #expect(throws: (any Error).self) { try BackupCodec.decode(JSONValue.encoder().encode(JSONValue.object(root))) }
    #expect(throws: (any Error).self) { try VersionToken.next(Int.max) }
}

@Test func replacingAnonymousBackupInvalidatesPreviouslyOpenedEditors() async throws {
    let url = temporaryURL(); defer { cleanup(url) }
    let store = try LocalRepository(url: url)
    let entry = VocabularyEntry(id: "fixture", word: "synthetic", count: 1)
    try await store.create(entry)
    let old = try JSONValue.encoder().encode(try await store.backup(timestamp: 1))
    let preview = try await store.previewBackup(old, mode: .replaceAnonymous)
    try await store.begin(preview); try await store.stage(preview, start: 0); try await store.publish(preview.id)
    #expect(try await store.entry(entry.id)?.version == 1)
    await #expect(throws: (any Error).self) {
        try await store.update(entry.id, expectedVersion: entry.version, definition: entry.definition, notes: "stale edit")
    }
    #expect(try await store.entry(entry.id)?.notes == "")
    try await store.close()
}

import Foundation
@preconcurrency import CoreData
import Testing
@testable import RememberMeCore

private func temporaryStore() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent("rememberme-import-recovery-\(UUID().uuidString)/store.sqlite") }
private func cleanup(_ url: URL) { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
private let definition: JSONValue = .object(["word": .string("synthetic"), "phonetics": .array([]), "meanings": .array([])])
private func data(_ words: [(String, Double)]) throws -> Data {
    try LegacyCodec.export(words.map { word, count in VocabularyEntry(word: word, count: count, timestamp: 1) })
}

@Test func interruptedCopyResumesFromItsDurableCursorWithoutChangingActiveData() async throws {
    let url = temporaryStore(); defer { cleanup(url) }
    let repository = try LocalRepository(url: url)
    for index in 0..<3 {
        var entry = VocabularyEntry(id: "original-\(index)", word: "original\(index)", count: 2, timestamp: 1)
        entry.history = [Encounter(id: "history-\(index)", timestamp: 1, context: "Synthetic history", url: "", definition: definition)]
        try await repository.create(entry)
    }
    let original = try await repository.backup(timestamp: 5)
    let preview = try await repository.previewLegacy(data([("imported", 3)]), mode: .firstMigration)
    try await repository.begin(preview)
    #expect(try await repository.batchState(preview.id) == "copying")
    await #expect(throws: (any Error).self) { try await repository.copyImportChunk(preview.id, limit: 1, fault: .invalidSave) }
    #expect(try await repository.importRecovery(preview.id).copied == 0)
    let copied = try await repository.copyImportChunk(preview.id, limit: 1)
    #expect(copied.copied == 1); #expect(copied.state == "copying")
    #expect(try await repository.backup(timestamp: 5) == original)
    try await repository.close()
    let reopened = try LocalRepository(url: url)
    #expect(try await reopened.recoverableImports().count == 1)
    #expect(try await reopened.importRecovery(preview.id).copied == 1)
    try await reopened.resumeImport(preview.id, chunkSize: 1)
    #expect(try await reopened.entries().count == 4)
    #expect(try await reopened.pendingOperations().count == 4)
    for entry in original.entries { #expect(try await reopened.entry(entry.id) == entry) }
    #expect(try await reopened.recoverableImports().isEmpty)
    try await reopened.close()
}

@Test func interruptedLegacyMergeUsesOriginalPlanAndOperationIDsExactlyOnce() async throws {
    let url = temporaryStore(); defer { cleanup(url) }
    let repository = try LocalRepository(url: url)
    try await repository.create(VocabularyEntry(id: "existing", word: "existing", count: 4, timestamp: 1))
    let preview = try await repository.previewLegacy(data([("existing", 0.5), ("newword", 2)]), mode: .legacyMerge)
    try await repository.begin(preview)
    try await repository.stage(preview, start: 0, limit: 1)
    #expect(try await repository.entry("existing")?.count == 4)
    #expect(try await repository.importRecovery(preview.id).processed == 1)
    try await repository.close()
    let reopened = try LocalRepository(url: url)
    let recovered = try await reopened.loadImportPlan(preview.id)
    #expect(recovered == preview)
    try await reopened.resumeImport(preview.id, chunkSize: 1)
    try await reopened.publish(preview.id)
    #expect(try await reopened.entry("existing")?.count == 4.5)
    let operations = try await reopened.pendingOperations()
    #expect(operations.count == 3)
    #expect(Set(preview.operations.map(\.id)).isSubset(of: Set(operations.map(\.id))))
    try await reopened.close()
}

@Test func resumedCopyCannotReplaceWorkCommittedAfterItsPreview() async throws {
    let url = temporaryStore(); defer { cleanup(url) }
    let repository = try LocalRepository(url: url)
    try await repository.create(VocabularyEntry(id: "existing", word: "existing", timestamp: 1))
    let preview = try await repository.previewLegacy(data([("newword", 2)]), mode: .firstMigration)
    try await repository.begin(preview); try await repository.copyImportChunk(preview.id, limit: 1)
    _ = try await repository.record("existing", context: "new local work", url: "", definition: definition, timestamp: 2)
    try await repository.close()
    let reopened = try LocalRepository(url: url)
    #expect(try await reopened.importRecovery(preview.id).canResume == false)
    await #expect(throws: ClientError.stalePreview) { try await reopened.resumeImport(preview.id) }
    #expect(try await reopened.entry("existing")?.count == 1)
    #expect(try await reopened.entries().count == 1)
    try await reopened.cancel(preview.id)
    #expect(try await reopened.recoverableImports().isEmpty)
    #expect(try await reopened.entry("existing")?.history.count == 1)
    try await reopened.close()
}

@Test func changedConfirmedChunkIsRejectedAndOriginalPlanRemainsRecoverable() async throws {
    let url = temporaryStore(); defer { cleanup(url) }
    let repository = try LocalRepository(url: url)
    var preview = try await repository.previewLegacy(data([("newword", 2)]), mode: .firstMigration)
    try await repository.begin(preview)
    preview.entries[0].count = 999
    await #expect(throws: (any Error).self) { try await repository.stage(preview, start: 0) }
    #expect(try await repository.entries().isEmpty)
    #expect(try await repository.importRecovery(preview.id).processed == 0)
    try await repository.close()
    let reopened = try LocalRepository(url: url)
    try await reopened.resumeImport(preview.id)
    #expect(try await reopened.entries().first?.count == 2)
    try await reopened.close()
}

@Test func damagedPrivatePlanNeverPublishesAndCanBeDiscarded() async throws {
    let url = temporaryStore(); defer { cleanup(url) }
    let repository = try LocalRepository(url: url)
    let preview = try await repository.previewLegacy(data([("newword", 2)]), mode: .firstMigration)
    try await repository.begin(preview); try await repository.close()
    let directory = url.deletingLastPathComponent().appendingPathComponent(url.lastPathComponent + "-import-plans")
        .appendingPathComponent(LegacyCodec.digest(Data("anonymous".utf8)))
    let file = try ImportPlanFiles.file(directory, id: preview.id)
    try Data("not the confirmed plan".utf8).write(to: file)
    let reopened = try LocalRepository(url: url)
    await #expect(throws: (any Error).self) { try await reopened.resumeImport(preview.id) }
    #expect(try await reopened.entries().isEmpty)
    try await reopened.cancel(preview.id)
    #expect(!FileManager.default.fileExists(atPath: file.path))
    #expect(try await reopened.recoverableImports().isEmpty)
    try await reopened.close()
}

@Test func cancelledCleanupSurvivesAnInterruptedCallerAndCanFinishAfterRestart() async throws {
    let url = temporaryStore(); defer { cleanup(url) }
    let repository = try LocalRepository(url: url)
    try await repository.create(VocabularyEntry(id: "existing", word: "existing", timestamp: 1))
    let preview = try await repository.previewLegacy(data([("newword", 2)]), mode: .firstMigration)
    try await repository.begin(preview); try await repository.copyImportChunk(preview.id, limit: 1)
    let cancel = Task { try await repository.cancel(preview.id) }
    cancel.cancel()
    await #expect(throws: (any Error).self) { try await cancel.value }
    #expect(try await repository.batchState(preview.id) == "cancelled")
    try await repository.close()
    let reopened = try LocalRepository(url: url)
    #expect(try await reopened.recoverableImports().first?.state == "cancelled")
    try await reopened.cancel(preview.id)
    #expect(try await reopened.recoverableImports().isEmpty)
    #expect(try await reopened.entries().map(\.id) == ["existing"])
    try await reopened.close()
}

@Test func pruningKeepsCurrentRecoveryPointAndInFlightCopies() async throws {
    let url = temporaryStore(); defer { cleanup(url) }
    let repository = try LocalRepository(url: url)
    try await repository.create(VocabularyEntry(id: "existing", word: "existing", timestamp: 1))
    for word in ["second", "third"] {
        let preview = try await repository.previewLegacy(data([(word, 2)]), mode: .firstMigration)
        try await repository.begin(preview); try await repository.stage(preview, start: 0); try await repository.publish(preview.id)
    }
    let snapshot = try await repository.backup(timestamp: 5)
    let pending = try await repository.previewLegacy(data([("fourth", 2)]), mode: .firstMigration)
    try await repository.begin(pending); try await repository.copyImportChunk(pending.id, limit: 1)
    let result = try await repository.pruneImportGenerations(chunkSize: 1)
    #expect(result.removedRows > 0); #expect(!result.retainedLegacyGenerations)
    #expect(try await repository.backup(timestamp: 5) == snapshot)
    #expect(try await repository.importRecovery(pending.id).canResume)
    try await repository.resumeImport(pending.id)
    #expect(try await repository.entries().count == 4)
    #expect(try await repository.pendingOperations().count == 4)
    // Directly inspect row generations to prove pruning retained one recovery point.
    try await repository.close()
    let coordinator = NSPersistentStoreCoordinator(managedObjectModel: StoreModelV4.make())
    let store = try coordinator.addPersistentStore(ofType: NSSQLiteStoreType, configurationName: nil, at: url)
    let context = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType); context.persistentStoreCoordinator = coordinator
    try context.performAndWait {
        let rows = try context.fetch(NSFetchRequest<NSManagedObject>(entityName: "Entry"))
        #expect(Set(rows.map { $0.value(forKey: "generation") as! String }).count >= 2)
        context.reset()
    }
    try coordinator.remove(store)
}

@Test func interruptedImportsAreIsolatedByOwner() async throws {
    let url = temporaryStore(); defer { cleanup(url) }
    let first = try LocalRepository(url: url, owner: "synthetic-owner-A")
    let preview = try await first.previewLegacy(data([("newword", 2)]), mode: .firstMigration)
    try await first.begin(preview); try await first.close()
    let second = try LocalRepository(url: url, owner: "synthetic-owner-B")
    #expect(try await second.recoverableImports().isEmpty)
    await #expect(throws: (any Error).self) { try await second.resumeImport(preview.id) }
    #expect(try await second.entries().isEmpty)
    try await second.close()
}

@Test func olderFullJsonRecoveryPlanRemainsReadable() async throws {
    let url = temporaryStore(); defer { cleanup(url) }
    let repository = try LocalRepository(url: url)
    let preview = try await repository.previewLegacy(data([("legacyplan", 3)]), mode: .firstMigration)
    let directory = url.deletingLastPathComponent().appendingPathComponent("legacy-plan-fixture")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let bytes = try JSONValue.encoder().encode(preview)
    try bytes.write(to: ImportPlanFiles.file(directory, id: preview.id))
    let manifest = ImportJobManifest(mode: preview.mode, sourceGeneration: "synthetic-source", sources: preview.sources,
        planDigest: LegacyCodec.digest(bytes), planBytes: bytes.count, createdAtMs: 1,
        copyEntityIndex: 0, copyOffset: 0, copied: 0, copyTotal: 0)
    #expect(try ImportPlanFiles.load(directory, id: preview.id, manifest: manifest) == preview)
    try await repository.close()
}

@Test func streamedPlanPreservesOperationOrderAcrossDifferentEntries() async throws {
    let url = temporaryStore(); defer { cleanup(url) }
    let repository = try LocalRepository(url: url)
    var preview = try await repository.previewLegacy(data([("firstword", 2), ("secondword", 3)]), mode: .firstMigration)
    preview.operations.reverse()
    try await repository.begin(preview); try await repository.close()
    let reopened = try LocalRepository(url: url)
    #expect(try await reopened.loadImportPlan(preview.id) == preview)
    try await reopened.resumeImport(preview.id)
    #expect(try await reopened.entries().count == 2)
    #expect(try await reopened.pendingOperations().count == 2)
    try await reopened.close()
}

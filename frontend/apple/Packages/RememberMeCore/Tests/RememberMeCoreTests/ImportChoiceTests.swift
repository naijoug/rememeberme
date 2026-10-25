import Foundation
import Testing
@testable import RememberMeCore

private func choiceStore() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent("rememberme-import-choice-\(UUID().uuidString)/store.sqlite") }
private func publish(_ plan: ImportPreview, in repository: LocalRepository) async throws {
    try await repository.begin(plan); try await repository.stageImportToReady(plan.id); try await repository.publish(plan.id)
}
@Test func localSourceAssociationPreservesCountAndResumesExactlyOnce() async throws {
    let url = choiceStore(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    var repository = try LocalRepository(url: url)
    var local = VocabularyEntry(id: "local", word: "synthetic", count: 8, timestamp: 1); local.notes = "retain notes"
    try await repository.create(local)
    var incoming = VocabularyEntry(word: "synthetic", count: 3, timestamp: 1)
    incoming.history = [Encounter(timestamp: 1, context: "same text", url: "https://example.test", definition: incoming.definition),
                        Encounter(timestamp: 1, context: "same text", url: "https://example.test", definition: incoming.definition)]
    let bytes = try LegacyCodec.export([incoming]), initial = try await repository.previewLegacy(bytes, mode: .firstMigration)
    let id = try #require(initial.conflicts.first?.id)
    let plan = try await repository.previewLegacy(bytes, mode: .firstMigration, choices: [id: .init(.associateHistory, targetId: local.id)])
    #expect(plan.conflicts.isEmpty); #expect(plan.entries.first?.count == 8)
    #expect(plan.entries.first?.history.count == 2); #expect(plan.entries.first?.aliases.contains(id) == true)
    try await repository.begin(plan); try await repository.stageImportToReady(plan.id); try await repository.close()
    repository = try LocalRepository(url: url)
    #expect(try await repository.loadImportPlan(plan.id).operations.map(\.id) == plan.operations.map(\.id))
    try await repository.publish(plan.id)
    let saved = try #require(await repository.entry(local.id))
    #expect(saved.count == 8 && saved.notes == "retain notes" && saved.history.count == 2)
    #expect(try await repository.previewLegacy(bytes, mode: .firstMigration).alreadyImported)
    try await repository.close()
}
@Test func localSourceChoicesHandleReplacementSeparateLifecycleAndSkip() async throws {
    let url = choiceStore(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try LocalRepository(url: url)
    let local = VocabularyEntry(id: "local", word: "synthetic", count: 8, timestamp: 1)
    try await repository.create(local)
    let bytes = try LegacyCodec.export([VocabularyEntry(word: "synthetic", count: 3, timestamp: 1)])
    let id = try #require(await repository.previewLegacy(bytes, mode: .firstMigration).conflicts.first?.id)
    let replaced = try await repository.previewLegacy(bytes, mode: .firstMigration, choices: [id: .init(.replaceFields, targetId: local.id, fields: [.count])])
    #expect(replaced.entries.first?.count == 3); #expect(replaced.entries.first?.definition == local.definition)
    let skip = try await repository.previewLegacy(bytes, mode: .firstMigration, choices: [id: .init(.keepCurrent)])
    #expect(skip.entries.isEmpty && skip.operations.isEmpty && skip.conflicts.isEmpty)
    let separate = try await repository.previewLegacy(bytes, mode: .firstMigration, choices: [id: .init(.newLifecycle)])
    let again = try await repository.previewLegacy(bytes, mode: .firstMigration, choices: [id: .init(.newLifecycle)])
    #expect(separate.entries.first?.id == again.entries.first?.id)
    try await publish(separate, in: repository)
    #expect(try await repository.entries(matchingKey: "synthetic").count == 2)
    #expect(try await repository.entry(local.id)?.count == 8)
    try await repository.close()
}
@Test func anonymousRestoreSelectsFieldsAndDoesNotReplayReviews() async throws {
    let url = choiceStore(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try LocalRepository(url: url)
    var current = VocabularyEntry(id: "local", word: "synthetic", count: 9, timestamp: 1); current.notes = "new notes"
    current.history = [Encounter(id: "later", timestamp: 5, context: "later", url: "", definition: current.definition)]
    try await repository.create(current)
    var old = current; old.count = 2; old.notes = "old notes"; old.history = []
    let bytes = try JSONValue.encoder().encode(Backup(entries: [old], importSources: [], exportedAtMs: 1))
    let plan = try await repository.previewBackup(bytes, mode: .restoreMerge, choices: [old.id: .useBackup], fields: [old.id: [.count]])
    try await publish(plan, in: repository)
    let saved = try #require(await repository.entry(current.id))
    #expect(saved.count == 2 && saved.notes == "new notes" && saved.history.count == 1)
    #expect(saved.review == nil && saved.reviewEvents.isEmpty)
    try await repository.delete(current.id)
    let protected = try await repository.previewBackup(bytes, mode: .restoreMerge, choices: [old.id: .useBackup], fields: [old.id: [.count]])
    #expect(!protected.conflicts.isEmpty)
    try await repository.close()
}

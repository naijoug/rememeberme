import Foundation
import Testing
import RememberMeCore
@testable import RememberMeUI

private func temporaryURL() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent("rememberme-ui-model-\(UUID().uuidString)/store.sqlite") }
private let meaning: JSONValue = .object(["word": .string("synthetic"), "phonetics": .array([]), "meanings": .array([])])
private actor TestTransport: LookupTransport {
    let delay: Double
    init(delay: Double = 0) { self.delay = delay }
    func fetch(_ url: URL) async throws -> LookupHTTPResponse {
        try await Task.sleep(for: .seconds(delay))
        if url.host == "api.mymemory.translated.net" {
            return LookupHTTPResponse(status: 200, data: Data("{\"responseStatus\":200,\"responseData\":{\"translatedText\":\"合成\"}}".utf8))
        }
        let word = url.lastPathComponent
        let result: JSONValue = .array([.object(["word": .string(word), "phonetics": .array([]), "meanings": .array([])])])
        return LookupHTTPResponse(status: 200, data: try JSONValue.encoder().encode(result))
    }
}

@Test @MainActor func modelBackupRestoreRoundTripUsesPreviewAndDoesNotRestoreOutbox() async throws {
    let url = temporaryURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try LocalRepository(url: url)
    let model = VocabularyModel(repository: repository, lookup: LookupService(dictionaryDirectory: nil, transport: TestTransport()))
    #expect(await model.save(word: "synthetic", definition: meaning, notes: "note", original: nil))
    await model.record()
    #expect(model.recordCount == 1)
    await model.prepareExport(legacy: false)
    let backupBytes = try #require(model.exportDocument?.data)
    let parsed = try JSONDecoder().decode(JSONValue.self, from: backupBytes)
    #expect(parsed["outbox"] == nil); #expect(parsed["checkpoint"] == nil)
    let id = try #require(model.detail?.id)
    await model.reset()
    #expect(model.detail?.count == 0)
    try await model.preparePreview(backupBytes, mode: .restoreMerge)
    #expect(model.preview?.conflicts.count == 1)
    #expect(try await repository.entry(id)?.count == 0)
    model.restoreChoices[id] = .useBackup
    await model.resolvePreview()
    #expect(model.preview?.conflicts.isEmpty == true)
    model.startImport()
    while model.busy { await Task.yield() }
    #expect(model.error == nil); #expect(model.detail?.count == 1)
    #expect(model.recordCount == 1)
    await model.prepareExport(legacy: true)
    #expect(!model.exportLosses.isEmpty)
    let downgraded = try LegacyCodec.decode(#require(model.exportDocument?.data))
    #expect(downgraded[0].count == 1)
    #expect(downgraded[0].history.count == 1)
    try await repository.close()
}

@Test @MainActor func pagedListsAndHistoryLoadBeyondFirstPage() async throws {
    let url = temporaryURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try LocalRepository(url: url)
    for index in 0..<105 {
        var entry = VocabularyEntry(id: "fixture-\(index)", word: "synthetic\(index)", count: Double(index))
        if index == 104 {
            entry.history = (0..<51).map { Encounter(id: "event-\($0)", timestamp: Double($0), context: "synthetic", url: "", definition: meaning) }
        }
        try await repository.create(entry)
    }
    let model = VocabularyModel(repository: repository, lookup: LookupService(dictionaryDirectory: nil, transport: TestTransport()))
    await model.reload(); #expect(model.entries.count == 100); #expect(model.hasMoreEntries)
    await model.moreEntries(); #expect(model.entries.count == 105); #expect(!model.hasMoreEntries)
    model.selection = "fixture-104"; await model.select()
    #expect(model.detail?.history.isEmpty == true)
    #expect(model.recordCount == 51); #expect(model.records.count == 50)
    await model.moreRecords(); #expect(model.records.count == 51)
    #expect(Set(model.records.map(\.id)).count == 51)
    model.search = "synthetic104"; await model.reload()
    #expect(model.entries.map(\.id) == ["fixture-104"]); #expect(!model.hasMoreEntries)
    try await repository.close()
}

@Test @MainActor func cancelledLookupCannotOverwriteAnotherWordDraft() async throws {
    let service = LookupService(dictionaryDirectory: nil, transport: TestTransport(delay: 0.05))
    let draft = EntryDraft(original: nil, service: service)
    draft.word = "apple"; draft.lookup()
    draft.word = "banana"; draft.clearLookup(); draft.lookup()
    while draft.englishLoading || draft.chineseLoading { await Task.yield() }
    #expect(draft.english?["word"]?.text == "banana")
    #expect(draft.chinese?["text"]?.text == "合成")
    #expect(draft.englishError == nil); #expect(draft.chineseError == nil)
    draft.clearLookup()
}

@Test @MainActor func importedPublicationCanBeCancelledWithoutShowingCandidateWords() async throws {
    let url = temporaryURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try LocalRepository(url: url)
    let model = VocabularyModel(repository: repository, lookup: LookupService(dictionaryDirectory: nil, transport: TestTransport()))
    let entry = VocabularyEntry(word: "synthetic", count: 1)
    try await model.preparePreview(LegacyCodec.export([entry]), mode: .firstMigration)
    model.startImport(); model.cancelImport()
    while model.busy { await Task.yield() }
    #expect(try await repository.entries().isEmpty)
    #expect(model.error == nil)
    #expect(model.preview == nil)
    #expect(model.status == "Import cancelled · Vocabulary unchanged")
    try await repository.close()
}

@Test @MainActor func shareDraftConfirmationKeepsSourceWithoutInventingHistory() async throws {
    let url = temporaryURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try LocalRepository(url: url)
    let draft = CaptureDraft(text: "A synthetic sentence to choose a word from.", sourceURL: "https://example.test/shared")
    try await repository.receiveCapture(draft)
    let model = VocabularyModel(repository: repository, lookup: LookupService(dictionaryDirectory: nil, transport: TestTransport()))
    await model.refreshCaptures(); #expect(model.captures.count == 1)
    #expect(await model.saveCapture(draft, word: "Synthetic", definition: meaning, notes: "note", kind: .properNoun))
    #expect(model.captures.isEmpty); #expect(model.detail?.word == "Synthetic"); #expect(model.detail?.kind == .properNoun)
    #expect(model.detail?.captureOrigin == draft); #expect(model.detail?.count == nil); #expect(model.recordCount == 0)
    await model.prepareExport(legacy: false)
    let backup = try BackupCodec.decode(#require(model.exportDocument?.data))
    #expect(backup.entries[0].captureOrigin == draft)
    await model.prepareExport(legacy: true)
    let legacy = try LegacyCodec.decode(#require(model.exportDocument?.data))
    #expect(legacy[0].history.isEmpty); #expect(legacy[0].count == 0)
    try await repository.close()
}

@Test @MainActor func interruptedImportIsVisibleAfterReopeningAndResumesOriginalPlan() async throws {
    let url = temporaryURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let first = try LocalRepository(url: url)
    try await first.create(VocabularyEntry(id: "original", word: "original", count: 3, timestamp: 1))
    let source = try LegacyCodec.export([VocabularyEntry(word: "recoverable", count: 2, timestamp: 1)])
    let preview = try await first.previewLegacy(source, mode: .firstMigration)
    try await first.begin(preview); try await first.copyImportChunk(preview.id, limit: 1)
    try await first.close()
    let reopened = try LocalRepository(url: url)
    let model = VocabularyModel(repository: reopened, lookup: LookupService(dictionaryDirectory: nil, transport: TestTransport()))
    await model.reload(); await model.refreshInterruptedImports()
    #expect(model.entries.map(\.word) == ["original"])
    #expect(model.interruptedImports.first?.id == preview.id)
    #expect(model.interruptedImports.first?.canResume == true)
    model.resumeImport(preview.id)
    while model.busy { await Task.yield() }
    #expect(model.error == nil)
    #expect(model.interruptedImports.isEmpty)
    #expect(model.entries.count == 2)
    #expect(model.entries.first(where: { $0.word == "recoverable" })?.count == 2)
    #expect(try await reopened.pendingOperations().count == 2)
    try await reopened.close()
}

@Test @MainActor func staleImportRecoveryOffersDiscardWithoutOverwritingNewData() async throws {
    let url = temporaryURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try LocalRepository(url: url)
    try await repository.create(VocabularyEntry(id: "original", word: "original", count: 3, timestamp: 1))
    let source = try LegacyCodec.export([VocabularyEntry(word: "recoverable", count: 2, timestamp: 1)])
    let preview = try await repository.previewLegacy(source, mode: .firstMigration)
    try await repository.begin(preview); try await repository.copyImportChunk(preview.id, limit: 1)
    _ = try await repository.reset("original", timestamp: 2)
    let model = VocabularyModel(repository: repository, lookup: LookupService(dictionaryDirectory: nil, transport: TestTransport()))
    await model.refreshInterruptedImports()
    #expect(model.interruptedImports.first?.canResume == false)
    model.discardImport(preview.id)
    while model.busy { await Task.yield() }
    #expect(model.error == nil); #expect(model.interruptedImports.isEmpty)
    #expect(try await repository.entry("original")?.count == 0)
    #expect(try await repository.entries().count == 1)
    try await repository.close()
}

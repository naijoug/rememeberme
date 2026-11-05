import Foundation
import Testing
import RememberMeCore
@testable import RememberMeUI

private func meaning(_ text: String) -> JSONValue {
    .object(["word": .string("bank"), "phonetics": .array([]), "meanings": .array([
        .object(["partOfSpeech": .string("noun"), "definitions": .array([.object(["definition": .string(text)])])])
    ])])
}
private func encounter(_ id: String, _ sentence: String, definition: JSONValue = .null, url: String = "https://example.test/source") -> Encounter {
    Encounter(id: id, timestamp: 1, context: sentence, url: url, definition: definition)
}

@Test func reviewCardUsesBoundedLiteralMatchingAndHistoricalMeaning() {
    let entry = VocabularyEntry(id: "word", word: "bank", definition: meaning("current"))
    let history = [encounter("wrong", "banking and banks"), encounter("right", "<b>BANK</b> and bank.", definition: meaning("snapshot"))]
    let card = ReviewCardContent(entry: entry, history: history)
    #expect(card.encounterID == "right")
    #expect(card.context == "<b>BANK</b> and bank.")
    #expect(card.definition == meaning("snapshot")); #expect(card.definitionSource == .encounter)
    #expect(card.sourceURL?.scheme == "https")
    let tooOld = Array(repeating: encounter("empty", ""), count: 20) + history
    #expect(ReviewCardContent(entry: entry, history: tooOld).encounterID == nil)
    #expect(ReviewCardContent.containsWord("can't", in: "I CAN'T go."))
    #expect(!ReviewCardContent.containsWord("can", in: "can't"))
    #expect(ReviewCardContent.containsWord("well-known", in: "A well-known fact."))
    #expect(!ReviewCardContent.containsWord("known", in: "well-known"))
    #expect(!ReviewCardContent.containsWord("a.*", in: "anything"))
}

@Test func reviewCardFallsBackWithoutMutatingSourcesOrOpeningUnsafeURLs() {
    let entry = VocabularyEntry(id: "word", word: "bank", definition: meaning("current"))
    let source = encounter("empty", "A bank.", url: "javascript:alert(1)")
    let card = ReviewCardContent(entry: entry, history: [source])
    #expect(card.definitionSource == .current); #expect(card.definition == entry.definition)
    #expect(card.sourceURL == nil); #expect(source.context == "A bank.")
    let empty = ReviewCardContent(entry: VocabularyEntry(word: "bank"), history: [source])
    #expect(empty.definitionSource == .unavailable)
    let text = String(repeating: "x ", count: 900) + "BANK." + String(repeating: " y", count: 900)
    let bounded = ReviewCardContent(entry: entry, history: [encounter("long", text)])
    #expect(bounded.context!.count <= 1002); #expect(bounded.context!.contains("BANK"))
}

@Test @MainActor func historyFailureAllowsReviewAndChangedHistoryHidesAnswer() async throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: dir) }
    let repository = try LocalRepository(url: dir.appendingPathComponent("store.sqlite"))
    try await repository.create(VocabularyEntry(id: "word", word: "bank", count: 4, definition: meaning("current")))
    let failed = ReviewModel(repository: repository, historyLoader: { _ in throw ClientError.missingEntry })
    await failed.load(); failed.reveal()
    #expect(failed.historyError != nil); #expect(failed.loaded); #expect(failed.revealed)
    #expect(failed.card?.definitionSource == .current)
    await failed.answer(.remembered)
    #expect(failed.summary.total == 1)
    let saved = try #require(try await repository.entry("word"))
    #expect(saved.count == 4); #expect(saved.history.isEmpty)
    try await repository.close()
}

private actor HistoryGate {
    var pending: [CheckedContinuation<[Encounter], Never>] = []
    func read() async -> [Encounter] { await withCheckedContinuation { pending.append($0) } }
    var count: Int { pending.count }
    func resolve(_ index: Int, _ value: [Encounter]) { pending[index].resume(returning: value) }
}

@Test @MainActor func lateHistoryCannotReplaceNewerCardOrClosedView() async throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: dir) }
    let repository = try LocalRepository(url: dir.appendingPathComponent("store.sqlite"))
    try await repository.create(VocabularyEntry(id: "word", word: "bank"))
    let gate = HistoryGate()
    let model = ReviewModel(repository: repository, historyLoader: { _ in await gate.read() })
    let first = Task { await model.load() }
    while await gate.count < 1 { await Task.yield() }
    let second = Task { await model.load() }
    while await gate.count < 2 { await Task.yield() }
    await gate.resolve(1, [encounter("new", "A new bank.")]); await second.value
    model.reveal()
    await gate.resolve(0, [encounter("old", "An old bank.")]); await first.value
    #expect(model.card?.encounterID == "new"); #expect(model.revealed)
    let third = Task { await model.load() }
    while await gate.count < 3 { await Task.yield() }
    await gate.resolve(2, [encounter("changed", "A changed bank.")]); await third.value
    #expect(!model.revealed)
    let last = Task { await model.load() }
    while await gate.count < 4 { await Task.yield() }
    model.stop()
    await gate.resolve(3, [encounter("late", "A late bank.")]); await last.value
    #expect(model.card == nil); #expect(!model.revealed)
    try await repository.close()
}

import Foundation
import Testing
import RememberMeCore
@testable import RememberMeUI

private func reviewStoreURL() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent("rememberme-review-model-\(UUID().uuidString)/store.sqlite")
}

@Test @MainActor func learningRequiresRevealAndCountsOnlyCommittedAnswers() async throws {
    let url = reviewStoreURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try LocalRepository(url: url)
    var original = VocabularyEntry(id: "new", word: "synthetic", count: 3)
    let event = Encounter(id: "source", timestamp: 1, context: "Literal context", url: "", definition: original.definition)
    original.history = [event]
    try await repository.create(original)
    let model = ReviewModel(repository: repository)
    await model.load()
    #expect(model.loaded); #expect(model.dueCount == 0); #expect(model.remainingNew == 20)
    await model.answer(.remembered)
    #expect(model.summary.total == 0)
    #expect(try await repository.entry("new")?.review == nil)
    model.reveal(); await model.answer(.remembered)
    #expect(model.error == nil); #expect(model.queue.isEmpty); #expect(!model.revealed)
    #expect(model.summary.total == 1); #expect(model.summary.remembered == 1)
    #expect(model.remainingNew == 19)
    let saved = try #require(try await repository.entry("new"))
    #expect(saved.count == 3); #expect(saved.history == [event]); #expect(saved.reviewEvents.count == 1)
    #expect(model.lastAnswer?.word == "synthetic")
    let state = try #require(saved.review)
    #expect(model.lastAnswer?.dueAt.timeIntervalSince1970 == state.dueAtMs / 1000)
    // A second click after the card has advanced cannot answer it again.
    await model.answer(.forgot)
    #expect(model.summary.total == 1)
    try await repository.close()
    let reopened = try LocalRepository(url: url)
    let nextSession = ReviewModel(repository: reopened)
    await nextSession.load()
    #expect(nextSession.queue.isEmpty); #expect(nextSession.remainingNew == 19)
    #expect(nextSession.summary.total == 0); #expect(nextSession.lastAnswer == nil)
    try await reopened.close()
}

@Test @MainActor func concurrentReviewConflictRefreshesCardWithoutCountingFailedAnswer() async throws {
    let url = reviewStoreURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try LocalRepository(url: url)
    try await repository.create(VocabularyEntry(id: "shared", word: "synthetic"))
    let model = ReviewModel(repository: repository)
    await model.load(); model.reveal()
    _ = try await repository.answerReview("shared", result: .fuzzy, expectedReviewVersion: 0)
    await model.answer(.remembered)
    #expect(model.error != nil); #expect(!model.revealed); #expect(model.queue.isEmpty)
    #expect(model.summary.total == 0); #expect(model.lastAnswer == nil)
    #expect(try await repository.entry("shared")?.reviewEvents.count == 1)
    await model.load()
    #expect(model.error == nil)
    try await repository.close()
}

@Test @MainActor func changedDefinitionOnSameCardMustBeRevealedAgain() async throws {
    let url = reviewStoreURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try LocalRepository(url: url)
    try await repository.create(VocabularyEntry(id: "same", word: "synthetic"))
    let model = ReviewModel(repository: repository)
    await model.load(); model.reveal()
    let entry = try #require(try await repository.entry("same"))
    _ = try await repository.update(entry.id, expectedVersion: entry.version, definition: entry.definition, notes: "Changed literal notes")
    await model.load()
    #expect(model.queue.first?.id == "same"); #expect(!model.revealed)
    #expect(model.queue.first?.notes == "Changed literal notes")
    try await repository.close()
}

@Test @MainActor func learningRefillsBoundedQueueAndKeepsFullDueCount() async throws {
    let url = reviewStoreURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try LocalRepository(url: url)
    for index in 0..<55 {
        var entry = VocabularyEntry(id: "due-\(index)", word: "synthetic\(index)")
        entry.review = ReviewState(step: 1, dueAtMs: 1, version: 1)
        try await repository.create(entry)
    }
    let model = ReviewModel(repository: repository)
    await model.load()
    #expect(model.queue.count == 50); #expect(model.dueCount == 55)
    model.reveal(); await model.answer(.forgot)
    #expect(model.queue.count == 50); #expect(model.dueCount == 54)
    model.reveal(); await model.answer(.fuzzy)
    model.reveal(); await model.answer(.remembered)
    #expect(model.summary.total == 3)
    #expect(model.summary.forgot == 1); #expect(model.summary.fuzzy == 1); #expect(model.summary.remembered == 1)
    #expect(model.remainingNew == 20); #expect(model.dueCount == 52)
    try await repository.close()
}

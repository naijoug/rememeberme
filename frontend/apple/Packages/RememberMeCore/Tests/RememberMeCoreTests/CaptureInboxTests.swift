import Foundation
import Testing
@testable import RememberMeCore

@Test func shareInboxSurvivesProcessInstancesAndAcknowledgesOnlyCommittedDraft() async throws {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("rememberme-share-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: folder) }
    let inbox = CaptureInbox(directory: folder.appendingPathComponent("inbox"))
    let draft = CaptureDraft(text: "<script>synthetic text</script>", sourceURL: "https://example.test/share", createdAtMs: 1)
    try await inbox.save(draft)
    let reopened = CaptureInbox(directory: folder.appendingPathComponent("inbox"))
    #expect(try await reopened.scan().drafts == [draft])
    let repository = try LocalRepository(url: folder.appendingPathComponent("store.sqlite"))
    try await repository.receiveCapture(draft)
    try await repository.receiveCapture(draft)
    #expect(try await repository.captureDrafts().count == 1)
    #expect(try await repository.entries().isEmpty)
    #expect(try await repository.pendingOperations().isEmpty)
    try await repository.close()
    let recovered = try LocalRepository(url: folder.appendingPathComponent("store.sqlite"))
    #expect(try await recovered.captureDrafts() == [draft])
    try await reopened.acknowledge(draft)
    #expect(try await reopened.scan().drafts.isEmpty)
    let definition: JSONValue = .object(["word": .string("synthetic"), "phonetics": .array([]), "meanings": .array([])])
    let id = try await recovered.confirmCapture(draft.id, word: "synthetic", definition: definition, notes: draft.text, kind: .word)
    _ = try await recovered.confirmCapture(draft.id, word: "synthetic", definition: definition, notes: draft.text, kind: .word)
    #expect(try await recovered.entry(id)?.count == nil)
    #expect(try await recovered.entry(id)?.history.isEmpty == true)
    #expect(try await recovered.pendingOperations().count == 1)
    #expect(try await recovered.captureDrafts().isEmpty)
    #expect(try await recovered.entry(id)?.captureOrigin == draft)
    await #expect(throws: (any Error).self) {
        try await recovered.confirmCapture(draft.id, word: "another", definition: definition, notes: draft.text, kind: .word)
    }
    try await recovered.delete(id)
    // Re-delivery after deletion cannot resurrect an already confirmed capture.
    try await recovered.receiveCapture(draft)
    _ = try await recovered.confirmCapture(draft.id, word: "synthetic", definition: definition, notes: draft.text, kind: .word)
    #expect(try await recovered.entries().isEmpty)
    try await recovered.close()
}

@Test func concurrentShareWritersCannotOverwriteEachOthersStableIDs() async throws {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("rememberme-share-race-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: folder) }
    let first = CaptureInbox(directory: folder), second = CaptureInbox(directory: folder)
    let draft = CaptureDraft(text: "synthetic", createdAtMs: 1)
    async let a: Void = first.save(draft)
    async let b: Void = second.save(draft)
    try await a; try await b
    #expect(try await first.scan().drafts == [draft])
    var changed = draft; changed.text = "changed"
    await #expect(throws: (any Error).self) { try await second.save(changed) }
    #expect(try await first.scan().drafts == [draft])
    try Data("invalid".utf8).write(to: folder.appendingPathComponent("invalid.json"))
    #expect(try await first.scan().unreadableFiles == ["invalid.json"])
    await #expect(throws: (any Error).self) { try await first.save(CaptureDraft(id: "../outside", text: "synthetic")) }
}

@Test func captureDiskFailureDoesNotCreateFalseCompletion() async throws {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("rememberme-share-failure-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: folder) }
    let file = folder.appendingPathComponent("not-a-directory")
    try Data("synthetic".utf8).write(to: file)
    let inbox = CaptureInbox(directory: file)
    await #expect(throws: (any Error).self) { try await inbox.save(CaptureDraft(text: "synthetic")) }
    #expect(try Data(contentsOf: file) == Data("synthetic".utf8))
}

import Foundation
import Testing
@testable import RememberMeCore

private let sourceIdentity = ConnectedIdentity(origin: "https://sources.example.test", userId: "synthetic", deviceId: "device")
private let sourceDefinition: JSONValue = .object(["word": .string("synthetic"), "phonetics": .array([]), "meanings": .array([])])
private func sourceAccount(revision: Int, consent: Bool) -> APIAccountIdentity {
    var account = APIAccountIdentity(userId: sourceIdentity.userId, deviceId: sourceIdentity.deviceId, epoch: "epoch", timezone: "UTC", syncContext: consent, syncURLs: consent)
    account.sourceRevision = revision; account.syncCapabilities = ["source-privacy-v1"]; return account
}
private func sourceRepository(_ url: URL) async throws -> LocalRepository {
    let repository = try LocalRepository(url: url, owner: SyncConfiguration.owner(for: sourceIdentity))
    try await repository.configureSync(identity: sourceIdentity, enabled: true, privacy: SyncPrivacy(context: true, urls: true))
    try await repository.initializeSyncEpoch(sourceAccount(revision: 0, consent: true))
    let entry = APIEntry(id: "word", word: "synthetic", normalizedKey: "synthetic", kind: .word, count: 3,
        definition: sourceDefinition, notes: "", createdAtMs: 1, updatedAtMs: 1, version: 1, deleted: false, review: nil, reviewVersion: 0)
    try await repository.applySyncPage(.init(epoch: "epoch", boundary: 1, nextCursor: 1, hasMore: false, changes: [.init(sequence: 1, entry: entry)]), snapshot: true, histories: ["word": []])
    return repository
}
@Test func removalSurvivesRestartAndNeverRebasesFrozenOrUnsentSources() async throws {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("rememberme-sources-\(UUID().uuidString)/store.sqlite")
    defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try await sourceRepository(url)
    _ = try await repository.record("word", context: "private", url: "https://example.test", definition: sourceDefinition, timestamp: 2, eventID: "one")
    let frozen = try #require(try await repository.nextSyncWire())
    _ = try await repository.record("word", context: "private two", url: "https://example.test/two", definition: sourceDefinition, timestamp: 3, eventID: "two")
    let request = try await repository.beginSourceRemoval()
    #expect(try await repository.nextSyncWire() == nil)
    await #expect(throws: (any Error).self) { try await repository.configureSync(identity: sourceIdentity, enabled: true) }
    try await repository.close()
    let reopened = try LocalRepository(url: url, owner: SyncConfiguration.owner(for: sourceIdentity))
    #expect(try await reopened.beginSourceRemoval() == request)
    try await reopened.finishSourceRemoval(request, revision: 1)
    try await reopened.initializeSyncEpoch(sourceAccount(revision: 1, consent: true))
    try await reopened.configureSync(identity: sourceIdentity, enabled: true, privacy: SyncPrivacy(context: true, urls: true))
    let retry = try #require(try await reopened.nextSyncWire())
    #expect(retry.body == frozen.body); #expect(try await reopened.sourceWireAllowed(retry) == false)
    #expect(try await reopened.pendingOperations().allSatisfy { $0.wireSourceRevision == 0 })
    #expect(try await reopened.entry("word")?.count == 5)
    #expect(try await reopened.entry("word")?.history.map(\.context) == ["private", "private two"])
    try await reopened.close()
}
@Test func backfillIsExplicitAndPreservesCountAndLocalSourcesAfterClear() async throws {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("rememberme-backfill-\(UUID().uuidString)/store.sqlite")
    defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try await sourceRepository(url)
    try await repository.configureSync(identity: sourceIdentity, enabled: true)
    _ = try await repository.record("word", context: "private", url: "https://example.test", definition: sourceDefinition, timestamp: 2, eventID: "history")
    let privateWire = try #require(try await repository.nextSyncWire())
    var cloud = try #require(try await repository.remoteEntry("word")); cloud.count = 4; cloud.version = 2
    try await repository.acknowledgeSyncWire(privateWire.id, result: .init(operationId: privateWire.id, status: "applied", entry: cloud, cursor: 2))
    try await repository.configureSync(identity: sourceIdentity, enabled: false, privacy: .init(context: true, urls: false))
    #expect(try await repository.syncStatus().pending == 0)
    #expect(try await repository.backfillSources(entryId: "word", offset: 0) == 1)
    try await repository.configureSync(identity: sourceIdentity, enabled: true, privacy: .init(context: true, urls: false))
    let backfill = try #require(try await repository.nextSyncWire())
    let value = try JSONDecoder().decode(APIOperation.self, from: backfill.body)
    #expect(value.kind == "enrichSource"); #expect(value.payload["events"]?.items?.first?["context"] == .string("private"))
    #expect(value.payload["events"]?.items?.first?["url"] == nil); #expect(value.sourceRevision == 0)
    cloud.version = 3
    try await repository.acknowledgeSyncWire(backfill.id, result: .init(operationId: backfill.id, status: "applied", entry: cloud, cursor: 3))
    #expect(try await repository.backfillSources(entryId: "word", offset: 0) == 0)
    let request = try await repository.beginSourceRemoval(); try await repository.finishSourceRemoval(request, revision: 1)
    try await repository.configureSync(identity: sourceIdentity, enabled: false, privacy: .init(context: true, urls: false))
    #expect(try await repository.backfillSources(entryId: "word", offset: 0) == 1)
    #expect(try await repository.entry("word")?.count == 4)
    #expect(try await repository.entry("word")?.history.first?.url == "https://example.test")
    try await repository.close()
}
@Test func anotherDevicesConsentDoesNotAuthorizeThisDevicesPendingSources() async throws {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("rememberme-consent-\(UUID().uuidString)/store.sqlite")
    defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let repository = try await sourceRepository(url)
    try await repository.configureSync(identity: sourceIdentity, enabled: true)
    _ = try await repository.record("word", context: "not consented", url: "https://example.test", definition: sourceDefinition, timestamp: 2)
    try await repository.initializeSyncEpoch(sourceAccount(revision: 0, consent: true))
    #expect(try await repository.syncConfiguration()?.privacy == SyncPrivacy())
    try await repository.configureSync(identity: sourceIdentity, enabled: true, privacy: .init(context: true, urls: true))
    let wire = try #require(try await repository.nextSyncWire())
    let operation = try JSONDecoder().decode(APIOperation.self, from: wire.body)
    #expect(operation.payload["event"]?["context"] == nil); #expect(operation.payload["event"]?["url"] == nil)
    try await repository.close()
}

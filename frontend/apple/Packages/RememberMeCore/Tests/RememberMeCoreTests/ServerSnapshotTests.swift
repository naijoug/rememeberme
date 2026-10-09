import Foundation
import Testing
@testable import RememberMeCore

private actor SnapshotAPI: SyncAPI {
    enum Scenario: Sendable { case normal, changedEpoch, changedBoundary, repeatedPosition, slow }
    let scenario: Scenario
    var accounts = 0
    var historyRequests = 0
    var boundaries: [Int?] = []
    init(_ scenario: Scenario = .normal) { self.scenario = scenario }
    func identity() async throws -> ConnectedIdentity? { .init(origin: "https://snapshot.example.test", userId: "synthetic-user", deviceId: "synthetic-device") }
    func account() async throws -> APIAccountIdentity {
        accounts += 1
        return .init(userId: "synthetic-user", deviceId: "synthetic-device", epoch: scenario == .changedEpoch && accounts > 1 ? "new-epoch" : "epoch",
            timezone: "UTC", syncContext: false, syncURLs: false, syncCapabilities: ["history-version-v1"])
    }
    private func entry(_ id: String, version: Int, count: Double?) -> APIEntry {
        .init(id: id, word: id, normalizedKey: id, kind: .word, count: count,
            definition: .object(["word": .string(id), "phonetics": .array([]), "meanings": .array([])]), notes: "", createdAtMs: 1, updatedAtMs: 1,
            version: version, deleted: id == "second", review: nil, reviewVersion: 0, historyOrdering: "retained")
    }
    func page(snapshot: Bool, epoch: String, after: Int, boundary: Int?) async throws -> SyncCheckpointPage {
        #expect(snapshot); #expect(epoch == "epoch"); boundaries.append(boundary)
        if after == 0 { return .init(epoch: epoch, boundary: 20, nextCursor: 10, hasMore: true, changes: [.init(sequence: 10, entry: entry("first", version: 7, count: 0.5))]) }
        return .init(epoch: epoch, boundary: scenario == .changedBoundary ? 21 : 20, nextCursor: 20, hasMore: false,
            changes: [.init(sequence: 20, entry: entry("second", version: 3, count: nil))])
    }
    func history(entryId: String, after: String, version: Int, epoch: String) async throws -> APIHistoryPage {
        historyRequests += 1
        if scenario == .slow { try await Task.sleep(for: .seconds(1)) }
        if entryId == "second" { return .init(entryVersion: version, nextCursor: after, hasMore: false, events: []) }
        #expect(version == 7); #expect(epoch == "epoch")
        let definition: JSONValue = .object(["word": .string("first"), "phonetics": .array([]), "meanings": .array([])])
        if after.isEmpty {
            return .init(entryVersion: version, nextCursor: "a", hasMore: true,
                events: [.init(id: "a", timestamp: 1, definition: definition, context: nil, url: nil, position: 2)])
        }
        return .init(entryVersion: version, nextCursor: "z", hasMore: false, events: [
            .init(id: "m", timestamp: 1, definition: definition, context: nil, url: nil, position: 3),
            .init(id: "z", timestamp: 30, definition: definition, context: nil, url: nil, position: scenario == .repeatedPosition ? 2 : 1)])
    }
    func submit(_ wire: SyncWireItem) async throws -> APIOperationResult { throw ClientError.invalidData("snapshot loader must never submit") }
    func observedBoundaries() -> [Int?] { boundaries }
    func historyCount() -> Int { historyRequests }
}
@Test func recoverySnapshotKeepsOneBoundaryVersionedHistoryOrderAndTombstones() async throws {
    let api = SnapshotAPI()
    let snapshot = try await ServerSnapshotLoader(api: api).download()
    #expect(snapshot.boundary == 20); #expect(snapshot.entries.count == 2)
    #expect(await api.observedBoundaries() == [nil, 20])
    #expect(snapshot.entries[0].state.count == 0.5)
    #expect(snapshot.entries[0].history.map(\.id) == ["z", "a", "m"])
    #expect(snapshot.entries[1].state.count == nil); #expect(snapshot.entries[1].state.deleted)
    #expect(await api.historyCount() == 3)
}
@Test func recoverySnapshotRejectsMidDownloadEpochBoundaryAndHistoryPositionChanges() async throws {
    await #expect(throws: ClientError.stalePreview) { try await ServerSnapshotLoader(api: SnapshotAPI(.changedEpoch)).download() }
    await #expect(throws: APIRequestError.invalidResponse) { try await ServerSnapshotLoader(api: SnapshotAPI(.changedBoundary)).download() }
    await #expect(throws: ClientError.invalidData("duplicate or missing retained history position")) {
        try await ServerSnapshotLoader(api: SnapshotAPI(.repeatedPosition)).download()
    }
}
@Test func cancellingARecoverySnapshotStopsTheInFlightHistoryRead() async throws {
    let api = SnapshotAPI(.slow)
    let task = Task { try await ServerSnapshotLoader(api: api).download() }
    while await api.historyCount() == 0 { await Task.yield() }
    task.cancel()
    await #expect(throws: CancellationError.self) { try await task.value }
    #expect(await api.historyCount() == 1)
}

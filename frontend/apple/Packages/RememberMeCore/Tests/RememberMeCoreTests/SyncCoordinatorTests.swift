import Foundation
import Testing
@testable import RememberMeCore

private let syncIdentity = ConnectedIdentity(origin: "https://sync.example.test", userId: "synthetic-user", deviceId: "synthetic-device")
private let syncDefinition: JSONValue = .object(["word": .string("synthetic"), "phonetics": .array([]), "meanings": .array([])])
private final class SyncVault: CredentialVault, @unchecked Sendable {
    private let lock = NSLock()
    private var value: APICredentials? = APICredentials(accessToken: String(repeating: "a", count: 43), refreshToken: String(repeating: "b", count: 43),
        accessExpiresAtMs: 1_000_000, refreshExpiresAtMs: 2_000_000, userId: syncIdentity.userId, deviceId: syncIdentity.deviceId)
    func load() -> APICredentials? { lock.withLock { value } }
    func save(_ value: APICredentials) { lock.withLock { self.value = value } }
    func clear() { lock.withLock { value = nil } }
}
private func syncResponse(_ value: JSONValue) throws -> APIHTTPResponse {
    APIHTTPResponse(status: 200, data: try JSONValue.encoder().encode(value))
}
private func syncEntryJSON(_ entry: APIEntry) throws -> JSONValue {
    var fields = try JSONDecoder().decode(JSONValue.self, from: JSONValue.encoder().encode(entry)).fields!
    fields["count"] = entry.count.map(JSONValue.number) ?? .null
    if entry.review == nil { fields["review"] = .null }
    return .object(fields)
}
private actor SyncScenarioTransport: APITransport {
    private var calls: [URLRequest] = []
    private var receipts: [String: Data] = [:]
    private var state: APIEntry?
    private var loseNextResponse: Bool
    private var submissionDelay: Double
    private var rejection: String?
    init(loseNextResponse: Bool = false, submissionDelay: Double = 0, rejection: String? = nil) {
        self.loseNextResponse = loseNextResponse; self.submissionDelay = submissionDelay; self.rejection = rejection
    }
    func requestCount(_ path: String) -> Int { calls.filter { $0.url!.path == path }.count }
    func submittedBodies() -> [Data] { calls.filter { $0.url!.path == "/api/v1/sync/operations" }.compactMap(\.httpBody) }
    func currentCount() -> Double? { state?.count }
    func send(_ request: URLRequest) async throws -> APIHTTPResponse {
        calls.append(request)
        switch request.url!.path {
        case "/api/v1/me":
            try await Task.sleep(for: .milliseconds(20))
            return try syncResponse(.object(["userId": .string(syncIdentity.userId), "deviceId": .string(syncIdentity.deviceId),
                "epoch": .string("epoch-A"), "timezone": .string("UTC"), "syncContext": .bool(false), "syncURLs": .bool(false)]))
        case "/api/v1/sync/snapshot", "/api/v1/sync/changes":
            return try syncResponse(.object(["epoch": .string("epoch-A"), "boundary": .number(0), "nextCursor": .number(0), "hasMore": .bool(false), "changes": .array([])]))
        case "/api/v1/sync/operations":
            if submissionDelay > 0 { try await Task.sleep(for: .seconds(submissionDelay)) }
            #expect(request.value(forHTTPHeaderField: "X-Sync-Epoch") == "epoch-A")
            let operation = try JSONDecoder().decode(APIOperation.self, from: request.httpBody!)
            if let rejection {
                return APIHTTPResponse(status: 409, data: try JSONValue.encoder().encode(JSONValue.object(["error": .object([
                    "code": .string(rejection), "retryable": .bool(false), "requestId": .string("00000000-0000-0000-0000-000000000001")])])) )
            }
            if let receipt = receipts[operation.operationId] { return APIHTTPResponse(status: 200, data: receipt) }
            if operation.kind == "create" {
                state = APIEntry(id: operation.entryId, word: "synthetic", normalizedKey: "synthetic", kind: .word,
                    count: operation.payload["count"]?.number, definition: syncDefinition, notes: "", createdAtMs: 1, updatedAtMs: 1,
                    version: 1, deleted: false, review: nil, reviewVersion: 0)
            } else if operation.kind == "record" {
                state!.count = (state!.count ?? 0) + 1; state!.version += 1
            } else if operation.kind == "reset" {
                #expect(operation.baseVersion == state!.version); state!.count = 0; state!.version += 1
            }
            let data = try JSONValue.encoder().encode(JSONValue.object(["operationId": .string(operation.operationId), "status": .string("applied"),
                "entry": try syncEntryJSON(state!), "cursor": .number(Double(state!.version))]))
            receipts[operation.operationId] = data
            if loseNextResponse { loseNextResponse = false; throw URLError(.networkConnectionLost) }
            return APIHTTPResponse(status: 200, data: data)
        default: throw APIRequestError.invalidResponse
        }
    }
}
private actor HistoryVersionTransport: APITransport {
    var invalid = false
    func setInvalid(_ value: Bool) { invalid = value }
    func send(_ request: URLRequest) async throws -> APIHTTPResponse {
        #expect(request.url?.path == "/api/v1/entries/fixture/history")
        let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
        #expect(query.first(where: { $0.name == "version" })?.value == "7")
        #expect(request.value(forHTTPHeaderField: "X-Sync-Epoch") == "epoch-A")
        return try syncResponse(.object(["entryVersion": .number(invalid ? 8 : 7), "nextCursor": .string("event"), "hasMore": .bool(false),
            "events": .array([.object(["id": .string("event"), "timestamp": .number(1), "position": .number(1), "definition": syncDefinition])])]))
    }
}
private func syncSetup(_ url: URL, transport: SyncScenarioTransport, enabled: Bool = true) async throws -> (LocalRepository, NativeSession, SyncCoordinator) {
    let repository = try LocalRepository(url: url, owner: SyncConfiguration.owner(for: syncIdentity))
    try await repository.configureSync(identity: syncIdentity, enabled: enabled)
    let session = NativeSession(origin: try APIOrigin(syncIdentity.origin), vault: SyncVault(), transport: transport, clock: { 1000 })
    let api = NativeSyncAPI(client: AuthenticatedAPIClient(session: session, transport: transport))
    return (repository, session, SyncCoordinator(repository: repository, api: api, clock: { 100_000 }))
}
private func syncURL() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent("rememberme-sync-flight-\(UUID().uuidString)/store.sqlite") }

@Test func syncFlightSharesConcurrentTriggersAndSubmitsCausalOperations() async throws {
    let url = syncURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let transport = SyncScenarioTransport()
    let (repository, _, coordinator) = try await syncSetup(url, transport: transport)
    try await repository.create(VocabularyEntry(id: "fixture", word: "synthetic", timestamp: 1, definition: syncDefinition))
    _ = try await repository.record("fixture", context: "private", url: "https://example.test/private", definition: syncDefinition, timestamp: 2)
    _ = try await repository.reset("fixture", timestamp: 3)
    try await withThrowingTaskGroup(of: SyncRunResult.self) { group in
        for _ in 0..<8 { group.addTask { try await coordinator.run() } }
        for try await result in group { #expect(result.submitted == 3) }
    }
    #expect(await transport.requestCount("/api/v1/me") == 1)
    #expect(await transport.requestCount("/api/v1/sync/operations") == 3)
    #expect(try await repository.syncStatus().pending == 0)
    #expect(try await repository.entry("fixture")?.count == 0)
    let bodies = await transport.submittedBodies()
    let record = try JSONDecoder().decode(APIOperation.self, from: bodies[1])
    #expect(record.payload["event"]?["context"] == nil); #expect(record.payload["event"]?["url"] == nil)
    try await repository.close()
}

@Test func syncResponseLossReopensAndRetriesExactCommittedRequestWithoutDoubleCount() async throws {
    let url = syncURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let transport = SyncScenarioTransport(loseNextResponse: true)
    let (repository, session, coordinator) = try await syncSetup(url, transport: transport)
    try await repository.create(VocabularyEntry(id: "fixture", word: "synthetic", count: 0.5, timestamp: 1, definition: syncDefinition))
    await #expect(throws: URLError.self) { try await coordinator.run() }
    #expect(try await repository.syncStatus().pending == 1)
    #expect(await transport.currentCount() == 0.5)
    try await repository.close()
    let reopened = try LocalRepository(url: url, owner: SyncConfiguration.owner(for: syncIdentity))
    let next = SyncCoordinator(repository: reopened, api: NativeSyncAPI(client: AuthenticatedAPIClient(session: session, transport: transport)), clock: { 200_000 })
    #expect(try await next.run().submitted == 1)
    let bodies = await transport.submittedBodies(); #expect(bodies.count == 2); #expect(bodies[0] == bodies[1])
    #expect(try await reopened.syncStatus().pending == 0); #expect(await transport.currentCount() == 0.5)
    try await reopened.close()
}

@Test func syncLogoutDuringSubmissionCannotAcknowledgeALateResponse() async throws {
    let url = syncURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let transport = SyncScenarioTransport(submissionDelay: 0.1)
    let (repository, session, coordinator) = try await syncSetup(url, transport: transport)
    try await repository.create(VocabularyEntry(id: "fixture", word: "synthetic", timestamp: 1, definition: syncDefinition))
    let task = Task { try await coordinator.run() }
    while await transport.requestCount("/api/v1/sync/operations") == 0 { await Task.yield() }
    try await session.disconnect()
    await #expect(throws: AuthenticationError.superseded) { try await task.value }
    #expect(try await repository.syncStatus().pending == 1)
    #expect(try await repository.remoteEntry("fixture") == nil)
    try await repository.close()
}

@Test func syncDisabledAndWrongOwnerDoNotReadOrTransmitVocabulary() async throws {
    let url = syncURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let transport = SyncScenarioTransport()
    let (repository, _, coordinator) = try await syncSetup(url, transport: transport, enabled: false)
    try await repository.create(VocabularyEntry(id: "fixture", word: "synthetic", timestamp: 1, definition: syncDefinition))
    #expect(try await coordinator.run() == SyncRunResult())
    #expect(await transport.requestCount("/api/v1/me") == 0)
    try await repository.close()
    var other = syncIdentity; other.userId = "another-synthetic-user"
    let otherRepository = try LocalRepository(url: url, owner: SyncConfiguration.owner(for: other))
    try await otherRepository.configureSync(identity: other, enabled: true)
    let session = NativeSession(origin: try APIOrigin(syncIdentity.origin), vault: SyncVault(), transport: transport, clock: { 1000 })
    let wrong = SyncCoordinator(repository: otherRepository, api: NativeSyncAPI(client: AuthenticatedAPIClient(session: session, transport: transport)))
    await #expect(throws: AuthenticationError.superseded) { try await wrong.run() }
    #expect(await transport.requestCount("/api/v1/me") == 0)
    try await otherRepository.close()
}

@Test func syncServerEpochRejectionPausesTheQueueWithoutDiscardingIntent() async throws {
    let url = syncURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let transport = SyncScenarioTransport(rejection: "SYNC_EPOCH_CHANGED")
    let (repository, _, coordinator) = try await syncSetup(url, transport: transport)
    try await repository.create(VocabularyEntry(id: "fixture", word: "synthetic", timestamp: 1, definition: syncDefinition))
    await #expect(throws: APIRequestError.self) { try await coordinator.run() }
    #expect(try await repository.syncConfiguration()?.phase == "epochConflict")
    #expect(try await repository.syncConfiguration()?.enabled == false)
    #expect(try await repository.syncStatus().pending == 1)
    #expect(try await coordinator.run() == SyncRunResult())
    #expect(await transport.requestCount("/api/v1/sync/operations") == 1)
    try await repository.close()
}
@Test func syncOwnershipReadOnlyPullCanPrepareADisabledAccountWithoutSendingItsQueue() async throws {
    let url = syncURL(); defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let transport = SyncScenarioTransport()
    let (repository, _, coordinator) = try await syncSetup(url, transport: transport, enabled: false)
    try await repository.create(VocabularyEntry(id: "fixture", word: "synthetic", timestamp: 1, definition: syncDefinition))
    let result = try await coordinator.pullForOwnershipPreview()
    #expect(result.pulledPages == 1); #expect(result.submitted == 0); #expect(result.needsContinuation == false)
    #expect(try await repository.syncConfiguration()?.phase == "ready")
    #expect(try await repository.syncConfiguration()?.enabled == false)
    #expect(await transport.requestCount("/api/v1/sync/operations") == 0)
    #expect(try await repository.syncStatus().pending == 1)
    try await repository.close()
}
@Test func syncNativeHistoryRequestBindsAndValidatesTheCountSnapshotVersion() async throws {
    let transport = HistoryVersionTransport()
    let session = NativeSession(origin: try APIOrigin(syncIdentity.origin), vault: SyncVault(), transport: transport, clock: { 1000 })
    let api = NativeSyncAPI(client: AuthenticatedAPIClient(session: session, transport: transport))
    let page = try await api.history(entryId: "fixture", after: "", version: 7, epoch: "epoch-A")
    #expect(page.entryVersion == 7); #expect(page.events.first?.position == 1)
    await transport.setInvalid(true)
    await #expect(throws: APIRequestError.invalidResponse) { try await api.history(entryId: "fixture", after: "", version: 7, epoch: "epoch-A") }
}

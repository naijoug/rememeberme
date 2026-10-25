import Foundation

public protocol SyncAPI: Sendable {
    func identity() async throws -> ConnectedIdentity?
    func account() async throws -> APIAccountIdentity
    func page(snapshot: Bool, epoch: String, after: Int, boundary: Int?) async throws -> SyncCheckpointPage
    func history(entryId: String, after: String, version: Int, epoch: String) async throws -> APIHistoryPage
    func selectReminderDevice(enabled: Bool, expectedRevision: Int) async throws -> ReminderDeviceSelection
    func setSourcePrivacy(_ privacy: SyncPrivacy, timezone: String) async throws
    func clearSources(_ request: SourceRemovalRequest, epoch: String) async throws -> Int
    func submit(_ wire: SyncWireItem) async throws -> APIOperationResult
}

public struct NativeSyncAPI: SyncAPI {
    let client: AuthenticatedAPIClient
    public init(client: AuthenticatedAPIClient) { self.client = client }
    public func identity() async throws -> ConnectedIdentity? { try await client.session.restoreIdentity() }
    public func account() async throws -> APIAccountIdentity {
        let data = try await client.request(path: "/api/v1/me")
        let value = try JSONDecoder().decode(APIAccountIdentity.self, from: data)
        guard let identity = try await identity(), value.userId == identity.userId, value.deviceId == identity.deviceId,
              !value.epoch.isEmpty, TimeZone(identifier: value.timezone) != nil else { throw AuthenticationError.invalidReply }
        return value
    }
    public func page(snapshot: Bool, epoch: String, after: Int, boundary: Int?) async throws -> SyncCheckpointPage {
        var query = [URLQueryItem(name: "epoch", value: epoch), URLQueryItem(name: "after", value: String(after)), URLQueryItem(name: "limit", value: "50")]
        if let boundary { query.append(URLQueryItem(name: "boundary", value: String(boundary))) }
        let data = try await client.request(path: "/api/v1/sync/" + (snapshot ? "snapshot" : "changes"), query: query, epoch: epoch)
        let raw = try JSONDecoder().decode(JSONValue.self, from: data)
        guard let changes = raw["changes"]?.items, changes.allSatisfy({ $0["entry"]?["count"] != nil && $0["entry"]?["review"] != nil }) else {
            throw APIRequestError.invalidResponse
        }
        let page = try JSONDecoder().decode(SyncCheckpointPage.self, from: data)
        try page.validate(after: after)
        guard page.epoch == epoch, boundary == nil || page.boundary == boundary else { throw APIRequestError.invalidResponse }
        return page
    }
    public func history(entryId: String, after: String, version: Int, epoch: String) async throws -> APIHistoryPage {
        let data = try await client.request(path: "/api/v1/entries/" + entryId + "/history",
            query: [.init(name: "after", value: after), .init(name: "limit", value: "25"), .init(name: "version", value: String(version))], epoch: epoch)
        let page = try JSONDecoder().decode(APIHistoryPage.self, from: data); try page.validate(after: after)
        guard page.entryVersion == version, page.events.allSatisfy({ $0.position != nil }) else { throw APIRequestError.invalidResponse }; return page
    }
    public func submit(_ wire: SyncWireItem) async throws -> APIOperationResult {
        // Send the persisted bytes exactly, including on a refreshed session.
        let data = try await client.request(path: "/api/v1/sync/operations", method: "POST", body: wire.body, epoch: wire.epoch)
        let result = try APIOperationResult.decode(data)
        guard result.operationId == wire.id, result.entry.id == wire.entryId else { throw APIRequestError.invalidResponse }
        return result
    }
}

public struct SyncRunResult: Sendable, Equatable {
    public var pulledPages: Int = 0
    public var historyPages: Int = 0
    public var submitted: Int = 0
    public var needsContinuation: Bool = false
}

/// One finite foreground flight per repository/account. Every cursor, frozen
/// request and retry time survives the process; no background timer owns truth.
public actor SyncCoordinator {
    private let repository: LocalRepository
    private let api: any SyncAPI
    private let clock: @Sendable () -> Double
    private var flight: (id: UUID, sends: Bool, task: Task<SyncRunResult, Error>)?
    public init(repository: LocalRepository, api: any SyncAPI,
                clock: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 * 1000 }) {
        self.repository = repository; self.api = api; self.clock = clock
    }
    public func cancel() { flight?.task.cancel() }
    public func run() async throws -> SyncRunResult {
        try await execute(sends: true)
    }
    public func pullForOwnershipPreview() async throws -> SyncRunResult {
        try await execute(sends: false)
    }
    private func execute(sends: Bool) async throws -> SyncRunResult {
        if let flight {
            let result = try await flight.task.value
            if flight.sends == sends { return result }
            if self.flight?.id == flight.id { self.flight = nil }
            return try await execute(sends: sends)
        }
        let id = UUID(), repository = repository, api = api, clock = clock
        let task = Task { try await Self.perform(repository: repository, api: api, clock: clock, sends: sends) }
        flight = (id, sends, task)
        defer { if flight?.id == id { flight = nil } }
        return try await task.value
    }
    private static func active(_ repository: LocalRepository, api: any SyncAPI, sends: Bool) async throws -> SyncConfiguration? {
        try Task.checkCancellation()
        guard let configuration = try await repository.syncConfiguration(), (!sends || configuration.enabled),
              configuration.phase != "epochConflict", (!sends || configuration.pendingSourceRemoval == nil) else { return nil }
        guard try await api.identity() == configuration.identity else { throw AuthenticationError.superseded }
        return configuration
    }
    private static func perform(repository: LocalRepository, api: any SyncAPI, clock: @Sendable () -> Double, sends: Bool) async throws -> SyncRunResult {
        var result = SyncRunResult()
        guard try await active(repository, api: api, sends: sends) != nil else { return result }
        let deadline = ContinuousClock.now.advanced(by: .seconds(20))
        do {
            let account = try await api.account()
            guard try await active(repository, api: api, sends: sends) != nil else { return result }
            try await repository.initializeSyncEpoch(account)
            guard try await active(repository, api: api, sends: sends) != nil else { return result }
            for _ in 0..<5 {
                guard ContinuousClock.now < deadline else { result.needsContinuation = true; return result }
                guard let configuration = try await active(repository, api: api, sends: sends), let epoch = configuration.epoch else { return result }
                let snapshot = configuration.phase == "snapshot"
                let page = try await api.page(snapshot: snapshot, epoch: epoch,
                    after: snapshot ? configuration.snapshotCursor : configuration.cursor,
                    boundary: snapshot ? configuration.snapshotBoundary : configuration.pullBoundary)
                guard try await active(repository, api: api, sends: sends) != nil else { return result }
                try await repository.applySyncPage(page, snapshot: snapshot); result.pulledPages += 1
                if !page.hasMore { break }
                result.needsContinuation = true
            }
            for _ in 0..<10 {
                guard ContinuousClock.now < deadline else { result.needsContinuation = true; return result }
                guard let configuration = try await active(repository, api: api, sends: sends), let epoch = configuration.epoch else { return result }
                guard let checkpoint = try await repository.pendingSyncHistory() else { break }
                let page = try await api.history(entryId: checkpoint.entryId, after: checkpoint.cursor, version: checkpoint.version, epoch: epoch)
                guard try await active(repository, api: api, sends: sends) != nil else { return result }
                try await repository.applySyncHistoryPage(page, checkpoint: checkpoint, epoch: epoch); result.historyPages += 1
            }
            for _ in 0..<(sends ? 5 : 0) {
                guard ContinuousClock.now < deadline else { result.needsContinuation = true; return result }
                guard try await active(repository, api: api, sends: sends)?.phase == "ready" else { return result }
                guard let wire = try await repository.nextSyncWire(now: clock()) else { break }
                do {
                    if !(try await repository.sourceWireAllowed(wire)) {
                        try await repository.rejectSyncWire(wire.id, code: "SOURCE_CONSENT_CHANGED", retryable: false, now: clock()); continue
                    }
                    let reply = try await api.submit(wire)
                    guard try await active(repository, api: api, sends: sends) != nil else { return result }
                    try await repository.acknowledgeSyncWire(wire.id, result: reply); result.submitted += 1
                } catch let error as APIRequestError {
                    if error.requiresSignIn { throw error }
                    if case .server(_, let code, let retryable, _) = error {
                        if code == "SYNC_EPOCH_CHANGED" { throw error }
                        try await repository.rejectSyncWire(wire.id, code: code, retryable: retryable, now: clock())
                        if retryable { break }
                    } else {
                        try await repository.rejectSyncWire(wire.id, code: "INVALID_RESPONSE", retryable: true, now: clock()); throw error
                    }
                } catch is CancellationError { throw CancellationError() }
                catch let error as URLError {
                    try await repository.rejectSyncWire(wire.id, code: "NETWORK_UNAVAILABLE", retryable: true, now: clock()); throw error
                }
            }
            let status = try await repository.syncStatus()
            let pendingHistory = try await repository.pendingSyncHistory()
            result.needsContinuation = (sends && status.pending > 0) || status.configuration?.phase == "snapshot"
                || status.configuration?.pullBoundary != nil || pendingHistory != nil
            return result
        } catch let error as APIRequestError {
            if case .server(_, let code, _, _) = error {
                if code == "SYNC_EPOCH_CHANGED" { try await repository.restartSyncSnapshot(epochChanged: true) }
                else if code == "CURSOR_REJECTED" { try await repository.restartSyncSnapshot() }
            }
            throw error
        }
    }
}

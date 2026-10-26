import Foundation

public struct ConnectedIdentity: Sendable, Equatable {
    public var origin: String
    public var userId: String
    public var deviceId: String
    public init(origin: String, userId: String, deviceId: String) { self.origin = origin; self.userId = userId; self.deviceId = deviceId }
}
struct AccessLease: Sendable {
    var identity: ConnectedIdentity
    var accessToken: String
    var generation: UUID
}

public actor NativeSession {
    public let origin: APIOrigin
    private let http: APIHTTPClient
    private let vault: any CredentialVault
    private let clock: @Sendable () -> Double
    private var credentials: APICredentials?
    private var loaded = false
    private var generation = UUID()
    private var pendingLogin: UUID?
    private var refreshing: (id: UUID, generation: UUID, task: Task<APICredentials, Error>)?
    public init(origin: APIOrigin, vault: (any CredentialVault)? = nil, transport: any APITransport = URLSessionAPITransport(),
                clock: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 * 1000 }) {
        self.origin = origin; self.vault = vault ?? KeychainCredentialVault(origin: origin.string)
        http = APIHTTPClient(origin: origin, transport: transport); self.clock = clock
    }
    public func restoreIdentity() throws -> ConnectedIdentity? {
        try restore()
        return credentials.map { ConnectedIdentity(origin: origin.string, userId: $0.userId, deviceId: $0.deviceId) }
    }
    private func restore() throws {
        if !loaded { credentials = try vault.load(); loaded = true }
    }
    public func beginLogin(deviceName: String) throws -> NativeLoginAttempt {
        try restore()
        let attempt = try NativeLoginAttempt(origin: origin, deviceName: deviceName)
        pendingLogin = attempt.id; return attempt
    }
    public func cancelLogin(_ attempt: NativeLoginAttempt) {
        if pendingLogin == attempt.id { pendingLogin = nil }
    }
    public func completeLogin(_ attempt: NativeLoginAttempt, callback: URL) async throws -> ConnectedIdentity {
        try Task.checkCancellation()
        guard pendingLogin == attempt.id else { throw AuthenticationError.superseded }
        let activeGeneration = generation
        let code = try attempt.code(from: callback)
        let body = try JSONValue.encoder().encode(JSONValue.object(["code": .string(code), "verifier": .string(attempt.verifier)]))
        let data = try await http.request(path: "/api/v1/auth/exchange", method: "POST", body: body)
        let value = try JSONDecoder().decode(APICredentials.self, from: data); try value.validate()
        try Task.checkCancellation()
        guard pendingLogin == attempt.id, generation == activeGeneration else { throw AuthenticationError.superseded }
        try vault.save(value)
        refreshing?.task.cancel(); refreshing = nil
        credentials = value; loaded = true; pendingLogin = nil; generation = UUID()
        return ConnectedIdentity(origin: origin.string, userId: value.userId, deviceId: value.deviceId)
    }
    func accessLease(rejectedToken: String? = nil) async throws -> AccessLease {
        try restore()
        guard let old = credentials else { throw AuthenticationError.notSignedIn }
        let force = rejectedToken == old.accessToken
        if !force && old.refreshRequestId == nil && old.accessExpiresAtMs > clock() + 60_000 {
            return AccessLease(identity: ConnectedIdentity(origin: origin.string, userId: old.userId, deviceId: old.deviceId), accessToken: old.accessToken, generation: generation)
        }
        guard old.refreshExpiresAtMs > clock() else { try disconnect(); throw AuthenticationError.expired }
        let activeGeneration = generation
        if refreshing == nil {
            let http = http
            var intent = old
            if intent.refreshRequestId == nil { intent.refreshRequestId = try NativeLoginAttempt.random() }
            try vault.save(intent); credentials = intent
            let body = try JSONValue.encoder().encode(JSONValue.object(["refreshToken": .string(old.refreshToken),
                "requestId": .string(intent.refreshRequestId!)]))
            let task = Task {
                let bytes = try await http.request(path: "/api/v1/auth/refresh", method: "POST", body: body)
                let pair = try JSONDecoder().decode(APICredentials.self, from: bytes); try pair.validate()
                guard pair.userId == old.userId, pair.deviceId == old.deviceId else { throw AuthenticationError.invalidReply }
                return pair
            }
            refreshing = (UUID(), activeGeneration, task)
        }
        let flight = refreshing!
        do {
            let pair = try await flight.task.value
            guard generation == activeGeneration else { throw AuthenticationError.superseded }
            if refreshing?.id == flight.id {
                // A failed vault save leaves this completed flight available for
                // retry, rather than spending the already-rotated old refresh token.
                try vault.save(pair); credentials = pair; refreshing = nil
            }
            guard let current = credentials, current.userId == old.userId, current.deviceId == old.deviceId else { throw AuthenticationError.superseded }
            return AccessLease(identity: ConnectedIdentity(origin: origin.string, userId: current.userId, deviceId: current.deviceId), accessToken: current.accessToken, generation: generation)
        } catch {
            if generation == activeGeneration, refreshing?.id == flight.id {
                if let failure = error as? APIRequestError, failure.requiresSignIn { try disconnect(); throw AuthenticationError.expired }
                if error is APIRequestError || error is URLError || error is CancellationError || error is DecodingError {
                    refreshing = nil
                }
                if let invalid = error as? AuthenticationError, invalid == .invalidReply { refreshing = nil }
            }
            throw error
        }
    }
    func matches(_ lease: AccessLease) -> Bool {
        generation == lease.generation && credentials?.userId == lease.identity.userId && credentials?.deviceId == lease.identity.deviceId
    }
    public func disconnect() throws {
        // Do not report local logout until removal succeeded. A locked/failing
        // Keychain remains an explicit action failure the user can retry.
        try vault.clear()
        credentials = nil; loaded = true; pendingLogin = nil; generation = UUID()
        refreshing?.task.cancel(); refreshing = nil
    }
    @discardableResult public func logout() async throws -> Bool {
        try restore()
        let previous = credentials
        try disconnect()
        if let previous {
            // Local credential removal is authoritative even if offline. This
            // best-effort revocation never reconnects or rewrites the vault.
            let body = try JSONValue.encoder().encode(JSONValue.object(["refreshToken": .string(previous.refreshToken)]))
            do { _ = try await http.request(path: "/api/v1/auth/logout", method: "POST", body: body); return true }
            catch { return false }
        }
        return true
    }
}

public struct AuthenticatedAPIClient: Sendable {
    public let session: NativeSession
    private let http: APIHTTPClient
    public init(session: NativeSession, transport: any APITransport = URLSessionAPITransport()) {
        self.session = session; http = APIHTTPClient(origin: session.origin, transport: transport)
    }
    public func request(path: String, method: String = "GET", query: [URLQueryItem] = [], body: Data? = nil, epoch: String? = nil) async throws -> Data {
        try Task.checkCancellation()
        let first = try await session.accessLease()
        try Task.checkCancellation()
        do {
            let data = try await http.request(path: path, method: method, query: query, body: body, accessToken: first.accessToken, epoch: epoch)
            try Task.checkCancellation()
            guard await session.matches(first) else { throw AuthenticationError.superseded }; return data
        } catch let error as APIRequestError where error.requiresSignIn {
            guard await session.matches(first) else { throw AuthenticationError.superseded }
            let next = try await session.accessLease(rejectedToken: first.accessToken)
            try Task.checkCancellation()
            guard next.identity == first.identity else { throw AuthenticationError.superseded }
            let data = try await http.request(path: path, method: method, query: query, body: body, accessToken: next.accessToken, epoch: epoch)
            try Task.checkCancellation()
            guard await session.matches(next) else { throw AuthenticationError.superseded }; return data
        }
    }
}

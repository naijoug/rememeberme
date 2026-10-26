import Foundation
import Testing
@testable import RememberMeCore

private final class MemoryVault: CredentialVault, @unchecked Sendable {
    private let lock = NSLock()
    private var value: APICredentials?
    private var failure = false
    private var writes = 0
    private var failAt: Int?
    private var attempts = 0
    init(_ value: APICredentials? = nil) { self.value = value }
    func load() throws -> APICredentials? { lock.withLock { value } }
    func save(_ value: APICredentials) throws {
        try lock.withLock {
            attempts += 1
            if failure || attempts == failAt { throw AuthenticationError.keychain(-1) }
            self.value = value; writes += 1
        }
    }
    func clear() throws { lock.withLock { value = nil } }
    func failSave(_ value: Bool) { lock.withLock { failure = value } }
    func failOnSave(_ attempt: Int) { lock.withLock { failAt = attempt } }
    func writeCount() -> Int { lock.withLock { writes } }
}
private func pair(_ letter: String = "a", expired: Bool = false, user: String = "synthetic-user") -> APICredentials {
    APICredentials(accessToken: String(repeating: letter, count: 43), refreshToken: String(repeating: letter.uppercased(), count: 43),
        accessExpiresAtMs: expired ? 900 : 100_000, refreshExpiresAtMs: 1_000_000, userId: user, deviceId: "synthetic-device")
}
private actor SessionTransport: APITransport {
    var requests: [URLRequest] = []
    let refreshed: APICredentials
    let login: APICredentials
    var refreshError: APIHTTPResponse?
    var delay: Double
    var rejectOld = false
    var dropRefresh = false
    init(refreshed: APICredentials = pair("b"), login: APICredentials = pair("c"), delay: Double = 0.03, rejectOld: Bool = false) {
        self.refreshed = refreshed; self.login = login; self.delay = delay; self.rejectOld = rejectOld
    }
    func dropNextRefresh() { dropRefresh = true }
    func sent(_ path: String) -> [URLRequest] { requests.filter { $0.url!.path == path } }
    func setRefreshError(_ value: APIHTTPResponse?) { refreshError = value }
    func count(_ path: String) -> Int { requests.filter { $0.url!.path == path }.count }
    func send(_ request: URLRequest) async throws -> APIHTTPResponse {
        requests.append(request)
        if delay > 0 { try await Task.sleep(for: .seconds(delay)) }
        switch request.url!.path {
        case "/api/v1/auth/refresh":
            if dropRefresh { dropRefresh = false; throw URLError(.networkConnectionLost) }
            if let refreshError { return refreshError }
            return APIHTTPResponse(status: 200, data: try JSONValue.encoder().encode(refreshed))
        case "/api/v1/auth/exchange": return APIHTTPResponse(status: 200, data: try JSONValue.encoder().encode(login))
        default:
            if rejectOld, request.value(forHTTPHeaderField: "Authorization") == "Bearer " + pair().accessToken { return errorResponse(401, "UNAUTHENTICATED") }
            return APIHTTPResponse(status: 200, data: Data("{\"ok\":true}".utf8))
        }
    }
}
private func errorResponse(_ status: Int, _ code: String, retryable: Bool = false) -> APIHTTPResponse {
    APIHTTPResponse(status: status, data: Data("{\"error\":{\"code\":\"\(code)\",\"retryable\":\(retryable),\"requestId\":\"00000000-0000-0000-0000-000000000001\"}}".utf8))
}
private let origin = try! APIOrigin("https://api.example.test")

@Test func loginChallengeMatchesRFCAndCallbackRejectsReplayOrInjection() throws {
    #expect(NativeLoginAttempt.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk") == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    let attempt = try NativeLoginAttempt(origin: origin, deviceName: "synthetic")
    let code = String(repeating: "x", count: 43)
    #expect(try attempt.code(from: URL(string: "rememberme://auth/callback?state=\(attempt.state)&code=\(code)")!) == code)
    for address in ["rememberme://wrong/callback?state=\(attempt.state)&code=\(code)",
                    "rememberme://auth/callback?state=wrong&code=\(code)",
                    "rememberme://auth/callback?state=\(attempt.state)&code=\(code)&code=\(code)",
                    "rememberme://auth/callback?state=\(attempt.state)&code=\(code)&accessToken=unexpected"] {
        #expect(throws: AuthenticationError.invalidCallback) { try attempt.code(from: URL(string: address)!) }
    }
}
@Test func originScopeRejectsInsecureOrCredentialBearingServerAddresses() throws {
    #expect(try APIOrigin("https://API.EXAMPLE.TEST:443/") == origin)
    for raw in ["http://api.example.test", "https://user:password@api.example.test", "https://api.example.test/path", "https://api.example.test/?token=secret", "https://api.example.test/#fragment"] {
        #expect(throws: AuthenticationError.invalidServer) { try APIOrigin(raw) }
    }
    #expect(try APIOrigin("http://127.0.0.1:8787", allowLoopbackHTTP: true).string == "http://127.0.0.1:8787")
    #expect(throws: AuthenticationError.invalidServer) { try origin.endpoint("/api/v1/../../wrong") }
}
@Test func concurrentExpiredAccessRequestsShareOneRefreshAndPersistIntentBeforeResult() async throws {
    let vault = MemoryVault(pair(expired: true)), transport = SessionTransport()
    let session = NativeSession(origin: origin, vault: vault, transport: transport, clock: { 1000 })
    let client = AuthenticatedAPIClient(session: session, transport: transport)
    try await withThrowingTaskGroup(of: Data.self) { group in
        for _ in 0..<12 { group.addTask { try await client.request(path: "/api/v1/me") } }
        for try await reply in group { #expect(String(decoding: reply, as: UTF8.self) == "{\"ok\":true}") }
    }
    #expect(await transport.count("/api/v1/auth/refresh") == 1)
    #expect(vault.writeCount() == 2); #expect(try vault.load()?.accessToken == pair("b").accessToken)
}
@Test func rejectedOldAccessRetriesOnceWithoutDuplicateConcurrentRefresh() async throws {
    let vault = MemoryVault(pair()), transport = SessionTransport(rejectOld: true)
    let session = NativeSession(origin: origin, vault: vault, transport: transport, clock: { 1000 })
    let client = AuthenticatedAPIClient(session: session, transport: transport)
    async let first = client.request(path: "/api/v1/me")
    async let second = client.request(path: "/api/v1/me")
    _ = try await first; _ = try await second
    #expect(await transport.count("/api/v1/auth/refresh") == 1)
    #expect(await transport.count("/api/v1/me") == 4)
}
@Test func logoutDuringRefreshCannotSaveLateCredentialsOrReconnect() async throws {
    let vault = MemoryVault(pair(expired: true)), transport = SessionTransport(delay: 0.1)
    let session = NativeSession(origin: origin, vault: vault, transport: transport, clock: { 1000 })
    let work = Task { try await session.accessLease() }
    while await transport.count("/api/v1/auth/refresh") == 0 { await Task.yield() }
    try await session.disconnect()
    await #expect(throws: (any Error).self) { try await work.value }
    #expect(try vault.load() == nil); #expect(try await session.restoreIdentity() == nil); #expect(vault.writeCount() == 1)
}
@Test func vaultFailureRetriesTheCompletedRefreshInsteadOfSpendingOldTokenAgain() async throws {
    let vault = MemoryVault(pair(expired: true)), transport = SessionTransport()
    vault.failOnSave(2)
    let session = NativeSession(origin: origin, vault: vault, transport: transport, clock: { 1000 })
    await #expect(throws: AuthenticationError.keychain(-1)) { try await session.accessLease() }
    vault.failSave(false)
    _ = try await session.accessLease()
    #expect(await transport.count("/api/v1/auth/refresh") == 1)
    #expect(vault.writeCount() == 2)
}
@Test func temporaryServerFailureKeepsCredentialsButConfirmedRevocationClearsThem() async throws {
    let vault = MemoryVault(pair(expired: true)), transport = SessionTransport()
    let session = NativeSession(origin: origin, vault: vault, transport: transport, clock: { 1000 })
    await transport.setRefreshError(errorResponse(503, "AUTH_STORAGE_UNAVAILABLE", retryable: true))
    await #expect(throws: (any Error).self) { try await session.accessLease() }
    #expect(try vault.load() != nil)
    await transport.setRefreshError(errorResponse(401, "REFRESH_REJECTED"))
    await #expect(throws: AuthenticationError.expired) { try await session.accessLease() }
    #expect(try vault.load() == nil)
}
@Test func aCancelledOrSupersededLoginCannotOverwriteTheCurrentSession() async throws {
    let vault = MemoryVault(), transport = SessionTransport(delay: 0.1)
    let session = NativeSession(origin: origin, vault: vault, transport: transport, clock: { 1000 })
    let first = try await session.beginLogin(deviceName: "synthetic")
    let callback = URL(string: "rememberme://auth/callback?state=\(first.state)&code=\(String(repeating: "x", count: 43))")!
    let work = Task { try await session.completeLogin(first, callback: callback) }
    while await transport.count("/api/v1/auth/exchange") == 0 { await Task.yield() }
    _ = try await session.beginLogin(deviceName: "new attempt")
    await #expect(throws: AuthenticationError.superseded) { try await work.value }
    #expect(try vault.load() == nil)
}

@Test func refreshResponseLossRetriesThePersistedIntentAfterRestart() async throws {
    let vault = MemoryVault(pair(expired: true)), transport = SessionTransport(delay: 0)
    await transport.dropNextRefresh()
    let first = NativeSession(origin: origin, vault: vault, transport: transport, clock: { 1000 })
    await #expect(throws: (any Error).self) { try await first.accessLease() }
    let pending = try #require(vault.load()?.refreshRequestId)
    let restarted = NativeSession(origin: origin, vault: vault, transport: transport, clock: { 1000 })
    _ = try await restarted.accessLease()
    let requests = await transport.sent("/api/v1/auth/refresh")
    #expect(requests.count == 2)
    #expect(requests[0].httpBody == requests[1].httpBody)
    #expect(String(decoding: requests[0].httpBody!, as: UTF8.self).contains(pending))
    #expect(try vault.load()?.refreshRequestId == nil)
}

@Test func failedRefreshResultSaveRecoversAfterRestart() async throws {
    let vault = MemoryVault(pair(expired: true)), transport = SessionTransport(delay: 0)
    vault.failOnSave(2)
    let first = NativeSession(origin: origin, vault: vault, transport: transport, clock: { 1000 })
    await #expect(throws: AuthenticationError.keychain(-1)) { try await first.accessLease() }
    #expect(try vault.load()?.refreshRequestId != nil)
    let restarted = NativeSession(origin: origin, vault: vault, transport: transport, clock: { 1000 })
    _ = try await restarted.accessLease()
    let requests = await transport.sent("/api/v1/auth/refresh")
    #expect(requests.count == 2); #expect(requests[0].httpBody == requests[1].httpBody)
    #expect(try vault.load()?.refreshToken == pair("b").refreshToken)
}

@Test func failedIntentSaveNeverSpendsTheRefreshToken() async throws {
    let vault = MemoryVault(pair(expired: true)), transport = SessionTransport(delay: 0)
    vault.failSave(true)
    let session = NativeSession(origin: origin, vault: vault, transport: transport, clock: { 1000 })
    await #expect(throws: AuthenticationError.keychain(-1)) { try await session.accessLease() }
    #expect(await transport.count("/api/v1/auth/refresh") == 0)
}

@Test func logoutUsesRefreshCredentialWhenAccessExpired() async throws {
    let vault = MemoryVault(pair(expired: true)), transport = SessionTransport(delay: 0)
    let session = NativeSession(origin: origin, vault: vault, transport: transport, clock: { 1000 })
    #expect(try await session.logout())
    let request = try #require(await transport.sent("/api/v1/auth/logout").first)
    #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
    let body = try JSONDecoder().decode(JSONValue.self, from: request.httpBody!)
    #expect(body == .object(["refreshToken": .string(pair().refreshToken)]))
    #expect(try vault.load() == nil)
}

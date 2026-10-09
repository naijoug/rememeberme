import Foundation
import Testing
import RememberMeCore
@testable import RememberMeUI

private final class AccountVault: CredentialVault, @unchecked Sendable {
    private let lock = NSLock(); private var pair: APICredentials?
    func load() throws -> APICredentials? { lock.withLock { pair } }
    func save(_ value: APICredentials) throws { lock.withLock { pair = value } }
    func clear() throws { lock.withLock { pair = nil } }
}
private actor AccountTransport: APITransport {
    private var calls = 0
    func count() -> Int { calls }
    func send(_ request: URLRequest) async throws -> APIHTTPResponse {
        calls += 1
        if request.url!.path == "/api/v1/auth/exchange" {
            let pair = APICredentials(accessToken: String(repeating: "a", count: 43), refreshToken: String(repeating: "b", count: 43),
                accessExpiresAtMs: Date().timeIntervalSince1970 * 1000 + 900_000,
                refreshExpiresAtMs: Date().timeIntervalSince1970 * 1000 + 86_400_000, userId: "synthetic-account", deviceId: "synthetic-device")
            return APIHTTPResponse(status: 200, data: try JSONValue.encoder().encode(pair))
        }
        return APIHTTPResponse(status: 200, data: Data("{\"loggedOut\":true}".utf8))
    }
}
@MainActor private final class AccountBrowser: WebAuthenticator {
    let cancelled: Bool
    init(cancelled: Bool = false) { self.cancelled = cancelled }
    func authenticate(_ attempt: NativeLoginAttempt) async throws -> URL {
        if cancelled { throw CancellationError() }
        return URL(string: "rememberme://auth/callback?state=\(attempt.state)&code=\(String(repeating: "x", count: 43))")!
    }
}
@Test @MainActor func accountConnectionPersistsOnlyOriginInPreferencesAndKeepsCredentialsInVault() async throws {
    let suite = "rememberme-account-ui-" + UUID().uuidString
    let defaults = UserDefaults(suiteName: suite)!; defer { defaults.removePersistentDomain(forName: suite) }
    let vault = AccountVault(), transport = AccountTransport()
    let model = AccountConnectionModel(browser: AccountBrowser(), defaults: defaults, permitsTestNetworking: true) { origin in
        NativeSession(origin: origin, vault: vault, transport: transport)
    }
    model.serverAddress = "https://api.example.test"; model.signIn()
    while model.busy { await Task.yield() }
    #expect(model.error == nil); #expect(model.identity?.userId == "synthetic-account")
    #expect(try vault.load() != nil)
    #expect(defaults.persistentDomain(forName: suite)?.keys.sorted() == ["rememberme.api.origin"])
    #expect(await transport.count() == 1)
    model.disconnect(); while model.busy { await Task.yield() }
    #expect(model.identity == nil); #expect(try vault.load() == nil)
    #expect(await transport.count() == 2)
}
@Test @MainActor func cancelledBrowserSignInDoesNotExchangeOrStoreCredentials() async throws {
    let suite = "rememberme-account-cancel-" + UUID().uuidString
    let defaults = UserDefaults(suiteName: suite)!; defer { defaults.removePersistentDomain(forName: suite) }
    let vault = AccountVault(), transport = AccountTransport()
    let model = AccountConnectionModel(browser: AccountBrowser(cancelled: true), defaults: defaults, permitsTestNetworking: true) { origin in
        NativeSession(origin: origin, vault: vault, transport: transport)
    }
    model.serverAddress = "https://api.example.test"; model.signIn()
    while model.busy { await Task.yield() }
    #expect(model.identity == nil); #expect(model.error == nil)
    #expect(try vault.load() == nil); #expect(await transport.count() == 0)
    #expect(model.status == "Sign-in cancelled · Local vocabulary unchanged")
}

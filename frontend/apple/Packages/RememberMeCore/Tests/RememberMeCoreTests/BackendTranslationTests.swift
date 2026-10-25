import Foundation
import Testing
@testable import RememberMeCore

private actor SyntheticChineseProvider: ChineseTranslationProvider {
    nonisolated let cacheNamespace: String
    private var requests = [String]()
    init(_ namespace: String) { cacheNamespace = namespace }
    func translate(_ word: String) async throws -> JSONValue {
        requests.append(word)
        return .object(["text": .string("合成释义"), "source": .string("hermes"), "target": .string("zh-CN")])
    }
    func calls() -> [String] { requests }
}

@Test func backendTranslationUsesSeparatePersistentCacheAndPreservesLegacyDefinitions() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("rememberme-hermes-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: directory) }
    let cache = directory.appendingPathComponent("cache.json")
    let provider = SyntheticChineseProvider("hermes:https://api.example.test")
    let first = LookupService(dictionaryDirectory: nil, cacheURL: cache, chineseProvider: provider)
    #expect(try await first.chinese("Synthetic")["source"]?.text == "hermes")
    let second = LookupService(dictionaryDirectory: nil, cacheURL: cache, chineseProvider: provider)
    #expect(try await second.chinese("synthetic")["text"]?.text == "合成释义")
    #expect(await provider.calls() == ["synthetic"])
    let other = SyntheticChineseProvider("hermes:https://other.example.test")
    await second.setChineseProvider(other)
    _ = try await second.chinese("synthetic")
    #expect(await other.calls() == ["synthetic"])
    for source in ["mymemory", "hermes"] {
        let definition = JSONValue.object(["word": .string("synthetic"), "phonetics": .array([]), "meanings": .array([]),
            "translation": .object(["text": .string("合成释义"), "source": .string(source), "target": .string("zh-CN")])])
        #expect(LegacyCodec.validDefinition(definition))
    }
}

private final class TranslationVault: CredentialVault, @unchecked Sendable {
    func load() throws -> APICredentials? {
        APICredentials(accessToken: String(repeating: "a", count: 43), refreshToken: String(repeating: "b", count: 43),
            accessExpiresAtMs: 100_000, refreshExpiresAtMs: 1_000_000, userId: "synthetic-user", deviceId: "synthetic-device")
    }
    func save(_ value: APICredentials) throws {}
    func clear() throws {}
}
private actor TranslationAPI: APITransport {
    private var request: URLRequest?
    private let data: Data
    init(_ data: String) { self.data = Data(data.utf8) }
    func send(_ request: URLRequest) async throws -> APIHTTPResponse {
        self.request = request
        return APIHTTPResponse(status: 200, data: data)
    }
    func sent() -> URLRequest? { request }
}
@Test func backendChineseProviderAuthenticatesAndSendsOnlyWordAndTarget() async throws {
    let origin = try APIOrigin("https://api.example.test")
    let transport = TranslationAPI("{\"translation\":{\"text\":\"合成释义\",\"target\":\"zh-CN\",\"source\":\"hermes\"}}")
    let session = NativeSession(origin: origin, vault: TranslationVault(), transport: transport, clock: { 1000 })
    let provider = BackendTranslationProvider(session: session, accountID: "synthetic-user", transport: transport)
    #expect(try await provider.translate("synthetic")["source"]?.text == "hermes")
    let sent = try #require(await transport.sent())
    #expect(sent.url?.absoluteString == "https://api.example.test/api/v1/lookup/translation")
    #expect(sent.httpMethod == "POST")
    #expect(sent.value(forHTTPHeaderField: "Authorization") == "Bearer " + String(repeating: "a", count: 43))
    #expect(try JSONDecoder().decode(JSONValue.self, from: #require(sent.httpBody)) == .object(["word": .string("synthetic"), "target": .string("zh-CN")]))
    #expect(provider.cacheNamespace != BackendTranslationProvider(session: session, accountID: "another-user").cacheNamespace)
}
@Test func backendChineseProviderRejectsMalformedAndUnexpectedSources() async throws {
    let origin = try APIOrigin("https://api.example.test")
    for body in ["{}", "{\"translation\":{\"text\":\"\",\"target\":\"zh-CN\",\"source\":\"hermes\"}}",
                 "{\"translation\":{\"text\":\"合成释义\",\"target\":\"zh-CN\",\"source\":\"unknown\"}}"] {
        let transport = TranslationAPI(body)
        let session = NativeSession(origin: origin, vault: TranslationVault(), transport: transport, clock: { 1000 })
        let provider = BackendTranslationProvider(session: session, accountID: "synthetic-user", transport: transport)
        await #expect(throws: LookupError.self) { try await provider.translate("synthetic") }
    }
}

@Test func backendChineseProviderAcceptsServerMyMemoryFallback() async throws {
    let transport = TranslationAPI("{\"translation\":{\"text\":\"备用释义\",\"target\":\"zh-CN\",\"source\":\"mymemory\"}}")
    let session = NativeSession(origin: try APIOrigin("https://api.example.test"), vault: TranslationVault(), transport: transport, clock: { 1000 })
    let provider = BackendTranslationProvider(session: session, accountID: "synthetic-user", transport: transport)
    #expect(try await provider.translate("synthetic")["source"]?.text == "mymemory")
}

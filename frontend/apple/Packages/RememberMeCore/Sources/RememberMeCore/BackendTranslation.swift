import Foundation

public protocol ChineseTranslationProvider: Sendable {
    var cacheNamespace: String { get }
    func translate(_ word: String) async throws -> JSONValue
}

public struct BackendTranslationProvider: ChineseTranslationProvider {
    public let cacheNamespace: String
    private let client: AuthenticatedAPIClient
    public init(session: NativeSession, accountID: String = "", transport: any APITransport = URLSessionAPITransport()) {
        cacheNamespace = "hermes:" + session.origin.string + ":" + accountID
        client = AuthenticatedAPIClient(session: session, transport: transport)
    }
    public func translate(_ word: String) async throws -> JSONValue {
        let body = try JSONValue.encoder().encode(JSONValue.object(["word": .string(word), "target": .string("zh-CN")]))
        let data = try await client.request(path: "/api/v1/lookup/translation", method: "POST", body: body)
        let translation = try JSONDecoder().decode(JSONValue.self, from: data)["translation"]
        guard let translation, let source = translation["source"]?.text, ["hermes", "mymemory"].contains(source), translation["target"]?.text == "zh-CN",
              let text = translation["text"]?.text, !LegacyCodec.trim(text).isEmpty, text.utf16.count <= 2000 else {
            throw LookupError.invalidResponse
        }
        return translation
    }
}

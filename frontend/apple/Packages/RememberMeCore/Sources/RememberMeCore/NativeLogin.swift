import Foundation
import Security
import CryptoKit

public struct NativeLoginAttempt: Sendable {
    public let id: UUID
    public let verifier: String
    public let state: String
    public let callback: URL
    public let authorizationURL: URL
    public init(origin: APIOrigin, deviceName: String, callback: URL = URL(string: "rememberme://auth/callback")!) throws {
        guard callback.scheme == "rememberme", callback.host == "auth", callback.path == "/callback",
              callback.query == nil, callback.fragment == nil, callback.user == nil, callback.password == nil, callback.port == nil,
              deviceName.utf16.count <= 80 else { throw AuthenticationError.invalidCallback }
        id = UUID(); verifier = try Self.random(); state = try Self.random(); self.callback = callback
        authorizationURL = try origin.endpoint("/auth/native/start", query: [URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "challenge", value: Self.challenge(verifier)), URLQueryItem(name: "callback", value: callback.absoluteString),
            URLQueryItem(name: "deviceName", value: deviceName)])
    }
    private static func random() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else { throw AuthenticationError.randomGeneration(status) }
        return base64url(Data(bytes))
    }
    public static func challenge(_ verifier: String) -> String { base64url(Data(SHA256.hash(data: Data(verifier.utf8)))) }
    private static func base64url(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
    public func code(from result: URL) throws -> String {
        guard let components = URLComponents(url: result, resolvingAgainstBaseURL: false),
              components.scheme == callback.scheme, components.host == callback.host, components.path == callback.path,
              components.user == nil, components.password == nil, components.port == nil, components.fragment == nil,
              let items = components.queryItems, items.count == 2,
              items.filter({ $0.name == "state" }).count == 1, items.filter({ $0.name == "code" }).count == 1,
              items.first(where: { $0.name == "state" })?.value == state,
              let code = items.first(where: { $0.name == "code" })?.value,
              code.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else { throw AuthenticationError.invalidCallback }
        return code
    }
}

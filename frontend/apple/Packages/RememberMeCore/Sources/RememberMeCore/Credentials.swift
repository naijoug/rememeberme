import Foundation
import Security

public struct APICredentials: Codable, Sendable, Equatable {
    public var accessToken: String
    public var refreshToken: String
    public var accessExpiresAtMs: Double
    public var refreshExpiresAtMs: Double
    public var userId: String
    public var deviceId: String
    /// Durable rotation intent; omitted from server replies and cleared on success.
    public var refreshRequestId: String? = nil
    public init(accessToken: String, refreshToken: String, accessExpiresAtMs: Double, refreshExpiresAtMs: Double,
                userId: String, deviceId: String) {
        self.accessToken = accessToken; self.refreshToken = refreshToken
        self.accessExpiresAtMs = accessExpiresAtMs; self.refreshExpiresAtMs = refreshExpiresAtMs
        self.userId = userId; self.deviceId = deviceId
    }
    public func validate() throws {
        let tokenPattern = "^[A-Za-z0-9_-]{43}$"
        let identityPattern = "^[A-Za-z0-9:_-]{1,200}$"
        guard accessToken.range(of: tokenPattern, options: .regularExpression) != nil,
              refreshToken.range(of: tokenPattern, options: .regularExpression) != nil,
              refreshRequestId == nil || refreshRequestId?.range(of: tokenPattern, options: .regularExpression) != nil,
              userId.range(of: identityPattern, options: .regularExpression) != nil,
              deviceId.range(of: identityPattern, options: .regularExpression) != nil,
              accessExpiresAtMs.isFinite, refreshExpiresAtMs.isFinite,
              accessExpiresAtMs > 0, refreshExpiresAtMs >= accessExpiresAtMs else { throw AuthenticationError.invalidReply }
    }
}

public enum AuthenticationError: Error, Sendable, Equatable, LocalizedError {
    case invalidServer, invalidCallback, invalidReply, notSignedIn, expired, superseded
    case keychain(OSStatus), randomGeneration(OSStatus)
    public var errorDescription: String? {
        switch self {
        case .invalidServer: return "Use an HTTPS API origin without credentials, a path, query or fragment."
        case .invalidCallback: return "The login callback does not match this active sign-in. Start a new sign-in."
        case .invalidReply: return "The server returned an invalid authentication response."
        case .notSignedIn: return "Sign in to connect this device."
        case .expired: return "This device session expired or was revoked. Sign in again."
        case .superseded: return "The account connection changed before this action finished."
        case .keychain: return "Could not access saved credentials. Unlock this device and try again."
        case .randomGeneration: return "Could not prepare a secure sign-in. Try again."
        }
    }
}

/// Synchronous vault writes run within NativeSession's actor turn. That avoids
/// logout/new-login reentrancy between checking a lease and committing credentials.
public protocol CredentialVault: Sendable {
    func load() throws -> APICredentials?
    func save(_ value: APICredentials) throws
    func clear() throws
}

public struct KeychainCredentialVault: CredentialVault {
    private let service: String
    private let account: String
    public init(origin: String, service: String = "com.rememberme.credentials.v1") {
        self.service = service; account = LegacyCodec.digest(Data(origin.utf8))
    }
    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: account, kSecAttrSynchronizable as String: false]
    }
    public func load() throws -> APICredentials? {
        var request = query; request[kSecReturnData as String] = true; request[kSecMatchLimit as String] = kSecMatchLimitOne
        var found: CFTypeRef?
        let result = SecItemCopyMatching(request as CFDictionary, &found)
        if result == errSecItemNotFound { return nil }
        guard result == errSecSuccess else { throw AuthenticationError.keychain(result) }
        guard let data = found as? Data else { throw AuthenticationError.invalidReply }
        let value = try JSONDecoder().decode(APICredentials.self, from: data)
        try value.validate(); return value
    }
    public func save(_ value: APICredentials) throws {
        try value.validate()
        let attributes: [String: Any] = [kSecValueData as String: try JSONValue.encoder().encode(value),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        var result = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if result == errSecItemNotFound {
            var insert = query
            for (key, value) in attributes { insert[key] = value }
            result = SecItemAdd(insert as CFDictionary, nil)
        }
        guard result == errSecSuccess else { throw AuthenticationError.keychain(result) }
    }
    public func clear() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw AuthenticationError.keychain(status) }
    }
}

public struct APIOrigin: Sendable, Equatable {
    public let url: URL
    public let string: String
    public init(_ raw: String, allowLoopbackHTTP: Bool = false) throws {
        guard var components = URLComponents(string: raw), let scheme = components.scheme?.lowercased(),
              let host = components.host?.lowercased(), !host.isEmpty,
              components.user == nil, components.password == nil, components.query == nil, components.fragment == nil,
              components.path.isEmpty || components.path == "/",
              scheme == "https" || (allowLoopbackHTTP && scheme == "http" && ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host)) else {
            throw AuthenticationError.invalidServer
        }
        components.scheme = scheme; components.host = host; components.path = ""
        if (scheme == "https" && components.port == 443) || (scheme == "http" && components.port == 80) { components.port = nil }
        guard let url = components.url else { throw AuthenticationError.invalidServer }
        self.url = url; string = url.absoluteString
    }
    public func endpoint(_ path: String, query: [URLQueryItem] = []) throws -> URL {
        guard path.hasPrefix("/api/v1/") || path == "/auth/native/start", !path.contains(".."), !path.contains("?"), !path.contains("#") else {
            throw AuthenticationError.invalidServer
        }
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        components.path = path; components.queryItems = query.isEmpty ? nil : query
        guard let result = components.url else { throw AuthenticationError.invalidServer }; return result
    }
}

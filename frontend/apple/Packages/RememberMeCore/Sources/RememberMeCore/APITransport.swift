import Foundation

public struct APIHTTPResponse: Sendable {
    public var status: Int
    public var headers: [String: String]
    public var data: Data
    public init(status: Int, headers: [String: String] = ["content-type": "application/json"], data: Data) {
        self.status = status; self.headers = Dictionary(headers.map { ($0.key.lowercased(), $0.value) }, uniquingKeysWith: { _, last in last }); self.data = data
    }
}
public protocol APITransport: Sendable {
    func send(_ request: URLRequest) async throws -> APIHTTPResponse
}
public enum APIRequestError: Error, Sendable, Equatable, LocalizedError {
    case responseTooLarge, invalidResponse
    case server(status: Int, code: String, retryable: Bool, requestId: String?)
    public var errorDescription: String? {
        switch self {
        case .responseTooLarge: return "The API response is too large to process. Try a smaller page."
        case .invalidResponse: return "The API returned an invalid response."
        case .server(let status, let code, _, _):
            switch code {
            case "LOGIN_NOT_CONFIGURED": return "Sign-in is not configured on this server yet."
            case "VERSION_CONFLICT", "REVIEW_VERSION_CONFLICT": return "This item changed on another device. Refresh and resolve the conflict."
            case "SOURCE_CONFLICT": return "This word has another source. Review the merge before uploading."
            case "SYNC_EPOCH_CHANGED": return "The server was restored or reset. A full synchronization is required."
            case "RATE_LIMITED": return "Too many requests. Try again later."
            default: return "The API request failed (HTTP \(status))."
            }
        }
    }
    public var requiresSignIn: Bool {
        guard case .server(let status, let code, _, _) = self else { return false }
        return status == 401 && ["UNAUTHENTICATED", "REFRESH_REJECTED", "LOGIN_CODE_REJECTED"].contains(code)
    }
}

private final class NoAPIRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
}
public struct URLSessionAPITransport: APITransport {
    private let session: URLSession
    private let maximumBytes: Int
    public init(maximumBytes: Int = 32 * 1024 * 1024) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil; configuration.urlCredentialStorage = nil
        configuration.httpShouldSetCookies = false; configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 15; configuration.timeoutIntervalForResource = 20
        session = URLSession(configuration: configuration, delegate: NoAPIRedirects(), delegateQueue: nil)
        self.maximumBytes = maximumBytes
    }
    public func send(_ request: URLRequest) async throws -> APIHTTPResponse {
        var request = request; request.httpShouldHandleCookies = false
        let (stream, response) = try await session.bytes(for: request)
        var finished = false
        defer { if !finished { stream.task.cancel() } }
        guard let response = response as? HTTPURLResponse else { throw APIRequestError.invalidResponse }
        if response.expectedContentLength > Int64(maximumBytes) { throw APIRequestError.responseTooLarge }
        var data = Data()
        for try await byte in stream {
            try Task.checkCancellation()
            guard data.count < maximumBytes else { throw APIRequestError.responseTooLarge }
            data.append(byte)
        }
        finished = true
        let headers = response.allHeaderFields.reduce(into: [String: String]()) { result, item in
            if let key = item.key as? String, let value = item.value as? String { result[key] = value }
        }
        return APIHTTPResponse(status: response.statusCode, headers: headers, data: data)
    }
}

public struct APIHTTPClient: Sendable {
    public let origin: APIOrigin
    public let transport: any APITransport
    public init(origin: APIOrigin, transport: any APITransport = URLSessionAPITransport()) { self.origin = origin; self.transport = transport }
    public func request(path: String, method: String = "GET", query: [URLQueryItem] = [], body: Data? = nil,
                        accessToken: String? = nil, epoch: String? = nil) async throws -> Data {
        if let body, body.count > 256 * 1024 { throw ClientError.invalidData("API request exceeds the supported size") }
        var request = URLRequest(url: try origin.endpoint(path, query: query)); request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body { request.httpBody = body; request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let accessToken { request.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization") }
        if let epoch { request.setValue(epoch, forHTTPHeaderField: "X-Sync-Epoch") }
        let response = try await transport.send(request)
        let contentType = response.headers["content-type"]?.lowercased() ?? ""
        guard contentType.contains("application/json") else { throw APIRequestError.invalidResponse }
        if !(200..<300).contains(response.status) {
            guard let failure = try? JSONDecoder().decode(APIErrorBody.self, from: response.data),
                  failure.error.code.range(of: "^[A-Z0-9_]{1,100}$", options: .regularExpression) != nil else { throw APIRequestError.invalidResponse }
            throw APIRequestError.server(status: response.status, code: failure.error.code, retryable: failure.error.retryable,
                requestId: UUID(uuidString: failure.error.requestId) == nil ? nil : failure.error.requestId)
        }
        return response.data
    }
}

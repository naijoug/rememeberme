import Foundation
import Testing
@testable import RememberMeCore

private actor ReplyTransport: APITransport {
    let reply: APIHTTPResponse
    var requests: [URLRequest] = []
    init(_ reply: APIHTTPResponse) { self.reply = reply }
    func send(_ request: URLRequest) -> APIHTTPResponse { requests.append(request); return reply }
    func count() -> Int { requests.count }
}
@Test func apiRejectsHtmlRedirectAndOversizedRequestsWithoutLeakingCredentials() async throws {
    let origin = try APIOrigin("https://api.example.test")
    let redirected = ReplyTransport(APIHTTPResponse(status: 302, headers: ["Content-Type": "text/html", "Location": "https://other.example.test/"], data: Data("redirect".utf8)))
    let client = APIHTTPClient(origin: origin, transport: redirected)
    await #expect(throws: APIRequestError.invalidResponse) { try await client.request(path: "/api/v1/me", accessToken: "synthetic") }
    #expect(await redirected.count() == 1)
    await #expect(throws: (any Error).self) { try await client.request(path: "/api/v1/sync/operations", method: "POST", body: Data(repeating: 1, count: 256 * 1024 + 1)) }
    #expect(await redirected.count() == 1)
    let request = await redirected.requests[0]
    #expect(request.url?.host == "api.example.test")
    #expect(request.url?.query == nil)
    #expect(request.value(forHTTPHeaderField: "Cookie") == nil)
}
@Test func apiErrorMetadataDoesNotInterpretUntrustedMessagesAsAuthenticationRejection() async throws {
    let bad = ReplyTransport(APIHTTPResponse(status: 401, data: Data("{\"error\":{\"code\":\"<script>wrong</script>\",\"retryable\":false,\"requestId\":\"bad\"}}".utf8)))
    let client = APIHTTPClient(origin: try APIOrigin("https://api.example.test"), transport: bad)
    await #expect(throws: APIRequestError.invalidResponse) { try await client.request(path: "/api/v1/me") }
    let ordinary = APIRequestError.server(status: 503, code: "AUTH_STORAGE_UNAVAILABLE", retryable: true, requestId: nil)
    #expect(ordinary.requiresSignIn == false)
}

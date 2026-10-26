import SwiftUI
@preconcurrency import AuthenticationServices
import RememberMeCore
#if os(macOS)
import AppKit
#else
import UIKit
#endif

@MainActor protocol WebAuthenticator: AnyObject {
    func authenticate(_ attempt: NativeLoginAttempt) async throws -> URL
}
@MainActor final class AppleWebAuthenticator: NSObject, WebAuthenticator, ASWebAuthenticationPresentationContextProviding {
    private var active: ASWebAuthenticationSession?
    private var continuation: CheckedContinuation<URL, Error>?
    private var flight: UUID?
    // AuthenticationServices may invoke its ObjC completion on an XPC queue.
    // Keep the outer closure nonisolated; an inherited MainActor closure traps
    // in Swift 6 before its inner Task can hop to the main executor.
    nonisolated static func completionHandler(_ action: @escaping @MainActor @Sendable (URL?, Error?) -> Void)
        -> @Sendable (URL?, Error?) -> Void {
        { url, error in Task { @MainActor in action(url, error) } }
    }
    func authenticate(_ attempt: NativeLoginAttempt) async throws -> URL {
        guard continuation == nil else { throw AuthenticationError.superseded }
        let id = UUID(); flight = id
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                if Task.isCancelled { continuation.resume(throwing: CancellationError()); flight = nil; return }
                self.continuation = continuation
                let browser = ASWebAuthenticationSession(url: attempt.authorizationURL, callbackURLScheme: attempt.callback.scheme,
                    completionHandler: Self.completionHandler { [weak self] url, error in
                        guard let self, self.flight == id else { return }
                        if let url { self.finish(.success(url)) }
                        else { self.finish(.failure(error ?? AuthenticationError.invalidCallback)) }
                    })
                browser.presentationContextProvider = self; browser.prefersEphemeralWebBrowserSession = true
                active = browser
                if !browser.start() { finish(.failure(AuthenticationError.invalidCallback)) }
            }
        } onCancel: {
            Task { @MainActor in
                guard self.flight == id else { return }
                self.active?.cancel(); self.finish(.failure(CancellationError()))
            }
        }
    }
    private func finish(_ result: Result<URL, Error>) {
        let waiting = continuation; continuation = nil; active = nil; flight = nil
        waiting?.resume(with: result)
    }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        #if os(macOS)
        return NSApplication.shared.keyWindow ?? NSApplication.shared.windows.first(where: \.isVisible) ?? ASPresentationAnchor()
        #else
        return UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
        #endif
    }
}

@MainActor private enum SessionPool {
    static var sessions: [String: NativeSession] = [:]
    static func session(_ origin: APIOrigin) -> NativeSession {
        if let value = sessions[origin.string] { return value }
        let value = NativeSession(origin: origin); sessions[origin.string] = value; return value
    }
}

@MainActor final class AccountConnectionModel: ObservableObject {
    static let shared = AccountConnectionModel()
    @Published var serverAddress = ""
    @Published private(set) var identity: ConnectedIdentity?
    @Published private(set) var busy = false
    @Published var error: String?
    @Published var status = "Cloud account is not connected"
    private var session: NativeSession?
    private let browser: any WebAuthenticator
    private let defaults: UserDefaults
    private let factory: @MainActor (APIOrigin) -> NativeSession
    private let permitsTestNetworking: Bool
    private var work: Task<Void, Never>?
    init(browser: any WebAuthenticator = AppleWebAuthenticator(), defaults: UserDefaults = .standard,
         permitsTestNetworking: Bool = false, factory: @escaping @MainActor (APIOrigin) -> NativeSession = SessionPool.session) {
        self.browser = browser; self.defaults = defaults; self.permitsTestNetworking = permitsTestNetworking; self.factory = factory
        if !isDisposableSession { serverAddress = defaults.string(forKey: "rememberme.api.origin") ?? "" }
    }
    private var isDisposableSession: Bool {
        ProcessInfo.processInfo.arguments.contains("-rememberme-test-store") && !permitsTestNetworking
    }
    func restore() async {
        guard !busy, !serverAddress.isEmpty, !isDisposableSession else { return }
        do {
            let origin = try APIOrigin(serverAddress)
            let session = factory(origin); self.session = session; identity = try await session.restoreIdentity()
            status = identity == nil ? "Cloud account is not connected" : "Saved account connection · Vocabulary remains local until sync is enabled"
        } catch { self.error = error.localizedDescription }
    }
    func signIn() {
        guard !busy else { return }
        guard !isDisposableSession else { error = "Account networking is disabled for disposable UI test stores."; return }
        busy = true; error = nil
        work = Task {
            defer { busy = false; work = nil }
            var attempt: NativeLoginAttempt?
            do {
                let origin = try APIOrigin(serverAddress), session = factory(origin)
                self.session = session
                #if os(macOS)
                let name = "Remember Me Mac"
                #else
                let name = "Remember Me iPhone"
                #endif
                let login = try await session.beginLogin(deviceName: name); attempt = login
                status = "Complete sign-in in the system browser"
                let callback = try await browser.authenticate(login)
                identity = try await session.completeLogin(login, callback: callback)
                serverAddress = origin.string; defaults.set(origin.string, forKey: "rememberme.api.origin")
                status = "Account connected · Vocabulary upload requires a separate merge and sync choice"
            } catch {
                if let attempt, let session { await session.cancelLogin(attempt) }
                if error is CancellationError || (error as NSError).code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                    status = "Sign-in cancelled · Local vocabulary unchanged"
                } else { self.error = error.localizedDescription; status = "Account connection was not completed" }
            }
        }
    }
    func cancel() { work?.cancel() }
    func connectedSession() async throws -> NativeSession {
        guard let session, let identity, try await session.restoreIdentity() == identity else { throw AuthenticationError.notSignedIn }
        return session
    }
    func translationProvider() async throws -> BackendTranslationProvider {
        guard let session, let identity else { throw AuthenticationError.notSignedIn }
        return BackendTranslationProvider(session: session, accountID: identity.userId)
    }
    func disconnect() {
        guard !busy, let session else { return }
        busy = true; error = nil
        work = Task {
            defer { busy = false; work = nil }
            do {
                let revoked = try await session.logout(); identity = nil
                status = revoked ? "Account disconnected · Local vocabulary retained"
                    : "Disconnected on this device · Server revocation could not be confirmed"
            }
            catch { self.error = error.localizedDescription }
        }
    }
}

struct AccountConnectionView: View {
    @ObservedObject var model: AccountConnectionModel
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Cloud account").font(.headline)
            TextField("HTTPS API address", text: $model.serverAddress).textContentType(.URL).disabled(model.busy || model.identity != nil)
            Text(model.status).font(.caption).foregroundStyle(.secondary)
            if model.identity != nil {
                Button("Disconnect account") { model.disconnect() }.disabled(model.busy)
            } else {
                HStack {
                    Button("Sign in with GitHub") { model.signIn() }.disabled(model.busy || model.serverAddress.isEmpty)
                    if model.busy { Button("Cancel sign-in", role: .cancel) { model.cancel() } }
                }
            }
            if let error = model.error { Text(verbatim: error).font(.caption).foregroundStyle(.red) }
            Text("Connecting saves device credentials in Keychain. Vocabulary, history and backups stay on this device until you explicitly enable sync and confirm ownership.").font(.caption).foregroundStyle(.secondary)
        }.task { await model.restore() }
    }
}

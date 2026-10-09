import UIKit
import SwiftUI
import UniformTypeIdentifiers
import RememberMeCore

@MainActor final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let host = UIHostingController(rootView: ShareCaptureView(controller: self))
        addChild(host); view.addSubview(host.view); host.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([host.view.topAnchor.constraint(equalTo: view.topAnchor), host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor), host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor)])
        host.didMove(toParent: self)
    }
    func input() async throws -> CaptureDraft {
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
        guard providers.count <= 10 else { throw ClientError.invalidData("share at most ten text/URL items at a time") }
        var text: [String] = []; var source: String?
        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier), let value = try? await read(provider, type: UTType.plainText.identifier) { text.append(value) }
            if source == nil, provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                source = try? await read(provider, type: UTType.url.identifier)
            }
        }
        let result = CaptureDraft(text: text.joined(separator: "\n"), sourceURL: source)
        try result.validate(); return result
    }
    private func read(_ provider: NSItemProvider, type: String) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadItem(forTypeIdentifier: type, options: nil) { value, error in
                if let error { continuation.resume(throwing: error) }
                else if let url = value as? URL { continuation.resume(returning: url.absoluteString) }
                else if let text = value as? String { continuation.resume(returning: text) }
                else if let data = value as? Data, let text = String(data: data, encoding: .utf8) { continuation.resume(returning: text) }
                else { continuation.resume(throwing: ClientError.invalidData("host supplied no readable text or URL")) }
            }
        }
    }
    func save(_ draft: CaptureDraft) async throws {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "RememberMeAppGroup") as? String,
              let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else {
            throw ClientError.invalidData("sharing is unavailable in this installation; open the app and use Paste")
        }
        try await CaptureInbox(directory: container.appendingPathComponent("CaptureInbox")).save(draft)
        // Complete only after the inbox write/synchronization succeeded. No network or app launch.
        extensionContext?.completeRequest(returningItems: nil)
    }
    func cancel() { extensionContext?.cancelRequest(withError: ClientError.cancelled) }
}

private struct ShareCaptureView: View {
    let controller: ShareViewController
    @State private var draft: CaptureDraft?
    @State private var error: String?
    @State private var busy = false
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Save a Remember Me draft").font(.title2)
            if let draft {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        if !draft.text.isEmpty { Text(verbatim: draft.text).textSelection(.enabled) }
                        if let source = draft.sourceURL { Text(verbatim: source).font(.caption).textSelection(.enabled) }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
                Text("Open Remember Me to choose a word and confirm it. Sharing does not increase forgotten counts.").font(.caption)
            } else if error == nil { ProgressView("Reading shared content") }
            if let error { Text(verbatim: error).foregroundStyle(.red) }
            HStack {
                Button("Cancel", role: .cancel) { controller.cancel() }.disabled(busy)
                Button("Save draft") {
                    guard let draft else { return }; busy = true
                    Task { do { try await controller.save(draft) } catch { self.error = error.localizedDescription; busy = false } }
                }.disabled(draft == nil || busy)
            }
        }.padding(24)
        .task { do { draft = try await controller.input() } catch { self.error = error.localizedDescription } }
    }
}

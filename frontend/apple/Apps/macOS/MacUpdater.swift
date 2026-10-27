import SwiftUI
import Combine
import Sparkle

/// One updater for all windows. Sparkle owns downloads, validation, installation
/// and preferences; vocabulary stores and account credentials are not involved.
@MainActor final class MacUpdater: ObservableObject {
    @Published private(set) var canCheckForUpdates = false
    @Published private(set) var automaticChecks = false
    @Published private(set) var automaticDownloads = false
    @Published private(set) var lastCheck: Date?
    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "Unknown"
    let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "Unknown"
    let disabledForTesting: Bool
    private let controller: SPUStandardUpdaterController?

    init() {
        disabledForTesting = ProcessInfo.processInfo.arguments.contains("-rememberme-test-store")
        guard !disabledForTesting else { controller = nil; return }
        let controller = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
        self.controller = controller
        let updater = controller.updater
        updater.publisher(for: \.canCheckForUpdates).assign(to: &$canCheckForUpdates)
        updater.publisher(for: \.automaticallyChecksForUpdates).assign(to: &$automaticChecks)
        updater.publisher(for: \.automaticallyDownloadsUpdates).assign(to: &$automaticDownloads)
        updater.publisher(for: \.lastUpdateCheckDate).assign(to: &$lastCheck)
    }
    func checkForUpdates() { controller?.checkForUpdates(nil) }
    func setAutomaticChecks(_ enabled: Bool) { controller?.updater.automaticallyChecksForUpdates = enabled }
    func setAutomaticDownloads(_ enabled: Bool) { controller?.updater.automaticallyDownloadsUpdates = enabled }
}

struct MacUpdateSettingsView: View {
    @ObservedObject var model: MacUpdater
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            GroupBox {
                VStack(alignment: .leading, spacing: 12) {
                    LabeledContent("Installed version", value: "\(model.version) (\(model.build))")
                    if let date = model.lastCheck {
                        LabeledContent("Last checked", value: date.formatted(date: .abbreviated, time: .shortened))
                    }
                    Button("Check for Updates…") { model.checkForUpdates() }
                        .disabled(!model.canCheckForUpdates)
                    Text("When a new version is available, you can download it and install it from the update window.")
                        .font(.caption).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, alignment: .leading).padding(8)
            } label: { Label("Software update", systemImage: "arrow.down.circle") }
            GroupBox {
                VStack(alignment: .leading, spacing: 12) {
                    Toggle("Automatically check for updates", isOn: Binding(get: { model.automaticChecks }, set: { model.setAutomaticChecks($0) }))
                    Toggle("Automatically download and install updates", isOn: Binding(get: { model.automaticDownloads }, set: { model.setAutomaticDownloads($0) }))
                        .disabled(!model.automaticChecks)
                    Text("Automatic updates install when you quit the app. You can also install and relaunch from the update window. Your saved words and account connection stay on this device.")
                        .font(.caption).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, alignment: .leading).padding(8)
            } label: { Text("Automatic updates") }
            .disabled(model.disabledForTesting)
            if model.disabledForTesting { Text("Updates are disabled for disposable UI tests.").font(.caption) }
        }
    }
}

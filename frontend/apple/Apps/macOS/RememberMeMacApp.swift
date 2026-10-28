import SwiftUI
import RememberMeUI

@main struct RememberMeMacApp: App {
    @StateObject private var updates = MacUpdater()
    @FocusedBinding(\.rememberMeSettings) private var showsSettings: Bool?
    var body: some Scene {
        WindowGroup("RememberMe") {
            RememberMeRootView(updates: AnyView(MacUpdateSettingsView(model: updates)))
                .frame(minWidth: 680, minHeight: 480)
        }
            .defaultSize(width: 960, height: 680)
            .commands {
                CommandGroup(replacing: .appSettings) {
                    Button("Settings…") { showsSettings = true }
                        .keyboardShortcut(",", modifiers: .command)
                        .disabled(showsSettings == nil)
                }
                CommandGroup(after: .appInfo) {
                    Button("Check for Updates…") { updates.checkForUpdates() }
                        .disabled(!updates.canCheckForUpdates)
                }
            }
    }
}

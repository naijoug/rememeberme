import SwiftUI
import RememberMeUI

@main struct RememberMeMacApp: App {
    @StateObject private var updates = MacUpdater()
    var body: some Scene {
        WindowGroup("RememberMe") { RememberMeRootView().frame(minWidth: 680, minHeight: 480) }
            .defaultSize(width: 960, height: 680)
            .commands {
                CommandGroup(after: .appInfo) {
                    Button("Check for Updates…") { updates.checkForUpdates() }
                        .disabled(!updates.canCheckForUpdates)
                }
            }
        Settings { RememberMeSettingsView(updates: AnyView(MacUpdateSettingsView(model: updates))) }
    }
}

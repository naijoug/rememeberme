import SwiftUI
import RememberMeUI

@main struct RememberMeMacApp: App {
    var body: some Scene {
        WindowGroup { RememberMeRootView().frame(minWidth: 680, minHeight: 480) }
            .defaultSize(width: 960, height: 680)
    }
}

import SwiftUI
import UserNotifications
import RememberMeCore

extension Notification.Name {
    static let rememberMeReminderSelectionChanged = Notification.Name("RememberMeReminderSelectionChanged")
    static let rememberMeOpenReview = Notification.Name("RememberMeOpenReview")
}

private final class ReminderDelegate: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard response.notification.request.identifier.hasPrefix("rememberme-review-") else { return }
        await MainActor.run { NotificationCenter.default.post(name: .rememberMeOpenReview, object: nil) }
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification) async -> UNNotificationPresentationOptions { [.banner, .sound] }
}

@MainActor final class ReminderSettings: ObservableObject {
    static let shared = ReminderSettings()
    @Published private(set) var enabled: Bool
    @Published var time: Date
    @Published var message: String?
    @Published private(set) var scheduling = false
    private let defaults: UserDefaults
    private let center: UNUserNotificationCenter
    private let delegate = ReminderDelegate()
    private var scheduleID = UUID()
    private init() {
        defaults = .standard; center = .current()
        enabled = defaults.bool(forKey: "rememberme.reminders.enabled")
        let hour = defaults.object(forKey: "rememberme.reminders.hour") as? Int ?? 20
        let minute = defaults.integer(forKey: "rememberme.reminders.minute")
        time = Calendar.current.date(bySettingHour: hour, minute: minute, second: 0, of: Date()) ?? Date()
        center.delegate = delegate
    }
    func setEnabled(_ value: Bool, repository: LocalRepository) async {
        guard !ProcessInfo.processInfo.arguments.contains("-rememberme-test-store") else {
            message = "System notifications are not requested from disposable UI test sessions."; return
        }
        if value {
            do {
                guard try await center.requestAuthorization(options: [.alert, .sound]) else {
                    enabled = false; message = "Notifications are disabled in system settings. Review remains available in the app."
                    defaults.set(false, forKey: "rememberme.reminders.enabled"); await reschedule(repository); return
                }
                enabled = true; message = nil
            } catch { message = error.localizedDescription; return }
        } else { enabled = false; message = nil }
        defaults.set(enabled, forKey: "rememberme.reminders.enabled")
        await reschedule(repository)
    }
    func saveTime(_ repository: LocalRepository) async {
        let parts = Calendar.current.dateComponents([.hour, .minute], from: time)
        defaults.set(parts.hour ?? 20, forKey: "rememberme.reminders.hour")
        defaults.set(parts.minute ?? 0, forKey: "rememberme.reminders.minute")
        await reschedule(repository)
    }
    func switchVocabulary(_ repository: LocalRepository) async {
        guard !ProcessInfo.processInfo.arguments.contains("-rememberme-test-store") else { return }
        let token = UUID(); scheduleID = token
        let delivered = await center.deliveredNotifications()
        guard scheduleID == token else { return }
        center.removeDeliveredNotifications(withIdentifiers: delivered.map { $0.request.identifier }.filter { $0.hasPrefix("rememberme-review-") })
        await reschedule(repository)
    }
    func reschedule(_ repository: LocalRepository) async {
        guard !ProcessInfo.processInfo.arguments.contains("-rememberme-test-store") else { return }
        let token = UUID(); scheduleID = token; scheduling = true
        defer { if scheduleID == token { scheduling = false } }
        let pending = await center.pendingNotificationRequests()
        guard scheduleID == token else { return }
        center.removePendingNotificationRequests(withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix("rememberme-review-") })
        guard enabled else {
            let delivered = await center.deliveredNotifications()
            if scheduleID == token { center.removeDeliveredNotifications(withIdentifiers: delivered.map { $0.request.identifier }.filter { $0.hasPrefix("rememberme-review-") }) }
            return
        }
        if repository.owner != "anonymous" {
            guard let configuration = try? await repository.syncConfiguration(),
                  configuration.capabilities?.contains("reminder-device-v1") == true,
                  configuration.reminderDevice?.deviceId == configuration.deviceId else {
                let delivered = await center.deliveredNotifications()
                guard scheduleID == token else { return }
                center.removeDeliveredNotifications(withIdentifiers: delivered.map { $0.request.identifier }.filter { $0.hasPrefix("rememberme-review-") })
                message = "Choose this device for account reminders while online. Other selected devices cancel when they reconnect."
                return
            }
        }
        let authorization = await center.notificationSettings().authorizationStatus
        guard scheduleID == token else { return }
        guard authorization == .authorized || authorization == .provisional else {
            message = "Allow notifications in system settings to receive reminders."; return
        }
        do {
            let now = Date(), zone = TimeZone.current.identifier
            let parts = Calendar.current.dateComponents([.hour, .minute], from: time)
            let dates = try ReminderPlan.dates(after: now, hour: parts.hour ?? 20, minute: parts.minute ?? 0, timeZoneID: zone)
            for date in dates {
                guard scheduleID == token, enabled else { return }
                let queue = try await repository.reviewQueue(at: date.timeIntervalSince1970 * 1000, timeZoneID: zone, limit: 1)
                guard scheduleID == token else { return }
                guard !queue.entries.isEmpty else { continue }
                var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(identifier: zone)!
                var components = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: date); components.timeZone = calendar.timeZone
                let content = UNMutableNotificationContent()
                content.title = "Remember Me"; content.body = "Take a moment to review your vocabulary. Open the app for the current queue."
                content.sound = .default; content.userInfo = ["destination": "review"]
                let id = "rememberme-review-" + token.uuidString + "-" + String(date.timeIntervalSince1970)
                try await center.add(UNNotificationRequest(identifier: id, content: content,
                    trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: false)))
                if scheduleID != token || !enabled { center.removePendingNotificationRequests(withIdentifiers: [id]); return }
            }
            message = "Reminders scheduled from this device’s local vocabulary. Other devices may need a separate update."
        } catch { if scheduleID == token { message = error.localizedDescription } }
    }
}

struct NativeSettingsView: View {
    let repository: LocalRepository
    var account: AccountVocabularyModel? = nil
    var showsDone = true
    var updates: AnyView? = nil
    @ObservedObject private var reminders = ReminderSettings.shared
    @Environment(\.dismiss) private var dismiss
    @AppStorage("rememberme.appearance") private var appearance = "system"
    @State private var selectedTab = 0
    var body: some View {
        #if os(macOS)
        TabView(selection: $selectedTab) {
            settingsScroll { accountSettings }.tabItem { Label("Account", systemImage: "person.crop.circle") }.tag(0)
            settingsScroll { generalSettings }.tabItem { Label("General", systemImage: "gearshape") }.tag(1)
            settingsScroll { privacySettings }.tabItem { Label("Privacy", systemImage: "hand.raised") }.tag(2)
            if let updates { settingsScroll { updates }.tabItem { Label("Updates", systemImage: "arrow.down.circle") }.tag(3) }
        }
        .frame(width: 560, height: 590)
        .preferredColorScheme(appearance == "light" ? .light : appearance == "dark" ? .dark : nil)
        #else
        settingsScroll {
            HStack { Text("Settings").font(.title2); Spacer(); if showsDone { Button("Done") { dismiss() } } }
            accountSettings
            generalSettings
            privacySettings
        }.frame(minWidth: 300, idealWidth: 520)
        #endif
    }
    private func settingsScroll<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        ScrollView { VStack(alignment: .leading, spacing: 20, content: content).frame(maxWidth: .infinity, alignment: .leading).padding(24) }
    }
    private var accountSettings: some View {
        VStack(alignment: .leading, spacing: 20) {
            if let account { NativeAccountSettingsView(account: account) }
            else { AccountConnectionView(model: .shared) }
        }
    }
    private var generalSettings: some View {
        VStack(alignment: .leading, spacing: 20) {
            GroupBox {
                Picker("Theme", selection: $appearance) {
                    Text("System").tag("system"); Text("Light").tag("light"); Text("Dark").tag("dark")
                }.padding(8)
            } label: { Label("Appearance", systemImage: "circle.lefthalf.filled") }
            GroupBox {
                VStack(alignment: .leading, spacing: 12) {
                    Toggle("Remind me on this device", isOn: Binding(get: { reminders.enabled },
                        set: { value in Task { await reminders.setEnabled(value, repository: repository) } })).disabled(reminders.scheduling)
                    DatePicker("Local reminder time", selection: $reminders.time, displayedComponents: .hourAndMinute)
                        .onChange(of: reminders.time) { Task { await reminders.saveTime(repository) } }
                    Text("Reminders use the vocabulary currently shown in the app.").font(.caption).foregroundStyle(.secondary)
                    if let message = reminders.message { Text(verbatim: message).font(.caption) }
                    if let account { AccountReminderView(model: account) }
                }.frame(maxWidth: .infinity, alignment: .leading).padding(8)
            } label: { Label("Reminders", systemImage: "bell") }
        }
    }
    private var privacySettings: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 12) {
                Text("Signing in enables word synchronization. Words saved before sign-in need your confirmation before they are added to your account.")
                Text("Saved sentences and source URLs are excluded from sync by default. Optional sharing controls are under Account → Advanced: source privacy.")
                Text("WordNet English hits stay local. Online lookup sends the selected word to dictionary or translation providers, without saved sentences or URLs.")
                Text("Complete backups include saved sentences and full URLs. Credentials and pending requests are excluded.")
            }.font(.callout).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading).padding(8)
        } label: { Label("Your data", systemImage: "hand.raised") }
    }
}

private struct NativeAccountSettingsView: View {
    @ObservedObject var account: AccountVocabularyModel
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            AccountConnectionView(model: account.connection, accountName: account.accountName, accountBusy: account.busy)
            AccountVocabularyView(model: account)
        }
    }
}

struct AccountReminderView: View {
    @ObservedObject var model: AccountVocabularyModel
    var body: some View {
        if !model.isAnonymous {
            VStack(alignment: .leading, spacing: 10) {
                Text("Account reminder device").font(.headline)
                Text(model.reminderSelection?.deviceId == model.connection.identity?.deviceId && model.reminderSelection?.deviceId != nil
                     ? "This device is selected. Enable local reminders above to receive notifications."
                     : model.reminderSelection?.deviceId == nil ? "No reminder device selected." : "Another device is selected.")
                Button("Use this device for account reminders") { model.chooseReminderDevice(enabled: true) }
                    .disabled(model.busy || !model.reminderControlsAvailable || model.connection.identity == nil)
                if model.reminderSelection?.deviceId != nil && model.reminderSelection?.deviceId == model.connection.identity?.deviceId {
                    Button("Stop account reminders on this device") { model.chooseReminderDevice(enabled: false) }.disabled(model.busy)
                }
                Text("A change takes effect on other devices after they reconnect. Offline devices may still deliver previously scheduled reminders.").font(.caption)
                if !model.reminderControlsAvailable { Text("Update the cloud service to support reminder device selection.").font(.caption) }
            }.task { await model.refreshReminderSelection() }
        }
    }
}

/// Uses the same repository/account pool as all vocabulary windows.
public struct RememberMeSettingsView: View {
    @StateObject private var model = VocabularyModel()
    private let updates: AnyView?
    public init(updates: AnyView? = nil) { self.updates = updates }
    public var body: some View {
        Group {
            if let repository = model.repository {
                NativeSettingsView(repository: repository, account: model.account, showsDone: false, updates: updates)
            } else if let error = model.error { Text(verbatim: error).padding() }
            else { ProgressView("Opening settings…") }
        }
    }
}

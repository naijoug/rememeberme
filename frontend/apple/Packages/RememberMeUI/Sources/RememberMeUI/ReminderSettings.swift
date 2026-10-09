import SwiftUI
import UserNotifications
import RememberMeCore

extension Notification.Name {
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
    @ObservedObject private var reminders = ReminderSettings.shared
    @Environment(\.dismiss) private var dismiss
    @AppStorage("rememberme.appearance") private var appearance = "system"
    var body: some View {
        ScrollView { VStack(alignment: .leading, spacing: 20) {
            HStack { Text("Settings").font(.title2); Spacer(); Button("Done") { dismiss() } }
            Picker("Appearance", selection: $appearance) {
                Text("System").tag("system"); Text("Light").tag("light"); Text("Dark").tag("dark")
            }
            Toggle("Remind me on this device", isOn: Binding(get: { reminders.enabled },
                set: { value in Task { await reminders.setEnabled(value, repository: repository) } })).disabled(reminders.scheduling)
            DatePicker("Local reminder time", selection: $reminders.time, displayedComponents: .hourAndMinute)
                .onChange(of: reminders.time) { Task { await reminders.saveTime(repository) } }
            Text("Enable reminders on your chosen device to avoid duplicate notifications. Reminders use the currently selected vocabulary.").font(.caption).foregroundStyle(.secondary)
            if let message = reminders.message { Text(verbatim: message).font(.caption) }
            Divider()
            AccountConnectionView(model: .shared)
            if let account { AccountVocabularyView(model: account) }
            Divider()
            Text("Vocabulary is saved on this device and uploaded to your chosen account only when you enable sync. WordNet English hits stay local; Chinese lookup uses MyMemory and English misses use Free Dictionary API. Only the lookup word is sent to dictionary providers.").font(.callout)
            Text("Complete backups include contexts and full URLs and may contain sensitive information. Credentials and pending network requests are excluded.").font(.callout)
        }.padding(24) }.frame(minWidth: 300, idealWidth: 520)
    }
}

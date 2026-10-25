import SwiftUI
import Combine
import RememberMeCore

@MainActor enum AccountVocabularyPool {
    private static var models: [String: AccountVocabularyModel] = [:]
    static func model(url: URL, anonymous: LocalRepository) -> AccountVocabularyModel {
        let key = url.standardizedFileURL.path
        if let value = models[key] { return value }
        let value = AccountVocabularyModel(url: url, anonymous: anonymous)
        value.startNetworkMonitoring()
        models[key] = value
        Task { await value.restoreSelection() }
        return value
    }
}

@MainActor final class AccountVocabularyModel: ObservableObject {
    @Published private(set) var repository: LocalRepository
    @Published private(set) var busy = false
    @Published var error: String?
    @Published var status = "Anonymous vocabulary · Saved on this device"
    @Published private(set) var preview: OwnershipPreview?
    @Published private(set) var recoveryPreview: EpochRecoveryPreview?
    @Published var recoveryChoices: [String: EpochRecoveryChoice] = [:]
    @Published var choices: [String: OwnershipSelection] = [:]
    @Published private(set) var pendingCount = 0
    @Published private(set) var conflicts: [SyncConflict] = []
    @Published private(set) var conflictCopies: [String: VocabularyEntry] = [:]
    @Published private(set) var syncEnabled = false
    @Published private(set) var sourcePrivacy = SyncPrivacy()
    @Published private(set) var sourceRemovalPending = false
    @Published private(set) var sourceControlsAvailable = false
    @Published private(set) var epochConflict = false
    @Published private(set) var accountName = "Connected account"
    let connection: AccountConnectionModel
    private let url: URL
    private let anonymous: LocalRepository
    private let defaults: UserDefaults
    private let opener: @MainActor (URL, String) async throws -> LocalRepository
    private let apiFactory: @MainActor (NativeSession) -> any SyncAPI
    private var target: LocalRepository?
    private var coordinator: SyncCoordinator?
    private var work: Task<Void, Never>?
    private var workID = UUID()
    private var subscription: AnyCancellable?
    private var lastIdentity: ConnectedIdentity?
    private var restoring = false
    private var networkMonitor: SyncNetworkMonitor?
    private var foregroundScenes = Set<UUID>()
    private var retryNeeded = false
    private lazy var retryScheduler = ForegroundSyncScheduler { [weak self] in
        guard let self, !self.isAnonymous, self.connection.identity != nil else { return false }
        if self.busy { return true }
        // Reminder preference reads are independent of vocabulary upload consent.
        if !self.syncEnabled { await self.refreshReminderSelection(); return false }
        self.synchronize(automatic: true)
        await self.work?.value
        return self.retryNeeded && self.syncEnabled && !self.epochConflict
    }
    func startNetworkMonitoring() {
        guard networkMonitor == nil, !disposable else { return }
        networkMonitor = SyncNetworkMonitor { [weak self] online in self?.retryScheduler.networkChanged(online: online) }
    }
    func setForeground(_ active: Bool, scene: UUID) {
        if active { foregroundScenes.insert(scene) } else { foregroundScenes.remove(scene) }
        retryScheduler.setActive(!foregroundScenes.isEmpty)
        if foregroundScenes.isEmpty { cancel() }
    }
    private var recoverySnapshot: ServerSnapshot?
    init(url: URL, anonymous: LocalRepository, connection: AccountConnectionModel = .shared, defaults: UserDefaults = .standard,
         opener: @escaping @MainActor (URL, String) async throws -> LocalRepository = { try await RepositoryPool.open($0, owner: $1) },
         apiFactory: @escaping @MainActor (NativeSession) -> any SyncAPI = { NativeSyncAPI(client: AuthenticatedAPIClient(session: $0)) }) {
        self.url = url; self.anonymous = anonymous; repository = anonymous; self.connection = connection; self.defaults = defaults
        self.opener = opener; self.apiFactory = apiFactory; lastIdentity = connection.identity
        subscription = connection.$identity.dropFirst().sink { [weak self] identity in
            Task { @MainActor in await self?.connectionChanged(identity) }
        }
    }
    var activeOwner: String { repository.owner }
    var isAnonymous: Bool { activeOwner == "anonymous" }
    private var preferenceKey: String { "rememberme.vocabulary.owner." + LegacyCodec.digest(Data(url.standardizedFileURL.path.utf8)) }
    private var disposable: Bool { ProcessInfo.processInfo.arguments.contains("-rememberme-test-store") }
    func restoreSelection() async {
        guard !disposable else { return }
        restoring = true; defer { restoring = false }
        await connection.restore()
        lastIdentity = connection.identity
        guard let owner = defaults.string(forKey: preferenceKey), owner.hasPrefix("account:") else { return }
        do {
            let saved = try await opener(url, owner)
            guard let configuration = try await saved.syncConfiguration(), SyncConfiguration.owner(for: configuration.identity) == owner else { return }
            if let identity = connection.identity, SyncConfiguration.owner(for: identity) != owner { return }
            repository = saved; target = saved
            await refreshStatus()
            if let identity = connection.identity, SyncConfiguration.owner(for: identity) == owner {
                coordinator = SyncCoordinator(repository: saved, api: apiFactory(try await connection.connectedSession()))
                synchronize()
            } else { status = "Saved account vocabulary · Offline · Anonymous vocabulary is separate" }
        } catch { self.error = error.localizedDescription }
    }
    private func connectionChanged(_ identity: ConnectedIdentity?) async {
        guard identity == connection.identity, identity != lastIdentity else { return }
        retryScheduler.cancel(); retryNeeded = false
        if restoring { lastIdentity = identity; return }
        lastIdentity = identity; workID = UUID(); work?.cancel(); work = nil; busy = false; preview = nil; choices = [:]
        recoveryPreview = nil; recoverySnapshot = nil; recoveryChoices = [:]
        if let coordinator { await coordinator.cancel() }
        if let target, let configuration = try? await target.syncConfiguration() {
            try? await target.configureSync(identity: configuration.identity, enabled: false, privacy: configuration.privacy)
        }
        guard connection.identity == identity else { return }
        coordinator = nil; target = nil; repository = anonymous; syncEnabled = false; conflicts = []; conflictCopies = [:]; pendingCount = 0
        if !disposable { defaults.set("anonymous", forKey: preferenceKey) }
        status = "Anonymous vocabulary · Account data and unsent changes are retained separately"
    }
    private func launch(_ action: @escaping @MainActor () async throws -> Void) {
        guard !busy else { return }
        let id = UUID(); workID = id; busy = true; error = nil
        work = Task {
            defer { if workID == id { busy = false; work = nil } }
            do { try await action() }
            catch {
                guard workID == id else { return }
                if !(error is CancellationError) { self.error = error.localizedDescription }
                status = "Saved on this device · Cloud action not completed"
            }
        }
    }
    func cancel() {
        retryScheduler.cancel(); retryNeeded = false
        work?.cancel()
        if let coordinator { Task { await coordinator.cancel() } }
    }
    private func preparedAccount() async throws -> LocalRepository {
        guard let identity = connection.identity else { throw AuthenticationError.notSignedIn }
        let session = try await connection.connectedSession()
        let account = try await opener(url, SyncConfiguration.owner(for: identity))
        try Task.checkCancellation()
        guard connection.identity == identity else { throw AuthenticationError.superseded }
        if let coordinator { await coordinator.cancel() }
        let privacy = try await account.syncConfiguration()?.privacy ?? SyncPrivacy()
        try await account.configureSync(identity: identity, enabled: false, privacy: privacy)
        try Task.checkCancellation()
        guard connection.identity == identity else { throw AuthenticationError.superseded }
        let sync = SyncCoordinator(repository: account, api: apiFactory(session)); coordinator = sync; target = account
        while true {
            try Task.checkCancellation()
            status = "Downloading account vocabulary for review…"
            let result = try await sync.pullForOwnershipPreview()
            try Task.checkCancellation()
            guard connection.identity == identity else { throw AuthenticationError.superseded }
            if !result.needsContinuation { break }
            if result.pulledPages == 0 && result.historyPages == 0 { throw ClientError.conflict("Cloud snapshot needs another foreground attempt") }
        }
        guard let configuration = try await account.syncConfiguration(), ["ready", "epochConflict"].contains(configuration.phase),
              Set(configuration.capabilities ?? []).isSuperset(of: ["history-order-v1", "history-version-v1", "explicit-lifecycles-v1"]) else {
            throw ClientError.conflict("This cloud service needs an update before vocabulary synchronization can be enabled")
        }
        accountName = configuration.displayName ?? "Connected account"
        return account
    }
    func openCloudVocabulary() {
        launch {
            let account = try await self.preparedAccount()
            self.select(account)
            await self.refreshStatus()
        }
    }
    func prepareOwnership() {
        launch {
            let account = try await self.preparedAccount()
            self.choices = [:]; self.preview = try await account.previewAnonymousOwnership()
            self.status = "Review anonymous vocabulary ownership before uploading"
        }
    }
    func updateOwnershipPreview() {
        guard let preview, let target else { return }
        launch { self.preview = try await target.previewAnonymousOwnership(choices: self.choices, previewId: preview.id) }
    }
    func dismissPreview() { guard !busy else { return }; preview = nil; choices = [:] }
    func confirmOwnership() {
        guard let preview, !preview.plan.entries.isEmpty, preview.plan.conflicts.isEmpty, let target else { return }
        launch {
            guard let identity = self.connection.identity, preview.plan.owner == SyncConfiguration.owner(for: identity) else { throw AuthenticationError.superseded }
            try Task.checkCancellation(); try await target.begin(preview.plan); try await target.resumeImport(preview.id)
            try Task.checkCancellation()
            guard self.connection.identity == identity else { throw AuthenticationError.superseded }
            self.preview = nil; self.choices = [:]; self.select(target)
            let privacy = try await target.syncConfiguration()?.privacy ?? SyncPrivacy()
            try await target.configureSync(identity: identity, enabled: true, privacy: privacy)
            await self.refreshStatus(); self.status = "Ownership confirmed · Local copy saved · Waiting for cloud synchronization"
        }
    }
    func useAnonymousVocabulary() {
        launch {
            if let coordinator = self.coordinator { await coordinator.cancel() }
            if let target = self.target, let configuration = try await target.syncConfiguration() {
                try await target.configureSync(identity: configuration.identity, enabled: false, privacy: configuration.privacy)
            }
            self.select(self.anonymous); self.syncEnabled = false; self.pendingCount = 0; self.conflicts = []; self.conflictCopies = [:]
            self.status = "Anonymous vocabulary · Saved on this device · Account queue paused"
        }
    }
    private func select(_ repository: LocalRepository) {
        retryScheduler.cancel(); retryNeeded = false
        self.repository = repository
        if !disposable { defaults.set(repository.owner, forKey: preferenceKey) }
    }
    func setSyncEnabled(_ enabled: Bool) {
        guard !isAnonymous else { return }
        if !enabled { retryScheduler.cancel(); retryNeeded = false }
        launch {
            guard let identity = self.connection.identity, SyncConfiguration.owner(for: identity) == self.repository.owner,
                  let configuration = try await self.repository.syncConfiguration(), configuration.phase != "epochConflict" else { throw AuthenticationError.notSignedIn }
            guard !enabled || Set(configuration.capabilities ?? []).isSuperset(of: ["history-order-v1", "history-version-v1", "explicit-lifecycles-v1"]) else {
                throw ClientError.conflict("Update the cloud service and reopen the account vocabulary before enabling sync")
            }
            if !enabled, let coordinator = self.coordinator { await coordinator.cancel() }
            try await self.repository.configureSync(identity: identity, enabled: enabled, privacy: configuration.privacy)
            await self.refreshStatus()
            if enabled { self.retryScheduler.trigger() }
        }
    }
    func synchronize(automatic: Bool = false) {
        guard !busy, !isAnonymous, syncEnabled, let coordinator else { return }
        if !automatic { retryScheduler.cancel() }
        launch {
            self.retryNeeded = false
            defer { if !automatic && self.retryNeeded { self.retryScheduler.trigger(immediate: false) } }
            do {
                for _ in 0..<3 {
                    let result = try await coordinator.run()
                    await self.refreshStatus()
                    self.retryNeeded = result.needsContinuation
                    let configuration = try await self.repository.syncConfiguration()
                    if !result.needsContinuation || (result.submitted == 0 && result.historyPages == 0 && configuration?.phase != "snapshot" && configuration?.pullBoundary == nil) { break }
                }
            } catch {
                self.retryNeeded = error is URLError
                if let apiError = error as? APIRequestError, case .server(_, _, let retryable, _) = apiError { self.retryNeeded = retryable }
                if error is CancellationError { self.retryNeeded = false }
                await self.refreshStatus()
                throw error
            }
        }
    }
    @Published private(set) var reminderSelection: ReminderDeviceSelection?
    @Published private(set) var reminderControlsAvailable = false
    func refreshReminderSelection() async {
        guard !isAnonymous, !busy, let configuration = try? await repository.syncConfiguration(), connection.identity == configuration.identity else { return }
        let reader = repository
        do {
            let api = try await sourceAPI(for: configuration)
            let account = try await api.account()
            guard repository === reader, connection.identity == configuration.identity else { return }
            try await reader.initializeSyncEpoch(account)
            await refreshStatus()
        } catch { /* Offline devices retain the last verified selection; foreground sync reports network failures. */ }
    }
    func chooseReminderDevice(enabled: Bool) {
        guard !isAnonymous, reminderControlsAvailable, let selection = reminderSelection else { return }
        launch {
            let reader = self.repository
            guard let configuration = try await reader.syncConfiguration(), self.connection.identity == configuration.identity else { throw AuthenticationError.superseded }
            let api = try await self.sourceAPI(for: configuration)
            do {
                let result = try await api.selectReminderDevice(enabled: enabled, expectedRevision: selection.revision)
                guard result.deviceId == (enabled ? configuration.deviceId : nil) else { throw APIRequestError.invalidResponse }
            } catch {
                // An unknown write outcome must not trigger an unconditional reclaim.
                if let account = try? await api.account(), self.repository === reader, self.connection.identity == configuration.identity {
                    try await reader.initializeSyncEpoch(account); await self.refreshStatus()
                }
                throw error
            }
            let account = try await api.account()
            guard self.repository === reader, self.connection.identity == configuration.identity else { throw AuthenticationError.superseded }
            try await reader.initializeSyncEpoch(account); await self.refreshStatus()
        }
    }
    func setSourcePrivacy(_ privacy: SyncPrivacy) {
        guard !isAnonymous else { return }
        launch {
            let repository = self.repository
            guard let configuration = try await repository.syncConfiguration(), configuration.pendingSourceRemoval == nil,
                  configuration.capabilities?.contains("source-privacy-v1") == true else { throw ClientError.conflict("Complete source removal or update the cloud service first") }
            if let coordinator = self.coordinator { await coordinator.cancel() }
            // Persist opt-outs before I/O, so a lost preference reply never permits a local send.
            let safe = SyncPrivacy(context: configuration.privacy.context && privacy.context, urls: configuration.privacy.urls && privacy.urls)
            try await repository.configureSync(identity: configuration.identity, enabled: false, privacy: safe)
            await self.refreshStatus()
            let api = try await self.sourceAPI(for: configuration)
            try await api.setSourcePrivacy(privacy, timezone: configuration.timeZoneID ?? "UTC")
            let account = try await api.account()
            try Task.checkCancellation()
            guard self.repository === repository, self.connection.identity == configuration.identity else { throw AuthenticationError.superseded }
            try await repository.initializeSyncEpoch(account)
            try await repository.configureSync(identity: configuration.identity, enabled: false,
                privacy: SyncPrivacy(context: privacy.context && account.syncContext, urls: privacy.urls && account.syncURLs))
            await self.refreshStatus(); self.status = "Source preferences saved · Sync is paused · Historical sources require explicit backfill"
        }
    }
    func clearUploadedSources() {
        guard !isAnonymous else { return }
        launch {
            let repository = self.repository
            if let coordinator = self.coordinator { await coordinator.cancel() }
            let request = try await repository.beginSourceRemoval()
            await self.refreshStatus()
            guard let configuration = try await repository.syncConfiguration(), let epoch = configuration.epoch else { throw AuthenticationError.notSignedIn }
            let api = try await self.sourceAPI(for: configuration)
            let revision = try await api.clearSources(request, epoch: epoch)
            guard self.connection.identity == configuration.identity, self.repository === repository else { throw AuthenticationError.superseded }
            try await repository.finishSourceRemoval(request, revision: revision)
            await self.refreshStatus(); self.status = "Uploaded contexts and URLs removed · Local sources retained · Sync is paused"
        }
    }
    private func sourceAPI(for configuration: SyncConfiguration) async throws -> any SyncAPI {
        try Task.checkCancellation()
        guard connection.identity == configuration.identity else { throw AuthenticationError.superseded }
        let api = apiFactory(try await connection.connectedSession())
        try Task.checkCancellation()
        guard connection.identity == configuration.identity, try await api.identity() == configuration.identity else { throw AuthenticationError.superseded }
        return api
    }
    func backfillHistoricalSources() {
        guard !isAnonymous else { return }
        launch {
            let repository = self.repository
            guard let configuration = try await repository.syncConfiguration(), configuration.pendingSourceRemoval == nil else { throw ClientError.conflict("Complete source removal first") }
            if let coordinator = self.coordinator { await coordinator.cancel() }
            try await repository.configureSync(identity: configuration.identity, enabled: false, privacy: configuration.privacy)
            await self.refreshStatus()
            var offset = 0, queued = 0
            while true {
                try Task.checkCancellation()
                let entries = try await repository.entries(limit: 50, offset: offset)
                if entries.isEmpty { break }
                for entry in entries {
                    var historyOffset = 0
                    while true {
                        try Task.checkCancellation()
                        let events = try await repository.history(entry.id, offset: historyOffset, limit: 25)
                        if events.isEmpty { break }
                        queued += try await repository.backfillSources(entryId: entry.id, offset: historyOffset)
                        historyOffset += events.count
                        self.status = "\(queued) historical sources queued · Sync stays paused"
                    }
                }
                offset += entries.count
            }
            await self.refreshStatus(); self.status = "\(queued) historical sources queued · Enable sync to upload"
        }
    }
    func localVocabularyChanged() async {
        guard !busy, !isAnonymous else { return }
        await refreshStatus()
        if pendingCount > 0 && syncEnabled { synchronize() }
    }
    func refreshStatus() async {
        guard !isAnonymous else { return }
        let reader = repository
        do {
            let state = try await reader.syncStatus()
            var current = try await reader.syncConflicts()
            var copies: [String: VocabularyEntry] = [:]
            for index in current.indices {
                current[index].remote = try await reader.remoteEntry(current[index].entryId)
                copies[current[index].id] = try await reader.entry(current[index].entryId, includeHistory: false)
            }
            let incompleteHistory = try await reader.pendingSyncHistory() != nil
            guard repository === reader else { return }
            let nextReminder = state.configuration?.reminderDevice
            let changedReminder = reminderSelection != nextReminder
            reminderSelection = nextReminder
            reminderControlsAvailable = state.configuration?.capabilities?.contains("reminder-device-v1") == true
            if changedReminder { NotificationCenter.default.post(name: .rememberMeReminderSelectionChanged, object: nil) }
            sourcePrivacy = state.configuration?.privacy ?? SyncPrivacy()
            sourceRemovalPending = state.configuration?.pendingSourceRemoval != nil
            sourceControlsAvailable = state.configuration?.capabilities?.contains("source-privacy-v1") == true
            syncEnabled = state.configuration?.enabled == true; epochConflict = state.configuration?.phase == "epochConflict"
            if !syncEnabled || epochConflict { retryScheduler.cancel(); retryNeeded = false }
            pendingCount = state.pending
            accountName = state.configuration?.displayName ?? "Connected account"
            conflicts = current; conflictCopies = copies
            if epochConflict { status = "Account vocabulary saved · Cloud was restored · Reconciliation required" }
            else if state.configuration?.phase != "ready" || state.configuration?.pullBoundary != nil || incompleteHistory { status = "Account vocabulary saved · Cloud download is incomplete" }
            else if !conflicts.isEmpty { status = "Saved on this device · \(conflicts.count) conflicts need review" }
            else if pendingCount > 0 { status = "Saved on this device · \(pendingCount) changes waiting for sync" }
            else { status = syncEnabled ? "Account vocabulary · Synchronization completed" : "Account vocabulary · Saved on this device · Sync is paused" }
        } catch { self.error = error.localizedDescription }
    }
    func useCloudForConflict(_ conflict: SyncConflict) {
        launch {
            try await self.repository.acceptRemoteForConflict(conflict.id)
            await self.refreshStatus()
        }
    }
    func separateCopyForConflict(_ conflict: SyncConflict) {
        guard let local = conflictCopies[conflict.id] else { return }
        launch {
            _ = try await self.repository.copyConflictAsSeparateLifecycle(conflict.id, expectedLocalVersion: local.version)
            await self.refreshStatus()
        }
    }
    func prepareEpochRecovery() {
        guard !isAnonymous else { return }
        launch {
            if let coordinator = self.coordinator { await coordinator.cancel() }
            guard let identity = self.connection.identity, identity == (try await self.repository.syncConfiguration())?.identity else { throw AuthenticationError.superseded }
            self.status = "Downloading restored cloud vocabulary…"
            let snapshot = try await ServerSnapshotLoader(api: self.apiFactory(try await self.connection.connectedSession())).download()
            try Task.checkCancellation()
            guard self.connection.identity == identity else { throw AuthenticationError.superseded }
            self.recoveryChoices = [:]; self.recoverySnapshot = snapshot
            self.recoveryPreview = try await self.repository.previewEpochRecovery(snapshot)
            self.status = "Review restored cloud data · Earlier requests remain paused"
        }
    }
    func updateEpochRecoveryChoices() {
        guard let recoverySnapshot, let recoveryPreview else { return }
        launch { self.recoveryPreview = try await self.repository.previewEpochRecovery(recoverySnapshot, choices: self.recoveryChoices, previewId: recoveryPreview.id) }
    }
    func dismissEpochRecovery() {
        guard !busy else { return }; recoveryPreview = nil; recoverySnapshot = nil; recoveryChoices = [:]
    }
    func validateEpochPublication(_ id: String, repository: LocalRepository) async throws {
        guard let identity = connection.identity, SyncConfiguration.owner(for: identity) == repository.owner else { throw AuthenticationError.superseded }
        let session = try await connection.connectedSession(), api = apiFactory(session)
        let account = try await api.account()
        try Task.checkCancellation()
        guard connection.identity == identity, try await api.identity() == identity else { throw AuthenticationError.superseded }
        try await repository.verifyEpochRecoveryPublication(id, account: account, identity: identity)
    }
    func confirmEpochRecovery() {
        guard let recoveryPreview, recoveryPreview.plan.conflicts.isEmpty else { return }
        let accountRepository = repository
        launch {
            try Task.checkCancellation(); try await accountRepository.begin(recoveryPreview.plan)
            try await accountRepository.stageImportToReady(recoveryPreview.id)
            try await self.validateEpochPublication(recoveryPreview.id, repository: accountRepository)
            try Task.checkCancellation(); try await accountRepository.publish(recoveryPreview.id)
            guard self.repository === accountRepository else { throw AuthenticationError.superseded }
            self.recoveryPreview = nil; self.recoverySnapshot = nil; self.recoveryChoices = [:]
            await self.refreshStatus()
            self.status = "Recovery choices saved · Sync remains paused until you enable it"
        }
    }
    func snapshotForAccountRestore(repository: LocalRepository) async throws -> ServerSnapshot {
        guard !busy else { throw ClientError.conflict("Finish the current account action before restoring a backup") }
        let token = UUID(); workID = token; busy = true
        defer { if workID == token { busy = false; Task { await self.refreshStatus() } } }
        guard let identity = connection.identity, SyncConfiguration.owner(for: identity) == repository.owner,
              let configuration = try await repository.syncConfiguration(), configuration.identity == identity else { throw AuthenticationError.notSignedIn }
        if let coordinator { await coordinator.cancel() }
        try await repository.configureSync(identity: identity, enabled: false, privacy: configuration.privacy)
        let api = apiFactory(try await connection.connectedSession())
        let snapshot = try await ServerSnapshotLoader(api: api).download()
        try Task.checkCancellation()
        guard connection.identity == identity else { throw AuthenticationError.superseded }
        try await repository.initializeSyncEpoch(snapshot.account)
        guard try await repository.syncConfiguration()?.phase == "ready" else { throw ClientError.conflict("Review the restored cloud epoch before importing an account backup") }
        await refreshStatus(); return snapshot
    }
    func validateAccountRestorePublication(_ id: String, repository: LocalRepository) async throws {
        guard let identity = connection.identity, SyncConfiguration.owner(for: identity) == repository.owner else { throw AuthenticationError.superseded }
        let snapshot = try await ServerSnapshotLoader(api: apiFactory(try await connection.connectedSession())).download()
        try Task.checkCancellation()
        guard connection.identity == identity else { throw AuthenticationError.superseded }
        try await repository.verifyAccountRestorePublication(id, snapshot: snapshot)
    }
}

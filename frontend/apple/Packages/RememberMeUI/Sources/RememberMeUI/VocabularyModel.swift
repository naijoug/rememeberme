import Foundation
import SwiftUI
import RememberMeCore
import Combine

@MainActor enum RepositoryPool {
    static var tasks: [String: Task<LocalRepository, Error>] = [:]
    static func open(_ url: URL, owner: String = "anonymous") async throws -> LocalRepository {
        let key = url.standardizedFileURL.path + "|" + owner
        if let task = tasks[key] { return try await task.value }
        let task = Task.detached { try LocalRepository(url: url, owner: owner) }
        tasks[key] = task
        do { return try await task.value }
        catch { tasks[key] = nil; throw error }
    }
}

@MainActor final class VocabularyModel: ObservableObject {
    @Published var entries: [VocabularyEntry] = []
    @Published var selection: String?
    @Published var detail: VocabularyEntry?
    @Published var records: [Encounter] = []
    @Published var recordCount = 0
    @Published var search = ""
    @Published var sort: EntrySort = .count
    @Published var hasMoreEntries = false
    @Published var loadingEntries = false
    @Published var loadingRecords = false
    @Published var error: String?
    @Published var status = "Opening local vocabulary…"
    @Published var preview: ImportPreview?
    @Published var accountRestorePreview: AccountRestorePreview?
    @Published var accountRestoreChoices: [String: AccountRestoreSelection] = [:]
    @Published var accountRestoreLoading = false
    @Published var busy = false
    @Published var importProgress = 0.0
    @Published var resolving = false
    @Published var restoreChoices: [String: RestoreChoice] = [:]
    @Published var exportDocument: JSONDocument?
    @Published var exportName = "rememberme-backup"
    @Published var exportLosses: [String] = []
    @Published var captures: [CaptureDraft] = []
    @Published var shareMessage: String?
    @Published var interruptedImports: [ImportRecovery] = []
    @Published var account: AccountVocabularyModel?
    @Published private(set) var activeOwner = "anonymous"
    var repository: LocalRepository?
    var lookup: LookupService?
    private var queryID = UUID()
    private var detailID = UUID()
    private var previewBytes: Data?
    private var accountBackupBytes: Data?
    private var accountBackupSnapshot: ServerSnapshot?
    private var previewTask: Task<Void, Never>?
    private var importTask: Task<Void, Never>?
    private var scopeID = UUID()
    private var subscriptions: Set<AnyCancellable> = []
    private let switchedReminders: @MainActor (LocalRepository) async -> Void

    init(repository: LocalRepository, lookup: LookupService, onRepositoryChange: @escaping @MainActor (LocalRepository) async -> Void = { _ in }) {
        switchedReminders = onRepositoryChange
        self.repository = repository; self.lookup = lookup
        activeOwner = repository.owner
        status = "Saved on this device · Cloud sync is not connected"
    }

    init() {
        switchedReminders = { await ReminderSettings.shared.switchVocabulary($0) }
        Task {
            do {
                let args = ProcessInfo.processInfo.arguments
                let url: URL
                if let index = args.firstIndex(of: "-rememberme-test-store"), args.count > index + 1 {
                    let value = args[index + 1]
                    url = value.hasPrefix("ui-") && UUID(uuidString: String(value.dropFirst(3))) != nil
                        ? FileManager.default.temporaryDirectory.appendingPathComponent("RememberMeUITests/\(value)/vocabulary.sqlite")
                        : URL(fileURLWithPath: value)
                } else {
                    url = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                        appropriateFor: nil, create: true).appendingPathComponent("RememberMe/vocabulary.sqlite")
                }
                repository = try await RepositoryPool.open(url)
                #if DEBUG
                if args.contains("-rememberme-test-import-recovery"), let index = args.firstIndex(of: "-rememberme-test-store"),
                   args.count > index + 1, args[index + 1].hasPrefix("ui-"),
                   UUID(uuidString: String(args[index + 1].dropFirst(3))) != nil, let repository,
                   try await repository.entries().isEmpty, try await repository.recoverableImports().isEmpty {
                    // A disposable UI fixture only. Never seed a normal store or
                    // read the user's vocabulary to simulate an interruption.
                    try await repository.create(VocabularyEntry(id: "ui-recovery-original", word: "original", count: 3, timestamp: 1))
                    let source = try LegacyCodec.export([VocabularyEntry(word: "recoverable", count: 2, timestamp: 1)])
                    let preview = try await repository.previewLegacy(source, mode: .firstMigration)
                    try await repository.begin(preview); try await repository.copyImportChunk(preview.id, limit: 1)
                }
                #endif
                lookup = LookupService(dictionaryDirectory: Bundle.main.resourceURL?.appendingPathComponent("wordnet"),
                    cacheURL: url.deletingLastPathComponent().appendingPathComponent("translation-cache.json"))
                if let repository { attach(AccountVocabularyPool.model(url: url, anonymous: repository)) }
                await reload(); status = "Saved on this device · Cloud sync is not connected"
                if let repository { await ReminderSettings.shared.reschedule(repository) }
                await refreshCaptures()
                await refreshInterruptedImports()
            } catch { self.error = error.localizedDescription; status = "Cannot open local vocabulary" }
        }
    }

    func attach(_ account: AccountVocabularyModel) {
        self.account = account
        account.$repository.sink { [weak self] repository in
            Task { @MainActor in
                guard self?.account?.repository === repository else { return }
                await self?.useRepository(repository)
            }
        }.store(in: &subscriptions)
        account.$status.sink { [weak self] status in self?.status = status }.store(in: &subscriptions)
    }
    func useRepository(_ repository: LocalRepository) async {
        guard self.repository !== repository else { return }
        scopeID = UUID(); queryID = UUID(); detailID = UUID()
        importTask?.cancel(); importTask = nil; busy = false
        previewTask?.cancel(); previewTask = nil; accountRestoreLoading = false
        accountRestorePreview = nil; accountRestoreChoices = [:]; accountBackupBytes = nil; accountBackupSnapshot = nil
        self.repository = repository; activeOwner = repository.owner
        let scope = scopeID
        selection = nil; detail = nil; entries = []; records = []; recordCount = 0
        captures = []; preview = nil; previewBytes = nil; restoreChoices = [:]; exportDocument = nil
        error = nil; hasMoreEntries = false
        await reload(); guard scopeID == scope else { return }
        await refreshCaptures(); guard scopeID == scope else { return }
        await refreshInterruptedImports(); guard scopeID == scope else { return }
        await switchedReminders(repository)
    }

    func reload() async {
        let id = UUID(); queryID = id
        loadingEntries = true
        defer { if queryID == id { loadingEntries = false } }
        do {
            guard let repository else { return }
            let results = try await repository.entries(search: search, sort: sort, limit: 101)
            guard queryID == id, !Task.isCancelled else { return }
            entries = Array(results.prefix(100)); hasMoreEntries = results.count > 100
            await select()
        } catch { self.error = error.localizedDescription }
    }

    func moreEntries() async {
        guard !loadingEntries, hasMoreEntries, let repository else { return }
        let id = queryID, offset = entries.count
        loadingEntries = true
        defer { if id == queryID { loadingEntries = false } }
        do {
            let results = try await repository.entries(search: search, sort: sort, limit: 101, offset: offset)
            guard queryID == id, entries.count == offset, !Task.isCancelled else { return }
            entries += results.prefix(100); hasMoreEntries = results.count > 100
        } catch { self.error = error.localizedDescription }
    }

    func refreshCaptures() async {
        guard let repository else { return }
        let scope = scopeID
        do {
            #if os(iOS)
            // UI tests never access the installation's App Group container.
            if !ProcessInfo.processInfo.arguments.contains("-rememberme-test-store"),
               let group = Bundle.main.object(forInfoDictionaryKey: "RememberMeAppGroup") as? String,
               let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) {
                let inbox = CaptureInbox(directory: container.appendingPathComponent("CaptureInbox"))
                let scan = try await inbox.scan()
                for draft in scan.drafts {
                    try await repository.receiveCapture(draft)
                    try await inbox.acknowledge(draft)
                }
                shareMessage = scan.unreadableFiles.isEmpty ? nil : "Some shared drafts could not be read and have been retained for recovery."
            } else if !ProcessInfo.processInfo.arguments.contains("-rememberme-test-store") {
                shareMessage = "Sharing is unavailable in this installation. Use Paste or JSON import."
            }
            #endif
            let saved = try await repository.captureDrafts()
            guard scopeID == scope else { return }; captures = saved
        } catch { if scopeID == scope { shareMessage = error.localizedDescription } }
    }

    func saveCapture(_ draft: CaptureDraft, word: String, definition: JSONValue, notes: String, kind: EntryKind) async -> Bool {
        guard let repository else { return false }
        do {
            selection = try await repository.confirmCapture(draft.id, word: word, definition: definition, notes: notes, kind: kind)
            await refreshCaptures(); await reload(); return true
        } catch { self.error = error.localizedDescription; return false }
    }
    func dismissCapture(_ draft: CaptureDraft) async {
        do { try await repository?.dismissCapture(draft.id); await refreshCaptures() }
        catch { self.error = error.localizedDescription }
    }

    func select() async {
        let id = UUID(); detailID = id
        let selected = selection
        do {
            guard let selected, let repository else { detail = nil; records = []; recordCount = 0; return }
            let result = try await repository.entry(selected, includeHistory: false)
            let page = try await repository.history(selected)
            let count = try await repository.historyCount(selected)
            guard detailID == id, selection == selected else { return }
            detail = result?.deleted == false ? result : nil
            records = detail == nil ? [] : page; recordCount = detail == nil ? 0 : count
        } catch { self.error = error.localizedDescription }
    }

    func moreRecords() async {
        guard !loadingRecords, records.count < recordCount, let selected = selection, let repository else { return }
        let id = detailID, offset = records.count
        loadingRecords = true
        defer { if detailID == id { loadingRecords = false } }
        do {
            let page = try await repository.history(selected, offset: offset)
            guard detailID == id, selection == selected, records.count == offset else { return }
            records += page
        } catch { self.error = error.localizedDescription }
    }

    func previewFile(_ url: URL, mode: ImportMode, expectedOwner: String? = nil) async {
        let scope = scopeID
        guard expectedOwner == nil || repository?.owner == expectedOwner else { error = AuthenticationError.superseded.localizedDescription; return }
        busy = true; defer { if scopeID == scope { busy = false } }
        do {
            let bytes = try await Task.detached {
                let access = url.startAccessingSecurityScopedResource()
                defer { if access { url.stopAccessingSecurityScopedResource() } }
                return try Data(contentsOf: url)
            }.value
            guard scopeID == scope else { return }; try await preparePreview(bytes, mode: mode)
        } catch { if !(error is CancellationError) { self.error = error.localizedDescription } }
    }
    func startPreviewFile(_ url: URL, mode: ImportMode, expectedOwner: String) {
        previewTask?.cancel()
        previewTask = Task { await previewFile(url, mode: mode, expectedOwner: expectedOwner) }
    }
    func cancelAccountBackupPreview() { previewTask?.cancel() }

    func preparePreview(_ bytes: Data, mode: ImportMode) async throws {
        guard let repository else { throw ClientError.invalidData("local store unavailable") }
        if mode == .restoreMerge, repository.owner != "anonymous" {
            accountBackupBytes = bytes; accountRestoreChoices = [:]
            try await reloadAccountBackupPreview(); return
        }
        restoreChoices = [:]; previewBytes = bytes
        preview = try await (mode == .firstMigration || mode == .legacyMerge
            ? repository.previewLegacy(bytes, mode: mode) : repository.previewBackup(bytes, mode: mode))
        importProgress = 0
    }
    func reloadAccountBackupPreview() async throws {
        guard let bytes = accountBackupBytes, let repository else { throw ClientError.invalidData("account backup unavailable") }
        let scope = scopeID
        _ = try BackupCodec.decode(bytes)
        accountRestoreLoading = true; defer { if scopeID == scope { accountRestoreLoading = false } }
        var snapshot: ServerSnapshot?
        var unavailableReason: String?
        do {
            guard let account else { throw AuthenticationError.notSignedIn }
            snapshot = try await account.snapshotForAccountRestore(repository: repository)
        } catch is CancellationError { throw CancellationError() }
        catch { guard scopeID == scope else { throw AuthenticationError.superseded }; unavailableReason = error.localizedDescription }
        guard scopeID == scope else { throw AuthenticationError.superseded }
        accountBackupSnapshot = snapshot
        accountRestorePreview = try await repository.previewAccountBackup(bytes, snapshot: snapshot, choices: accountRestoreChoices)
        status = snapshot == nil ? (unavailableReason ?? "Cloud is unavailable") + " · Preview only; reconnect before confirmation" : "Review account backup changes · Sync is paused"
    }
    func refreshAccountBackupPreview() {
        guard !busy else { return }
        previewTask = Task {
            busy = true; defer { busy = false }
            do { try await reloadAccountBackupPreview() }
            catch { if !(error is CancellationError) { self.error = error.localizedDescription } }
        }
    }
    func applyAccountBackupChoices() async {
        guard let bytes = accountBackupBytes, let accountRestorePreview, let repository else { return }
        resolving = true; defer { resolving = false }
        do { self.accountRestorePreview = try await repository.previewAccountBackup(bytes, snapshot: accountBackupSnapshot,
            choices: accountRestoreChoices, previewId: accountRestorePreview.id) }
        catch { self.error = error.localizedDescription }
    }
    func confirmAccountBackup() {
        guard let accountRestorePreview, accountRestorePreview.online, accountRestorePreview.plan.conflicts.isEmpty else { return }
        guard !busy else { return }
        busy = true
        let plan = accountRestorePreview.plan
        importTask = Task { await runImport(id: plan.id, starting: plan) }
    }
    func dismissAccountBackup() {
        guard !busy else { cancelAccountBackupPreview(); return }
        accountRestorePreview = nil; accountBackupBytes = nil; accountBackupSnapshot = nil; accountRestoreChoices = [:]
    }

    func resolvePreview() async {
        guard let bytes = previewBytes, let preview, let repository else { return }
        resolving = true; defer { resolving = false }
        do { self.preview = try await repository.previewBackup(bytes, mode: preview.mode, choices: restoreChoices) }
        catch { self.error = error.localizedDescription }
    }

    func startImport() {
        guard !busy else { return }
        // Mark busy before dispatch so double clicks cannot create two batches.
        busy = true
        importTask = Task { await commitImport() }
    }
    func cancelImport() { importTask?.cancel() }
    func refreshInterruptedImports() async {
        let scope = scopeID
        do { let imports = try await repository?.recoverableImports() ?? []; if scopeID == scope { interruptedImports = imports } }
        catch { self.error = error.localizedDescription }
    }
    func resumeImport(_ id: String) {
        guard !busy else { return }
        busy = true
        importTask = Task { await runImport(id: id, starting: nil) }
    }
    func discardImport(_ id: String) {
        guard !busy, let repository else { return }
        busy = true
        importTask = Task {
            defer { busy = false; importTask = nil }
            do {
                status = "Cleaning cancelled import…"
                try await repository.cancel(id)
                status = "Interrupted import discarded · Vocabulary unchanged"
            } catch { self.error = error.localizedDescription; status = "Cleanup interrupted · You can finish it from Interrupted imports" }
            await refreshInterruptedImports()
        }
    }
    func dismissPreview() {
        guard !busy else { return }
        preview = nil; previewBytes = nil; restoreChoices = [:]
    }
    private func commitImport() async {
        guard let preview, let repository else { busy = false; importTask = nil; return }
        await runImport(id: preview.id, starting: preview, repository: repository)
    }
    private func runImport(id: String, starting: ImportPreview?, repository supplied: LocalRepository? = nil) async {
        let scope = scopeID
        defer { if scopeID == scope { busy = false; importTask = nil } }
        guard let repository = supplied ?? repository else { return }
        do {
            try Task.checkCancellation()
            if let starting { try await repository.begin(starting) }
            var progress = try await repository.importRecovery(id)
            guard progress.canResume else { throw ClientError.stalePreview }
            let frozen: ImportPreview? = progress.state == "ready" ? try? await repository.loadImportPlan(id) : try await repository.loadImportPlan(id)
            while progress.state == "copying" {
                try Task.checkCancellation()
                progress = try await repository.copyImportChunk(id)
                importProgress = 0.3 * Double(progress.copied) / Double(max(progress.copyTotal, 1))
                status = "Preparing existing vocabulary · \(Int(100 * Double(progress.copied) / Double(max(progress.copyTotal, 1))))%"
            }
            while progress.state == "staging" {
                try Task.checkCancellation()
                guard let frozen else { throw ClientError.invalidData("saved import plan") }
                try await repository.stage(frozen, start: progress.processed, limit: 50)
                progress = try await repository.importRecovery(id)
                importProgress = 0.3 + 0.7 * Double(progress.processed) / Double(max(progress.total, 1))
                status = "Importing \(progress.processed)/\(progress.total)…"
            }
            if frozen?.mode == .reconcileEpoch {
                guard let account else { throw ClientError.accountRequired }
                try await account.validateEpochPublication(id, repository: repository)
            }
            if frozen?.mode == .restoreAccount {
                guard let account else { throw ClientError.accountRequired }
                try await account.validateAccountRestorePublication(id, repository: repository)
            }
            try Task.checkCancellation()
            try await repository.publish(id)
            guard scopeID == scope else { return }
            preview = nil; previewBytes = nil; accountRestorePreview = nil; accountBackupBytes = nil; accountBackupSnapshot = nil
            importProgress = 1; status = "Import saved on this device"; await reload()
            // Failure to prune old scratch data must never turn a committed
            // import into a reported save failure or roll it back.
            _ = try? await repository.pruneImportGenerations()
        } catch {
            guard scopeID == scope else { return }
            var savedState: String?
            var missingBatch = false
            do { savedState = try await repository.batchState(id) }
            catch { missingBatch = (error as? ClientError) == .invalidData("batch missing") }
            if savedState == "published" {
                status = "Import saved on this device"
                Task { await reload() }
            } else if error is CancellationError {
                if missingBatch {
                    status = "Import cancelled · Vocabulary unchanged"
                    preview = nil; previewBytes = nil; await refreshInterruptedImports(); return
                }
                // Cleanup is independent of the cancelled worker so it can
                // finish normally; a disk failure remains a durable recovery job.
                let cleanup = Task.detached { try await repository.cancel(id) }
                do { try await cleanup.value; status = "Import cancelled · Vocabulary unchanged" }
                catch { status = "Import stopped · Finish temporary cleanup from Interrupted imports" }
            } else {
                self.error = error.localizedDescription
                status = "Import interrupted · Resume or discard it from Interrupted imports"
            }
            preview = nil; previewBytes = nil
        }
        await refreshInterruptedImports()
    }

    func save(word: String, definition: JSONValue, notes: String, original: VocabularyEntry?, kind: EntryKind = .word, expectedOwner: String? = nil) async -> Bool {
        let scope = scopeID
        do {
            guard let repository else { throw ClientError.invalidData("local store unavailable") }
            guard expectedOwner == nil || expectedOwner == repository.owner else { throw AuthenticationError.superseded }
            if let original {
                _ = try await repository.update(original.id, expectedVersion: original.version, definition: definition, notes: notes, kind: kind)
            } else {
                var entry = VocabularyEntry(word: LegacyCodec.trim(word), kind: kind, definition: definition); entry.notes = notes
                try await repository.create(entry)
                guard scopeID == scope else { return false }; selection = entry.id
            }
            guard scopeID == scope else { return false }
            await reload(); return true
        } catch { self.error = error.localizedDescription; return false }
    }
    func record(expectedOwner: String? = nil) async {
        guard let detail, let repository else { return }
        guard expectedOwner == nil || expectedOwner == repository.owner else { error = AuthenticationError.superseded.localizedDescription; return }
        let scope = scopeID
        do {
            _ = try await repository.record(detail.id, context: "", url: "", definition: detail.definition,
                timestamp: Date().timeIntervalSince1970 * 1000)
            if scopeID == scope { await reload() }
        } catch { self.error = error.localizedDescription }
    }
    func reset(expectedOwner: String? = nil) async {
        guard let detail, let repository else { return }
        guard expectedOwner == nil || expectedOwner == repository.owner else { error = AuthenticationError.superseded.localizedDescription; return }
        let scope = scopeID
        do { _ = try await repository.reset(detail.id); if scopeID == scope { await reload() } }
        catch { self.error = error.localizedDescription }
    }
    func delete(expectedOwner: String? = nil) async {
        guard let detail, let repository else { return }
        guard expectedOwner == nil || expectedOwner == repository.owner else { error = AuthenticationError.superseded.localizedDescription; return }
        let scope = scopeID
        do { try await repository.delete(detail.id); guard scopeID == scope else { return }; selection = nil; self.detail = nil; await reload() }
        catch { self.error = error.localizedDescription }
    }

    func prepareExport(legacy: Bool) async {
        guard !busy, let repository else { return }
        let scope = scopeID
        busy = true; defer { if scopeID == scope { busy = false } }
        do {
            let backup = try await repository.backup()
            let bytes = try await Task.detached {
                try legacy ? LegacyCodec.export(backup.entries) : JSONValue.encoder().encode(backup)
            }.value
            guard scopeID == scope else { return }
            exportName = legacy ? "rememberme-legacy" : "rememberme-backup"
            exportLosses = legacy ? ["Unknown counts become zero.", "Types, notes, shared draft origins, current definitions without history, reviews and deletion records cannot be represented.",
                "History and source URLs are included and may be sensitive."] : []
            exportDocument = JSONDocument(data: bytes)
        } catch { self.error = error.localizedDescription }
    }
}

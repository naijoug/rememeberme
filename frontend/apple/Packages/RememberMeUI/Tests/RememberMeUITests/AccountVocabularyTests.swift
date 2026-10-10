import Foundation
import Testing
import RememberMeCore
@testable import RememberMeUI

private let testOrigin = "https://account-vocabulary.example.test"
private final class VocabularyVault: CredentialVault, @unchecked Sendable {
    private let lock = NSLock(); private var pair: APICredentials?
    func load() -> APICredentials? { lock.withLock { pair } }
    func save(_ value: APICredentials) { lock.withLock { pair = value } }
    func clear() { lock.withLock { pair = nil } }
}
private actor VocabularyAuthTransport: APITransport {
    func send(_ request: URLRequest) async throws -> APIHTTPResponse {
        if request.url!.path == "/api/v1/auth/exchange" {
            let pair = APICredentials(accessToken: String(repeating: "a", count: 43), refreshToken: String(repeating: "b", count: 43),
                accessExpiresAtMs: Date().timeIntervalSince1970 * 1000 + 900_000, refreshExpiresAtMs: Date().timeIntervalSince1970 * 1000 + 86_400_000,
                userId: "synthetic-account", deviceId: "synthetic-device")
            return APIHTTPResponse(status: 200, data: try JSONValue.encoder().encode(pair))
        }
        return APIHTTPResponse(status: 200, data: Data(#"{"loggedOut":true}"#.utf8))
    }
}
@MainActor private final class VocabularyBrowser: WebAuthenticator {
    func authenticate(_ attempt: NativeLoginAttempt) async throws -> URL {
        URL(string: "rememberme://auth/callback?state=\(attempt.state)&code=\(String(repeating: "c", count: 43))")!
    }
}
private actor VocabularyAPI: SyncAPI {
    private var bodies: [Data] = []
    private var state: JSONValue?
    private var accountCalls = 0
    private var epoch = "synthetic-epoch"
    private var offline = false
    private var sourcePrivacy = SyncPrivacy()
    private var sourceRevision = 0
    private var lostRemoval: SourceRemovalRequest?
    private var loseRemovalReply = false
    var delay = 0.0
    var capabilities = ["history-order-v1", "history-version-v1", "explicit-lifecycles-v1"]
    func setDelay(_ value: Double) { delay = value }
    func setCapabilities(_ values: [String]) { capabilities = values }
    func setEpoch(_ value: String) { epoch = value }
    func setOffline(_ value: Bool) { offline = value }
    func setRemovalReplyLoss(_ value: Bool) { loseRemovalReply = value }
    func setSourcePrivacy(_ privacy: SyncPrivacy, timezone: String) async throws { sourcePrivacy = privacy }
    func clearSources(_ request: SourceRemovalRequest, epoch: String) async throws -> Int {
        if lostRemoval != request { sourceRevision += 1; lostRemoval = request; sourcePrivacy = SyncPrivacy() }
        if loseRemovalReply { throw URLError(.networkConnectionLost) }
        return request.sourceRevision + 1
    }
    func mutateCloud() {
        guard var fields = state?.fields else { return }
        fields["version"] = .number((fields["version"]?.number ?? 0) + 1); fields["count"] = .number(9); state = .object(fields)
    }
    func callCount() -> Int { accountCalls }
    func submitted() -> [Data] { bodies }
    func identity() async throws -> ConnectedIdentity? { .init(origin: testOrigin, userId: "synthetic-account", deviceId: "synthetic-device") }
    func account() async throws -> APIAccountIdentity {
        accountCalls += 1
        if offline { throw URLError(.notConnectedToInternet) }
        if delay > 0 { try await Task.sleep(for: .seconds(delay)) }
        return try JSONDecoder().decode(APIAccountIdentity.self, from: JSONValue.encoder().encode(JSONValue.object([
            "userId": .string("synthetic-account"), "deviceId": .string("synthetic-device"), "epoch": .string(epoch),
            "timezone": .string("UTC"), "syncContext": .bool(sourcePrivacy.context), "syncURLs": .bool(sourcePrivacy.urls), "sourceRevision": .number(Double(sourceRevision)),
            "reviewDay": .string(try ReviewDate.localDay(Date().timeIntervalSince1970 * 1000, timeZoneID: "UTC")), "reviewAdmissionIds": .array([]),
            "displayName": .string("Synthetic account"), "syncCapabilities": .array(capabilities.map(JSONValue.string))])))
    }
    func page(snapshot: Bool, epoch: String, after: Int, boundary: Int?) async throws -> SyncCheckpointPage {
        let changes: [JSONValue] = after == 0 ? state.map { [.object(["sequence": .number(1), "entry": $0])] } ?? [] : []
        return try JSONDecoder().decode(SyncCheckpointPage.self, from: JSONValue.encoder().encode(JSONValue.object([
            "epoch": .string(epoch), "boundary": .number(state == nil ? 0 : 1), "nextCursor": .number(changes.isEmpty ? Double(after) : 1),
            "hasMore": .bool(false), "changes": .array(changes)])))
    }
    func history(entryId: String, after: String, version: Int, epoch: String) async throws -> APIHistoryPage {
        try JSONDecoder().decode(APIHistoryPage.self, from: JSONValue.encoder().encode(JSONValue.object([
            "entryVersion": .number(Double(version)), "nextCursor": .string(after), "hasMore": .bool(false), "events": .array([])])))
    }
    func submit(_ wire: SyncWireItem) async throws -> APIOperationResult {
        bodies.append(wire.body)
        let operation = try JSONDecoder().decode(APIOperation.self, from: wire.body)
        let definition: JSONValue = .object(["word": .string("synthetic"), "phonetics": .array([]), "meanings": .array([])])
        state = .object(["id": .string(operation.entryId), "word": .string("synthetic"), "normalizedKey": .string("synthetic"), "kind": .string("word"),
            "count": operation.payload["count"] ?? .null, "definition": definition, "notes": .string(""), "createdAtMs": .number(1), "updatedAtMs": .number(1),
            "version": .number(1), "reviewVersion": .number(0), "review": .null, "deleted": .bool(false), "historyOrdering": .string("retained")])
        return try APIOperationResult.decode(JSONValue.encoder().encode(JSONValue.object(["operationId": .string(wire.id), "status": .string("applied"), "entry": state!, "cursor": .number(1)])))
    }
}
private actor SilentLookup: LookupTransport {
    func fetch(_ url: URL) async throws -> LookupHTTPResponse { throw URLError(.notConnectedToInternet) }
}
@MainActor private enum VocabularyFixtures {
    static var stores: [String: [String: LocalRepository]] = [:]
}
@MainActor private func vocabularySetup() async throws -> (URL, UserDefaults, LocalRepository, AccountConnectionModel, AccountVocabularyModel, VocabularyAPI) {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("rememberme-account-vocabulary-\(UUID().uuidString)/store.sqlite")
    let defaults = UserDefaults(suiteName: url.deletingLastPathComponent().lastPathComponent)!
    let vault = VocabularyVault(), transport = VocabularyAuthTransport()
    let connection = AccountConnectionModel(browser: VocabularyBrowser(), defaults: defaults, permitsTestNetworking: true) { origin in
        NativeSession(origin: origin, vault: vault, transport: transport)
    }
    connection.serverAddress = testOrigin; connection.signIn()
    while connection.busy { await Task.yield() }
    let anonymous = try LocalRepository(url: url), api = VocabularyAPI()
    VocabularyFixtures.stores[url.path] = ["anonymous": anonymous]
    let model = AccountVocabularyModel(url: url, anonymous: anonymous, connection: connection, defaults: defaults,
        opener: { location, owner in
            if let value = VocabularyFixtures.stores[location.path]?[owner] { return value }
            let value = try LocalRepository(url: location, owner: owner)
            VocabularyFixtures.stores[location.path]?[owner] = value; return value
        }, apiFactory: { _ in api })
    return (url, defaults, anonymous, connection, model, api)
}
@MainActor private func cleanupVocabulary(_ url: URL, _ defaults: UserDefaults, _ model: AccountVocabularyModel) async throws {
    while model.busy { await Task.yield() }
    for repository in VocabularyFixtures.stores[url.path]?.values ?? Dictionary<String, LocalRepository>().values { try await repository.close() }
    VocabularyFixtures.stores[url.path] = nil
    defaults.removePersistentDomain(forName: url.deletingLastPathComponent().lastPathComponent)
    try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
}

@Test @MainActor func openingCloudDoesNotUploadTheAnonymousVocabulary() async throws {
    let (url, defaults, anonymous, _, model, api) = try await vocabularySetup()
    try await anonymous.create(VocabularyEntry(id: "local", word: "synthetic", count: 3, timestamp: 1))
    model.openCloudVocabulary(); while model.busy { await Task.yield() }
    #expect(model.error == nil); #expect(!model.isAnonymous); #expect(!model.syncEnabled)
    #expect(await api.submitted().isEmpty)
    #expect(try await anonymous.entry("local")?.count == 3)
    #expect(try await model.repository.entries().isEmpty)
    try await anonymous.close(); try await cleanupVocabulary(url, defaults, model)
}

@Test @MainActor func accountOwnershipRequiresConfirmationBeforeQueuingOrSendingWords() async throws {
    let (url, defaults, anonymous, _, model, api) = try await vocabularySetup()
    try await anonymous.create(VocabularyEntry(id: "local", word: "synthetic", count: 0.5, timestamp: 1))
    model.prepareOwnership(); while model.busy { await Task.yield() }
    #expect(model.preview?.plan.entries.count == 1); #expect(model.isAnonymous)
    #expect(await api.submitted().isEmpty)
    model.confirmOwnership(); while model.busy { await Task.yield() }
    #expect(model.error == nil); #expect(!model.isAnonymous); #expect(model.syncEnabled)
    #expect(model.pendingCount == 1); #expect(await api.submitted().isEmpty)
    model.synchronize(); while model.busy { await Task.yield() }
    #expect(model.error == nil); #expect(model.pendingCount == 0)
    #expect(await api.submitted().count == 1)
    #expect(try await anonymous.entry("local")?.count == 0.5)
    #expect(try await model.repository.entry("local")?.count == 0.5)
    model.prepareOwnership(); while model.busy { await Task.yield() }
    #expect(model.preview?.plan.entries.isEmpty == true)
    #expect(model.preview?.items.first?.selection.action == .keepAnonymous)
    try await anonymous.close(); try await cleanupVocabulary(url, defaults, model)
}

@Test @MainActor func accountSelectionSwitchesBothWindowsAndRejectsOldScopeDrafts() async throws {
    let (url, defaults, anonymous, _, controller, api) = try await vocabularySetup()
    var local = VocabularyEntry(id: "shared-id", word: "synthetic", count: 3, timestamp: 1); local.notes = "anonymous note"
    try await anonymous.create(local)
    let service = LookupService(dictionaryDirectory: nil, transport: SilentLookup())
    let first = VocabularyModel(repository: anonymous, lookup: service), second = VocabularyModel(repository: anonymous, lookup: service)
    first.attach(controller); second.attach(controller)
    first.selection = local.id; await first.select(); let draft = try #require(first.detail)
    await first.prepareExport(legacy: false); #expect(first.exportDocument != nil)
    controller.openCloudVocabulary(); while controller.busy { await Task.yield() }
    while first.activeOwner == "anonymous" || second.activeOwner == "anonymous" { await Task.yield() }
    #expect(first.selection == nil && second.selection == nil); #expect(first.detail == nil); #expect(first.exportDocument == nil)
    #expect(await first.save(word: draft.word, definition: draft.definition, notes: "stale private edit", original: draft, expectedOwner: "anonymous") == false)
    #expect(try await anonymous.entry(local.id)?.notes == "anonymous note")
    #expect(try await controller.repository.entries().isEmpty); #expect(await api.submitted().isEmpty)
    controller.useAnonymousVocabulary(); while controller.busy { await Task.yield() }
    while first.activeOwner != "anonymous" || second.activeOwner != "anonymous" { await Task.yield() }
    #expect(first.repository === anonymous && second.repository === anonymous)
    try await cleanupVocabulary(url, defaults, controller)
}

@Test @MainActor func logoutCancelsOwnershipPreparationAndKeepsTheAnonymousData() async throws {
    let (url, defaults, anonymous, connection, model, api) = try await vocabularySetup()
    try await anonymous.create(VocabularyEntry(id: "local", word: "synthetic", count: 3, timestamp: 1))
    await api.setDelay(0.1)
    model.prepareOwnership()
    while await api.callCount() == 0 { await Task.yield() }
    connection.disconnect()
    while connection.busy || model.busy { await Task.yield() }
    #expect(model.isAnonymous); #expect(model.preview == nil); #expect(await api.submitted().isEmpty)
    #expect(try await anonymous.entry("local")?.count == 3)
    try await cleanupVocabulary(url, defaults, model)
}

@Test @MainActor func cloudServiceWithoutTheRequiredContractsCannotEnableVocabularyTransmission() async throws {
    let (url, defaults, anonymous, _, model, api) = try await vocabularySetup()
    await api.setCapabilities([])
    try await anonymous.create(VocabularyEntry(id: "local", word: "synthetic", count: 3, timestamp: 1))
    model.prepareOwnership(); while model.busy { await Task.yield() }
    #expect(model.error != nil); #expect(model.preview == nil); #expect(model.isAnonymous)
    #expect(await api.submitted().isEmpty)
    try await cleanupVocabulary(url, defaults, model)
}

@Test @MainActor func epochRecoveryUIRequiresChoicesRechecksTheServerAndKeepsSendingPaused() async throws {
    let (url, defaults, anonymous, _, model, api) = try await vocabularySetup()
    try await anonymous.create(VocabularyEntry(id: "local", word: "synthetic", count: 0.5, timestamp: 1))
    model.prepareOwnership(); while model.busy { await Task.yield() }
    model.confirmOwnership(); while model.busy { await Task.yield() }
    model.synchronize(); while model.busy { await Task.yield() }
    let original = try #require(try await model.repository.entry("local"))
    _ = try await model.repository.update("local", expectedVersion: original.version, definition: original.definition, notes: "unsent old-epoch note")
    let oldOperationId = try #require(try await model.repository.pendingOperations().first { $0.state == "pending" }?.id)
    await api.setEpoch("restored-epoch")
    model.synchronize(); while model.busy { await Task.yield() }
    #expect(model.epochConflict); #expect(!model.syncEnabled)
    model.prepareEpochRecovery(); while model.busy { await Task.yield() }
    #expect(model.error == nil); #expect(model.recoveryPreview?.previousPendingCount == 1)
    #expect(try await model.repository.syncConfiguration()?.epoch == "synthetic-epoch")
    model.recoveryChoices["local"] = .restoreLocalFields
    model.updateEpochRecoveryChoices(); while model.busy { await Task.yield() }
    model.confirmEpochRecovery(); while model.busy { await Task.yield() }
    #expect(model.error == nil); #expect(!model.epochConflict); #expect(!model.syncEnabled)
    #expect(model.recoveryPreview == nil)
    #expect(try await model.repository.syncConfiguration()?.epoch == "restored-epoch")
    #expect(try await model.repository.entry("local")?.notes == "unsent old-epoch note")
    #expect(try await model.repository.pendingOperations().allSatisfy { $0.id != oldOperationId })
    #expect(await api.submitted().count == 1)
    try await cleanupVocabulary(url, defaults, model)
}

@Test @MainActor func epochRecoveryUIRejectsASecondServerRestoreBeforePublishing() async throws {
    let (url, defaults, anonymous, _, model, api) = try await vocabularySetup()
    try await anonymous.create(VocabularyEntry(id: "local", word: "synthetic", count: 0.5, timestamp: 1))
    model.prepareOwnership(); while model.busy { await Task.yield() }
    model.confirmOwnership(); while model.busy { await Task.yield() }
    model.synchronize(); while model.busy { await Task.yield() }
    await api.setEpoch("restored-epoch")
    model.synchronize(); while model.busy { await Task.yield() }
    model.prepareEpochRecovery(); while model.busy { await Task.yield() }
    #expect(model.recoveryPreview != nil)
    await api.setEpoch("another-restore")
    model.confirmEpochRecovery(); while model.busy { await Task.yield() }
    #expect(model.error != nil); #expect(model.epochConflict)
    #expect(try await model.repository.syncConfiguration()?.epoch == "synthetic-epoch")
    #expect(try await model.repository.entry("local")?.count == 0.5)
    #expect(await api.submitted().count == 1)
    try await cleanupVocabulary(url, defaults, model)
}

@MainActor private func accountBackupModels() async throws -> (URL, UserDefaults, LocalRepository, AccountVocabularyModel, VocabularyAPI, VocabularyModel, Data) {
    let (url, defaults, anonymous, _, account, api) = try await vocabularySetup()
    try await anonymous.create(VocabularyEntry(id: "local", word: "synthetic", count: 3, timestamp: 1))
    account.prepareOwnership(); while account.busy { await Task.yield() }
    account.confirmOwnership(); while account.busy { await Task.yield() }
    account.synchronize(); while account.busy { await Task.yield() }
    let model = VocabularyModel(repository: account.repository, lookup: LookupService(dictionaryDirectory: nil, transport: SilentLookup()))
    model.attach(account)
    var saved = VocabularyEntry(id: "local", word: "synthetic", count: 0.5, timestamp: 1); saved.notes = "backup note"; saved.version = 999
    let bytes = try JSONValue.encoder().encode(Backup(entries: [saved], importSources: [], exportedAtMs: 1))
    return (url, defaults, anonymous, account, api, model, bytes)
}
@Test @MainActor func accountBackupPresentationRequiresExplicitFieldSelectionAndKeepsSyncPaused() async throws {
    let (url, defaults, _, account, api, model, bytes) = try await accountBackupModels()
    try await model.preparePreview(bytes, mode: .restoreMerge)
    #expect(model.accountRestorePreview?.online == true); #expect(model.accountRestorePreview?.plan.entries.isEmpty == true)
    model.accountRestoreChoices["local"] = .init(.useBackup, fields: [.count])
    await model.applyAccountBackupChoices(); model.confirmAccountBackup()
    while model.busy { await Task.yield() }
    #expect(model.error == nil); #expect(try await account.repository.entry("local")?.count == 0.5)
    #expect(try await account.repository.entry("local")?.notes == "")
    #expect(try await account.repository.syncConfiguration()?.enabled == false)
    #expect(await api.submitted().count == 1)
    #expect(try await account.repository.pendingOperations().filter { $0.state == "pending" }.count == 1)
    try await cleanupVocabulary(url, defaults, account)
}
@Test @MainActor func accountBackupPresentationShowsOfflinePreviewButCannotQueueAConfirmation() async throws {
    let (url, defaults, _, account, api, model, bytes) = try await accountBackupModels()
    await api.setOffline(true)
    try await model.preparePreview(bytes, mode: .restoreMerge)
    #expect(model.accountRestorePreview?.online == false)
    model.accountRestoreChoices["local"] = .init(.useBackup)
    await model.applyAccountBackupChoices(); model.confirmAccountBackup()
    #expect(!model.busy); #expect(try await account.repository.entry("local")?.count == 3)
    #expect(try await account.repository.pendingOperations().allSatisfy { $0.state == "confirmed" })
    #expect(await api.submitted().count == 1)
    try await cleanupVocabulary(url, defaults, account)
}
@Test @MainActor func accountBackupPresentationRejectsACloudChangeBeforePublication() async throws {
    let (url, defaults, _, account, api, model, bytes) = try await accountBackupModels()
    try await model.preparePreview(bytes, mode: .restoreMerge)
    model.accountRestoreChoices["local"] = .init(.useBackup, fields: [.count])
    await model.applyAccountBackupChoices()
    await api.mutateCloud()
    model.confirmAccountBackup(); while model.busy { await Task.yield() }
    #expect(model.error != nil); #expect(try await account.repository.entry("local")?.count == 3)
    #expect(try await account.repository.recoverableImports().contains { $0.mode == .restoreAccount })
    #expect(await api.submitted().count == 1)
    try await cleanupVocabulary(url, defaults, account)
}

@Test @MainActor func sourcePrivacyUIRequiresExplicitConsentAndRetainsRemovalRetryAfterLostReply() async throws {
    let (url, defaults, _, _, model, api) = try await vocabularySetup()
    await api.setCapabilities(["history-order-v1", "history-version-v1", "explicit-lifecycles-v1", "source-privacy-v1"])
    model.openCloudVocabulary(); while model.busy { await Task.yield() }
    #expect(model.sourceControlsAvailable); #expect(model.sourcePrivacy == SyncPrivacy())
    model.setSourcePrivacy(.init(context: true, urls: false)); while model.busy { await Task.yield() }
    #expect(model.error == nil); #expect(model.sourcePrivacy == SyncPrivacy(context: true, urls: false)); #expect(!model.syncEnabled)
    await api.setRemovalReplyLoss(true)
    model.clearUploadedSources(); while model.busy { await Task.yield() }
    #expect(model.error != nil); #expect(model.sourceRemovalPending); #expect(!model.syncEnabled)
    let pending = try #require(try await model.repository.syncConfiguration()?.pendingSourceRemoval)
    model.setSyncEnabled(true); while model.busy { await Task.yield() }
    #expect(!model.syncEnabled); #expect(model.error != nil)
    await api.setRemovalReplyLoss(false)
    model.clearUploadedSources(); while model.busy { await Task.yield() }
    #expect(model.error == nil); #expect(!model.sourceRemovalPending); #expect(model.sourcePrivacy == SyncPrivacy())
    #expect(try await model.repository.syncConfiguration()?.sourceRevision == pending.sourceRevision + 1)
    #expect(!model.syncEnabled); #expect(await api.submitted().isEmpty)
    try await cleanupVocabulary(url, defaults, model)
}

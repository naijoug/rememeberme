import Foundation
@preconcurrency import CoreData

public enum AccountRestoreAction: String, Codable, Sendable, CaseIterable { case keepCurrent, useBackup, associateHistory, newLifecycle }
public enum AccountRestoreField: String, Codable, Sendable, CaseIterable { case count, definition, notes, review, wordAndKind, captureOrigin }
public struct AccountRestoreSelection: Sendable, Equatable {
    public var action: AccountRestoreAction
    public var targetId: String?
    public var fields: Set<AccountRestoreField>
    public init(_ action: AccountRestoreAction, targetId: String? = nil, fields: Set<AccountRestoreField> = Set(AccountRestoreField.allCases)) {
        self.action = action; self.targetId = targetId; self.fields = fields
    }
}
public struct AccountRestoreItem: Sendable, Identifiable {
    public var id: String
    public var word: String
    public var backupCount: Double?
    public var currentCount: Double?
    public var currentExists: Bool
    public var backupDeleted: Bool
    public var currentDeleted: Bool
    public var reason: String?
    public var selection: AccountRestoreSelection
    public var candidates: [OwnershipCandidate]
}
public struct AccountRestorePreview: Sendable, Identifiable {
    public var id: String { plan.id }
    public var online: Bool
    public var items: [AccountRestoreItem]
    public var plan: ImportPreview
}
public struct ServerEntryExpectation: Codable, Sendable, Equatable {
    public var id: String
    public var version: Int?
}
public struct AccountRestoreProvenance: Codable, Sendable, Equatable {
    public var sourceGeneration: String
    public var origin: String
    public var userId: String
    public var deviceId: String
    public var epoch: String
    public var privacy: SyncPrivacy
    public var timeZoneID: String
    public var expectedEntries: [ServerEntryExpectation]
    public var expectedLiveKeys: [String: [String]]
    public var identity: ConnectedIdentity { .init(origin: origin, userId: userId, deviceId: deviceId) }
}
private struct AccountRestoreValidation: Codable, Sendable {
    var epoch: String
    var userId: String
    var deviceId: String
    var checkedAtMs: Double
}

extension LocalRepository {
    public func previewAccountBackup(_ data: Data, snapshot: ServerSnapshot? = nil, choices: [String: AccountRestoreSelection] = [:], previewId: String = UUID().uuidString) throws -> AccountRestorePreview {
        let backup = try BackupCodec.decode(data), owner = owner
        guard owner != "anonymous" else { throw ClientError.accountRequired }
        return try context.performAndWait { () throws -> AccountRestorePreview in
            context.reset(); defer { context.reset() }
            let meta = try Self.partition(context, owner), generation = Self.generation(meta)
            guard let configuration = try Self.syncValue(SyncConfiguration.self, id: "configuration", context: context, owner: owner, generation: generation) else { throw ClientError.accountRequired }
            if let snapshot {
                guard !configuration.enabled, configuration.phase == "ready", configuration.identity == snapshot.identity,
                      configuration.epoch == snapshot.account.epoch, snapshot.account.userId == configuration.userId,
                      snapshot.account.deviceId == configuration.deviceId else { throw ClientError.conflict("Pause sync and load current account state before restoring") }
            }
            let locals = try Self.fetch(context, "Entry", owner: owner, generation: generation).map { try Self.readEntry($0, context: context, includeHistory: true) }
            let localById = Dictionary(uniqueKeysWithValues: locals.map { ($0.id, $0) })
            guard snapshot == nil || Set(snapshot!.entries.map { $0.state.id }).count == snapshot!.entries.count else { throw ClientError.invalidData("account snapshot identities") }
            let clouds = Dictionary(uniqueKeysWithValues: (snapshot?.entries ?? []).map { ($0.state.id, $0) })
            var current = localById
            let logical = try Self.logicalOperations(context, owner: owner, generation: generation)
            if let snapshot {
                for cloud in snapshot.entries {
                    let remote = try Self.recoveryCloudEntry(cloud, local: localById[cloud.state.id], permitDifferent: false)
                    let pending = logical.filter { $0.entryID == cloud.state.id && ["pending", "conflict"].contains($0.state) }
                    current[cloud.state.id] = try SyncProjection.overlay(cloud.state, local: remote, pending: pending, knownEvents: Set(cloud.history.map(\.id)))
                    if localById[cloud.state.id]?.deleted == true { current[cloud.state.id]!.deleted = true }
                }
            }
            let eventOwners = Dictionary(grouping: current.values.flatMap { value in value.history.map { ($0.id, value.id) } }, by: { $0.0 })
            var items: [AccountRestoreItem] = [], entries: [VocabularyEntry] = [], operations: [PendingOperation] = [], conflicts: [RestoreConflict] = [], bases: [String: APIEntry] = [:]
            var expected: [String: Int?] = [:], expectedKeys: [String: [String]] = [:]
            for incoming in backup.entries + backup.tombstones {
                let existing = current[incoming.id]
                let peers = current.values.filter { !$0.deleted && LegacyCodec.keyBytes($0.normalizedKey) == LegacyCodec.keyBytes(incoming.normalizedKey) }
                let hasPending = logical.contains { $0.entryID == incoming.id && ["pending", "conflict"].contains($0.state) }
                let collision = peers.contains { $0.id != incoming.id }
                let selection = choices[incoming.id] ?? AccountRestoreSelection(existing == nil && !collision ? .useBackup : .keepCurrent)
                let reason = existing?.deleted == true && !incoming.deleted ? "This lifecycle was deleted. Keep deletion or explicitly create a separate word."
                    : collision ? "Another lifecycle has this spelling. Counts will not be added automatically."
                    : hasPending ? "Local changes are not yet confirmed. Synchronize or resolve them before replacing fields."
                    : existing != nil ? "Current fields are kept by default; select which backup fields to restore." : nil
                items.append(.init(id: incoming.id, word: incoming.word, backupCount: incoming.count, currentCount: existing?.count,
                    currentExists: existing != nil,
                    backupDeleted: incoming.deleted, currentDeleted: existing?.deleted ?? false, reason: reason, selection: selection,
                    candidates: peers.map { .init(id: $0.id, word: $0.word, count: $0.count, deleted: $0.deleted) }.sorted { $0.id < $1.id }))
                do {
                    if selection.action == .keepCurrent && (existing == nil || existing!.deleted || incoming.deleted) { continue }
                    var chosen: VocabularyEntry
                    var intent: [PendingOperation] = []
                    switch selection.action {
                    case .newLifecycle:
                        guard !incoming.deleted else { throw ClientError.conflict("A backup tombstone cannot become a new live word") }
                        chosen = try Self.separateLifecycle(Self.freshAccountBackupEntry(incoming, fields: selection.fields), batch: previewId)
                        intent = try Self.ownershipCreation(chosen, owner: owner, batch: previewId, duplicates: true)
                    case .associateHistory:
                        guard !incoming.deleted, let targetId = selection.targetId, let target = current[targetId], !target.deleted,
                              clouds[targetId] != nil || snapshot == nil else { throw ClientError.conflict("Select a current cloud word for history association") }
                        chosen = target
                        chosen.history = try Self.accountBackupHistory(target.history, incoming: incoming.history, target: targetId, owners: eventOwners)
                        if chosen.history != target.history { intent = [try Self.accountHistoryIntent(chosen, owner: owner, previewId: previewId)] }
                    case .keepCurrent:
                        guard let existing else { continue }
                        chosen = existing
                        do {
                            chosen.history = try Self.accountBackupHistory(existing.history, incoming: incoming.history, target: existing.id, owners: eventOwners)
                            chosen.reviewEvents = try Self.accountReviewHistory(existing.reviewEvents, incoming: incoming.reviewEvents)
                        } catch { if choices[incoming.id]?.action == .keepCurrent { continue }; throw error }
                        if chosen.history != existing.history { intent = [try Self.accountHistoryIntent(chosen, owner: owner, previewId: previewId)] }
                    case .useBackup:
                        guard !hasPending else { throw ClientError.conflict("Synchronize or resolve this word's pending changes before restoring its fields") }
                        if let existing {
                            guard !(existing.deleted && !incoming.deleted), !collision || incoming.deleted || !selection.fields.contains(.wordAndKind) else { throw ClientError.conflict("Deleted or differently sourced lifecycles need an explicit separate word") }
                            chosen = existing
                            chosen.history = try Self.accountBackupHistory(existing.history, incoming: incoming.history, target: existing.id, owners: eventOwners)
                            chosen.reviewEvents = try Self.accountReviewHistory(existing.reviewEvents, incoming: incoming.reviewEvents)
                            if incoming.deleted {
                                chosen.deleted = true
                                if !existing.deleted { intent = [.init(id: previewId + ":delete:" + LegacyCodec.digest(Data(chosen.id.utf8)), owner: owner, entryID: chosen.id,
                                    kind: "delete", baseVersion: existing.version, payload: .object([:]))] }
                            } else {
                                if selection.fields.contains(.count) { chosen.count = incoming.count }
                                if selection.fields.contains(.definition) { chosen.definition = incoming.definition }
                                if selection.fields.contains(.notes) { chosen.notes = incoming.notes }
                                if selection.fields.contains(.review) { chosen.review = incoming.review }
                                if selection.fields.contains(.captureOrigin) { chosen.captureOrigin = incoming.captureOrigin }
                                if selection.fields.contains(.wordAndKind) { chosen.word = incoming.word; chosen.normalizedKey = incoming.normalizedKey; chosen.kind = incoming.kind }
                                let changed = chosen.count != existing.count || chosen.definition != existing.definition || chosen.notes != existing.notes || !Self.sameReviewSnapshot(chosen.review, existing.review)
                                if changed { intent.append(.init(id: previewId + ":restore:" + LegacyCodec.digest(Data(chosen.id.utf8)), owner: owner, entryID: chosen.id, kind: "restore", baseVersion: existing.version, payload: try Self.json(chosen))) }
                                else if chosen.history != existing.history { intent.append(try Self.accountHistoryIntent(chosen, owner: owner, previewId: previewId)) }
                                if chosen.word != existing.word || chosen.kind != existing.kind {
                                    intent.append(.init(id: previewId + ":edit:" + LegacyCodec.digest(Data(chosen.id.utf8)), owner: owner, entryID: chosen.id, kind: "edit",
                                        baseVersion: existing.version, payload: .object(["word": .string(chosen.word), "kind": .string(chosen.kind.rawValue)])))
                                }
                            }
                        } else {
                            guard !collision else { throw ClientError.conflict("Associate history or explicitly create a separate word for this source") }
                            chosen = Self.freshAccountBackupEntry(incoming, fields: selection.fields)
                            chosen.history = try Self.accountBackupHistory([], incoming: chosen.history, target: chosen.id, owners: eventOwners)
                            intent = try Self.ownershipCreation(chosen, owner: owner, batch: previewId, duplicates: false)
                        }
                    }
                    guard !entries.contains(where: { $0.id == chosen.id }) else { throw ClientError.conflict("Multiple backup words target the same lifecycle; restore them separately") }
                    guard selection.action == .newLifecycle || chosen.deleted || !entries.contains(where: { !$0.deleted && $0.id != chosen.id && LegacyCodec.keyBytes($0.normalizedKey) == LegacyCodec.keyBytes(chosen.normalizedKey) }) else {
                        throw ClientError.conflict("Several backup lifecycles have this spelling; explicitly choose a separate word for the additional source")
                    }
                    if selection.action == .keepCurrent, intent.isEmpty, chosen == existing { continue }
                    if chosen.id == incoming.id {
                        chosen.sourceDigest = chosen.sourceDigest ?? incoming.sourceDigest
                        chosen.aliases = Array(Set(chosen.aliases + incoming.aliases)).sorted()
                    }
                    chosen.version = try VersionToken.next(current[chosen.id]?.version ?? 0)
                    chosen.reviewRevision = try VersionToken.next(current[chosen.id]?.effectiveReviewVersion ?? 0)
                    if chosen.review != nil { chosen.review!.version = chosen.reviewRevision! }
                    try Self.validate(chosen)
                    if let snapshot {
                        var version = clouds[chosen.id]?.state.version ?? 0, reviewVersion = clouds[chosen.id]?.state.reviewVersion ?? 0
                        for var operation in intent {
                            operation.observedRemoteVersion = version
                            operation.observedReviewVersion = reviewVersion
                            // Validate unsupported IDs, review ranges and request sizes in preview.
                            guard operation.entryID.range(of: "^[A-Za-z0-9:_-]{1,200}$", options: .regularExpression) != nil else { throw ClientError.invalidData("backup ID cannot be sent; choose a separate lifecycle") }
                            guard chosen.history.allSatisfy({ $0.id.range(of: "^[A-Za-z0-9:_-]{1,200}$", options: .regularExpression) != nil }) else { throw ClientError.invalidData("backup event IDs cannot be sent; choose a separate lifecycle") }
                            if let review = chosen.review, !chosen.deleted, selection.action != .keepCurrent {
                                guard review.dueAtMs <= 8_640_000_000_000_000 else { throw ClientError.invalidData("backup review time exceeds the API range; deselect Review") }
                            }
                            let projected = try SyncProjection.makeWire(operation, privacy: configuration.privacy, base: clouds[chosen.id]?.state)
                            for request in projected { try Self.validateAccountBackupWire(request) }
                            version += Self.predictedWrites(operation); reviewVersion += Self.predictedReviewWrites(operation)
                        }
                        expected[chosen.id] = .some(clouds[chosen.id]?.state.version)
                        let key = LegacyCodec.keyBytes(chosen.normalizedKey)
                        if selection.action != .newLifecycle {
                            expectedKeys[key] = snapshot.entries.filter { !$0.state.deleted && LegacyCodec.keyBytes($0.state.normalizedKey) == key }.map { $0.state.id }.sorted()
                        }
                    }
                    entries.append(chosen); operations += intent
                    if let cloud = clouds[chosen.id] { bases[chosen.id] = cloud.state }
                } catch let error as ClientError { conflicts.append(.init(id: incoming.id, reason: error.localizedDescription, canUseBackup: false)) }
            }
            let restoredSources = Set(entries.compactMap(\.sourceDigest))
            var plan = ImportPreview(id: previewId, mode: .restoreAccount, revision: meta.value(forKey: "revision") as! Int64, owner: owner,
                entries: entries, sources: backup.importSources.filter { restoredSources.contains($0) }, conflicts: conflicts, operations: operations, alreadyImported: false,
                losses: ["Export a current complete backup first. Account restore merges selected changes; missing backup words are kept.", "Backup versions, old requests, checkpoints and review answers are not replayed. Imported history does not increment count."])
            if let snapshot {
                plan.remoteBases = bases
                plan.accountRestore = .init(sourceGeneration: generation, origin: snapshot.identity.origin, userId: snapshot.identity.userId,
                    deviceId: snapshot.identity.deviceId, epoch: snapshot.account.epoch,
                    privacy: configuration.privacy, timeZoneID: snapshot.account.timezone,
                    expectedEntries: expected.keys.sorted().map { .init(id: $0, version: expected[$0]!) }, expectedLiveKeys: expectedKeys)
            }
            return .init(online: snapshot != nil, items: items, plan: plan)
        }
    }
    static func accountBackupHistory(_ current: [Encounter], incoming: [Encounter], target: String, owners: [String: [(String, String)]]) throws -> [Encounter] {
        let redressed = incoming.map { event in var copy = event; copy.cloudPosition = nil; return copy }
        return try ownershipHistory(current, incoming: redressed, entryId: target, existing: owners)
    }
    static func freshAccountBackupEntry(_ incoming: VocabularyEntry, fields: Set<AccountRestoreField>) -> VocabularyEntry {
        var copy = incoming
        if !fields.contains(.count) { copy.count = nil }
        if !fields.contains(.definition) { copy.definition = .object(["word": .string(copy.word), "phonetics": .array([]), "meanings": .array([])]) }
        if !fields.contains(.notes) { copy.notes = "" }
        if !fields.contains(.review) { copy.review = nil }
        if !fields.contains(.captureOrigin) { copy.captureOrigin = nil }
        copy.version = 0; copy.reviewRevision = copy.review == nil ? 0 : 1
        if copy.review != nil { copy.review!.version = 1 }
        copy.history = copy.history.map { event in var value = event; value.cloudPosition = nil; return value }
        return copy
    }
    static func sameReviewSnapshot(_ left: ReviewState?, _ right: ReviewState?) -> Bool {
        if left == nil || right == nil { return left == nil && right == nil }
        return left!.algorithmVersion == right!.algorithmVersion && left!.step == right!.step && left!.dueAtMs == right!.dueAtMs
    }
    static func validateAccountBackupWire(_ operation: APIOperation) throws {
        func depthFits(_ value: JSONValue, depth: Int) -> Bool {
            guard depth <= 32 else { return false }
            if let fields = value.fields { return fields.values.allSatisfy { depthFits($0, depth: depth + 1) } }
            if let items = value.items { return items.allSatisfy { depthFits($0, depth: depth + 1) } }
            return true
        }
        guard depthFits(operation.payload, depth: 1) else { throw ClientError.invalidData("backup definition exceeds API nesting limits; deselect Current definition or skip this item") }
        let fields = operation.payload.fields ?? [:]
        if let notes = fields["notes"]?.text, notes.utf16.count > 16_384 { throw ClientError.invalidData("backup notes exceed the API limit; deselect Notes") }
        if let word = fields["word"]?.text, word.utf16.count > 16_384 { throw ClientError.invalidData("backup spelling exceeds the API limit") }
        let definitions = [fields["definition"]].compactMap { $0 } + (fields["events"]?.items ?? []).compactMap { $0["definition"] }
        guard definitions.allSatisfy({ ($0["word"]?.text?.utf16.count ?? 0) <= 16_384 }) else { throw ClientError.invalidData("backup definition spelling exceeds the API limit") }
        for event in fields["events"]?.items ?? [] {
            guard (event["context"]?.text?.utf16.count ?? 0) <= 16_384, (event["url"]?.text?.utf16.count ?? 0) <= 8192 else {
                throw ClientError.invalidData("backup history source exceeds the API limit under current source consent")
            }
        }
    }
    static func accountReviewHistory(_ current: [ReviewEvent], incoming: [ReviewEvent]) throws -> [ReviewEvent] {
        let existing = Dictionary(uniqueKeysWithValues: current.map { ($0.id, $0) })
        guard incoming.allSatisfy({ existing[$0.id] == nil || existing[$0.id] == $0 }) else { throw ClientError.conflict("Review event ID has different immutable content") }
        return current + incoming.filter { existing[$0.id] == nil }
    }
    static func accountHistoryIntent(_ entry: VocabularyEntry, owner: String, previewId: String) throws -> PendingOperation {
        .init(id: previewId + ":history:" + LegacyCodec.digest(Data(entry.id.utf8)), owner: owner, entryID: entry.id,
            kind: "associateHistory", baseVersion: entry.version, payload: try json(entry))
    }
    public func verifyAccountRestorePublication(_ batchId: String, snapshot: ServerSnapshot) throws {
        let plan = try loadImportPlan(batchId)
        guard plan.mode == .restoreAccount, let source = plan.accountRestore, snapshot.identity == source.identity,
              snapshot.account.epoch == source.epoch, snapshot.account.userId == source.userId, snapshot.account.deviceId == source.deviceId,
              snapshot.account.timezone == source.timeZoneID, snapshot.account.syncContext == source.privacy.context,
              snapshot.account.syncURLs == source.privacy.urls else { throw ClientError.stalePreview }
        guard Set(snapshot.entries.map { $0.state.id }).count == snapshot.entries.count else { throw ClientError.invalidData("account snapshot identities") }
        let current = Dictionary(uniqueKeysWithValues: snapshot.entries.map { ($0.state.id, $0.state) })
        for expected in source.expectedEntries { guard current[expected.id]?.version == expected.version else { throw ClientError.stalePreview } }
        for (key, ids) in source.expectedLiveKeys {
            guard snapshot.entries.filter({ !$0.state.deleted && LegacyCodec.keyBytes($0.state.normalizedKey) == key }).map({ $0.state.id }).sorted() == ids else { throw ClientError.stalePreview }
        }
        let owner = owner, now = Date().timeIntervalSince1970 * 1000
        try transaction { context in
            let request = NSFetchRequest<NSManagedObject>(entityName: "Batch"); request.predicate = NSPredicate(format: "owner == %@ AND id == %@", owner, batchId)
            guard let batch = try context.fetch(request).first, batch.value(forKey: "state") as? String == "ready",
                  try Self.partition(context, owner).value(forKey: "revision") as? Int64 == plan.revision else { throw ClientError.stalePreview }
            try Self.writeSync(AccountRestoreValidation(epoch: source.epoch, userId: source.userId, deviceId: source.deviceId, checkedAtMs: now),
                id: "account-restore-validation:" + batchId, context: context, owner: owner, generation: Self.generation(batch))
        }
    }
    static func publishAccountRestore(_ source: AccountRestoreProvenance, batchId: String, context: NSManagedObjectContext, owner: String, candidate: String) throws {
        let meta = try partition(context, owner), active = generation(meta), now = Date().timeIntervalSince1970 * 1000
        guard active == source.sourceGeneration, let configuration = try syncValue(SyncConfiguration.self, id: "configuration", context: context, owner: owner, generation: active),
              !configuration.enabled, configuration.phase == "ready", configuration.identity == source.identity, configuration.epoch == source.epoch,
              configuration.privacy == source.privacy, configuration.timeZoneID == source.timeZoneID,
              let validation = try syncValue(AccountRestoreValidation.self, id: "account-restore-validation:" + batchId, context: context, owner: owner, generation: candidate),
              validation.epoch == source.epoch, validation.userId == source.userId, validation.deviceId == source.deviceId,
              validation.checkedAtMs <= now, now - validation.checkedAtMs <= 60_000 else { throw ClientError.conflict("Reconnect and recheck current cloud versions before publishing this account restore") }
    }
}

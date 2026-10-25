import Foundation
@preconcurrency import CoreData

public enum EpochRecoveryChoice: String, Codable, Sendable, CaseIterable {
    case useCloud, keepLocalPending, restoreLocalFields, newLifecycle
}
public struct EpochRecoveryProvenance: Codable, Sendable, Equatable {
    public var sourceGeneration: String
    public var previousEpoch: String
    public var configuration: SyncConfiguration
    public var serverPrivacy: SyncPrivacy? = nil
}
public struct EpochRecoveryItem: Sendable, Identifiable {
    public var id: String
    public var word: String
    public var localCount: Double?
    public var cloudCount: Double?
    public var localExists: Bool
    public var cloudExists: Bool
    public var localDeleted: Bool
    public var cloudDeleted: Bool
    public var historyConflicts: Int
    public var choice: EpochRecoveryChoice
}
public struct EpochRecoveryPreview: Sendable, Identifiable {
    public var id: String { plan.id }
    public var items: [EpochRecoveryItem]
    public var previousPendingCount: Int
    public var plan: ImportPreview
}
private struct EpochPublicationValidation: Codable, Sendable, Equatable {
    var epoch: String
    var userId: String
    var deviceId: String
    var verifiedAtMs: Double
    var reviewDay: String?
    var reviewAdmissionIds: [String]?
}

extension LocalRepository {
    public func previewEpochRecovery(_ snapshot: ServerSnapshot, choices: [String: EpochRecoveryChoice] = [:], previewId: String = UUID().uuidString) throws -> EpochRecoveryPreview {
        let owner = owner
        return try context.performAndWait { () throws -> EpochRecoveryPreview in
            context.reset(); defer { context.reset() }
            let meta = try Self.partition(context, owner), generation = Self.generation(meta)
            guard let previous = try Self.syncValue(SyncConfiguration.self, id: "configuration", context: context, owner: owner, generation: generation),
                  owner == SyncConfiguration.owner(for: snapshot.identity), snapshot.identity == previous.identity,
                  previous.phase == "epochConflict", !previous.enabled, let epoch = previous.epoch,
                  snapshot.account.epoch != epoch, snapshot.account.userId == previous.userId, snapshot.account.deviceId == previous.deviceId,
                  snapshot.account.reviewDay != nil, snapshot.account.reviewAdmissionIds != nil,
                  VersionToken.valid(snapshot.boundary), Set(snapshot.account.syncCapabilities ?? []).isSuperset(of: ["history-order-v1", "history-version-v1", "explicit-lifecycles-v1"]) else {
                throw ClientError.conflict("A paused account and a complete new-epoch snapshot including current review quota are required")
            }
            let locals = try Self.fetch(context, "Entry", owner: owner, generation: generation).map { try Self.readEntry($0, context: context, includeHistory: true) }
            let localById = Dictionary(uniqueKeysWithValues: locals.map { ($0.id, $0) })
            guard Set(snapshot.entries.map { $0.state.id }).count == snapshot.entries.count else { throw ClientError.invalidData("recovery lifecycle identity") }
            let clouds = Dictionary(uniqueKeysWithValues: snapshot.entries.map { ($0.state.id, $0) })
            var configuration = SyncConfiguration(identity: snapshot.identity, enabled: false, privacy: .init(context: previous.privacy.context && snapshot.account.syncContext, urls: previous.privacy.urls && snapshot.account.syncURLs))
            try snapshot.account.reminderDevice?.validate()
            configuration.reminderDevice = snapshot.account.reminderDevice
            configuration.sourceRevision = snapshot.account.sourceRevision
            configuration.epoch = snapshot.account.epoch; configuration.cursor = snapshot.boundary; configuration.phase = "ready"
            configuration.timeZoneID = snapshot.account.timezone; configuration.capabilities = snapshot.account.syncCapabilities; configuration.displayName = snapshot.account.displayName
            try Self.validateReviewAdmissions(snapshot.account)
            configuration.serverReviewDay = snapshot.account.reviewDay; configuration.serverReviewAdmissionIds = snapshot.account.reviewAdmissionIds
            var entries: [VocabularyEntry] = [], operations: [PendingOperation] = [], conflicts: [RestoreConflict] = [], items: [EpochRecoveryItem] = [], bases: [String: APIEntry] = [:]
            let ids = Set(localById.keys).union(clouds.keys).sorted()
            for id in ids {
                let local = localById[id], cloud = clouds[id]
                try cloud?.state.validate()
                let remoteEvents = Dictionary(grouping: cloud?.history ?? [], by: \.id)
                let historyConflicts = (local?.history ?? []).filter { event in
                    guard let other = remoteEvents[event.id]?.first else { return false }
                    return other.timestamp != event.timestamp || other.definition != event.definition
                }.count
                let choice = choices[id] ?? (cloud == nil || historyConflicts > 0 || local?.deleted == true && cloud?.state.deleted == false ? .keepLocalPending : .useCloud)
                items.append(.init(id: id, word: local?.word ?? cloud!.state.word, localCount: local?.count, cloudCount: cloud?.state.count,
                    localExists: local != nil, cloudExists: cloud != nil, localDeleted: local?.deleted ?? false, cloudDeleted: cloud?.state.deleted ?? false,
                    historyConflicts: historyConflicts, choice: choice))
                do {
                    let remote = try cloud.map { try Self.recoveryCloudEntry($0, local: local) }
                    var chosen: VocabularyEntry
                    switch choice {
                    case .useCloud:
                        guard historyConflicts == 0 else { throw ClientError.conflict("Same event ID has different immutable history; retain the local conflict or create a separate word") }
                        guard let remote, !(local?.deleted == true && !remote.deleted) else { throw ClientError.conflict("A missing cloud word or local deletion must be retained or copied explicitly") }
                        chosen = remote
                    case .keepLocalPending:
                        guard var kept = local else { throw ClientError.conflict("No local snapshot exists for this choice") }
                        if cloud?.state.deleted == true { kept.deleted = true }
                        let remoteHistory = Dictionary(uniqueKeysWithValues: (cloud?.history ?? []).map { ($0.id, $0) })
                        kept.history = kept.history.map { event in
                            var value = event; let remoteEvent = remoteHistory[event.id]
                            value.cloudPosition = remoteEvent?.timestamp == event.timestamp && remoteEvent?.definition == event.definition ? remoteEvent?.position : nil
                            return value
                        }
                        chosen = kept
                        if !kept.deleted || cloud?.state.deleted == false || historyConflicts > 0 {
                            var pending = PendingOperation(id: previewId + ":hold:" + LegacyCodec.digest(Data(id.utf8)), owner: owner, entryID: id,
                                kind: kept.deleted ? "delete" : cloud == nil ? "epochOrphan" : "restore", baseVersion: kept.version,
                                payload: kept.deleted ? .object([:]) : try Self.json(kept))
                            pending.state = "conflict"
                            operations.append(pending)
                        }
                    case .restoreLocalFields:
                        guard let local, let remote, !remote.deleted else { throw ClientError.conflict("A missing or deleted cloud lifecycle requires a separate new word") }
                        chosen = local
                        chosen.history = try Self.recoveryHistory(remote.history, local: local.history, permitDifferent: false)
                        if local.deleted {
                            operations.append(.init(id: previewId + ":delete:" + LegacyCodec.digest(Data(id.utf8)), owner: owner, entryID: id,
                                kind: "delete", baseVersion: local.version, payload: .object([:])))
                        } else {
                            operations.append(.init(id: previewId + ":restore:" + LegacyCodec.digest(Data(id.utf8)), owner: owner, entryID: id,
                                kind: "restore", baseVersion: local.version, payload: try Self.json(chosen)))
                            if local.word != remote.word || local.kind != remote.kind {
                                operations.append(.init(id: previewId + ":edit:" + LegacyCodec.digest(Data(id.utf8)), owner: owner, entryID: id, kind: "edit",
                                    baseVersion: local.version, payload: .object(["word": .string(local.word), "kind": .string(local.kind.rawValue)])))
                            }
                        }
                    case .newLifecycle:
                        guard let local, !local.deleted else { throw ClientError.conflict("Choose a live local snapshot to make a separate word") }
                        chosen = try Self.separateLifecycle(local, batch: previewId)
                        operations += try Self.ownershipCreation(chosen, owner: owner, batch: previewId, duplicates: true)
                        if let remote { entries.append(remote); bases[id] = cloud!.state }
                    }
                    chosen.version = try VersionToken.next(max(local?.version ?? 0, chosen.version))
                    chosen.reviewRevision = try VersionToken.next(max(local?.effectiveReviewVersion ?? 0, chosen.effectiveReviewVersion))
                    if chosen.review != nil { chosen.review!.version = chosen.reviewRevision! }
                    try Self.validate(chosen); entries.append(chosen)
                    if chosen.id == id, let cloud { bases[id] = cloud.state }
                } catch let error as ClientError { conflicts.append(.init(id: id, reason: error.localizedDescription, canUseBackup: false)) }
            }
            let sources = try Self.fetch(context, "Source", owner: owner, generation: generation).compactMap { $0.value(forKey: "id") as? String }
            let old = try Self.logicalOperations(context, owner: owner, generation: generation)
            var plan = ImportPreview(id: previewId, mode: .reconcileEpoch, revision: meta.value(forKey: "revision") as! Int64, owner: owner,
                entries: entries, sources: sources, conflicts: conflicts, operations: operations, alreadyImported: false,
                losses: ["Export a current complete backup before continuing.", "Earlier-epoch requests stay in the recovery generation and are never replayed.", "Retained local changes remain explicit conflicts; selected field restores use new request IDs and current cloud versions."])
            plan.epochRecovery = .init(sourceGeneration: generation, previousEpoch: epoch, configuration: configuration, serverPrivacy: .init(context: snapshot.account.syncContext, urls: snapshot.account.syncURLs))
            plan.remoteBases = bases
            return .init(items: items, previousPendingCount: old.filter { $0.state == "pending" || $0.state == "conflict" }.count, plan: plan)
        }
    }

    static func recoveryCloudEntry(_ cloud: ServerSnapshotEntry, local: VocabularyEntry?, permitDifferent: Bool = true) throws -> VocabularyEntry {
        var entry = VocabularyEntry(id: cloud.state.id, word: cloud.state.word, kind: cloud.state.kind, count: cloud.state.count,
            timestamp: cloud.state.createdAtMs, definition: cloud.state.definition)
        entry.updatedAt = cloud.state.updatedAtMs; entry.notes = cloud.state.notes; entry.deleted = cloud.state.deleted
        entry.sourceDigest = local?.sourceDigest; entry.aliases = local?.aliases ?? []; entry.legacyFields = local?.legacyFields ?? [:]
        entry.captureOrigin = local?.captureOrigin; entry.reviewEvents = local?.reviewEvents ?? []
        entry.version = try VersionToken.next(local?.version ?? 0); entry.reviewRevision = try VersionToken.next(local?.effectiveReviewVersion ?? 0)
        if let review = cloud.state.review { entry.review = ReviewState(step: review.step, dueAtMs: review.dueAtMs, version: entry.reviewRevision!) }
        guard Set(cloud.history.map(\.id)).count == cloud.history.count, Set(cloud.history.compactMap(\.position)).count == cloud.history.count,
              cloud.history.allSatisfy({ event in event.position.map { $0 > 0 && VersionToken.valid($0) } == true }) else { throw ClientError.invalidData("recovery history identity") }
        entry.history = cloud.history.map { event in
            var value = Encounter(id: event.id, timestamp: event.timestamp, context: event.context ?? "", url: event.url ?? "", definition: event.definition)
            value.cloudPosition = event.position; return value
        }
        entry.history = try recoveryHistory(entry.history, local: local?.history ?? [], permitDifferent: permitDifferent)
        try validate(entry); return entry
    }
    static func recoveryHistory(_ remote: [Encounter], local: [Encounter], permitDifferent: Bool) throws -> [Encounter] {
        var result = remote, index = Dictionary(uniqueKeysWithValues: remote.enumerated().map { ($0.element.id, $0.offset) })
        for event in local {
            if let position = index[event.id] {
                let immutableSame = result[position].timestamp == event.timestamp && result[position].definition == event.definition
                guard immutableSame || permitDifferent else { throw ClientError.conflict("Same event ID differs after server restoration; keep cloud or create a separate word") }
                if immutableSame {
                    if result[position].context.isEmpty { result[position].context = event.context }
                    if result[position].url.isEmpty { result[position].url = event.url }
                    result[position].legacyFields = event.legacyFields
                }
            } else {
                var kept = event; kept.cloudPosition = nil
                index[event.id] = result.count; result.append(kept)
            }
        }
        return result
    }
    static func stageEpochEntry(_ entry: VocabularyEntry, base: APIEntry?, context: NSManagedObjectContext, owner: String, generation: String) throws {
        guard let base else { return }
        try writeSync(base, id: "base:" + base.id, context: context, owner: owner, generation: generation)
        try writeSync(SyncHistoryCheckpoint(entryId: base.id, version: base.version, cursor: "", complete: true), id: "history:" + base.id, context: context, owner: owner, generation: generation)
        for event in entry.history where event.cloudPosition != nil {
            let value = APIHistoryPage.Event(id: event.id, timestamp: event.timestamp, definition: event.definition, context: nil, url: nil, position: event.cloudPosition)
            try writeSync(value, id: "event:" + LegacyCodec.digest(Data(base.id.utf8)) + ":" + event.id, context: context, owner: owner, generation: generation)
        }
    }
    static func publishEpochRecovery(_ provenance: EpochRecoveryProvenance, context: NSManagedObjectContext, owner: String, candidate: String) throws {
        let meta = try partition(context, owner), source = generation(meta)
        guard provenance.sourceGeneration == source,
              let previous = try syncValue(SyncConfiguration.self, id: "configuration", context: context, owner: owner, generation: source),
              previous.phase == "epochConflict", !previous.enabled, previous.epoch == provenance.previousEpoch,
              previous.identity == provenance.configuration.identity, provenance.configuration.epoch != previous.epoch else { throw ClientError.stalePreview }
        guard try syncValue(SyncConfiguration.self, id: "configuration", context: context, owner: owner, generation: candidate) == provenance.configuration else { throw ClientError.invalidData("recovery configuration changed") }
        let now = Date().timeIntervalSince1970 * 1000
        guard let validation = try syncValue(EpochPublicationValidation.self, id: "recovery-validation", context: context, owner: owner, generation: candidate),
              validation.epoch == provenance.configuration.epoch, validation.userId == provenance.configuration.userId,
              validation.deviceId == provenance.configuration.deviceId, validation.verifiedAtMs <= now,
              now - validation.verifiedAtMs <= 60_000 else { throw ClientError.conflict("Reconnect and recheck the server before publishing recovery choices") }
        if let admissions = validation.reviewAdmissionIds {
            var configuration = provenance.configuration
            configuration.serverReviewDay = validation.reviewDay; configuration.serverReviewAdmissionIds = admissions
            try writeSync(configuration, id: "configuration", context: context, owner: owner, generation: candidate)
            let request = NSFetchRequest<NSManagedObject>(entityName: "ReviewAdmission")
            request.predicate = NSPredicate(format: "owner == %@", owner)
            for row in try context.fetch(request) { context.delete(row) }
        }
        for operation in try logicalOperations(context, owner: owner, generation: candidate) where operation.state == "conflict" {
            let base = try syncValue(APIEntry.self, id: "base:" + operation.entryID, context: context, owner: owner, generation: candidate)
            try writeSync(SyncConflict(id: operation.id, entryId: operation.entryID, code: "EPOCH_RECONCILIATION_REQUIRED", localOperation: operation, remote: base),
                id: "conflict:" + operation.id, context: context, owner: owner, generation: candidate)
        }
    }
    static func validateReviewAdmissions(_ account: APIAccountIdentity) throws {
        guard (account.reviewDay == nil) == (account.reviewAdmissionIds == nil) else { throw ClientError.invalidData("server review admission snapshot") }
        if let day = account.reviewDay, let ids = account.reviewAdmissionIds {
            guard day.range(of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", options: .regularExpression) != nil,
                  ids.count <= 20, Set(ids).count == ids.count,
                  ids.allSatisfy({ $0.range(of: "^[A-Za-z0-9:_-]{1,200}$", options: .regularExpression) != nil }) else { throw ClientError.invalidData("server review admissions") }
        }
    }

    public func verifyEpochRecoveryPublication(_ batchId: String, account: APIAccountIdentity, identity: ConnectedIdentity) throws {
        try Self.validateReviewAdmissions(account)
        let plan = try loadImportPlan(batchId)
        guard plan.mode == .reconcileEpoch, let provenance = plan.epochRecovery,
              identity == provenance.configuration.identity, account.userId == identity.userId, account.deviceId == identity.deviceId,
              account.epoch == provenance.configuration.epoch, account.timezone == provenance.configuration.timeZoneID,
              account.reviewDay != nil, account.reviewAdmissionIds != nil,
              account.sourceRevision == provenance.configuration.sourceRevision,
              account.reminderDevice == provenance.configuration.reminderDevice,
              account.syncContext == (provenance.serverPrivacy ?? provenance.configuration.privacy).context, account.syncURLs == (provenance.serverPrivacy ?? provenance.configuration.privacy).urls else { throw ClientError.stalePreview }
        let owner = owner, now = Date().timeIntervalSince1970 * 1000
        try transaction { context in
            let request = NSFetchRequest<NSManagedObject>(entityName: "Batch")
            request.predicate = NSPredicate(format: "owner == %@ AND id == %@", owner, batchId)
            guard let batch = try context.fetch(request).first, batch.value(forKey: "state") as? String == "ready",
                  batch.value(forKey: "revision") as? Int64 == plan.revision,
                  try Self.partition(context, owner).value(forKey: "revision") as? Int64 == plan.revision else { throw ClientError.stalePreview }
            try Self.writeSync(EpochPublicationValidation(epoch: account.epoch, userId: account.userId, deviceId: account.deviceId, verifiedAtMs: now,
                reviewDay: account.reviewDay, reviewAdmissionIds: account.reviewAdmissionIds),
                id: "recovery-validation", context: context, owner: owner, generation: Self.generation(batch))
        }
    }
}

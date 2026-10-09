import Foundation
@preconcurrency import CoreData

public enum OwnershipAction: String, Codable, Sendable, CaseIterable {
    case migrate, keepAnonymous, associate, replaceFields, newLifecycle
}
public struct OwnershipSelection: Codable, Sendable, Equatable {
    public var action: OwnershipAction
    public var targetId: String?
    public init(_ action: OwnershipAction, targetId: String? = nil) { self.action = action; self.targetId = targetId }
}
public struct OwnershipCandidate: Sendable, Identifiable {
    public var id: String
    public var word: String
    public var count: Double?
    public var deleted: Bool
}
public struct OwnershipItem: Sendable, Identifiable {
    public var id: String
    public var word: String
    public var count: Double?
    public var deleted: Bool
    public var sharedBaselineAvailable: Bool
    public var selection: OwnershipSelection
    public var reason: String?
    public var candidates: [OwnershipCandidate]
}
public struct OwnershipMapping: Codable, Sendable, Equatable {
    public var localId: String
    public var remoteId: String
    public var action: OwnershipAction
}
public struct OwnershipProvenance: Codable, Sendable, Equatable {
    public var sourceGeneration: String
    public var sourceRevision: Int64
    public var origin: String
    public var userId: String
    public var deviceId: String
    public var epoch: String
    public var mappings: [OwnershipMapping]
}
public struct OwnershipPreview: Sendable, Identifiable {
    public var id: String { plan.id }
    public var items: [OwnershipItem]
    public var plan: ImportPreview
}

extension LocalRepository {
    public func previewAnonymousOwnership(choices: [String: OwnershipSelection] = [:], previewId: String = UUID().uuidString) throws -> OwnershipPreview {
        let owner = owner
        return try context.performAndWait { () throws -> OwnershipPreview in
            context.reset()
            defer { context.reset() }
            let meta = try Self.partition(context, owner), generation = Self.generation(meta)
            guard owner != "anonymous", let configuration = try Self.syncValue(SyncConfiguration.self, id: "configuration", context: context, owner: owner, generation: generation),
                  !configuration.enabled, configuration.phase == "ready", configuration.pullBoundary == nil, let epoch = configuration.epoch,
                  SyncConfiguration.owner(for: configuration.identity) == owner else { throw ClientError.conflict("Pause sync and finish the cloud snapshot before ownership preview") }
            let unfinished = try Self.fetch(context, "SyncRecord", owner: owner, generation: generation).filter { ($0.value(forKey: "id") as? String)?.hasPrefix("history:") == true }
                .map { try Self.decode(SyncHistoryCheckpoint.self, $0) }.contains { !$0.complete }
            guard !unfinished else { throw ClientError.conflict("Finish downloading cloud history before ownership preview") }
            let source = try Self.partition(context, "anonymous"), sourceGeneration = Self.generation(source)
            let sourceRows = try Self.fetch(context, "Entry", owner: "anonymous", generation: sourceGeneration)
            var sourceEntries: [VocabularyEntry] = try sourceRows.map { try Self.readEntry($0, context: context, includeHistory: true) }
            sourceEntries.sort { left, right in
                if left.createdAt == right.createdAt { return left.id < right.id }
                return left.createdAt < right.createdAt
            }
            let sourceOperations = try Self.logicalOperations(context, owner: "anonymous", generation: sourceGeneration)
            let targetEntries = try Self.fetch(context, "Entry", owner: owner, generation: generation).map { try Self.readEntry($0, context: context, includeHistory: true) }
            let allEvents = Dictionary(grouping: targetEntries.flatMap { entry in entry.history.map { ($0.id, entry.id) } }, by: { $0.0 })
            var entries: [VocabularyEntry] = [], operations: [PendingOperation] = [], items: [OwnershipItem] = [], conflicts: [RestoreConflict] = [], mappings: [OwnershipMapping] = []
            for local in sourceEntries {
                let intents = sourceOperations.filter { $0.entryID == local.id && $0.state != "discarded" }
                let seed = intents.first(where: { $0.kind == "legacySeed" }).flatMap { try? SyncProjection.decodeEntry($0.payload) }
                let shared = seed?.sourceDigest == local.sourceDigest && local.sourceDigest != nil
                let peers = targetEntries.filter { $0.id == local.id || (!$0.deleted && LegacyCodec.keyBytes($0.normalizedKey) == LegacyCodec.keyBytes(local.normalizedKey)) }
                let same = peers.first { $0.id == local.id }
                let previouslyCopied = try Self.syncValue(OwnershipMapping.self, id: Self.bindingKey(owner, local.id), context: context, owner: "anonymous", generation: sourceGeneration) != nil
                let canMigrate = !previouslyCopied && (local.sourceDigest == nil || shared) && (peers.isEmpty || (shared && same?.deleted == false))
                let selection = choices[local.id] ?? OwnershipSelection(canMigrate ? .migrate : .keepAnonymous)
                let reason = previouslyCopied ? "Already copied to this account; keep the anonymous copy unless you explicitly choose another action."
                    : same?.deleted == true ? "This cloud lifecycle was deleted. It cannot be resurrected."
                    : local.sourceDigest != nil && !shared ? "The original migration baseline is unavailable; association or a new lifecycle requires an explicit choice."
                    : !peers.isEmpty && !shared ? "A different cloud lifecycle has this spelling; counts will not be added automatically." : nil
                items.append(OwnershipItem(id: local.id, word: local.word, count: local.count, deleted: local.deleted, sharedBaselineAvailable: shared,
                    selection: selection, reason: reason, candidates: peers.map { .init(id: $0.id, word: $0.word, count: $0.count, deleted: $0.deleted) }))
                if selection.action == .keepAnonymous { continue }
                do {
                    var imported = local
                    var planned: [PendingOperation] = []
                    switch selection.action {
                    case .keepAnonymous: break
                    case .migrate:
                        guard (peers.isEmpty || (shared && same?.deleted == false)), local.sourceDigest == nil || shared else { throw ClientError.conflict("Choose an association or a separate lifecycle for this source") }
                        if shared {
                            var expected = 0, expectedReview = 0
                            planned = intents.map { intent in
                                var copy = PendingOperation(id: intent.id, owner: owner, entryID: intent.entryID, kind: intent.kind, baseVersion: intent.baseVersion, payload: intent.payload)
                                copy.projectedReview = intent.projectedReview
                                copy.observedRemoteVersion = expected; copy.observedReviewVersion = expectedReview
                                copy.observedVersionFloor = 0; copy.observedReviewVersionFloor = 0
                                expected += Self.predictedWrites(copy); expectedReview += Self.predictedReviewWrites(copy)
                                return copy
                            }
                        } else {
                            imported.history = local.history.map { event in var copy = event; copy.cloudPosition = nil; return copy }
                            planned = try Self.ownershipCreation(local, owner: owner, batch: previewId, duplicates: false)
                        }
                        if let same { imported.history = try Self.ownershipHistory(same.history, incoming: local.history, entryId: same.id, existing: allEvents) }
                    case .associate, .replaceFields:
                        guard !local.deleted, let targetId = selection.targetId, let peer = peers.first(where: { $0.id == targetId && !$0.deleted }),
                              let base = try Self.syncValue(APIEntry.self, id: "base:" + targetId, context: context, owner: owner, generation: generation) else { throw ClientError.conflict("Select a live cloud lifecycle before association") }
                        imported = peer
                        imported.history = try Self.ownershipHistory(peer.history, incoming: local.history, entryId: targetId, existing: allEvents)
                        if selection.action == .replaceFields {
                            imported.count = local.count; imported.definition = local.definition; imported.notes = local.notes; imported.review = local.review
                            var restore = PendingOperation(id: previewId + ":restore:" + LegacyCodec.digest(Data(local.id.utf8)), owner: owner,
                                entryID: targetId, kind: "restore", baseVersion: peer.version, payload: try Self.json(imported))
                            restore.observedRemoteVersion = base.version; restore.observedReviewVersion = base.reviewVersion
                            planned = [restore]
                        } else if !local.history.isEmpty {
                            var history = imported; history.history = local.history
                            planned = [PendingOperation(id: previewId + ":history:" + LegacyCodec.digest(Data(local.id.utf8)), owner: owner,
                                entryID: targetId, kind: "associateHistory", baseVersion: peer.version, payload: try Self.json(history))]
                        }
                        if imported.captureOrigin == nil { imported.captureOrigin = local.captureOrigin }
                        imported.aliases = Array(Set(imported.aliases + [local.id] + local.aliases)).sorted()
                    case .newLifecycle:
                        imported = try Self.separateLifecycle(local, batch: previewId)
                        planned = try Self.ownershipCreation(imported, owner: owner, batch: previewId, duplicates: true)
                    }
                    guard !entries.contains(where: { $0.id == imported.id }) else { throw ClientError.conflict("Several local entries target this lifecycle; confirm them separately") }
                    if selection.action == .migrate, entries.contains(where: { !$0.deleted && LegacyCodec.keyBytes($0.normalizedKey) == LegacyCodec.keyBytes(imported.normalizedKey) && $0.id != imported.id }) {
                        throw ClientError.conflict("Several local sources have this spelling; choose a separate lifecycle explicitly")
                    }
                    imported.version = try VersionToken.next(max(local.version, same?.version ?? imported.version))
                    imported.reviewRevision = try VersionToken.next(max(local.effectiveReviewVersion, imported.effectiveReviewVersion))
                    if imported.review != nil { imported.review!.version = imported.reviewRevision! }
                    try Self.validate(imported)
                    entries.append(imported); operations += planned
                    mappings.append(OwnershipMapping(localId: local.id, remoteId: imported.id, action: selection.action))
                } catch let failure as ClientError {
                    conflicts.append(RestoreConflict(id: local.id, reason: failure.localizedDescription, canUseBackup: false))
                }
            }
            // Original IDs survive migration retries. Per-entry intent order is
            // retained; new snapshots never replay the old anonymous outbox.
            let provenance = OwnershipProvenance(sourceGeneration: sourceGeneration, sourceRevision: source.value(forKey: "revision") as! Int64,
                origin: configuration.origin, userId: configuration.userId, deviceId: configuration.deviceId, epoch: epoch, mappings: mappings)
            let selectedIds = Set(mappings.map(\.localId))
            let digests = Array(Set(sourceEntries.filter { selectedIds.contains($0.id) }.compactMap(\.sourceDigest))).sorted()
            var plan = ImportPreview(id: previewId, mode: .bindAnonymous, revision: meta.value(forKey: "revision") as! Int64, owner: owner,
                entries: entries, sources: digests, conflicts: conflicts, operations: operations, alreadyImported: false,
                losses: ["The anonymous copy stays on this device. It does not become a second synchronization source.", "Association imports selected history without adding its count. Replacing fields uses a current-version snapshot.", "A separate lifecycle copies the selected count once and gives copied history new IDs; it may intentionally duplicate existing information."])
            plan.ownership = provenance
            return OwnershipPreview(items: items, plan: plan)
        }
    }

    static func ownershipCreation(_ entry: VocabularyEntry, owner: String, batch: String, duplicates: Bool) throws -> [PendingOperation] {
        var fields = try json(entry).fields!
        if duplicates { fields["allowDuplicate"] = .bool(true) }
        var result = [PendingOperation(id: batch + ":create:" + LegacyCodec.digest(Data(entry.id.utf8)), owner: owner, entryID: entry.id,
            kind: "create", baseVersion: 0, payload: .object(fields))]
        if entry.deleted { result.append(PendingOperation(id: batch + ":delete:" + LegacyCodec.digest(Data(entry.id.utf8)), owner: owner,
            entryID: entry.id, kind: "delete", baseVersion: entry.version, payload: .object([:]))) }
        return result
    }
    static func separateLifecycle(_ original: VocabularyEntry, batch: String) throws -> VocabularyEntry {
        var copy = original
        copy.id = try LegacyCodec.stableID("entry", [.string("ownership-entry-v1"), .string(batch), .string(original.id)])
        copy.aliases = Array(Set(original.aliases + [original.id])).sorted()
        copy.history = try original.history.map { event in
            var value = event; value.cloudPosition = nil
            value.id = try LegacyCodec.stableID("encounter", [.string("ownership-encounter-v1"), .string(batch), .string(original.id), .string(event.id)])
            value.legacyFields["originEncounterId"] = .string(event.id); return value
        }
        copy.reviewEvents = try original.reviewEvents.map { event in
            var value = event; value.originEventId = event.originEventId ?? event.id
            value.id = try LegacyCodec.stableID("review", [.string("ownership-review-v1"), .string(batch), .string(original.id), .string(event.id)])
            return value
        }
        return copy
    }
    public func copyConflictAsSeparateLifecycle(_ logicalId: String, expectedLocalVersion: Int) throws -> String {
        let owner = owner, batch = UUID().uuidString
        return try transaction { context in
            let meta = try Self.partition(context, owner), generation = Self.generation(meta)
            guard let conflict = try Self.syncValue(SyncConflict.self, id: "conflict:" + logicalId, context: context, owner: owner, generation: generation),
                  let row = try Self.row(context, "Entry", owner, generation, conflict.entryId) else { throw ClientError.invalidData("conflict copy missing") }
            let local = try Self.readEntry(row, context: context, includeHistory: true)
            guard local.version == expectedLocalVersion else { throw ClientError.stalePreview }
            var copy = try Self.separateLifecycle(local, batch: batch)
            copy.deleted = false; copy.version = 1; copy.reviewRevision = copy.review == nil ? 0 : 1
            if copy.review != nil { copy.review!.version = 1 }
            try Self.validate(copy); try Self.writeEntry(copy, context, owner, generation)
            for var intent in try Self.logicalOperations(context, owner: owner, generation: generation, entryId: local.id) where intent.state == "pending" || intent.state == "conflict" {
                intent.state = "discarded"; try Self.writeLogical(intent, context: context, generation: generation)
                if let record = try Self.row(context, "SyncRecord", owner, generation, "conflict:" + intent.id) { context.delete(record) }
            }
            if try Self.syncValue(APIEntry.self, id: "base:" + local.id, context: context, owner: owner, generation: generation) != nil {
                try Self.reproject(local.id, context: context, owner: owner, generation: generation)
            } else {
                context.delete(row)
                let history = NSFetchRequest<NSManagedObject>(entityName: "Encounter")
                history.predicate = NSPredicate(format: "owner == %@ AND generation == %@ AND entryID == %@", owner, generation, local.id)
                for record in try context.fetch(history) { context.delete(record) }
            }
            for operation in try Self.ownershipCreation(copy, owner: owner, batch: batch, duplicates: true) { try Self.enqueue(operation, context, generation) }
            Self.bump(meta); return copy.id
        }
    }
    static func ownershipHistory(_ current: [Encounter], incoming: [Encounter], entryId: String, existing: [String: [(String, String)]]) throws -> [Encounter] {
        var result = current, index = Dictionary(uniqueKeysWithValues: current.enumerated().map { ($0.element.id, $0.offset) })
        for event in incoming {
            guard !(existing[event.id] ?? []).contains(where: { $0.1 != entryId }) else { throw ClientError.conflict("An event already belongs to another lifecycle; preserve it through an explicit separate copy") }
            if let position = index[event.id] {
                guard result[position].timestamp == event.timestamp, result[position].definition == event.definition else { throw ClientError.conflict("Same event ID has different immutable history") }
                if result[position].context.isEmpty { result[position].context = event.context }
                if result[position].url.isEmpty { result[position].url = event.url }
            } else { index[event.id] = result.count; result.append(event) }
        }
        return result
    }
    static func bindingKey(_ owner: String, _ entry: String) -> String { "binding:" + LegacyCodec.digest(Data(owner.utf8)) + ":" + entry }
    static func publishOwnership(_ provenance: OwnershipProvenance, context: NSManagedObjectContext, owner: String, candidate: String) throws {
        let meta = try partition(context, owner), active = generation(meta)
        guard let configuration = try syncValue(SyncConfiguration.self, id: "configuration", context: context, owner: owner, generation: active),
              !configuration.enabled, configuration.phase == "ready", configuration.origin == provenance.origin,
              configuration.userId == provenance.userId, configuration.deviceId == provenance.deviceId, configuration.epoch == provenance.epoch else { throw ClientError.stalePreview }
        let source = try partition(context, "anonymous")
        guard generation(source) == provenance.sourceGeneration, source.value(forKey: "revision") as! Int64 == provenance.sourceRevision else { throw ClientError.stalePreview }
        // Reserving the source revision makes its optimistic lock part of the
        // same SQLite save as publication and ownership receipts.
        bump(source)
        for mapping in provenance.mappings {
            try writeSync(mapping, id: bindingKey(owner, mapping.localId), context: context, owner: "anonymous", generation: provenance.sourceGeneration)
            try writeSync(mapping, id: "association:" + mapping.localId, context: context, owner: owner, generation: candidate)
            try reproject(mapping.remoteId, context: context, owner: owner, generation: candidate)
        }
        for intent in try logicalOperations(context, owner: owner, generation: candidate).filter({ $0.state == "pending" && $0.kind == "review" }) {
            guard let eventId = intent.payload["id"]?.text, let at = intent.payload["answeredAtMs"]?.number else { throw ClientError.invalidData("owned review event") }
            let request = NSFetchRequest<NSManagedObject>(entityName: "ReviewAdmission")
            request.predicate = NSPredicate(format: "owner == %@ AND id == %@", "anonymous", eventId)
            guard try context.count(for: request) > 0 else { continue }
            request.predicate = NSPredicate(format: "owner == %@ AND id == %@", owner, eventId)
            if try context.count(for: request) == 0 {
                let admission = NSEntityDescription.insertNewObject(forEntityName: "ReviewAdmission", into: context)
                admission.setValue(owner, forKey: "owner"); admission.setValue(eventId, forKey: "id"); admission.setValue(intent.entryID, forKey: "entryID")
                admission.setValue(try ReviewDate.localDay(at, timeZoneID: configuration.timeZoneID ?? "UTC"), forKey: "day")
            }
        }
    }
}

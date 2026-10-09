import Foundation
@preconcurrency import CoreData

public extension Notification.Name {
    static let rememberMeVocabularyChanged = Notification.Name("RememberMeVocabularyChanged")
}

/// One actor owns one private context. Managed objects never leave performAndWait.
/// All owners and generations live in the same SQLite store to make publication atomic.
public actor LocalRepository {
    public nonisolated let owner: String
    public nonisolated let storageURL: URL
    let context: NSManagedObjectContext
    let coordinator: NSPersistentStoreCoordinator
    private let importPlanDirectory: URL
    private var importPlans: [String: ImportPreview] = [:]
    private var importOperations: [String: [String: [PendingOperation]]] = [:]
    private static let generationEntities = ["Entry", "Encounter", "Operation", "Source", "SyncRecord"]
    public enum Fault: Sendable { case none, invalidSave }

    public init(url: URL, owner: String = "anonymous") throws {
        self.owner = owner
        storageURL = url.standardizedFileURL
        importPlanDirectory = url.deletingLastPathComponent()
            .appendingPathComponent(url.lastPathComponent + "-import-plans")
            .appendingPathComponent(LegacyCodec.digest(Data(owner.utf8)))
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let destinationModel = StoreModelV4.make()
        try StoreMigration.prepare(url: url, destination: destinationModel)
        let coordinator = NSPersistentStoreCoordinator(managedObjectModel: destinationModel)
        try coordinator.addPersistentStore(ofType: NSSQLiteStoreType, configurationName: nil, at: url,
            options: [NSMigratePersistentStoresAutomaticallyOption: true, NSInferMappingModelAutomaticallyOption: true])
        self.coordinator = coordinator
        let context = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
        context.persistentStoreCoordinator = coordinator
        context.mergePolicy = NSErrorMergePolicy
        context.undoManager = nil
        self.context = context
        try context.performAndWait {
            if try Self.fetch(context, "Partition", owner: owner).isEmpty {
                let meta = NSEntityDescription.insertNewObject(forEntityName: "Partition", into: context)
                meta.setValue(owner, forKey: "owner"); meta.setValue(UUID().uuidString, forKey: "generation")
                meta.setValue(Int64(0), forKey: "revision"); try context.save()
            }
            // Optional query columns added in v2 are populated from preserved v1 payloads.
            let request = NSFetchRequest<NSManagedObject>(entityName: "Entry")
            request.predicate = NSPredicate(format: "createdAt == nil")
            let legacy = try context.fetch(request)
            for row in legacy {
                let value = try Self.decode(VocabularyEntry.self, row)
                row.setValue(value.createdAt, forKey: "createdAt")
                row.setValue(value.review?.dueAtMs, forKey: "reviewDueAt")
            }
            if context.hasChanges { try context.save() }
            let operationRequest = NSFetchRequest<NSManagedObject>(entityName: "Operation")
            operationRequest.predicate = NSPredicate(format: "owner == %@ AND sequence == nil", owner)
            let unsequenced = try context.fetch(operationRequest).map { ($0, try Self.decode(PendingOperation.self, $0)) }
                .sorted { left, right in
                    if left.1.baseVersion != right.1.baseVersion { return left.1.baseVersion < right.1.baseVersion }
                    let rank: (String) -> Int = { ["create", "legacySeed"].contains($0) ? 0 : 1 }
                    if rank(left.1.kind) != rank(right.1.kind) { return rank(left.1.kind) < rank(right.1.kind) }
                    return left.1.id < right.1.id
                }
            let meta = try Self.partition(context, owner)
            var next = (meta.value(forKey: "nextSequence") as? Int64) ?? 0
            for (row, var operation) in unsequenced {
                operation.sequence = next; next += 1
                row.setValue(operation.sequence, forKey: "sequence"); row.setValue(operation.entryID, forKey: "entryID")
                row.setValue(operation.state, forKey: "state"); row.setValue(try JSONValue.encoder().encode(operation), forKey: "payload")
            }
            meta.setValue(next, forKey: "nextSequence")
            if context.hasChanges { try context.save() }
            context.reset()
        }
    }

    public func close() throws {
        importPlans.removeAll()
        importOperations.removeAll()
        try context.performAndWait {
            context.reset()
            for store in coordinator.persistentStores { try coordinator.remove(store) }
        }
    }

    public func entries(search: String = "", sort: EntrySort = .count, limit: Int = 100, offset: Int = 0) throws -> [VocabularyEntry] {
        let owner = owner
        return try context.performAndWait {
            let meta = try Self.partition(context, owner)
            let request = NSFetchRequest<NSManagedObject>(entityName: "Entry")
            var predicates = [NSPredicate(format: "owner == %@ AND generation == %@ AND deleted == NO", owner, Self.generation(meta))]
            if !search.isEmpty { predicates.append(NSPredicate(format: "word CONTAINS[cd] %@", search)) }
            request.predicate = NSCompoundPredicate(andPredicateWithSubpredicates: predicates)
            request.sortDescriptors = sort == .count
                ? [NSSortDescriptor(key: "count", ascending: false), NSSortDescriptor(key: "id", ascending: true)]
                : [NSSortDescriptor(key: "updatedAt", ascending: false), NSSortDescriptor(key: "id", ascending: true)]
            request.fetchLimit = max(1, min(limit, 1000)); request.fetchOffset = max(0, offset)
            request.fetchBatchSize = 50
            return try context.fetch(request).map { try Self.readEntry($0, context: context, includeHistory: false) }
        }
    }

    public func entry(_ id: String, includeHistory: Bool = true) throws -> VocabularyEntry? {
        let owner = owner
        return try context.performAndWait {
            let meta = try Self.partition(context, owner)
            guard let row = try Self.row(context, "Entry", owner, Self.generation(meta), id) else { return nil }
            return try Self.readEntry(row, context: context, includeHistory: includeHistory)
        }
    }

    public func history(_ id: String, offset: Int = 0, limit: Int = 50) throws -> [Encounter] {
        let owner = owner
        return try context.performAndWait {
            let meta = try Self.partition(context, owner)
            let request = NSFetchRequest<NSManagedObject>(entityName: "Encounter")
            request.predicate = NSPredicate(format: "owner == %@ AND generation == %@ AND entryID == %@", owner, Self.generation(meta), id)
            request.sortDescriptors = [NSSortDescriptor(key: "position", ascending: false)]
            request.fetchOffset = max(0, offset); request.fetchLimit = max(1, min(limit, 50))
            return try context.fetch(request).map { try Self.decode(Encounter.self, $0) }
        }
    }

    public func historyCount(_ id: String) throws -> Int {
        let owner = owner
        return try context.performAndWait {
            let meta = try Self.partition(context, owner)
            let request = NSFetchRequest<NSManagedObject>(entityName: "Encounter")
            request.predicate = NSPredicate(format: "owner == %@ AND generation == %@ AND entryID == %@", owner, Self.generation(meta), id)
            return try context.count(for: request)
        }
    }

    /// Drain inbox drafts into the main app store before acknowledging the shared file.
    public func receiveCapture(_ draft: CaptureDraft) throws {
        try draft.validate()
        let owner = owner
        try transaction { context in
            let request = NSFetchRequest<NSManagedObject>(entityName: "Capture")
            request.predicate = NSPredicate(format: "owner == %@ AND id == %@", owner, draft.id); request.fetchLimit = 1
            if let existing = try context.fetch(request).first {
                guard try Self.decode(CaptureDraft.self, existing) == draft else { throw ClientError.conflict("capture ID reused") }; return
            }
            let capture = NSEntityDescription.insertNewObject(forEntityName: "Capture", into: context)
            capture.setValue(owner, forKey: "owner"); capture.setValue(draft.id, forKey: "id")
            capture.setValue("pending", forKey: "state"); capture.setValue(draft.createdAtMs, forKey: "createdAt")
            capture.setValue(try JSONValue.encoder().encode(draft), forKey: "payload")
        }
    }

    public func captureDrafts(limit: Int = 50) throws -> [CaptureDraft] {
        let owner = owner
        return try context.performAndWait {
            let request = NSFetchRequest<NSManagedObject>(entityName: "Capture")
            request.predicate = NSPredicate(format: "owner == %@ AND state == 'pending'", owner)
            request.sortDescriptors = [NSSortDescriptor(key: "createdAt", ascending: true), NSSortDescriptor(key: "id", ascending: true)]
            request.fetchLimit = max(1, min(limit, 100))
            return try context.fetch(request).map { try Self.decode(CaptureDraft.self, $0) }
        }
    }

    public func confirmCapture(_ draftID: String, word: String, definition: JSONValue, notes: String, kind: EntryKind) throws -> String {
        let owner = owner
        return try transaction { context in
            let request = NSFetchRequest<NSManagedObject>(entityName: "Capture")
            request.predicate = NSPredicate(format: "owner == %@ AND id == %@", owner, draftID); request.fetchLimit = 1
            guard let capture = try context.fetch(request).first else { throw ClientError.invalidData("capture missing") }
            let entryID = "capture-entry:" + draftID
            let requestDigest = LegacyCodec.digest(try JSONValue.encoder().encode(JSONValue.object([
                "word": .string(LegacyCodec.trim(word)), "definition": definition, "notes": .string(notes), "kind": .string(kind.rawValue)
            ])))
            if capture.value(forKey: "state") as? String == "confirmed" {
                let saved = try Self.decode(JSONValue.self, capture)
                guard saved["confirmationDigest"]?.text == requestDigest else { throw ClientError.conflict("capture confirmation ID reused with different content") }
                return entryID
            }
            guard capture.value(forKey: "state") as? String == "pending" else { throw ClientError.conflict("capture was dismissed") }
            let meta = try Self.partition(context, owner), generation = Self.generation(meta)
            var entry = VocabularyEntry(id: entryID, word: LegacyCodec.trim(word), kind: kind, definition: definition)
            entry.notes = notes; entry.captureOrigin = try Self.decode(CaptureDraft.self, capture)
            try Self.validate(entry)
            let peers = try Self.fetch(context, "Entry", owner: owner, generation: generation)
            guard !peers.contains(where: { ($0.value(forKey: "keyBytes") as? String) == LegacyCodec.keyBytes(entry.normalizedKey)
                && ($0.value(forKey: "deleted") as? Bool) == false }) else { throw ClientError.conflict("word already exists; edit the existing entry or choose a different draft word") }
            try Self.writeEntry(entry, context, owner, generation)
            try Self.enqueue(PendingOperation(id: "capture-confirm:" + draftID, owner: owner, entryID: entryID, kind: "create", baseVersion: 0,
                payload: try Self.json(entry)), context, generation)
            var saved = try Self.decode(JSONValue.self, capture).fields!
            saved["confirmationDigest"] = .string(requestDigest)
            capture.setValue(try JSONValue.encoder().encode(JSONValue.object(saved)), forKey: "payload")
            capture.setValue("confirmed", forKey: "state"); Self.bump(meta)
            return entryID
        }
    }

    public func dismissCapture(_ id: String) throws {
        let owner = owner
        try transaction { context in
            let request = NSFetchRequest<NSManagedObject>(entityName: "Capture")
            request.predicate = NSPredicate(format: "owner == %@ AND id == %@", owner, id); request.fetchLimit = 1
            guard let capture = try context.fetch(request).first else { return }
            if capture.value(forKey: "state") as? String == "pending" { capture.setValue("dismissed", forKey: "state") }
        }
    }

    public func create(_ entry: VocabularyEntry, fault: Fault = .none) throws {
        let owner = owner
        try transaction(fault: fault) { context in
            try Self.validate(entry)
            let meta = try Self.partition(context, owner)
            let generation = Self.generation(meta)
            guard try Self.row(context, "Entry", owner, generation, entry.id) == nil else { throw ClientError.conflict("entry ID") }
            let peers = try Self.fetch(context, "Entry", owner: owner, generation: generation)
            guard !peers.contains(where: { ($0.value(forKey: "keyBytes") as? String) == LegacyCodec.keyBytes(entry.normalizedKey)
                && ($0.value(forKey: "deleted") as? Bool) == false }) else { throw ClientError.conflict("word already exists") }
            try Self.writeEntry(entry, context, owner, generation)
            try Self.enqueue(PendingOperation(owner: owner, entryID: entry.id, kind: "create", baseVersion: 0,
                payload: try Self.json(entry)), context, generation)
            Self.bump(meta)
        }
    }

    public func record(_ id: String, context sentence: String, url: String, definition: JSONValue,
                       timestamp: Double, eventID: String = UUID().uuidString, fault: Fault = .none) throws -> VocabularyEntry {
        try mutate(id, fault: fault) { entry in
            if let previous = entry.history.first(where: { $0.id == eventID }) {
                guard previous.timestamp == timestamp, previous.context == sentence, previous.url == url,
                      previous.definition == definition else { throw ClientError.conflict("encounter ID reused") }
                return nil
            }
            guard timestamp.isFinite, timestamp >= 0, LegacyCodec.validDefinition(definition) else {
                throw ClientError.invalidData("encounter")
            }
            let current = entry.count ?? 0
            let count = current + 1
            guard count.isFinite, count > current else { throw ClientError.invalidNumber }
            let baseVersion = entry.version
            let event = Encounter(id: eventID, timestamp: timestamp, context: sentence, url: url, definition: definition)
            entry.count = count; entry.history.append(event); entry.updatedAt = timestamp; entry.version = try VersionToken.next(entry.version)
            return PendingOperation(id: eventID, owner: owner, entryID: id, kind: "record", baseVersion: baseVersion,
                payload: try Self.json(event))
        }
    }

    public func reset(_ id: String, timestamp: Double = Date().timeIntervalSince1970 * 1000) throws -> VocabularyEntry {
        try mutate(id) { entry in
            let base = entry.version
            entry.count = 0; entry.updatedAt = timestamp; entry.version = try VersionToken.next(entry.version)
            return PendingOperation(owner: owner, entryID: id, kind: "reset", baseVersion: base, payload: .object([:]))
        }
    }

    public func delete(_ id: String, timestamp: Double = Date().timeIntervalSince1970 * 1000) throws {
        _ = try mutate(id) { entry in
            let base = entry.version; entry.deleted = true; entry.updatedAt = timestamp; entry.version = try VersionToken.next(entry.version)
            return PendingOperation(owner: owner, entryID: id, kind: "delete", baseVersion: base, payload: .object([:]))
        }
    }

    public func update(_ id: String, expectedVersion: Int, definition: JSONValue, notes: String,
                       kind: EntryKind? = nil,
                       timestamp: Double = Date().timeIntervalSince1970 * 1000) throws -> VocabularyEntry {
        try mutate(id) { entry in
            guard entry.version == expectedVersion else { throw ClientError.conflict("entry changed") }
            guard LegacyCodec.validDefinition(definition) else { throw ClientError.invalidData("definition") }
            entry.definition = definition; entry.notes = notes; entry.updatedAt = timestamp; entry.version = try VersionToken.next(entry.version)
            if let kind { entry.kind = kind }
            return PendingOperation(owner: owner, entryID: id, kind: "edit", baseVersion: expectedVersion,
                payload: .object(["definition": definition, "notes": .string(notes), "kind": .string(entry.kind.rawValue)]))
        }
    }

    private func mutate(_ id: String, fault: Fault = .none,
                        change: @Sendable (inout VocabularyEntry) throws -> PendingOperation?) throws -> VocabularyEntry {
        let owner = owner
        return try transaction(fault: fault) { context in
            let meta = try Self.partition(context, owner)
            let generation = Self.generation(meta)
            guard let row = try Self.row(context, "Entry", owner, generation, id) else { throw ClientError.missingEntry }
            var entry = try Self.readEntry(row, context: context, includeHistory: true)
            guard !entry.deleted else { throw ClientError.missingEntry }
            if let operation = try change(&entry) {
                try Self.validate(entry)
                try Self.writeEntry(entry, context, owner, generation)
                try Self.enqueue(operation, context, generation); Self.bump(meta)
            }
            return entry
        }
    }

    public func pendingOperations() throws -> [PendingOperation] {
        let owner = owner
        return try context.performAndWait {
            let meta = try Self.partition(context, owner)
            return try Self.logicalOperations(context, owner: owner, generation: Self.generation(meta))
        }
    }

    public func reviewQueue(at timestamp: Double = Date().timeIntervalSince1970 * 1000,
                            timeZoneID: String = TimeZone.current.identifier, limit: Int = 50) throws -> ReviewQueue {
        let effectiveZone = try syncConfiguration()?.timeZoneID ?? timeZoneID
        let owner = owner, day = try ReviewDate.localDay(timestamp, timeZoneID: effectiveZone)
        return try context.performAndWait {
            let meta = try Self.partition(context, owner), generation = Self.generation(meta)
            let quota = try Self.effectiveAdmissionIds(context, owner: owner, generation: generation, day: day)
            let allowance = max(0, 20 - quota.count)
            let request = NSFetchRequest<NSManagedObject>(entityName: "Entry")
            request.predicate = NSPredicate(format: "owner == %@ AND generation == %@ AND deleted == NO AND reviewDueAt != nil AND reviewDueAt <= %lf", owner, generation, timestamp)
            let dueCount = try context.count(for: request)
            request.sortDescriptors = [NSSortDescriptor(key: "reviewDueAt", ascending: true), NSSortDescriptor(key: "id", ascending: true)]
            request.fetchLimit = max(1, min(limit, 100))
            var entries = try context.fetch(request).map { try Self.readEntry($0, context: context, includeHistory: false) }
            let capacity = max(0, min(limit, 100) - entries.count)
            if capacity > 0 && allowance > 0 {
                request.predicate = NSPredicate(format: "owner == %@ AND generation == %@ AND deleted == NO AND reviewDueAt == nil", owner, generation)
                request.sortDescriptors = [NSSortDescriptor(key: "createdAt", ascending: true), NSSortDescriptor(key: "id", ascending: true)]
                request.fetchLimit = min(capacity, allowance)
                entries += try context.fetch(request).map { try Self.readEntry($0, context: context, includeHistory: false) }
            }
            return ReviewQueue(entries: entries, remainingNewAllowance: allowance, dueCount: dueCount)
        }
    }

    public func answerReview(_ id: String, result: ReviewResult, expectedReviewVersion: Int,
                             timestamp: Double = Date().timeIntervalSince1970 * 1000,
                             timeZoneID: String = TimeZone.current.identifier, eventID: String = UUID().uuidString,
                             fault: Fault = .none) throws -> VocabularyEntry {
        let effectiveZone = try syncConfiguration()?.timeZoneID ?? timeZoneID
        let owner = owner, day = try ReviewDate.localDay(timestamp, timeZoneID: effectiveZone)
        return try transaction(fault: fault) { context in
            let meta = try Self.partition(context, owner), generation = Self.generation(meta)
            guard let row = try Self.row(context, "Entry", owner, generation, id) else { throw ClientError.missingEntry }
            var entry = try Self.readEntry(row, context: context, includeHistory: true)
            guard !entry.deleted else { throw ClientError.missingEntry }
            let event = ReviewEvent(id: eventID, result: result, answeredAtMs: timestamp, baseReviewVersion: expectedReviewVersion)
            if let existing = entry.reviewEvents.first(where: { $0.id == eventID }) {
                guard existing == event else { throw ClientError.conflict("review event ID reused") }; return entry
            }
            guard entry.effectiveReviewVersion == expectedReviewVersion else { throw ClientError.conflict("review changed; refresh the queue") }
            if let state = entry.review { guard state.dueAtMs <= timestamp else { throw ClientError.conflict("review not due") } }
            else {
                guard try Self.effectiveAdmissionIds(context, owner: owner, generation: generation, day: day).count < 20 else { throw ClientError.conflict("daily new-word limit reached") }
                let quota = NSEntityDescription.insertNewObject(forEntityName: "ReviewAdmission", into: context)
                quota.setValue(owner, forKey: "owner"); quota.setValue(day, forKey: "day")
                quota.setValue(eventID, forKey: "id"); quota.setValue(id, forKey: "entryID")
            }
            var next = try ReviewAlgorithm.next(entry.review, result: result, at: timestamp)
            next.version = try VersionToken.next(entry.effectiveReviewVersion)
            let baseVersion = entry.version
            entry.review = next; entry.reviewRevision = next.version; entry.reviewEvents.append(event); entry.version = try VersionToken.next(entry.version); entry.updatedAt = timestamp
            try Self.writeEntry(entry, context, owner, generation)
            var operation = PendingOperation(id: eventID, owner: owner, entryID: id, kind: "review",
                baseVersion: baseVersion, payload: try Self.json(event))
            operation.projectedReview = next
            try Self.enqueue(operation, context, generation)
            Self.bump(meta); return entry
        }
    }

    private static func admissions(_ context: NSManagedObjectContext, owner: String, day: String) throws -> [NSManagedObject] {
        let request = NSFetchRequest<NSManagedObject>(entityName: "ReviewAdmission")
        request.predicate = NSPredicate(format: "owner == %@ AND day == %@", owner, day)
        return try context.fetch(request)
    }
    private static func effectiveAdmissionIds(_ context: NSManagedObjectContext, owner: String, generation: String, day: String) throws -> Set<String> {
        var ids = Set(try admissions(context, owner: owner, day: day).compactMap { $0.value(forKey: "id") as? String })
        if let configuration = try syncValue(SyncConfiguration.self, id: "configuration", context: context, owner: owner, generation: generation),
           configuration.serverReviewDay == day { ids.formUnion(configuration.serverReviewAdmissionIds ?? []) }
        return ids
    }

    public func backup(timestamp: Double = Date().timeIntervalSince1970 * 1000) throws -> Backup {
        let owner = owner
        return try context.performAndWait {
            let meta = try Self.partition(context, owner)
            let generation = Self.generation(meta)
            let entries = try Self.fetch(context, "Entry", owner: owner, generation: generation).map {
                try Self.readEntry($0, context: context, includeHistory: true)
            }
            let sources = try Self.fetch(context, "Source", owner: owner, generation: generation).compactMap { $0.value(forKey: "id") as? String }
            return Backup(entries: entries, importSources: sources.sorted(), exportedAtMs: timestamp)
        }
    }

    public func previewLegacy(_ data: Data, mode: ImportMode) throws -> ImportPreview {
        context.performAndWait { context.reset() }
        guard mode == .firstMigration || mode == .legacyMerge else { throw ClientError.invalidData("legacy mode") }
        let batchID = UUID().uuidString
        let source = LegacyCodec.digest(data)
        let imported = try LegacyCodec.decode(data, batchID: mode == .legacyMerge ? batchID : nil)
        let owner = owner
        return try context.performAndWait {
            let meta = try Self.partition(context, owner)
            let generation = Self.generation(meta)
            let existingRequest = NSFetchRequest<NSManagedObject>(entityName: "Entry")
            existingRequest.predicate = NSPredicate(format: "owner == %@ AND generation == %@", owner, generation)
            let hasExistingEntries = try context.count(for: existingRequest) > 0
            let sources = try Self.fetch(context, "Source", owner: owner, generation: generation).compactMap { $0.value(forKey: "id") as? String }
            var preview = ImportPreview(id: batchID, mode: mode, revision: meta.value(forKey: "revision") as! Int64,
                owner: owner, entries: [], sources: [], conflicts: [], operations: [], alreadyImported: false, losses: [])
            if mode == .firstMigration && sources.contains(source) { preview.alreadyImported = true; return preview }
            for incoming in imported {
                var result = incoming
                let request = NSFetchRequest<NSManagedObject>(entityName: "Entry")
                request.predicate = NSPredicate(format: "owner == %@ AND generation == %@ AND keyBytes == %@ AND deleted == NO",
                    owner, generation, LegacyCodec.keyBytes(incoming.normalizedKey))
                request.fetchLimit = 2
                let matches = hasExistingEntries ? try context.fetch(request) : []
                guard matches.count <= 1 else { throw ClientError.conflict("multiple entries need source resolution") }
                let peer = try matches.first.map { try Self.readEntry($0, context: context, includeHistory: mode == .legacyMerge) }
                if let peer {
                    if mode == .firstMigration {
                        preview.conflicts.append(RestoreConflict(id: incoming.id, reason: "Different source for \(incoming.word)", canUseBackup: false))
                        continue
                    }
                    let count = (peer.count ?? 0) + incoming.count!
                    guard count.isFinite else { throw ClientError.invalidNumber }
                    result = peer; result.count = count
                    result.history = LegacyCodec.stableHistorySort(peer.history + incoming.history)
                    result.updatedAt = Date().timeIntervalSince1970 * 1000; result.version = try VersionToken.next(result.version)
                    // Current definition follows retained history, matching existing import behavior.
                    result.definition = result.history.last?.definition ?? result.definition
                }
                if hasExistingEntries, let row = try Self.row(context, "Entry", owner, generation, result.id), row.value(forKey: "deleted") as? Bool == true {
                    preview.conflicts.append(RestoreConflict(id: result.id, reason: "Entry was deleted", canUseBackup: false)); continue
                }
                preview.entries.append(result)
                let operationID = mode == .firstMigration
                    ? try LegacyCodec.stableID("seed", [.string("legacy-seed-v1"), .string(source), .string(incoming.normalizedKey)])
                    : batchID + ":" + incoming.id
                var seed = incoming
                seed.history = seed.history.map { event in var event = event; event.context = ""; event.url = ""; event.legacyFields = [:]; return event }
                seed.legacyFields = [:]
                var payload = try Self.json(seed)
                if mode == .legacyMerge, peer != nil, var fields = payload.fields {
                    fields["resultDefinition"] = result.definition; payload = .object(fields)
                }
                preview.operations.append(PendingOperation(id: operationID, owner: owner, entryID: result.id,
                    kind: mode == .firstMigration ? "legacySeed" : "legacyMerge", baseVersion: peer?.version ?? 0, payload: payload))
            }
            preview.sources = mode == .firstMigration ? [source] : []
            return preview
        }
    }

    public func previewBackup(_ data: Data, mode: ImportMode,
                              choices: [String: RestoreChoice] = [:]) throws -> ImportPreview {
        context.performAndWait { context.reset() }
        guard owner == "anonymous" else { throw ClientError.accountRequired }
        guard mode == .restoreMerge || mode == .replaceAnonymous else { throw ClientError.invalidData("backup mode") }
        let incoming = try BackupCodec.decode(data)
        let owner = owner
        return try context.performAndWait {
            let meta = try Self.partition(context, owner)
            let current = try Self.fetch(context, "Entry", owner: owner, generation: Self.generation(meta)).map {
                try Self.readEntry($0, context: context, includeHistory: true)
            }
            let result: RestorePlanner.Result
            if mode == .replaceAnonymous {
                let entries = try (incoming.entries + incoming.tombstones).map { item in
                    var restored = item
                    if let existing = current.first(where: { $0.id == item.id }) {
                        restored.version = try VersionToken.next(existing.version)
                        restored.reviewRevision = try VersionToken.next(existing.effectiveReviewVersion)
                        if restored.review != nil { restored.review!.version = restored.reviewRevision! }
                    } else {
                        restored.version = 0; restored.reviewRevision = restored.review == nil ? nil : 1
                        if restored.review != nil { restored.review!.version = 1 }
                    }
                    return restored
                }
                result = RestorePlanner.Result(entries: entries, conflicts: [])
            } else { result = try RestorePlanner.merge(current: current, backup: incoming, choices: choices) }
            let operations = try result.entries.map { entry in
                var projection = entry; projection.legacyFields = [:]; projection.captureOrigin = nil
                projection.history = projection.history.map { var event = $0; event.context = ""; event.url = ""; event.legacyFields = [:]; return event }
                return PendingOperation(owner: owner, entryID: entry.id, kind: "restore",
                    baseVersion: current.first(where: { $0.id == entry.id })?.version ?? 0, payload: try Self.json(projection))
            }
            return ImportPreview(id: UUID().uuidString, mode: mode, revision: meta.value(forKey: "revision") as! Int64,
                owner: owner, entries: result.entries, sources: incoming.importSources, conflicts: result.conflicts,
                operations: operations, alreadyImported: false, losses: [])
        }
    }

    /// Persist the confirmed plan before creating its private candidate generation.
    public func begin(_ preview: ImportPreview) throws {
        if preview.mode == .bindAnonymous && preview.ownership == nil { throw ClientError.invalidData("ownership provenance missing") }
        if preview.mode == .reconcileEpoch && (preview.epochRecovery == nil || preview.remoteBases == nil) { throw ClientError.invalidData("epoch recovery provenance missing") }
        if preview.mode == .restoreAccount && (preview.accountRestore == nil || preview.remoteBases == nil) { throw ClientError.conflict("Account backup restore needs a fresh online preview before confirmation") }
        guard preview.owner == owner, preview.conflicts.isEmpty, !preview.alreadyImported else {
            if preview.alreadyImported { return }
            throw ClientError.conflict("import preview")
        }
        let existingState = try? batchState(preview.id)
        if let existingState {
            guard ["copying", "staging", "ready"].contains(existingState), try frozenImportPlan(preview.id) == preview else {
                throw ClientError.conflict("batch already exists with a different plan or state")
            }
            return
        }
        let saved = try ImportPlanFiles.save(preview, directory: importPlanDirectory)
        let owner = owner
        do {
            try transaction { context in
                let meta = try Self.partition(context, owner)
                guard preview.revision == meta.value(forKey: "revision") as! Int64 else { throw ClientError.stalePreview }
                if preview.mode == .replaceAnonymous && owner != "anonymous" { throw ClientError.accountRequired }
                if let existing = try Self.findBatch(context, owner, preview.id) {
                    guard let manifest = try Self.manifest(existing), manifest.planDigest == saved.digest,
                          ["copying", "staging", "ready"].contains(existing.value(forKey: "state") as! String) else {
                        throw ClientError.conflict("batch already exists")
                    }
                    return
                }
                let sourceGeneration = Self.generation(meta)
                var copyTotal = 0
                if ![.replaceAnonymous, .reconcileEpoch].contains(preview.mode) {
                    for entity in Self.generationEntities {
                        let request = NSFetchRequest<NSManagedObject>(entityName: entity)
                        request.predicate = NSPredicate(format: "owner == %@ AND generation == %@", owner, sourceGeneration)
                        copyTotal += try context.count(for: request)
                    }
                }
                var manifest = ImportJobManifest(mode: preview.mode, sourceGeneration: sourceGeneration, sources: preview.sources,
                    planDigest: saved.digest, planBytes: saved.bytes, createdAtMs: Date().timeIntervalSince1970 * 1000,
                    copyEntityIndex: [.replaceAnonymous, .reconcileEpoch].contains(preview.mode) ? Self.generationEntities.count : 0,
                    copyOffset: 0, copied: 0, copyTotal: copyTotal)
                manifest.planFormat = saved.format
                let batch = NSEntityDescription.insertNewObject(forEntityName: "Batch", into: context)
                batch.setValue(owner, forKey: "owner"); batch.setValue(preview.id, forKey: "id")
                batch.setValue(UUID().uuidString, forKey: "generation"); batch.setValue(preview.revision, forKey: "revision")
                batch.setValue(copyTotal == 0 ? "staging" : "copying", forKey: "state"); batch.setValue(0, forKey: "progress")
                batch.setValue(preview.entries.count, forKey: "total")
                batch.setValue(try JSONValue.encoder().encode(manifest), forKey: "payload")
            }
            importPlans[preview.id] = preview
            importOperations[preview.id] = Dictionary(grouping: preview.operations, by: \.entryID)
        } catch {
            let hasBatch = (try? context.performAndWait { try Self.findBatch(context, owner, preview.id) != nil }) ?? true
            if saved.created && !hasBatch { try? ImportPlanFiles.remove(importPlanDirectory, id: preview.id) }
            throw error
        }
    }

    /// Cursor and cloned rows commit together; a failed chunk can safely retry.
    @discardableResult public func copyImportChunk(_ id: String, limit: Int = 250, fault: Fault = .none) throws -> ImportRecovery {
        let owner = owner
        try transaction(fault: fault) { context in
            let batch = try Self.batch(context, owner, id)
            if batch.value(forKey: "state") as? String != "copying" { return }
            let meta = try Self.partition(context, owner)
            guard batch.value(forKey: "revision") as! Int64 == meta.value(forKey: "revision") as! Int64,
                  var manifest = try Self.manifest(batch), manifest.sourceGeneration == Self.generation(meta) else { throw ClientError.stalePreview }
            let maximum = max(1, min(limit, 500))
            guard (0...Self.generationEntities.count).contains(manifest.copyEntityIndex), manifest.copyOffset >= 0 else {
                throw ClientError.invalidData("import copy cursor")
            }
            while manifest.copyEntityIndex < Self.generationEntities.count {
                let entity = Self.generationEntities[manifest.copyEntityIndex]
                let request = NSFetchRequest<NSManagedObject>(entityName: entity)
                request.predicate = NSPredicate(format: "owner == %@ AND generation == %@", owner, manifest.sourceGeneration)
                request.sortDescriptors = [NSSortDescriptor(key: "id", ascending: true)]
                request.fetchLimit = maximum; request.fetchOffset = manifest.copyOffset
                let originals = try context.fetch(request)
                for original in originals {
                    let copy = NSEntityDescription.insertNewObject(forEntityName: entity, into: context)
                    for key in original.entity.attributesByName.keys { copy.setValue(original.value(forKey: key), forKey: key) }
                    copy.setValue(Self.generation(batch), forKey: "generation")
                }
                manifest.copyOffset += originals.count; manifest.copied += originals.count
                if originals.count < maximum { manifest.copyEntityIndex += 1; manifest.copyOffset = 0 }
                if !originals.isEmpty { break }
            }
            if manifest.copyEntityIndex == Self.generationEntities.count { batch.setValue("staging", forKey: "state") }
            batch.setValue(try JSONValue.encoder().encode(manifest), forKey: "payload")
        }
        return try importRecovery(id)
    }

    public func stage(_ preview: ImportPreview, start: Int, limit: Int = 50, fault: Fault = .none) async throws {
        // Preserve the original API for probes/callers, while allowing UI code to
        // drive copy chunks explicitly and show progress before entry staging.
        while try batchState(preview.id) == "copying" {
            try Task.checkCancellation(); try copyImportChunk(preview.id); await Task.yield()
        }
        let frozen = try frozenImportPlan(preview.id)
        guard preview.owner == frozen.owner, preview.mode == frozen.mode, preview.revision == frozen.revision,
              preview.sources == frozen.sources, preview.ownership == frozen.ownership, preview.epochRecovery == frozen.epochRecovery,
              preview.accountRestore == frozen.accountRestore, preview.remoteBases == frozen.remoteBases, preview.entries.count == frozen.entries.count else {
            throw ClientError.conflict("confirmed import plan changed")
        }
        guard preview.operations.count == frozen.operations.count else { throw ClientError.conflict("confirmed import operations changed") }
        let suppliedOperations = Dictionary(grouping: preview.operations, by: \.entryID)
        let operationsByEntry = importOperations[preview.id] ?? [:]
        let owner = owner
        try transaction(fault: fault) { context in
            let batch = try Self.batch(context, owner, preview.id)
            let meta = try Self.partition(context, owner)
            guard batch.value(forKey: "revision") as! Int64 == meta.value(forKey: "revision") as! Int64 else { throw ClientError.stalePreview }
            guard batch.value(forKey: "state") as? String == "staging",
                  start == batch.value(forKey: "progress") as! Int64 else { throw ClientError.conflict("batch progress") }
            guard start >= 0, start <= frozen.entries.count else { throw ClientError.invalidData("batch range") }
            let end = min(start + max(1, min(limit, 500)), frozen.entries.count)
            guard Array(preview.entries[start..<end]) == Array(frozen.entries[start..<end]) else {
                throw ClientError.conflict("confirmed import entries changed")
            }
            let generation = Self.generation(batch)
            if let recovery = frozen.epochRecovery {
                try Self.writeSync(recovery.configuration, id: "configuration", context: context, owner: owner, generation: generation)
            }
            for entry in frozen.entries[start..<end] {
                let operations = operationsByEntry[entry.id] ?? []
                guard (suppliedOperations[entry.id] ?? []) == operations else { throw ClientError.conflict("confirmed import operations changed") }
                try Self.validate(entry); try Self.writeEntry(entry, context, owner, generation)
                if frozen.epochRecovery != nil || frozen.accountRestore != nil { try Self.stageEpochEntry(entry, base: frozen.remoteBases?[entry.id], context: context, owner: owner, generation: generation) }
                for operation in operations { try Self.enqueue(operation, context, generation) }
            }
            batch.setValue(end, forKey: "progress")
            if end == frozen.entries.count {
                for source in frozen.sources {
                    if try Self.row(context, "Source", owner, generation, source) == nil {
                        let row = NSEntityDescription.insertNewObject(forEntityName: "Source", into: context)
                        row.setValue(owner, forKey: "owner"); row.setValue(generation, forKey: "generation"); row.setValue(source, forKey: "id")
                    }
                }
                batch.setValue("ready", forKey: "state")
            }
        }
    }

    private func frozenImportPlan(_ id: String) throws -> ImportPreview {
        if let cached = importPlans[id] { return cached }
        let owner = owner
        let manifest = try context.performAndWait {
            guard let manifest = try Self.manifest(Self.batch(context, owner, id)) else {
                throw ClientError.invalidData("this older import needs a new source preview")
            }
            return manifest
        }
        let preview = try ImportPlanFiles.load(importPlanDirectory, id: id, manifest: manifest)
        guard preview.owner == owner else { throw ClientError.invalidData("import ownership") }
        importPlans[id] = preview
        importOperations[id] = Dictionary(grouping: preview.operations, by: \.entryID)
        return preview
    }

    public func publish(_ batchID: String, fault: Fault = .none) throws {
        if try batchState(batchID) == "published" { return }
        let owner = owner
        let ownership: OwnershipProvenance?
        let epochRecovery: EpochRecoveryProvenance?
        let accountRestore: AccountRestoreProvenance?
        if let manifest = try context.performAndWait({ try Self.manifest(Self.batch(context, owner, batchID)) }), manifest.mode == .bindAnonymous {
            ownership = try frozenImportPlan(batchID).ownership
        } else { ownership = nil }
        if let manifest = try context.performAndWait({ try Self.manifest(Self.batch(context, owner, batchID)) }), manifest.mode == .reconcileEpoch {
            epochRecovery = try frozenImportPlan(batchID).epochRecovery
        } else { epochRecovery = nil }
        if let manifest = try context.performAndWait({ try Self.manifest(Self.batch(context, owner, batchID)) }), manifest.mode == .restoreAccount {
            accountRestore = try frozenImportPlan(batchID).accountRestore
        } else { accountRestore = nil }
        try transaction(fault: fault) { context in
            let batch = try Self.batch(context, owner, batchID)
            if batch.value(forKey: "state") as? String == "published" { return }
            guard batch.value(forKey: "state") as? String == "ready" else { throw ClientError.conflict("batch not ready") }
            let meta = try Self.partition(context, owner)
            guard batch.value(forKey: "revision") as! Int64 == meta.value(forKey: "revision") as! Int64 else { throw ClientError.stalePreview }
            if let ownership { try Self.publishOwnership(ownership, context: context, owner: owner, candidate: Self.generation(batch)) }
            if let epochRecovery { try Self.publishEpochRecovery(epochRecovery, context: context, owner: owner, candidate: Self.generation(batch)) }
            if let accountRestore { try Self.publishAccountRestore(accountRestore, batchId: batchID, context: context, owner: owner, candidate: Self.generation(batch)) }
            // Previous generation remains available for recovery. Cleanup never reverts a publication.
            meta.setValue(Self.generation(batch), forKey: "generation"); Self.bump(meta)
            batch.setValue("published", forKey: "state")
        }
        importPlans[batchID] = nil
        importOperations[batchID] = nil
        try? ImportPlanFiles.remove(importPlanDirectory, id: batchID)
    }

    public func cancel(_ batchID: String) async throws {
        let owner = owner
        try transaction { context in
            let batch = try Self.batch(context, owner, batchID)
            guard batch.value(forKey: "state") as? String != "published" else { throw ClientError.conflict("batch already published") }
            batch.setValue("cancelled", forKey: "state")
        }
        importPlans[batchID] = nil
        importOperations[batchID] = nil
        for entity in Self.generationEntities {
            while true {
                try Task.checkCancellation()
                let deleted = try transaction { context in
                    let batch = try Self.batch(context, owner, batchID)
                    let meta = try Self.partition(context, owner)
                    guard batch.value(forKey: "state") as? String == "cancelled",
                          Self.generation(batch) != Self.generation(meta) else { throw ClientError.conflict("cannot clean an active import") }
                    let request = NSFetchRequest<NSManagedObject>(entityName: entity)
                    request.predicate = NSPredicate(format: "owner == %@ AND generation == %@", owner, Self.generation(batch))
                    request.fetchLimit = 250
                    let rows = try context.fetch(request)
                    for row in rows { context.delete(row) }
                    return rows.count
                }
                if deleted == 0 { break }
                await Task.yield()
            }
        }
        try ImportPlanFiles.remove(importPlanDirectory, id: batchID)
        try transaction { context in
            let batch = try Self.batch(context, owner, batchID)
            if var manifest = try? Self.manifest(batch) {
                manifest.cleanupComplete = true
                batch.setValue(try JSONValue.encoder().encode(manifest), forKey: "payload")
            } else {
                // A discarded/corrupt receipt no longer needs a resumable plan.
                // All candidate rows and its file were removed before this save.
                batch.setValue(try JSONValue.encoder().encode([String]()), forKey: "payload")
            }
        }
    }

    public func recoverableImports() throws -> [ImportRecovery] {
        let owner = owner
        return try context.performAndWait {
            let meta = try Self.partition(context, owner)
            var result: [ImportRecovery] = []
            for batch in try Self.fetch(context, "Batch", owner: owner) {
                let state = batch.value(forKey: "state") as! String
                guard ["copying", "staging", "ready", "cancelled"].contains(state) else { continue }
                let manifest = try? Self.manifest(batch)
                if state == "cancelled" {
                    if manifest?.cleanupComplete == true { continue }
                    // Earlier cancelled batches had already removed their rows in
                    // one save and do not need to be shown as interrupted work.
                    if manifest == nil, (try? JSONDecoder().decode([String].self, from: batch.value(forKey: "payload") as! Data)) != nil { continue }
                }
                result.append(Self.recovery(batch, meta: meta, directory: importPlanDirectory))
            }
            return result.sorted { ($0.createdAtMs ?? 0) > ($1.createdAtMs ?? 0) }
        }
    }

    public func importRecovery(_ id: String) throws -> ImportRecovery {
        let owner = owner
        return try context.performAndWait {
            Self.recovery(try Self.batch(context, owner, id), meta: try Self.partition(context, owner), directory: importPlanDirectory)
        }
    }

    public func loadImportPlan(_ id: String) throws -> ImportPreview { try frozenImportPlan(id) }

    /// Resumes the original frozen plan and IDs. Never re-runs the merge preview
    /// against changed data or auto-publishes an interrupted batch on startup.
    public func resumeImport(_ id: String, chunkSize: Int = 50) async throws {
        try await stageImportToReady(id, chunkSize: chunkSize)
        try Task.checkCancellation(); try publish(id)
    }

    public func stageImportToReady(_ id: String, chunkSize: Int = 50) async throws {
        var progress = try importRecovery(id)
        guard progress.canResume else { throw ClientError.stalePreview }
        if progress.state == "ready" { return }
        let preview = try frozenImportPlan(id)
        while progress.state == "copying" {
            try Task.checkCancellation(); progress = try copyImportChunk(id); await Task.yield()
        }
        while progress.state == "staging" {
            try Task.checkCancellation()
            try await stage(preview, start: progress.processed, limit: chunkSize)
            progress = try importRecovery(id); await Task.yield()
        }
        try Task.checkCancellation()
    }

    /// Keep the active state, the latest pre-publication recovery point, and all
    /// in-flight sources/candidates. Recalculate protection in every chunk so a
    /// concurrent publication cannot make a generation eligible accidentally.
    public func pruneImportGenerations(chunkSize: Int = 250) async throws -> ImportPruneResult {
        let owner = owner
        var removed = 0, retainedLegacy = false
        for entity in Self.generationEntities {
            while true {
                try Task.checkCancellation()
                let result = try transaction { context -> (Int, Bool) in
                    let meta = try Self.partition(context, owner)
                    let batches = try Self.fetch(context, "Batch", owner: owner)
                    var protected = Set([Self.generation(meta)])
                    let published = batches.filter { $0.value(forKey: "state") as? String == "published" }
                    if let latest = published.max(by: { ($0.value(forKey: "revision") as! Int64) < ($1.value(forKey: "revision") as! Int64) }) {
                        guard let manifest = try Self.manifest(latest) else { return (0, true) }
                        protected.insert(manifest.sourceGeneration)
                    }
                    for batch in batches where ["copying", "staging", "ready"].contains(batch.value(forKey: "state") as! String) {
                        protected.insert(Self.generation(batch))
                        if let manifest = try Self.manifest(batch) { protected.insert(manifest.sourceGeneration) }
                    }
                    let request = NSFetchRequest<NSManagedObject>(entityName: entity)
                    request.predicate = NSPredicate(format: "owner == %@ AND NOT (generation IN %@)", owner, Array(protected))
                    request.fetchLimit = max(1, min(chunkSize, 500))
                    let rows = try context.fetch(request)
                    for row in rows { context.delete(row) }
                    return (rows.count, false)
                }
                removed += result.0; retainedLegacy = retainedLegacy || result.1
                if result.0 == 0 { break }
                await Task.yield()
            }
        }
        // Published receipts survive pruning for idempotence; their private
        // input files can be removed once no resumption is possible.
        let finishedIDs = try context.performAndWait {
            try Self.fetch(context, "Batch", owner: owner).filter { $0.value(forKey: "state") as? String == "published" }
                .compactMap { $0.value(forKey: "id") as? String }
        }
        for id in finishedIDs { try? ImportPlanFiles.remove(importPlanDirectory, id: id) }
        return ImportPruneResult(removedRows: removed, retainedLegacyGenerations: retainedLegacy)
    }

    private static func recovery(_ batch: NSManagedObject, meta: NSManagedObject, directory: URL) -> ImportRecovery {
        let id = batch.value(forKey: "id") as! String, state = batch.value(forKey: "state") as! String
        let manifest = try? manifest(batch)
        let unchanged = batch.value(forKey: "revision") as! Int64 == meta.value(forKey: "revision") as! Int64
        let file = try? ImportPlanFiles.file(directory, id: id)
        let hasPlan = file.map { FileManager.default.fileExists(atPath: $0.path) } ?? false
        let readable = manifest != nil && hasPlan
        let canResume = unchanged && (state == "ready" || (readable && ["copying", "staging"].contains(state)))
        let explanation: String?
        if state == "cancelled" { explanation = "Cancelled import needs its remaining temporary data cleaned up." }
        else if !unchanged { explanation = "Vocabulary changed since this preview. Discard the interrupted import and preview the source again." }
        else if state != "ready" && !readable { explanation = "The saved plan is unavailable. Discard this import and choose its source again." }
        else { explanation = nil }
        return ImportRecovery(id: id, state: state, mode: manifest?.mode,
            processed: Int(batch.value(forKey: "progress") as! Int64), total: Int(batch.value(forKey: "total") as! Int64),
            copied: manifest?.copied ?? 0, copyTotal: manifest?.copyTotal ?? 0, createdAtMs: manifest?.createdAtMs,
            canResume: canResume, explanation: explanation)
    }

    public func batchState(_ id: String) throws -> String {
        let owner = owner
        return try context.performAndWait { try Self.batch(context, owner, id).value(forKey: "state") as! String }
    }

    func transaction<T: Sendable>(fault: Fault = .none, _ body: @Sendable (NSManagedObjectContext) throws -> T) throws -> T {
        try context.performAndWait {
            context.reset()
            do {
                let before = try Self.partition(context, owner).value(forKey: "revision") as! Int64
                let result = try body(context)
                if fault == .invalidSave {
                    // A real Core Data validation error tests the save/rollback boundary.
                    let invalid = NSEntityDescription.insertNewObject(forEntityName: "Operation", into: context)
                    invalid.setValue(owner, forKey: "owner")
                }
                if context.hasChanges { try context.save() }
                let after = try Self.partition(context, owner).value(forKey: "revision") as! Int64
                context.reset()
                if before != after { NotificationCenter.default.post(name: .rememberMeVocabularyChanged, object: nil) }
                return result
            } catch { context.rollback(); context.reset(); throw error }
        }
    }

    static func validate(_ entry: VocabularyEntry) throws {
        try entry.captureOrigin?.validate()
        guard !LegacyCodec.normalize(entry.word).isEmpty, entry.createdAt.isFinite, entry.createdAt >= 0,
              entry.updatedAt.isFinite, entry.updatedAt >= 0, entry.count == nil || (entry.count!.isFinite && entry.count! >= 0),
              VersionToken.valid(entry.version), entry.reviewRevision == nil || VersionToken.valid(entry.reviewRevision!),
              LegacyCodec.keyBytes(entry.normalizedKey) == LegacyCodec.keyBytes(LegacyCodec.normalize(entry.word)),
              validHistory(entry.history), LegacyCodec.validDefinition(entry.definition) else { throw ClientError.invalidData("entry") }
    }
    private static func validHistory(_ history: [Encounter]) -> Bool {
        Set(history.map(\.id)).count == history.count && history.allSatisfy { $0.timestamp.isFinite && $0.timestamp >= 0 && LegacyCodec.validDefinition($0.definition) }
    }
    static func json<T: Encodable>(_ value: T) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: JSONValue.encoder().encode(value))
    }
    static func decode<T: Decodable>(_ type: T.Type, _ row: NSManagedObject) throws -> T {
        try JSONDecoder().decode(type, from: row.value(forKey: "payload") as! Data)
    }
    static func generation(_ row: NSManagedObject) -> String { row.value(forKey: "generation") as! String }
    static func bump(_ meta: NSManagedObject) { meta.setValue((meta.value(forKey: "revision") as! Int64) + 1, forKey: "revision") }
    static func fetch(_ context: NSManagedObjectContext, _ entity: String, owner: String, generation: String? = nil) throws -> [NSManagedObject] {
        let request = NSFetchRequest<NSManagedObject>(entityName: entity)
        request.predicate = generation.map { NSPredicate(format: "owner == %@ AND generation == %@", owner, $0) }
            ?? NSPredicate(format: "owner == %@", owner)
        request.fetchBatchSize = 50
        return try context.fetch(request)
    }
    static func row(_ context: NSManagedObjectContext, _ entity: String, _ owner: String, _ generation: String, _ id: String) throws -> NSManagedObject? {
        let request = NSFetchRequest<NSManagedObject>(entityName: entity)
        request.predicate = NSPredicate(format: "owner == %@ AND generation == %@ AND id == %@", owner, generation, id)
        request.fetchLimit = 1
        return try context.fetch(request).first
    }
    static func partition(_ context: NSManagedObjectContext, _ owner: String) throws -> NSManagedObject {
        guard let meta = try fetch(context, "Partition", owner: owner).first else { throw ClientError.invalidData("partition") }; return meta
    }
    private static func batch(_ context: NSManagedObjectContext, _ owner: String, _ id: String) throws -> NSManagedObject {
        guard let batch = try findBatch(context, owner, id) else {
            throw ClientError.invalidData("batch missing")
        }; return batch
    }
    private static func findBatch(_ context: NSManagedObjectContext, _ owner: String, _ id: String) throws -> NSManagedObject? {
        let request = NSFetchRequest<NSManagedObject>(entityName: "Batch")
        request.predicate = NSPredicate(format: "owner == %@ AND id == %@", owner, id); request.fetchLimit = 1
        return try context.fetch(request).first
    }
    private static func manifest(_ batch: NSManagedObject) throws -> ImportJobManifest? {
        let data = batch.value(forKey: "payload") as! Data
        // Only the previous array representation is a legacy manifest. A corrupt
        // new manifest is an error rather than a silent downgrade to legacy.
        if (try? JSONDecoder().decode([String].self, from: data)) != nil { return nil }
        let manifest = try JSONDecoder().decode(ImportJobManifest.self, from: data)
        guard manifest.version == 1 else { throw ClientError.unsupportedVersion }
        guard !manifest.sourceGeneration.isEmpty, manifest.planBytes > 0, manifest.createdAtMs.isFinite, manifest.createdAtMs >= 0,
              (0...generationEntities.count).contains(manifest.copyEntityIndex), manifest.copyOffset >= 0,
              manifest.copied >= 0, manifest.copyTotal >= 0, manifest.copied <= manifest.copyTotal,
              manifest.copyOffset <= manifest.copyTotal else { throw ClientError.invalidData("import manifest") }
        return manifest
    }
    static func writeEntry(_ value: VocabularyEntry, _ context: NSManagedObjectContext, _ owner: String, _ generation: String) throws {
        let row = try row(context, "Entry", owner, generation, value.id) ?? NSEntityDescription.insertNewObject(forEntityName: "Entry", into: context)
        row.setValue(owner, forKey: "owner"); row.setValue(generation, forKey: "generation"); row.setValue(value.id, forKey: "id")
        row.setValue(value.word, forKey: "word"); row.setValue(LegacyCodec.keyBytes(value.normalizedKey), forKey: "keyBytes")
        row.setValue(value.count, forKey: "count"); row.setValue(value.updatedAt, forKey: "updatedAt"); row.setValue(value.deleted, forKey: "deleted")
        row.setValue(value.createdAt, forKey: "createdAt"); row.setValue(value.review?.dueAtMs, forKey: "reviewDueAt")
        var summary = value; summary.history = []
        row.setValue(try JSONValue.encoder().encode(summary), forKey: "payload")
        let request = NSFetchRequest<NSManagedObject>(entityName: "Encounter")
        request.predicate = NSPredicate(format: "owner == %@ AND generation == %@ AND entryID == %@", owner, generation, value.id)
        var old = Dictionary(uniqueKeysWithValues: try context.fetch(request).map { ($0.value(forKey: "id") as! String, $0) })
        for (position, encounter) in value.history.enumerated() {
            let record = old.removeValue(forKey: encounter.id) ?? NSEntityDescription.insertNewObject(forEntityName: "Encounter", into: context)
            record.setValue(owner, forKey: "owner"); record.setValue(generation, forKey: "generation"); record.setValue(encounter.id, forKey: "id")
            record.setValue(value.id, forKey: "entryID"); record.setValue(position, forKey: "position")
            record.setValue(try JSONValue.encoder().encode(encounter), forKey: "payload")
        }
        for record in old.values { context.delete(record) }
    }
    static func readEntry(_ row: NSManagedObject, context: NSManagedObjectContext, includeHistory: Bool) throws -> VocabularyEntry {
        var result = try decode(VocabularyEntry.self, row)
        if includeHistory {
            let request = NSFetchRequest<NSManagedObject>(entityName: "Encounter")
            request.predicate = NSPredicate(format: "owner == %@ AND generation == %@ AND entryID == %@", row.value(forKey: "owner") as! String, generation(row), result.id)
            request.sortDescriptors = [NSSortDescriptor(key: "position", ascending: true)]
            result.history = try context.fetch(request).map { try decode(Encounter.self, $0) }
        }
        return result
    }
    static func enqueue(_ operation: PendingOperation, _ context: NSManagedObjectContext, _ generation: String) throws {
        if let old = try row(context, "Operation", operation.owner, generation, operation.id) {
            let prior = try decode(PendingOperation.self, old)
            guard prior.owner == operation.owner, prior.entryID == operation.entryID, prior.kind == operation.kind,
                  prior.payload == operation.payload, prior.baseVersion == operation.baseVersion else { throw ClientError.conflict("operation ID reused") }; return
        }
        var operation = operation
        let meta = try partition(context, operation.owner)
        if operation.sequence == nil {
            let sequence = (meta.value(forKey: "nextSequence") as? Int64) ?? 0
            guard sequence >= 0, sequence < Int64(VersionToken.maximum) else { throw ClientError.invalidData("operation sequence exhausted") }
            operation.sequence = sequence; meta.setValue(sequence + 1, forKey: "nextSequence")
        } else if let sequence = operation.sequence {
            guard sequence >= 0, sequence < Int64(VersionToken.maximum) else { throw ClientError.invalidData("operation sequence exhausted") }
            meta.setValue(max((meta.value(forKey: "nextSequence") as? Int64) ?? 0, sequence + 1), forKey: "nextSequence")
        }
        try assignSyncObservation(&operation, context: context, generation: generation)
        let row = NSEntityDescription.insertNewObject(forEntityName: "Operation", into: context)
        row.setValue(operation.owner, forKey: "owner"); row.setValue(generation, forKey: "generation"); row.setValue(operation.id, forKey: "id")
        row.setValue(try JSONValue.encoder().encode(operation), forKey: "payload")
        row.setValue(operation.sequence, forKey: "sequence"); row.setValue(operation.entryID, forKey: "entryID"); row.setValue(operation.state, forKey: "state")
    }
}

enum StoreModelV4 {
    static func make() -> NSManagedObjectModel {
        let model = StoreModelV3.make(); model.versionIdentifiers = ["RememberMeStore-v4"]
        let operation = model.entitiesByName["Operation"]!
        for name in ["sequence", "entryID", "state"] {
            let property = NSAttributeDescription(); property.name = name; property.isOptional = true
            property.attributeType = name == "sequence" ? .integer64AttributeType : .stringAttributeType
            operation.properties.append(property)
        }
        let partition = model.entitiesByName["Partition"]!
        let sequence = NSAttributeDescription(); sequence.name = "nextSequence"; sequence.attributeType = .integer64AttributeType; sequence.isOptional = true
        partition.properties.append(sequence)
        let sync = NSEntityDescription(); sync.name = "SyncRecord"; sync.managedObjectClassName = "NSManagedObject"
        sync.properties = ["owner", "generation", "id", "payload"].map { name in
            let property = NSAttributeDescription(); property.name = name; property.attributeType = name == "payload" ? .binaryDataAttributeType : .stringAttributeType
            property.isOptional = false; return property
        }
        sync.uniquenessConstraints = [["owner", "generation", "id"]]
        model.entities.append(sync)
        operation.indexes = [NSFetchIndexDescription(name: "OperationSequenceIndex", elements: ["owner", "generation", "entryID", "state", "sequence"].map {
            NSFetchIndexElementDescription(property: operation.attributesByName[$0]!, collationType: .binary)
        })]
        return model
    }
}

enum StoreModelV2 {
    static func make() -> NSManagedObjectModel {
        let model = StoreModelV1.make()
        model.versionIdentifiers = ["RememberMeStore-v2"]
        let entry = model.entitiesByName["Entry"]!
        let created = NSAttributeDescription(); created.name = "createdAt"; created.attributeType = .doubleAttributeType; created.isOptional = true
        let due = NSAttributeDescription(); due.name = "reviewDueAt"; due.attributeType = .doubleAttributeType; due.isOptional = true
        entry.properties += [created, due]
        entry.indexes = [("EntryReviewQueryIndex", ["owner", "generation", "deleted", "reviewDueAt", "createdAt"]),
                         ("EntryQueryIndex", ["owner", "generation", "deleted", "count"])].map { name, keys in
            NSFetchIndexDescription(name: name, elements: keys.map {
                NSFetchIndexElementDescription(property: entry.attributesByName[$0]!, collationType: .binary)
            })
        }
        let admission = NSEntityDescription(); admission.name = "ReviewAdmission"; admission.managedObjectClassName = "NSManagedObject"
        admission.properties = ["owner", "day", "id", "entryID"].map {
            let value = NSAttributeDescription(); value.name = $0; value.attributeType = .stringAttributeType; value.isOptional = false; return value
        }
        admission.uniquenessConstraints = [["owner", "id"]]
        admission.indexes = [NSFetchIndexDescription(name: "AdmissionDailyIndex", elements: ["owner", "day"].map {
            NSFetchIndexElementDescription(property: admission.attributesByName[$0]!, collationType: .binary)
        })]
        model.entities += [admission]
        return model
    }
}

enum StoreMigration {
    static func prepare(url: URL, destination: NSManagedObjectModel) throws {
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        let metadata = try NSPersistentStoreCoordinator.metadataForPersistentStore(ofType: NSSQLiteStoreType, at: url, options: nil)
        if destination.isConfiguration(withName: nil, compatibleWithStoreMetadata: metadata) { return }
        guard let source = [StoreModelV3.make(), StoreModelV2.make(), StoreModelV1.make()].first(where: {
            $0.isConfiguration(withName: nil, compatibleWithStoreMetadata: metadata)
        }) else {
            throw ClientError.invalidData("unsupported store version; original database retained")
        }
        // Migrate to a separate store, then ask Core Data to replace the destination.
        // Never remove the existing database to work around a migration failure.
        let folder = url.deletingLastPathComponent().appendingPathComponent("migration-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let migrated = folder.appendingPathComponent("store.sqlite")
        let mapping = try NSMappingModel.inferredMappingModel(forSourceModel: source, destinationModel: destination)
        let manager = NSMigrationManager(sourceModel: source, destinationModel: destination)
        try manager.migrateStore(from: url, sourceType: NSSQLiteStoreType, options: nil, with: mapping,
            toDestinationURL: migrated, destinationType: NSSQLiteStoreType, destinationOptions: nil)
        let replacement = NSPersistentStoreCoordinator(managedObjectModel: destination)
        // Keep a store-coherent v1 recovery copy alongside the user database.
        let recovery = url.deletingLastPathComponent().appendingPathComponent("pre-upgrade-recovery.sqlite")
        let backup = NSPersistentStoreCoordinator(managedObjectModel: source)
        try backup.replacePersistentStore(at: recovery, destinationOptions: nil, withPersistentStoreFrom: url,
            sourceOptions: nil, ofType: NSSQLiteStoreType)
        try replacement.replacePersistentStore(at: url, destinationOptions: nil, withPersistentStoreFrom: migrated,
            sourceOptions: nil, ofType: NSSQLiteStoreType)
    }
}

enum StoreModelV3 {
    static func make() -> NSManagedObjectModel {
        let model = StoreModelV2.make(); model.versionIdentifiers = ["RememberMeStore-v3"]
        let capture = NSEntityDescription(); capture.name = "Capture"; capture.managedObjectClassName = "NSManagedObject"
        capture.properties = ["owner", "id", "state", "createdAt", "payload"].map { name in
            let property = NSAttributeDescription(); property.name = name
            property.attributeType = name == "payload" ? .binaryDataAttributeType : name == "createdAt" ? .doubleAttributeType : .stringAttributeType
            property.isOptional = false; return property
        }
        capture.uniquenessConstraints = [["owner", "id"]]
        capture.indexes = [NSFetchIndexDescription(name: "CapturePendingIndex", elements: ["owner", "state", "createdAt"].map {
            NSFetchIndexElementDescription(property: capture.attributesByName[$0]!, collationType: .binary)
        })]
        model.entities += [capture]
        return model
    }
}

/// This version is checked in source. Change it through an explicit model migration,
/// never by deleting the user's store after a load failure.
enum StoreModelV1 {
    static func make() -> NSManagedObjectModel {
        let model = NSManagedObjectModel(); model.versionIdentifiers = ["RememberMeStore-v1"]
        func attribute(_ name: String, _ type: NSAttributeType, optional: Bool = false) -> NSAttributeDescription {
            let result = NSAttributeDescription(); result.name = name; result.attributeType = type; result.isOptional = optional
            return result
        }
        func entity(_ name: String, _ fields: [NSAttributeDescription], _ identity: [String]) -> NSEntityDescription {
            let result = NSEntityDescription(); result.name = name; result.managedObjectClassName = "NSManagedObject"
            result.properties = fields; result.uniquenessConstraints = [identity]; return result
        }
        func base() -> [NSAttributeDescription] { [attribute("owner", .stringAttributeType), attribute("generation", .stringAttributeType), attribute("id", .stringAttributeType)] }
        model.entities = [
            entity("Partition", [attribute("owner", .stringAttributeType), attribute("generation", .stringAttributeType), attribute("revision", .integer64AttributeType)], ["owner"]),
            entity("Entry", base() + [attribute("word", .stringAttributeType), attribute("keyBytes", .stringAttributeType), attribute("count", .doubleAttributeType, optional: true),
                attribute("updatedAt", .doubleAttributeType), attribute("deleted", .booleanAttributeType), attribute("payload", .binaryDataAttributeType)], ["owner", "generation", "id"]),
            entity("Encounter", base() + [attribute("entryID", .stringAttributeType), attribute("position", .integer64AttributeType), attribute("payload", .binaryDataAttributeType)], ["owner", "generation", "id"]),
            entity("Operation", base() + [attribute("payload", .binaryDataAttributeType)], ["owner", "generation", "id"]),
            entity("Source", base(), ["owner", "generation", "id"]),
            entity("Batch", base() + [attribute("revision", .integer64AttributeType), attribute("progress", .integer64AttributeType), attribute("total", .integer64AttributeType),
                attribute("state", .stringAttributeType), attribute("payload", .binaryDataAttributeType)], ["owner", "id"])
        ]
        // History predicates cannot use the (owner, generation, event ID) uniqueness
        // index efficiently. Without this index, staging scans all older histories.
        for (entityName, keys) in [("Encounter", ["owner", "generation", "entryID", "position"]),
                                   ("Entry", ["owner", "generation", "deleted", "count"])] {
            let entity = model.entitiesByName[entityName]!
            let elements = keys.map { NSFetchIndexElementDescription(property: entity.attributesByName[$0]!, collationType: .binary) }
            entity.indexes = [NSFetchIndexDescription(name: entityName + "QueryIndex", elements: elements)]
        }
        return model
    }
}

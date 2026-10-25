import Foundation
@preconcurrency import CoreData

extension LocalRepository {
    static func syncValue<T: Decodable>(_ type: T.Type, id: String, context: NSManagedObjectContext, owner: String, generation: String) throws -> T? {
        guard let record = try row(context, "SyncRecord", owner, generation, id) else { return nil }
        return try decode(type, record)
    }
    static func writeSync<T: Encodable>(_ value: T, id: String, context: NSManagedObjectContext, owner: String, generation: String) throws {
        let record = try row(context, "SyncRecord", owner, generation, id) ?? NSEntityDescription.insertNewObject(forEntityName: "SyncRecord", into: context)
        record.setValue(owner, forKey: "owner"); record.setValue(generation, forKey: "generation"); record.setValue(id, forKey: "id")
        record.setValue(try JSONValue.encoder().encode(value), forKey: "payload")
    }
    static func logicalOperations(_ context: NSManagedObjectContext, owner: String, generation: String, entryId: String? = nil) throws -> [PendingOperation] {
        let request = NSFetchRequest<NSManagedObject>(entityName: "Operation")
        request.predicate = entryId.map { NSPredicate(format: "owner == %@ AND generation == %@ AND entryID == %@", owner, generation, $0) }
            ?? NSPredicate(format: "owner == %@ AND generation == %@", owner, generation)
        request.sortDescriptors = [NSSortDescriptor(key: "sequence", ascending: true)]
        return try context.fetch(request).map { try decode(PendingOperation.self, $0) }
    }
    static func writeLogical(_ value: PendingOperation, context: NSManagedObjectContext, generation: String) throws {
        guard let record = try row(context, "Operation", value.owner, generation, value.id) else { throw ClientError.invalidData("logical operation missing") }
        record.setValue(value.state, forKey: "state"); record.setValue(value.sequence, forKey: "sequence"); record.setValue(value.entryID, forKey: "entryID")
        record.setValue(try JSONValue.encoder().encode(value), forKey: "payload")
    }
    static func predictedWrites(_ operation: PendingOperation) -> Int {
        if let count = operation.wireCount { return count }
        switch operation.kind {
        case "legacySeed", "create":
            let history = operation.payload["history"]?.items?.count ?? 0
            let review = operation.payload["review"]?.fields == nil ? 0 : 1
            return 1 + (history + 24) / 25 + review
        case "legacyMerge", "restore": return 1 + ((operation.payload["history"]?.items?.count ?? 0) + 24) / 25
        case "associateHistory": return ((operation.payload["history"]?.items?.count ?? 0) + 24) / 25
        default: return 1
        }
    }
    static func predictedReviewWrites(_ operation: PendingOperation) -> Int {
        if ["review", "restore"].contains(operation.kind) { return 1 }
        if ["create", "legacySeed"].contains(operation.kind), operation.payload["review"]?.fields != nil { return 1 }
        return 0
    }
    static func assignSyncObservation(_ operation: inout PendingOperation, context: NSManagedObjectContext, generation: String) throws {
        guard let configuration = try syncValue(SyncConfiguration.self, id: "configuration", context: context, owner: operation.owner, generation: generation) else { return }
        guard SyncConfiguration.owner(for: configuration.identity) == operation.owner else { throw ClientError.invalidData("sync owner") }
        if operation.wirePrivacy == nil {
            operation.wirePrivacy = configuration.privacy; operation.wireSourceRevision = configuration.sourceRevision ?? 0
        }
        let base = try syncValue(APIEntry.self, id: "base:" + operation.entryID, context: context, owner: operation.owner, generation: generation)
        let earlier = try logicalOperations(context, owner: operation.owner, generation: generation, entryId: operation.entryID)
            .filter { $0.state == "pending" || $0.state == "conflict" }
        operation.syncDependencyId = earlier.last?.id
        operation.observedVersionFloor = operation.observedVersionFloor ?? base?.version ?? 0
        operation.observedReviewVersionFloor = operation.observedReviewVersionFloor ?? base?.reviewVersion ?? 0
        if let previous = earlier.last, let observed = previous.observedRemoteVersion {
            operation.dependencyExpectedVersion = observed + predictedWrites(previous)
        }
        if let previous = earlier.last { operation.dependencyExpectedReviewVersion = (previous.observedReviewVersion ?? 0) + predictedReviewWrites(previous) }
        if operation.observedRemoteVersion == nil {
            if let previous = earlier.last, let observed = previous.observedRemoteVersion {
                let next = observed + predictedWrites(previous)
                guard VersionToken.valid(next) else { throw ClientError.invalidData("predicted server version") }
                operation.dependencyExpectedVersion = next
                operation.observedRemoteVersion = max(base?.version ?? 0, next)
            } else { operation.observedRemoteVersion = base?.version ?? 0 }
        }
        if operation.observedReviewVersion == nil {
            let expected = earlier.last.map { ($0.observedReviewVersion ?? 0) + predictedReviewWrites($0) }
            operation.dependencyExpectedReviewVersion = expected
            operation.observedReviewVersion = max(base?.reviewVersion ?? 0, expected ?? 0)
        }
    }

    public func syncConfiguration() throws -> SyncConfiguration? {
        let owner = owner
        return try context.performAndWait {
            let generation = Self.generation(try Self.partition(context, owner))
            return try Self.syncValue(SyncConfiguration.self, id: "configuration", context: context, owner: owner, generation: generation)
        }
    }
    public func configureSync(identity: ConnectedIdentity, enabled: Bool = false, privacy: SyncPrivacy = SyncPrivacy()) throws {
        guard owner == SyncConfiguration.owner(for: identity), (try? APIOrigin(identity.origin, allowLoopbackHTTP: true)) != nil else { throw ClientError.invalidData("account partition does not match API identity") }
        let owner = owner
        try transaction { context in
            let meta = try Self.partition(context, owner), generation = Self.generation(meta)
            var configuration = try Self.syncValue(SyncConfiguration.self, id: "configuration", context: context, owner: owner, generation: generation)
                ?? SyncConfiguration(identity: identity)
            guard configuration.origin == identity.origin, configuration.userId == identity.userId else { throw ClientError.invalidData("account ownership changed") }
            guard !enabled || configuration.pendingSourceRemoval == nil else { throw ClientError.conflict("Complete source removal before enabling sync") }
            configuration.deviceId = identity.deviceId; configuration.enabled = enabled; configuration.privacy = privacy
            try Self.writeSync(configuration, id: "configuration", context: context, owner: owner, generation: generation); Self.bump(meta)
        }
    }
    public func syncStatus() throws -> SyncStatus {
        let owner = owner
        return try context.performAndWait {
            let generation = Self.generation(try Self.partition(context, owner))
            let configuration = try Self.syncValue(SyncConfiguration.self, id: "configuration", context: context, owner: owner, generation: generation)
            func count(_ state: String) throws -> Int {
                let request = NSFetchRequest<NSFetchRequestResult>(entityName: "Operation")
                request.predicate = NSPredicate(format: "owner == %@ AND generation == %@ AND state == %@", owner, generation, state)
                return try context.count(for: request)
            }
            return try SyncStatus(pending: count("pending"), conflicts: count("conflict"), configuration: configuration)
        }
    }
    public func initializeSyncEpoch(_ account: APIAccountIdentity) throws {
        let owner = owner
        try transaction { context in
            let meta = try Self.partition(context, owner), generation = Self.generation(meta)
            guard var configuration = try Self.syncValue(SyncConfiguration.self, id: "configuration", context: context, owner: owner, generation: generation),
                  configuration.userId == account.userId, configuration.deviceId == account.deviceId, !account.epoch.isEmpty else { throw ClientError.invalidData("API account identity") }
            if let epoch = configuration.epoch, epoch != account.epoch {
                configuration.phase = "epochConflict"; configuration.enabled = false
                try Self.writeSync(configuration, id: "configuration", context: context, owner: owner, generation: generation); Self.bump(meta)
                return
            }
            guard account.sourceRevision == nil || VersionToken.valid(account.sourceRevision!) else { throw ClientError.invalidData("source revision") }
            try account.reminderDevice?.validate()
            configuration.reminderDevice = account.reminderDevice
            configuration.sourceRevision = account.sourceRevision
            configuration.privacy.context = configuration.privacy.context && account.syncContext
            configuration.privacy.urls = configuration.privacy.urls && account.syncURLs
            configuration.epoch = account.epoch
            configuration.timeZoneID = account.timezone
            configuration.capabilities = account.syncCapabilities
            configuration.displayName = account.displayName
            try Self.validateReviewAdmissions(account)
            configuration.serverReviewDay = account.reviewDay; configuration.serverReviewAdmissionIds = account.reviewAdmissionIds
            if configuration.phase == "initial" { configuration.phase = "snapshot"; configuration.snapshotCursor = 0; configuration.snapshotBoundary = nil }
            try Self.writeSync(configuration, id: "configuration", context: context, owner: owner, generation: generation); Self.bump(meta)
        }
    }
    public func remoteEntry(_ id: String) throws -> APIEntry? {
        let owner = owner
        return try context.performAndWait {
            let generation = Self.generation(try Self.partition(context, owner))
            return try Self.syncValue(APIEntry.self, id: "base:" + id, context: context, owner: owner, generation: generation)
        }
    }
    static func reproject(_ id: String, context: NSManagedObjectContext, owner: String, generation: String) throws {
        guard let base = try syncValue(APIEntry.self, id: "base:" + id, context: context, owner: owner, generation: generation) else { return }
        let localRow = try row(context, "Entry", owner, generation, id)
        let local = try localRow.map { try readEntry($0, context: context, includeHistory: true) }
        let operations = try logicalOperations(context, owner: owner, generation: generation, entryId: id).filter { $0.state == "pending" || $0.state == "conflict" }
        let remoteRequest = NSFetchRequest<NSManagedObject>(entityName: "SyncRecord")
        let prefix = "event:" + LegacyCodec.digest(Data(id.utf8)) + ":"
        remoteRequest.predicate = NSPredicate(format: "owner == %@ AND generation == %@ AND id BEGINSWITH %@", owner, generation, prefix)
        let known = Set(try context.fetch(remoteRequest).compactMap { $0.value(forKey: "id") as? String }.map { String($0.dropFirst(prefix.count)) })
        // A new remote count may already include a locally pending encounter.
        // Keep the prior visible projection until the durable history scan can
        // distinguish an acknowledged encounter from a genuinely unsent one.
        let history = try syncValue(SyncHistoryCheckpoint.self, id: "history:" + id, context: context, owner: owner, generation: generation)
        if local != nil, history?.complete == false, operations.contains(where: {
            $0.kind == "record" && !known.contains($0.payload["id"]?.text ?? "")
        }) { return }
        let applied = Set(try wireItems(context, owner: owner, generation: generation).filter {
            $0.entryId == id && $0.index == 0 && $0.status == "confirmed"
        }.map(\.logicalId))
        var projected = try SyncProjection.overlay(base, local: local, pending: operations, knownEvents: known, appliedFields: applied)
        projected.version = try VersionToken.next(local?.version ?? 0)
        projected.reviewRevision = try VersionToken.next(local?.effectiveReviewVersion ?? 0)
        if projected.review != nil { projected.review!.version = projected.reviewRevision! }
        try writeEntry(projected, context, owner, generation)
    }
    public func applySyncPage(_ page: SyncCheckpointPage, snapshot: Bool, histories: [String: [APIHistoryPage.Event]] = [:], fault: Fault = .none) throws {
        let owner = owner
        try transaction(fault: fault) { context in
            let meta = try Self.partition(context, owner), generation = Self.generation(meta)
            guard var configuration = try Self.syncValue(SyncConfiguration.self, id: "configuration", context: context, owner: owner, generation: generation),
                  configuration.epoch == page.epoch, configuration.phase != "epochConflict" else { throw ClientError.conflict("sync epoch requires reconciliation") }
            let cursor = snapshot ? configuration.snapshotCursor : configuration.cursor
            try page.validate(after: cursor)
            if snapshot, let boundary = configuration.snapshotBoundary, boundary != page.boundary { throw ClientError.invalidData("snapshot boundary changed") }
            if !snapshot, let boundary = configuration.pullBoundary, boundary != page.boundary { throw ClientError.invalidData("pull boundary changed") }
            for change in page.changes {
                let prior = try Self.syncValue(APIEntry.self, id: "base:" + change.entry.id, context: context, owner: owner, generation: generation)
                if prior == nil || change.entry.version >= prior!.version {
                    try Self.writeSync(change.entry, id: "base:" + change.entry.id, context: context, owner: owner, generation: generation)
                    if prior == nil || change.entry.version > prior!.version {
                        try Self.writeSync(SyncHistoryCheckpoint(entryId: change.entry.id, version: change.entry.version, cursor: "", complete: histories[change.entry.id] != nil),
                            id: "history:" + change.entry.id, context: context, owner: owner, generation: generation)
                    }
                }
                if let events = histories[change.entry.id] { try Self.applyRemoteHistory(events, entryId: change.entry.id, context: context, owner: owner, generation: generation) }
                try Self.reproject(change.entry.id, context: context, owner: owner, generation: generation)
            }
            if snapshot {
                configuration.snapshotBoundary = page.boundary; configuration.snapshotCursor = page.nextCursor
                if !page.hasMore { configuration.cursor = page.boundary; configuration.phase = "ready"; configuration.snapshotBoundary = nil }
            } else {
                configuration.cursor = page.hasMore ? page.nextCursor : page.boundary
                configuration.pullBoundary = page.hasMore ? page.boundary : nil
            }
            try Self.writeSync(configuration, id: "configuration", context: context, owner: owner, generation: generation); Self.bump(meta)
        }
    }
    static func applyRemoteHistory(_ events: [APIHistoryPage.Event], entryId: String, context: NSManagedObjectContext, owner: String, generation: String) throws {
        guard let base = try syncValue(APIEntry.self, id: "base:" + entryId, context: context, owner: owner, generation: generation) else { throw ClientError.invalidData("history without entry") }
        let row = try row(context, "Entry", owner, generation, entryId)
        var local = try row.map { try readEntry($0, context: context, includeHistory: true) }
            ?? VocabularyEntry(id: entryId, word: base.word, kind: base.kind, count: base.count, timestamp: base.createdAtMs, definition: base.definition)
        var index = Dictionary(uniqueKeysWithValues: local.history.enumerated().map { ($0.element.id, $0.offset) })
        for event in events {
            guard event.timestamp.isFinite, event.timestamp >= 0, LegacyCodec.validDefinition(event.definition) else { throw ClientError.invalidData("remote encounter") }
            try writeSync(event, id: "event:" + LegacyCodec.digest(Data(entryId.utf8)) + ":" + event.id, context: context, owner: owner, generation: generation)
            if let offset = index[event.id] {
                let old = local.history[offset]
                guard old.timestamp == event.timestamp, old.definition == event.definition else { throw ClientError.conflict("immutable remote history differs") }
                if let source = event.context { local.history[offset].context = source }
                if let source = event.url { local.history[offset].url = source }
                local.history[offset].cloudPosition = event.position
            } else {
                index[event.id] = local.history.count
                var incoming = Encounter(id: event.id, timestamp: event.timestamp, context: event.context ?? "", url: event.url ?? "", definition: event.definition)
                incoming.cloudPosition = event.position; local.history.append(incoming)
            }
        }
        try writeEntry(local, context, owner, generation)
    }

    public func pendingSyncHistory() throws -> SyncHistoryCheckpoint? {
        let owner = owner
        return try context.performAndWait {
            let generation = Self.generation(try Self.partition(context, owner))
            return try Self.fetch(context, "SyncRecord", owner: owner, generation: generation).filter {
                ($0.value(forKey: "id") as? String)?.hasPrefix("history:") == true
            }.map { try Self.decode(SyncHistoryCheckpoint.self, $0) }.filter { !$0.complete }.sorted { $0.entryId < $1.entryId }.first
        }
    }
    public func restartSyncSnapshot(epochChanged: Bool = false) throws {
        let owner = owner
        try transaction { context in
            let meta = try Self.partition(context, owner), generation = Self.generation(meta)
            guard var configuration = try Self.syncValue(SyncConfiguration.self, id: "configuration", context: context, owner: owner, generation: generation) else { throw ClientError.accountRequired }
            if epochChanged { configuration.phase = "epochConflict"; configuration.enabled = false }
            else { configuration.phase = "snapshot"; configuration.snapshotCursor = 0; configuration.snapshotBoundary = nil; configuration.pullBoundary = nil }
            try Self.writeSync(configuration, id: "configuration", context: context, owner: owner, generation: generation); Self.bump(meta)
        }
    }
    public func applySyncHistoryPage(_ page: APIHistoryPage, checkpoint: SyncHistoryCheckpoint, epoch: String, fault: Fault = .none) throws {
        try page.validate(after: checkpoint.cursor)
        guard page.entryVersion == nil || page.entryVersion == checkpoint.version else { throw ClientError.invalidData("history version changed") }
        let owner = owner
        try transaction(fault: fault) { context in
            let meta = try Self.partition(context, owner), generation = Self.generation(meta)
            guard let configuration = try Self.syncValue(SyncConfiguration.self, id: "configuration", context: context, owner: owner, generation: generation),
                  configuration.epoch == epoch, configuration.phase != "epochConflict",
                  let current = try Self.syncValue(SyncHistoryCheckpoint.self, id: "history:" + checkpoint.entryId, context: context, owner: owner, generation: generation),
                  current == checkpoint else { throw ClientError.stalePreview }
            try Self.applyRemoteHistory(page.events, entryId: checkpoint.entryId, context: context, owner: owner, generation: generation)
            var next = checkpoint; next.cursor = page.nextCursor; next.complete = !page.hasMore
            if next.complete { try Self.orderSyncedHistory(checkpoint.entryId, context: context, owner: owner, generation: generation) }
            try Self.writeSync(next, id: "history:" + next.entryId, context: context, owner: owner, generation: generation)
            try Self.reproject(next.entryId, context: context, owner: owner, generation: generation); Self.bump(meta)
        }
    }
    static func orderSyncedHistory(_ entryId: String, context: NSManagedObjectContext, owner: String, generation: String) throws {
        guard let base = try syncValue(APIEntry.self, id: "base:" + entryId, context: context, owner: owner, generation: generation),
              let mode = base.historyOrdering, let row = try row(context, "Entry", owner, generation, entryId) else { return }
        var entry = try readEntry(row, context: context, includeHistory: true)
        entry.history = entry.history.enumerated().sorted { left, right in
            if mode == "timestamp", left.element.timestamp != right.element.timestamp { return left.element.timestamp < right.element.timestamp }
            let a = left.element.cloudPosition, b = right.element.cloudPosition
            if let a, let b, a != b { return a < b }
            if a != nil && b == nil { return true }
            if a == nil && b != nil { return false }
            return left.offset < right.offset
        }.map(\.element)
        try writeEntry(entry, context, owner, generation)
    }

    public func syncConflicts() throws -> [SyncConflict] {
        let owner = owner
        return try context.performAndWait {
            let generation = Self.generation(try Self.partition(context, owner))
            return try Self.fetch(context, "SyncRecord", owner: owner, generation: generation).filter {
                ($0.value(forKey: "id") as? String)?.hasPrefix("conflict:") == true
            }.map { try Self.decode(SyncConflict.self, $0) }
        }
    }
    public func acceptRemoteForConflict(_ logicalId: String) throws {
        let owner = owner
        try transaction { context in
            let meta = try Self.partition(context, owner), generation = Self.generation(meta)
            guard let row = try Self.row(context, "Operation", owner, generation, logicalId) else { throw ClientError.invalidData("conflict intent missing") }
            var operation = try Self.decode(PendingOperation.self, row)
            guard operation.state == "conflict" else { throw ClientError.conflict("intent is not rejected") }
            guard try Self.syncValue(APIEntry.self, id: "base:" + operation.entryID, context: context, owner: owner, generation: generation) != nil else {
                throw ClientError.conflict("No matching cloud lifecycle; choose source association or a new lifecycle before discarding this intent")
            }
            operation.state = "discarded"; try Self.writeLogical(operation, context: context, generation: generation)
            if let conflict = try Self.row(context, "SyncRecord", owner, generation, "conflict:" + logicalId) { context.delete(conflict) }
            var discardedDependencies = Set([logicalId])
            let remote = try Self.syncValue(APIEntry.self, id: "base:" + operation.entryID, context: context, owner: owner, generation: generation)
            for var dependent in try Self.logicalOperations(context, owner: owner, generation: generation, entryId: operation.entryID) {
                guard dependent.state == "pending", let dependencyId = dependent.syncDependencyId, discardedDependencies.contains(dependencyId) else { continue }
                discardedDependencies.insert(dependent.id); dependent.state = "conflict"
                try Self.writeLogical(dependent, context: context, generation: generation)
                try Self.writeSync(SyncConflict(id: dependent.id, entryId: dependent.entryID, code: "DEPENDENCY_DISCARDED", localOperation: dependent, remote: remote),
                    id: "conflict:" + dependent.id, context: context, owner: owner, generation: generation)
            }
            try Self.reproject(operation.entryID, context: context, owner: owner, generation: generation); Self.bump(meta)
        }
    }
}

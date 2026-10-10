import Foundation
@preconcurrency import CoreData

extension SyncProjection {
    static func makeWire(_ operation: PendingOperation, privacy: SyncPrivacy, base: APIEntry?) throws -> [APIOperation] {
        let fields = operation.payload.fields ?? [:]
        var values: [(String, JSONValue)] = []
        var remoteVersion = operation.observedRemoteVersion ?? base?.version ?? 0
        let remoteReview = operation.observedReviewVersion ?? base?.reviewVersion ?? 0
        func history(_ records: [Encounter], alwaysPrivate: Bool = false) throws {
            var chunk: [JSONValue] = []
            for record in records {
                let event = event(record, privacy: alwaysPrivate ? SyncPrivacy() : privacy)
                let next = chunk + [event]
                let body = JSONValue.object(["events": .array(next)])
                let size = try JSONValue.encoder().encode(body).count
                if next.count > 25 || size > 250 * 1024 {
                    guard !chunk.isEmpty else { throw ClientError.invalidData("an encounter exceeds the API size limit") }
                    values.append(("importHistory", .object(["events": .array(chunk)]))); chunk = [event]
                } else { chunk = next }
            }
            if !chunk.isEmpty { values.append(("importHistory", .object(["events": .array(chunk)]))) }
        }
        switch operation.kind {
        case "create", "legacySeed":
            var payload = try creation(fields).fields!
            if operation.kind == "create", fields["allowDuplicate"] == .bool(true) { payload["allowDuplicate"] = .bool(true) }
            let original = try decodeEntry(operation.payload)
            if operation.kind == "legacySeed" {
                guard let digest = original.sourceDigest else { throw ClientError.invalidData("migration source missing") }
                payload["sourceDigest"] = .string(digest)
            }
            values.append((operation.kind == "legacySeed" ? "seed" : "create", .object(payload)))
            try history(original.history, alwaysPrivate: operation.kind == "legacySeed")
            if let state = original.review {
                values.append(("restore", .object(["count": original.count.map(JSONValue.number) ?? .null,
                    "definition": original.definition, "notes": .string(original.notes),
                    "review": .object(["algorithmVersion": .string("review-v1"), "step": .number(Double(state.step)), "dueAtMs": .number(state.dueAtMs)]),
                    "baseReviewVersion": .number(0)])))
            }
        case "record":
            let record = try JSONDecoder().decode(Encounter.self, from: JSONValue.encoder().encode(operation.payload))
            values.append(("record", .object(["event": event(record, privacy: privacy)])))
        case "associateHistory":
            try history(try decodeEntry(operation.payload).history)
        case "enrichSource":
            values.append(("enrichSource", operation.payload))
        case "edit":
            var selected: [String: JSONValue] = [:]
            for key in ["word", "kind", "definition", "notes"] { selected[key] = fields[key] }
            values.append(("edit", .object(selected)))
        case "reset", "delete": values.append((operation.kind, .object([:])))
        case "review":
            var event = fields; event["originEventId"] = nil; event["baseReviewVersion"] = .number(Double(remoteReview))
            values.append(("review", .object(["event": .object(event)])))
        case "restore":
            let restored = try decodeEntry(operation.payload)
            let review: JSONValue = restored.review.map { .object(["algorithmVersion": .string($0.algorithmVersion), "step": .number(Double($0.step)), "dueAtMs": .number($0.dueAtMs)]) } ?? .null
            values.append(("restore", .object(["count": restored.count.map(JSONValue.number) ?? .null,
                "definition": restored.definition, "notes": .string(restored.notes), "review": review, "baseReviewVersion": .number(Double(remoteReview))])))
            try history(restored.history)
        case "legacyMerge":
            guard let count = fields["count"]?.number, let definition = fields["resultDefinition"] ?? fields["definition"] else { throw ClientError.invalidData("legacy merge intent") }
            if operation.baseVersion == 0 && remoteVersion == 0 {
                values.append(("create", try creation(fields)))
            } else { values.append(("legacyMerge", .object(["countDelta": .number(count), "definition": definition]))) }
            let incoming = try decodeEntry(operation.payload); try history(incoming.history)
        default: throw ClientError.invalidData("unsupported logical sync operation")
        }
        var result: [APIOperation] = []
        for (index, value) in values.enumerated() {
            let (kind, payload) = value
            let id: String
            if kind == "seed", let source = payload["sourceDigest"]?.text, let word = payload["word"]?.text {
                id = try LegacyCodec.stableID("seed", [.string("legacy-seed-v1"), .string(source), .string(LegacyCodec.normalize(word))])
            } else { id = try wireID(logical: operation.id, index: index, kind: kind) }
            let conditional = ["edit", "reset", "delete", "review", "restore", "legacyMerge"].contains(kind)
            if conditional && remoteVersion < 1 { throw ClientError.conflict("server base state is not available") }
            var item = APIOperation(operationId: id, entryId: operation.entryID, kind: kind,
                baseVersion: conditional ? remoteVersion : nil, payload: payload)
            if Self.hasSources(item) { item.sourceRevision = operation.wireSourceRevision ?? 0 }
            guard (try JSONValue.encoder().encode(item)).count <= 256 * 1024 else { throw ClientError.invalidData("sync item exceeds API request limit") }
            result.append(item)
            if index < values.count - 1 { remoteVersion = try VersionToken.next(remoteVersion) }
        }
        return result
    }
}

extension LocalRepository {
    static func wireItems(_ context: NSManagedObjectContext, owner: String, generation: String) throws -> [SyncWireItem] {
        let request = NSFetchRequest<NSManagedObject>(entityName: "SyncRecord")
        request.predicate = NSPredicate(format: "owner == %@ AND generation == %@ AND id BEGINSWITH %@", owner, generation, "wire:")
        return try context.fetch(request).map { try decode(SyncWireItem.self, $0) }.sorted { a, b in a.sequence == b.sequence ? a.index < b.index : a.sequence < b.sequence }
    }
    public func nextSyncWire(now: Double = Date().timeIntervalSince1970 * 1000) throws -> SyncWireItem? {
        let owner = owner
        return try transaction { context in
            let meta = try Self.partition(context, owner), generation = Self.generation(meta)
            guard let configuration = try Self.syncValue(SyncConfiguration.self, id: "configuration", context: context, owner: owner, generation: generation),
                  configuration.enabled, configuration.phase == "ready", let epoch = configuration.epoch else { return nil }
            var blockedEntries = Set<String>()
            let request = NSFetchRequest<NSManagedObject>(entityName: "Operation")
            request.predicate = NSPredicate(format: "owner == %@ AND generation == %@ AND state == %@", owner, generation, "pending")
            request.sortDescriptors = [NSSortDescriptor(key: "sequence", ascending: true)]; request.fetchLimit = 50
            let wires = try Self.wireItems(context, owner: owner, generation: generation)
            while true {
                let rows = try context.fetch(request)
                if rows.isEmpty { return nil }
                for row in rows {
                    var intent = try Self.decode(PendingOperation.self, row)
                    let conflicts = NSFetchRequest<NSFetchRequestResult>(entityName: "Operation")
                    conflicts.predicate = NSPredicate(format: "owner == %@ AND generation == %@ AND entryID == %@ AND state == %@", owner, generation, intent.entryID, "conflict")
                    if try context.count(for: conflicts) > 0 { blockedEntries.insert(intent.entryID) }
                    if blockedEntries.contains(intent.entryID) { continue }
                    if try Self.syncValue(SyncHistoryCheckpoint.self, id: "history:" + intent.entryID, context: context, owner: owner, generation: generation)?.complete == false {
                        blockedEntries.insert(intent.entryID); continue
                    }
                    let existing = wires.filter { $0.logicalId == intent.id }
                    if let first = existing.first(where: { $0.status == "pending" }) {
                        guard first.epoch == epoch else { throw ClientError.conflict("frozen operation belongs to an earlier server epoch") }
                        if let retry = first.retryAtMs, retry > now { blockedEntries.insert(intent.entryID); continue }
                        return first
                    }
                    if let dependencyId = intent.syncDependencyId {
                        guard let dependencyRow = try Self.row(context, "Operation", owner, generation, dependencyId) else { throw ClientError.invalidData("sync dependency missing") }
                        let dependency = try Self.decode(PendingOperation.self, dependencyRow)
                        guard dependency.state == "confirmed" else { blockedEntries.insert(intent.entryID); continue }
                        if let expected = intent.dependencyExpectedVersion, let actual = dependency.confirmedRemoteVersion,
                           actual < expected {
                            intent.observedRemoteVersion = max(intent.observedVersionFloor ?? 0, (intent.observedRemoteVersion ?? expected) - (expected - actual))
                        }
                        if let expected = intent.dependencyExpectedReviewVersion, let actual = dependency.confirmedReviewVersion,
                           actual < expected {
                            intent.observedReviewVersion = max(intent.observedReviewVersionFloor ?? 0, (intent.observedReviewVersion ?? expected) - (expected - actual))
                        }
                        intent.dependencyExpectedVersion = nil; intent.dependencyExpectedReviewVersion = nil
                        // Never raise an explicit mutation's base just because an
                        // additive predecessor ran over unseen concurrent changes.
                    }
                    let base = try Self.syncValue(APIEntry.self, id: "base:" + intent.entryID, context: context, owner: owner, generation: generation)
                    if intent.wirePrivacy == nil {
                        intent.wirePrivacy = configuration.privacy; intent.wireSourceRevision = configuration.sourceRevision ?? 0
                    }
                    // The payload/chunk layout is stable. Only duplicate/no-op
                    // acknowledgements can lower the expected causal base; unseen
                    // concurrent increments must still produce a CAS conflict.
                    let projected = try SyncProjection.makeWire(intent, privacy: intent.wirePrivacy!, base: base)
                    intent.wireCount = projected.count
                    let index = existing.count
                    guard index < projected.count else { throw ClientError.invalidData("incomplete wire confirmation") }
                    var operation = projected[index]
                    if operation.baseVersion != nil, index > 0 {
                        var previous = intent.observedRemoteVersion ?? 0, noOps = 0
                        for predecessor in existing {
                            guard let actual = predecessor.confirmedRemoteVersion else { throw ClientError.invalidData("wire predecessor result missing") }
                            if actual <= previous { noOps += 1 }
                            previous = actual
                        }
                        operation.baseVersion = max(intent.observedVersionFloor ?? 0, operation.baseVersion! - noOps)
                    }
                    let item = SyncWireItem(id: operation.operationId, logicalId: intent.id, entryId: intent.entryID,
                        sequence: intent.sequence ?? 0, index: index, epoch: epoch, body: try JSONValue.encoder().encode(operation),
                        status: "pending", attempts: 0, retryAtMs: nil, errorCode: nil)
                    try Self.writeLogical(intent, context: context, generation: generation)
                    try Self.writeSync(item, id: "wire:" + item.id, context: context, owner: owner, generation: generation)
                    Self.bump(meta); return item
                }
                request.fetchOffset += rows.count
            }
        }
    }
    public func acknowledgeSyncWire(_ id: String, result: APIOperationResult, fault: Fault = .none) throws {
        try result.entry.validate()
        let owner = owner
        try transaction(fault: fault) { context in
            let meta = try Self.partition(context, owner), generation = Self.generation(meta)
            guard var wire = try Self.syncValue(SyncWireItem.self, id: "wire:" + id, context: context, owner: owner, generation: generation),
                  result.operationId == wire.id, result.entry.id == wire.entryId,
                  let configuration = try Self.syncValue(SyncConfiguration.self, id: "configuration", context: context, owner: owner, generation: generation),
                  configuration.epoch == wire.epoch else { throw ClientError.invalidData("sync acknowledgement") }
            if wire.status == "confirmed" { return }
            wire.status = "confirmed"; wire.errorCode = nil; wire.retryAtMs = nil
            wire.confirmedRemoteVersion = result.entry.version; wire.confirmedReviewVersion = result.entry.reviewVersion
            try Self.writeSync(wire, id: "wire:" + id, context: context, owner: owner, generation: generation)
            let previous = try Self.syncValue(APIEntry.self, id: "base:" + wire.entryId, context: context, owner: owner, generation: generation)
            if previous == nil || result.entry.version >= previous!.version {
                try Self.writeSync(result.entry, id: "base:" + wire.entryId, context: context, owner: owner, generation: generation)
            }
            let operation = try JSONDecoder().decode(APIOperation.self, from: wire.body)
            let eventValues: [JSONValue]
            if operation.kind == "record", let event = operation.payload["event"] { eventValues = [event] }
            else { eventValues = operation.payload["events"]?.items ?? [] }
            for event in eventValues {
                if let eventId = event["id"]?.text {
                    let key = "event:" + LegacyCodec.digest(Data(wire.entryId.utf8)) + ":" + eventId
                    var fields = try Self.syncValue(JSONValue.self, id: key, context: context, owner: owner, generation: generation)?.fields ?? [:]
                    for (name, value) in event.fields ?? [:] { fields[name] = value }
                    fields["sourceRevision"] = .number(Double(operation.sourceRevision ?? 0))
                    try Self.writeSync(JSONValue.object(fields), id: key, context: context, owner: owner, generation: generation)
                }
            }
            let related = try Self.wireItems(context, owner: owner, generation: generation).filter { $0.logicalId == wire.logicalId }
            guard let row = try Self.row(context, "Operation", owner, generation, wire.logicalId) else { throw ClientError.invalidData("logical acknowledgement") }
            var intent = try Self.decode(PendingOperation.self, row)
            if related.count == intent.wireCount && related.allSatisfy({ $0.status == "confirmed" }) {
                intent.state = "confirmed"; intent.confirmedRemoteVersion = result.entry.version; intent.confirmedReviewVersion = result.entry.reviewVersion
                try Self.writeLogical(intent, context: context, generation: generation)
            }
            try Self.reproject(wire.entryId, context: context, owner: owner, generation: generation); Self.bump(meta)
        }
    }
    public func rejectSyncWire(_ id: String, code: String, retryable: Bool, now: Double = Date().timeIntervalSince1970 * 1000) throws {
        let owner = owner
        try transaction { context in
            let meta = try Self.partition(context, owner), generation = Self.generation(meta)
            guard var wire = try Self.syncValue(SyncWireItem.self, id: "wire:" + id, context: context, owner: owner, generation: generation) else { throw ClientError.invalidData("wire operation missing") }
            guard wire.status == "pending" else { return }
            wire.attempts += 1; wire.errorCode = code
            if retryable {
                wire.retryAtMs = now + min(60_000, 1000 * pow(2, Double(min(wire.attempts, 6))))
            } else {
                wire.status = "conflict"
                guard let row = try Self.row(context, "Operation", owner, generation, wire.logicalId) else { throw ClientError.invalidData("logical conflict") }
                var intent = try Self.decode(PendingOperation.self, row); intent.state = "conflict"
                try Self.writeLogical(intent, context: context, generation: generation)
                if intent.kind == "review", let eventId = intent.payload["id"]?.text {
                    let admissions = NSFetchRequest<NSManagedObject>(entityName: "ReviewAdmission")
                    admissions.predicate = NSPredicate(format: "owner == %@ AND id == %@", owner, eventId)
                    for admission in try context.fetch(admissions) { context.delete(admission) }
                }
                let remote = try Self.syncValue(APIEntry.self, id: "base:" + wire.entryId, context: context, owner: owner, generation: generation)
                try Self.writeSync(SyncConflict(id: intent.id, entryId: wire.entryId, code: code, localOperation: intent, remote: remote),
                    id: "conflict:" + intent.id, context: context, owner: owner, generation: generation)
                try Self.reproject(wire.entryId, context: context, owner: owner, generation: generation)
            }
            try Self.writeSync(wire, id: "wire:" + id, context: context, owner: owner, generation: generation); Self.bump(meta)
        }
    }
}

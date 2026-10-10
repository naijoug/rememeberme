import Foundation
@preconcurrency import CoreData

public struct SourceRemovalRequest: Codable, Sendable, Equatable {
    public var requestId: String
    public var sourceRevision: Int
}

extension SyncAPI {
    public func setSourcePrivacy(_ privacy: SyncPrivacy, timezone: String) async throws {
        throw ClientError.conflict("This service does not support source privacy controls")
    }
    public func clearSources(_ request: SourceRemovalRequest, epoch: String) async throws -> Int {
        throw ClientError.conflict("This service does not support source removal")
    }
}
extension NativeSyncAPI {
    public func setSourcePrivacy(_ privacy: SyncPrivacy, timezone: String) async throws {
        let body: JSONValue = .object(["timezone": .string(timezone), "syncContext": .bool(privacy.context), "syncURLs": .bool(privacy.urls)])
        _ = try await client.request(path: "/api/v1/preferences", method: "PUT", body: JSONValue.encoder().encode(body))
    }
    public func clearSources(_ request: SourceRemovalRequest, epoch: String) async throws -> Int {
        let data = try await client.request(path: "/api/v1/sources/clear", method: "POST", body: JSONValue.encoder().encode(request), epoch: epoch)
        let value = try JSONDecoder().decode(JSONValue.self, from: data)
        guard value["cleared"] == .bool(true), let revision = value["sourceRevision"]?.number,
              revision == Double(request.sourceRevision + 1) else { throw APIRequestError.invalidResponse }
        return Int(revision)
    }
}
extension SyncProjection {
    static func sourceEvents(_ operation: APIOperation) -> [JSONValue] {
        if let event = operation.payload["event"] { return [event] }
        return operation.payload["events"]?.items ?? []
    }
    static func hasSources(_ operation: APIOperation) -> Bool {
        sourceEvents(operation).contains { !($0["context"]?.text ?? "").isEmpty || !($0["url"]?.text ?? "").isEmpty }
    }
}
extension LocalRepository {
    public func sourceWireAllowed(_ wire: SyncWireItem) throws -> Bool {
        guard let configuration = try syncConfiguration(), configuration.pendingSourceRemoval == nil else { return false }
        let operation = try JSONDecoder().decode(APIOperation.self, from: wire.body)
        guard SyncProjection.hasSources(operation) else { return true }
        return (operation.sourceRevision ?? 0) == (configuration.sourceRevision ?? 0) && SyncProjection.sourceEvents(operation).allSatisfy {
            (($0["context"]?.text ?? "").isEmpty || configuration.privacy.context) && (($0["url"]?.text ?? "").isEmpty || configuration.privacy.urls)
        }
    }
    /// Freeze an idempotent removal before network I/O. An unknown outcome keeps sending paused across restart.
    public func beginSourceRemoval() throws -> SourceRemovalRequest {
        let owner = owner
        return try transaction { context in
            let meta = try Self.partition(context, owner), generation = Self.generation(meta)
            guard var configuration = try Self.syncValue(SyncConfiguration.self, id: "configuration", context: context, owner: owner, generation: generation),
                  configuration.phase == "ready", configuration.capabilities?.contains("source-privacy-v1") == true else { throw ClientError.conflict("Reopen the updated cloud service before removing sources") }
            if let pending = configuration.pendingSourceRemoval { return pending }
            let revision = configuration.sourceRevision ?? 0
            guard revision < VersionToken.maximum else { throw ClientError.invalidData("source revision exhausted") }
            let request = SourceRemovalRequest(requestId: UUID().uuidString, sourceRevision: revision)
            configuration.enabled = false; configuration.privacy = SyncPrivacy(); configuration.pendingSourceRemoval = request
            try Self.writeSync(configuration, id: "configuration", context: context, owner: owner, generation: generation); Self.bump(meta)
            return request
        }
    }
    public func finishSourceRemoval(_ request: SourceRemovalRequest, revision: Int) throws {
        let owner = owner
        try transaction { context in
            let meta = try Self.partition(context, owner), generation = Self.generation(meta)
            guard var configuration = try Self.syncValue(SyncConfiguration.self, id: "configuration", context: context, owner: owner, generation: generation),
                  configuration.pendingSourceRemoval == request, revision == request.sourceRevision + 1 else { throw ClientError.conflict("Source removal reply changed") }
            configuration.sourceRevision = revision; configuration.pendingSourceRemoval = nil
            configuration.privacy = SyncPrivacy(); configuration.enabled = false
            try Self.writeSync(configuration, id: "configuration", context: context, owner: owner, generation: generation); Self.bump(meta)
        }
    }
    /// One bounded page of local sources for events already known to the cloud.
    /// Consent is frozen when explicitly queued; clearing cannot rebase these requests.
    public func backfillSources(entryId: String, offset: Int, limit: Int = 25) throws -> Int {
        guard limit > 0, limit <= 25, offset >= 0 else { throw ClientError.invalidData("source page") }
        let owner = owner
        return try transaction { context in
            let meta = try Self.partition(context, owner), generation = Self.generation(meta)
            guard let configuration = try Self.syncValue(SyncConfiguration.self, id: "configuration", context: context, owner: owner, generation: generation),
                  configuration.phase == "ready", configuration.pendingSourceRemoval == nil,
                  configuration.capabilities?.contains("source-privacy-v1") == true,
                  configuration.privacy.context || configuration.privacy.urls else { throw ClientError.conflict("Enable source synchronization before backfilling") }
            guard let base = try Self.syncValue(APIEntry.self, id: "base:" + entryId, context: context, owner: owner, generation: generation), !base.deleted else { return 0 }
            let request = NSFetchRequest<NSManagedObject>(entityName: "Encounter")
            request.predicate = NSPredicate(format: "owner == %@ AND generation == %@ AND entryID == %@", owner, generation, entryId)
            request.sortDescriptors = [NSSortDescriptor(key: "position", ascending: true)]; request.fetchOffset = offset; request.fetchLimit = limit
            var events: [JSONValue] = []
            for row in try context.fetch(request) {
                let event = try Self.decode(Encounter.self, row)
                let key = "event:" + LegacyCodec.digest(Data(entryId.utf8)) + ":" + event.id
                guard let known = try Self.syncValue(JSONValue.self, id: key, context: context, owner: owner, generation: generation) else { continue }
                var fields: [String: JSONValue] = ["id": .string(event.id)]
                if configuration.privacy.context, !event.context.isEmpty, (known["sourceRevision"]?.number != Double(configuration.sourceRevision ?? 0) || known["context"]?.text != event.context) { fields["context"] = .string(event.context) }
                if configuration.privacy.urls, !event.url.isEmpty, (known["sourceRevision"]?.number != Double(configuration.sourceRevision ?? 0) || known["url"]?.text != event.url) { fields["url"] = .string(event.url) }
                if fields.count > 1 { events.append(.object(fields)) }
            }
            // Separate operations avoid creating a request over the byte limit for long sources.
            for event in events {
                var operation = PendingOperation(owner: owner, entryID: entryId, kind: "enrichSource", baseVersion: 0, payload: .object(["events": .array([event])]))
                operation.wirePrivacy = configuration.privacy; operation.wireSourceRevision = configuration.sourceRevision ?? 0
                try Self.enqueue(operation, context, generation)
            }
            if !events.isEmpty { Self.bump(meta) }
            return events.count
        }
    }
}

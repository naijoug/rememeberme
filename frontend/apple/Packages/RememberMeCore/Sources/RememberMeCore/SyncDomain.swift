import Foundation

public struct SyncPrivacy: Codable, Sendable, Equatable {
    public var context: Bool
    public var urls: Bool
    public init(context: Bool = false, urls: Bool = false) { self.context = context; self.urls = urls }
}
public struct SyncConfiguration: Codable, Sendable, Equatable {
    public var origin: String
    public var userId: String
    public var deviceId: String
    public var enabled: Bool
    public var epoch: String?
    public var cursor: Int
    public var snapshotBoundary: Int?
    public var pullBoundary: Int? = nil
    public var timeZoneID: String? = nil
    public var capabilities: [String]? = nil
    public var displayName: String? = nil
    public var serverReviewDay: String? = nil
    public var serverReviewAdmissionIds: [String]? = nil
    public var snapshotCursor: Int
    public var phase: String
    public var privacy: SyncPrivacy
    public init(identity: ConnectedIdentity, enabled: Bool = false, privacy: SyncPrivacy = SyncPrivacy()) {
        origin = identity.origin; userId = identity.userId; deviceId = identity.deviceId; self.enabled = enabled
        epoch = nil; cursor = 0; snapshotBoundary = nil; snapshotCursor = 0; phase = "initial"; self.privacy = privacy
    }
    public var identity: ConnectedIdentity { ConnectedIdentity(origin: origin, userId: userId, deviceId: deviceId) }
    public static func owner(for identity: ConnectedIdentity) -> String {
        "account:" + LegacyCodec.digest(Data(identity.origin.utf8)) + ":" + identity.userId
    }
}
public struct SyncConflict: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var entryId: String
    public var code: String
    public var localOperation: PendingOperation
    public var remote: APIEntry?
}
public struct SyncWireItem: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var logicalId: String
    public var entryId: String
    public var sequence: Int64
    public var index: Int
    public var epoch: String
    public var body: Data
    public var status: String
    public var attempts: Int
    public var retryAtMs: Double?
    public var errorCode: String?
    public var confirmedRemoteVersion: Int? = nil
    public var confirmedReviewVersion: Int? = nil
}
public struct SyncCheckpointPage: Codable, Sendable, Equatable {
    public struct Change: Codable, Sendable, Equatable {
        public var sequence: Int
        public var entry: APIEntry
    }
    public var epoch: String
    public var boundary: Int
    public var nextCursor: Int
    public var hasMore: Bool
    public var changes: [Change]
    public func validate(after cursor: Int) throws {
        guard !epoch.isEmpty, VersionToken.valid(boundary), VersionToken.valid(nextCursor), nextCursor >= cursor,
              nextCursor <= boundary, changes.count <= 50, (!hasMore || nextCursor > cursor) else { throw ClientError.invalidData("sync page") }
        var previous = cursor
        for change in changes {
            guard change.sequence > previous, change.sequence <= boundary else { throw ClientError.invalidData("sync sequence") }
            try change.entry.validate(); previous = change.sequence
        }
        guard changes.last?.sequence == nil || changes.last?.sequence == nextCursor else { throw ClientError.invalidData("sync cursor") }
    }
}
public struct APIAccountIdentity: Codable, Sendable, Equatable {
    public var userId: String
    public var deviceId: String
    public var epoch: String
    public var timezone: String
    public var syncContext: Bool
    public var syncURLs: Bool
    public var syncCapabilities: [String]? = nil
    public var displayName: String? = nil
    public var reviewDay: String? = nil
    public var reviewAdmissionIds: [String]? = nil
}
public struct APIHistoryPage: Codable, Sendable {
    public var entryVersion: Int? = nil
    public struct Event: Codable, Sendable, Equatable {
        public var id: String
        public var timestamp: Double
        public var definition: JSONValue
        public var context: String?
        public var url: String?
        public var position: Int? = nil
    }
    public var nextCursor: String
    public var hasMore: Bool
    public var events: [Event]
    public func validate(after cursor: String) throws {
        guard events.count <= 25, !hasMore || !events.isEmpty else { throw ClientError.invalidData("history page") }
        var previous = cursor
        for event in events {
            guard event.id.range(of: "^[A-Za-z0-9:_-]{1,200}$", options: .regularExpression) != nil,
                  event.id > previous, event.timestamp.isFinite, event.timestamp >= 0,
                  LegacyCodec.validDefinition(event.definition) else { throw ClientError.invalidData("history order or event") }
            if let position = event.position { guard position > 0, VersionToken.valid(position) else { throw ClientError.invalidData("history position") } }
            previous = event.id
        }
        guard nextCursor == previous else { throw ClientError.invalidData("history cursor") }
    }
}
public struct SyncHistoryCheckpoint: Codable, Sendable, Equatable {
    public var entryId: String
    public var version: Int
    public var cursor: String
    public var complete: Bool
}
public struct SyncStatus: Sendable {
    public var pending: Int
    public var conflicts: Int
    public var configuration: SyncConfiguration?
}

enum SyncProjection {
    static func wireID(logical: String, index: Int, kind: String) throws -> String {
        try LegacyCodec.stableID("wire", [.string("sync-wire-v1"), .string(logical), .number(Double(index)), .string(kind)])
    }
    static func creation(_ entry: VocabularyEntry) -> JSONValue {
        .object(["word": .string(entry.word), "kind": .string(entry.kind.rawValue), "count": entry.count.map(JSONValue.number) ?? .null,
            "definition": entry.definition, "notes": .string(entry.notes), "createdAtMs": .number(entry.createdAt), "updatedAtMs": .number(entry.updatedAt)])
    }
    static func creation(_ fields: [String: JSONValue]) throws -> JSONValue {
        guard let word = fields["word"]?.text, let type = fields["kind"]?.text, EntryKind(rawValue: type) != nil,
              let definition = fields["definition"], LegacyCodec.validDefinition(definition),
              let created = fields["createdAt"]?.number ?? fields["createdAtMs"]?.number,
              let updated = fields["updatedAt"]?.number ?? fields["updatedAtMs"]?.number else { throw ClientError.invalidData("incomplete creation intent") }
        return .object(["word": .string(word), "kind": .string(type), "count": fields["count"] ?? .null,
            "definition": definition, "notes": fields["notes"] ?? .string(""), "createdAtMs": .number(created), "updatedAtMs": .number(updated)])
    }
    static func event(_ record: Encounter, privacy: SyncPrivacy) -> JSONValue {
        var fields: [String: JSONValue] = ["id": .string(record.id), "timestamp": .number(record.timestamp), "definition": record.definition]
        if privacy.context { fields["context"] = .string(record.context) }
        if privacy.urls { fields["url"] = .string(record.url) }
        return .object(fields)
    }
    static func events(_ history: [Encounter], privacy: SyncPrivacy = SyncPrivacy()) -> [JSONValue] { history.map { event($0, privacy: privacy) } }
    static func decodeEntry(_ value: JSONValue) throws -> VocabularyEntry {
        try JSONDecoder().decode(VocabularyEntry.self, from: JSONValue.encoder().encode(value))
    }
    static func overlay(_ base: APIEntry, local: VocabularyEntry?, pending: [PendingOperation], knownEvents: Set<String>, appliedFields: Set<String> = []) throws -> VocabularyEntry {
        var result = local ?? VocabularyEntry(id: base.id, word: base.word, kind: base.kind, count: base.count,
            timestamp: base.createdAtMs, definition: base.definition)
        result.word = base.word; result.normalizedKey = base.normalizedKey; result.kind = base.kind; result.count = base.count
        result.definition = base.definition; result.notes = base.notes; result.createdAt = base.createdAtMs; result.updatedAt = base.updatedAtMs
        result.deleted = base.deleted
        if let review = base.review {
            result.review = ReviewState(step: review.step, dueAtMs: review.dueAtMs, version: max(1, result.effectiveReviewVersion))
        } else { result.review = nil }
        for operation in pending.sorted(by: { ($0.sequence ?? 0) < ($1.sequence ?? 0) }) {
            let fields = operation.payload.fields ?? [:]
            switch operation.kind {
            case "record":
                let event = try JSONDecoder().decode(Encounter.self, from: JSONValue.encoder().encode(operation.payload))
                if !knownEvents.contains(event.id) {
                    let next = (result.count ?? 0) + 1
                    guard next.isFinite, next > (result.count ?? 0) else { throw ClientError.invalidNumber }; result.count = next
                }
                result.updatedAt = event.timestamp
            case "edit":
                if let word = fields["word"]?.text { result.word = LegacyCodec.trim(word); result.normalizedKey = LegacyCodec.normalize(word) }
                if let definition = fields["definition"] { result.definition = definition }
                if let notes = fields["notes"]?.text { result.notes = notes }
                if let kind = fields["kind"]?.text.flatMap(EntryKind.init(rawValue:)) { result.kind = kind }
            case "reset": result.count = 0
            case "delete": result.deleted = true
            case "review":
                if operation.state == "conflict" { continue }
                let event = try JSONDecoder().decode(ReviewEvent.self, from: JSONValue.encoder().encode(operation.payload))
                // The same event may already be reflected in a newly pulled
                // reviewVersion while its submission reply is still missing.
                result.review = try operation.projectedReview ?? local?.review ?? ReviewAlgorithm.next(result.review, result: event.result, at: event.answeredAtMs)
            case "restore", "epochOrphan":
                if appliedFields.contains(operation.id) { continue }
                let restored = try decodeEntry(operation.payload)
                result.count = restored.count; result.definition = restored.definition; result.notes = restored.notes; result.review = restored.review
            case "legacyMerge":
                if appliedFields.contains(operation.id) { continue }
                if let delta = fields["count"]?.number {
                    let next = (result.count ?? 0) + delta; guard next.isFinite else { throw ClientError.invalidNumber }; result.count = next
                }
                if let definition = fields["resultDefinition"] ?? fields["definition"] { result.definition = definition }
            default: break
            }
        }
        return result
    }
}

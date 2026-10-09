import Foundation

/// Server CAS versions belong to the wire base state, never local Core Data revisions.
public struct APIReview: Codable, Sendable, Equatable {
    public var algorithmVersion: String
    public var step: Int
    public var dueAtMs: Double
}
public struct APIEntry: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var word: String
    public var normalizedKey: String
    public var kind: EntryKind
    public var count: Double?
    public var definition: JSONValue
    public var notes: String
    public var createdAtMs: Double
    public var updatedAtMs: Double
    public var version: Int
    public var deleted: Bool
    public var review: APIReview?
    public var reviewVersion: Int
    public var historyOrdering: String? = nil
    public func validate() throws {
        guard id.range(of: "^[A-Za-z0-9:_-]{1,200}$", options: .regularExpression) != nil, !word.isEmpty,
              LegacyCodec.keyBytes(normalizedKey) == LegacyCodec.keyBytes(LegacyCodec.normalize(word)),
              count == nil || (count!.isFinite && count! >= 0), LegacyCodec.validDefinition(definition),
              createdAtMs.isFinite, createdAtMs >= 0, updatedAtMs.isFinite, updatedAtMs >= 0,
              version > 0, VersionToken.valid(version), VersionToken.valid(reviewVersion) else { throw ClientError.invalidData("API entry") }
        guard historyOrdering == nil || ["retained", "timestamp"].contains(historyOrdering!) else { throw ClientError.invalidData("history ordering") }
        if let review {
            guard review.algorithmVersion == "review-v1", (0...4).contains(review.step), review.dueAtMs.isFinite,
                  review.dueAtMs >= 0, review.dueAtMs <= 8_640_000_000_000_000 else { throw ClientError.invalidData("API review") }
        }
    }
}
public struct APIOperation: Codable, Sendable, Equatable {
    public var operationId: String
    public var entryId: String
    public var kind: String
    public var baseVersion: Int?
    public var payload: JSONValue
}
public struct APIOperationResult: Codable, Sendable, Equatable {
    public var operationId: String
    public var status: String
    public var entry: APIEntry
    public var cursor: Int
    public static func decode(_ data: Data) throws -> APIOperationResult {
        let raw = try JSONDecoder().decode(JSONValue.self, from: data)
        guard let fields = raw["entry"]?.fields, fields["count"] != nil, fields["review"] != nil else {
            throw ClientError.invalidData("API reply omitted nullable state")
        }
        let result = try JSONDecoder().decode(Self.self, from: data)
        try result.entry.validate()
        guard result.status == "applied", !result.operationId.isEmpty, VersionToken.valid(result.cursor) else { throw ClientError.invalidData("API operation reply") }
        return result
    }
}
public struct APIErrorBody: Codable, Sendable, Equatable {
    public struct Detail: Codable, Sendable, Equatable {
        public var code: String
        public var retryable: Bool
        public var requestId: String
    }
    public var error: Detail
}

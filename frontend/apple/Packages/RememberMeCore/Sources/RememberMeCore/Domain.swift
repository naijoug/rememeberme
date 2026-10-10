import Foundation

public enum EntryKind: String, Codable, Sendable, CaseIterable {
    case word, phrase, abbreviation, properNoun = "proper_noun"
}

public enum VersionToken {
    public static let maximum = 9_007_199_254_740_991
    public static func valid(_ value: Int) -> Bool { value >= 0 && value <= maximum }
    public static func next(_ value: Int) throws -> Int {
        guard valid(value), value < maximum else { throw ClientError.invalidData("version token exhausted or invalid") }
        return value + 1
    }
}

public struct Encounter: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var timestamp: Double
    public var context: String
    public var url: String
    public var definition: JSONValue
    public var legacyFields: [String: JSONValue]
    public var cloudPosition: Int? = nil

    public init(id: String = UUID().uuidString, timestamp: Double, context: String,
                url: String, definition: JSONValue, legacyFields: [String: JSONValue] = [:]) {
        self.id = id; self.timestamp = timestamp; self.context = context
        self.url = url; self.definition = definition; self.legacyFields = legacyFields
    }
    public var navigableURL: URL? {
        guard let parsed = URL(string: url), let scheme = parsed.scheme?.lowercased(),
              ["http", "https"].contains(scheme), parsed.host != nil else { return nil }
        return parsed
    }
}

public struct VocabularyEntry: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var word: String
    public var normalizedKey: String
    public var kind: EntryKind
    public var count: Double?
    public var createdAt: Double
    public var updatedAt: Double
    public var definition: JSONValue
    public var notes: String
    public var version: Int
    public var deleted: Bool
    public var history: [Encounter]
    public var review: ReviewState?
    /// Remains monotonic even when a restore clears the studied state.
    public var reviewRevision: Int?
    public var reviewEvents: [ReviewEvent]
    public var legacyFields: [String: JSONValue]
    public var sourceDigest: String?
    public var aliases: [String]
    public var captureOrigin: CaptureDraft?

    public init(id: String = UUID().uuidString, word: String, kind: EntryKind = .word,
                count: Double? = nil, timestamp: Double = Date().timeIntervalSince1970 * 1000,
                definition: JSONValue? = nil) {
        self.id = id; self.word = word; normalizedKey = LegacyCodec.normalize(word)
        self.kind = kind; self.count = count; createdAt = timestamp; updatedAt = timestamp
        self.definition = definition ?? .object(["word": .string(word), "phonetics": .array([]), "meanings": .array([])])
        notes = ""; version = 0; deleted = false; history = []; review = nil; reviewEvents = []
        legacyFields = [:]; sourceDigest = nil; aliases = []; reviewRevision = nil; captureOrigin = nil
    }
    public var effectiveReviewVersion: Int { reviewRevision ?? review?.version ?? 0 }
}

public struct PendingOperation: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var owner: String
    public var entryID: String
    public var kind: String
    public var baseVersion: Int
    public var payload: JSONValue
    public var state: String
    public var sequence: Int64?
    public var observedRemoteVersion: Int?
    public var observedReviewVersion: Int?
    public var syncDependencyId: String?
    public var dependencyExpectedVersion: Int?
    public var dependencyExpectedReviewVersion: Int?
    public var observedVersionFloor: Int?
    public var observedReviewVersionFloor: Int?
    public var wireSourceRevision: Int?
    public var wirePrivacy: SyncPrivacy?
    public var wireCount: Int?
    public var confirmedRemoteVersion: Int?
    public var confirmedReviewVersion: Int?
    public var projectedReview: ReviewState?
    public init(id: String = UUID().uuidString, owner: String, entryID: String,
                kind: String, baseVersion: Int, payload: JSONValue) {
        self.id = id; self.owner = owner; self.entryID = entryID; self.kind = kind
        self.baseVersion = baseVersion; self.payload = payload; state = "pending"
        sequence = nil; observedRemoteVersion = nil; observedReviewVersion = nil
        syncDependencyId = nil; wirePrivacy = nil; wireCount = nil
        dependencyExpectedVersion = nil; dependencyExpectedReviewVersion = nil
        observedVersionFloor = nil; observedReviewVersionFloor = nil
        confirmedRemoteVersion = nil; confirmedReviewVersion = nil
        projectedReview = nil
    }
}

public struct Backup: Codable, Sendable, Equatable {
    public var format = "rememberme-backup"
    public var schemaVersion = 1
    public var exportedAtMs: Double
    public var entries: [VocabularyEntry]
    public var tombstones: [VocabularyEntry]
    public var importSources: [String]
    public init(entries: [VocabularyEntry], importSources: [String], exportedAtMs: Double) {
        self.exportedAtMs = exportedAtMs; self.entries = entries.filter { !$0.deleted }
        tombstones = entries.filter(\.deleted); self.importSources = importSources
    }
}

public enum EntrySort: Sendable { case count, updated }
public enum ImportMode: String, Codable, Sendable { case firstMigration, legacyMerge, restoreMerge, replaceAnonymous, bindAnonymous, reconcileEpoch, restoreAccount }

public struct ImportPreview: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let mode: ImportMode
    public let revision: Int64
    public let owner: String
    public var entries: [VocabularyEntry]
    public var sources: [String]
    public var conflicts: [RestoreConflict]
    public var operations: [PendingOperation]
    public var alreadyImported: Bool
    public var losses: [String]
    public var ownership: OwnershipProvenance? = nil
    public var epochRecovery: EpochRecoveryProvenance? = nil
    public var remoteBases: [String: APIEntry]? = nil
    public var accountRestore: AccountRestoreProvenance? = nil
}

public struct ImportRecovery: Sendable, Identifiable {
    public var id: String
    public var state: String
    public var mode: ImportMode?
    public var processed: Int
    public var total: Int
    public var copied: Int
    public var copyTotal: Int
    public var createdAtMs: Double?
    public var canResume: Bool
    public var explanation: String?
}

public struct ImportPruneResult: Sendable {
    public var removedRows: Int
    public var retainedLegacyGenerations: Bool
}

public struct RestoreConflict: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var reason: String
    public var canUseBackup: Bool
}

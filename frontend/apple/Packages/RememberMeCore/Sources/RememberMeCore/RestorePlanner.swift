import Foundation

public enum RestoreChoice: String, Sendable { case keepCurrent, useBackup }
public enum BackupCodec {
    public static func decode(_ data: Data) throws -> Backup {
        let root = try JSONDecoder().decode(JSONValue.self, from: data)
        guard root["format"]?.text == "rememberme-backup" else { throw ClientError.invalidData("backup format") }
        guard root["schemaVersion"]?.number == 1 else { throw ClientError.unsupportedVersion }
        guard Set(root.fields!.keys).isSubset(of: ["format", "schemaVersion", "exportedAtMs", "entries", "tombstones", "importSources"]) else {
            throw ClientError.invalidData("unknown backup envelope fields")
        }
        let backup = try JSONDecoder().decode(Backup.self, from: data)
        guard backup.exportedAtMs.isFinite, backup.exportedAtMs >= 0,
              backup.entries.allSatisfy({ !$0.deleted }), backup.tombstones.allSatisfy(\.deleted),
              Set(backup.importSources).count == backup.importSources.count else { throw ClientError.invalidData("backup envelope") }
        let all = backup.entries + backup.tombstones
        guard Set(all.map(\.id)).count == all.count else { throw ClientError.invalidData("duplicate entry ID") }
        var eventIDs = Set<String>()
        for entry in all {
            try entry.captureOrigin?.validate()
            guard !entry.id.isEmpty, !LegacyCodec.normalize(entry.word).isEmpty,
                  VersionToken.valid(entry.version), entry.createdAt.isFinite, entry.createdAt >= 0,
                  entry.updatedAt.isFinite, entry.updatedAt >= 0,
                  entry.reviewRevision == nil || VersionToken.valid(entry.reviewRevision!),
                  LegacyCodec.keyBytes(entry.normalizedKey) == LegacyCodec.keyBytes(LegacyCodec.normalize(entry.word)),
                  entry.count == nil || (entry.count!.isFinite && entry.count! >= 0),
                  LegacyCodec.validDefinition(entry.definition) else { throw ClientError.invalidData("backup entry") }
            for event in entry.history {
                guard !event.id.isEmpty, eventIDs.insert(event.id).inserted,
                      event.timestamp.isFinite, event.timestamp >= 0, LegacyCodec.validDefinition(event.definition) else {
                    throw ClientError.invalidData("backup encounter")
                }
            }
            if let review = entry.review {
                guard review.algorithmVersion == "review-v1", (0...4).contains(review.step), review.version >= 1, VersionToken.valid(review.version),
                      review.dueAtMs.isFinite, review.dueAtMs >= 0 else { throw ClientError.invalidData("backup review state") }
                guard entry.reviewRevision == nil || entry.reviewRevision == review.version else { throw ClientError.invalidData("backup review version") }
            }
            guard Set(entry.reviewEvents.map(\.id)).count == entry.reviewEvents.count,
                  entry.reviewEvents.allSatisfy({ !$0.id.isEmpty && $0.algorithmVersion == "review-v1"
                    && $0.answeredAtMs.isFinite && $0.answeredAtMs >= 0 && VersionToken.valid($0.baseReviewVersion) }) else {
                throw ClientError.invalidData("backup review events")
            }
        }
        return backup
    }
}

public enum RestorePlanner {
    public struct Result: Sendable {
        public var entries: [VocabularyEntry]
        public var conflicts: [RestoreConflict]
    }
    public static func merge(current: [VocabularyEntry], backup: Backup, choices: [String: RestoreChoice] = [:]) throws -> Result {
        var result = Result(entries: [], conflicts: [])
        let byID = Dictionary(uniqueKeysWithValues: current.map { ($0.id, $0) })
        for incoming in backup.entries + backup.tombstones {
            guard let existing = byID[incoming.id] else {
                if current.contains(where: { !$0.deleted && LegacyCodec.keyBytes($0.normalizedKey) == LegacyCodec.keyBytes(incoming.normalizedKey) }) {
                    if choices[incoming.id] != .keepCurrent {
                        result.conflicts.append(RestoreConflict(id: incoming.id, reason: "Different source for \(incoming.word)", canUseBackup: false))
                    }
                } else {
                    var restored = incoming; restored.version = 0
                    restored.reviewRevision = restored.review == nil ? nil : 1
                    if restored.review != nil { restored.review!.version = 1 }
                    result.entries.append(restored)
                }
                continue
            }
            if existing == incoming { continue }
            if existing.deleted && !incoming.deleted {
                if choices[incoming.id] != .keepCurrent {
                    result.conflicts.append(RestoreConflict(id: incoming.id, reason: "\(incoming.word) was deleted; keep deletion", canUseBackup: false))
                }
                continue
            }
            if current.contains(where: { $0.id != incoming.id && !$0.deleted
                && LegacyCodec.keyBytes($0.normalizedKey) == LegacyCodec.keyBytes(incoming.normalizedKey) }) {
                if choices[incoming.id] != .keepCurrent {
                    result.conflicts.append(RestoreConflict(id: incoming.id, reason: "Restored word conflicts with another entry", canUseBackup: false))
                }
                continue
            }
            let oldEvents = Dictionary(uniqueKeysWithValues: existing.history.map { ($0.id, $0) })
            let oldReviews = Dictionary(uniqueKeysWithValues: existing.reviewEvents.map { ($0.id, $0) })
            let changedEvent = incoming.history.contains { event in oldEvents[event.id].map { $0 != event } ?? false }
                || incoming.reviewEvents.contains { event in oldReviews[event.id].map { $0 != event } ?? false }
            if changedEvent {
                if choices[incoming.id] != .keepCurrent {
                    result.conflicts.append(RestoreConflict(id: incoming.id, reason: "Event ID has different immutable content", canUseBackup: false))
                }
                continue
            }
            let changedSnapshot = existing.count != incoming.count || existing.definition != incoming.definition
                || existing.notes != incoming.notes || existing.review != incoming.review || existing.deleted != incoming.deleted
                || existing.captureOrigin != incoming.captureOrigin
                || existing.kind != incoming.kind || LegacyCodec.keyBytes(existing.word) != LegacyCodec.keyBytes(incoming.word)
            if changedSnapshot && choices[incoming.id] == nil {
                result.conflicts.append(RestoreConflict(id: incoming.id, reason: "Different saved state for \(incoming.word)", canUseBackup: true))
                continue
            }
            var merged = existing
            if choices[incoming.id] == .useBackup {
                merged.count = incoming.count; merged.definition = incoming.definition; merged.notes = incoming.notes
                merged.kind = incoming.kind; merged.word = incoming.word; merged.normalizedKey = incoming.normalizedKey
                merged.captureOrigin = incoming.captureOrigin
                merged.review = incoming.review; merged.deleted = incoming.deleted
                if merged.review != existing.review {
                    // A restored schedule is a new local state, never a restored CAS token.
                    merged.reviewRevision = try VersionToken.next(existing.effectiveReviewVersion)
                    if merged.review != nil { merged.review!.version = merged.reviewRevision! }
                }
            }
            merged.history += incoming.history.filter { oldEvents[$0.id] == nil }
            merged.reviewEvents += incoming.reviewEvents.filter { oldReviews[$0.id] == nil }
            if merged != existing { merged.version = try VersionToken.next(existing.version); result.entries.append(merged) }
        }
        return result
    }
}

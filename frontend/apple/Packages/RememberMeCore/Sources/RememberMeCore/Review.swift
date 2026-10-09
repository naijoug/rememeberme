import Foundation

public enum ReviewResult: String, Codable, Sendable, CaseIterable { case forgot, fuzzy, remembered }
public struct ReviewState: Codable, Sendable, Equatable {
    public var algorithmVersion = "review-v1"
    public var step: Int
    public var dueAtMs: Double
    public var version: Int
    public init(step: Int, dueAtMs: Double, version: Int) {
        self.step = step; self.dueAtMs = dueAtMs; self.version = version
    }
}
public struct ReviewEvent: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var result: ReviewResult
    public var answeredAtMs: Double
    public var baseReviewVersion: Int
    public var algorithmVersion: String
    public var originEventId: String? = nil
    public init(id: String = UUID().uuidString, result: ReviewResult, answeredAtMs: Double, baseReviewVersion: Int) {
        self.id = id; self.result = result; self.answeredAtMs = answeredAtMs
        self.baseReviewVersion = baseReviewVersion; algorithmVersion = "review-v1"
    }
}
public enum ReviewAlgorithm {
    public static let dayMs: Double = 86_400_000
    public static let intervals: [Double] = [1, 3, 7, 14, 30]
    public static func next(_ state: ReviewState?, result: ReviewResult, at timestamp: Double) throws -> ReviewState {
        guard timestamp.isFinite, timestamp >= 0,
              state == nil || (state!.algorithmVersion == "review-v1" && (0...4).contains(state!.step)
                && state!.version > 0 && VersionToken.valid(state!.version)) else {
            throw ClientError.invalidData("review state or answer time")
        }
        let current = state?.step ?? -1
        let step: Int
        switch result {
        case .forgot: step = 0
        case .fuzzy: step = max(current, 0)
        case .remembered: step = min(current + 1, 4)
        }
        let due = timestamp + intervals[step] * dayMs
        guard due.isFinite, due > timestamp else { throw ClientError.invalidNumber }
        return ReviewState(step: step, dueAtMs: due, version: try VersionToken.next(state?.version ?? 0))
    }
}

public struct ReviewQueue: Sendable {
    public var entries: [VocabularyEntry]
    public var remainingNewAllowance: Int
    public var dueCount: Int
    public init(entries: [VocabularyEntry], remainingNewAllowance: Int, dueCount: Int) {
        self.entries = entries; self.remainingNewAllowance = remainingNewAllowance; self.dueCount = dueCount
    }
}

public enum ReviewDate {
    public static func localDay(_ timestamp: Double, timeZoneID: String) throws -> String {
        guard timestamp.isFinite, timestamp >= 0, timestamp <= 8_640_000_000_000_000,
              let timeZone = TimeZone(identifier: timeZoneID) else { throw ClientError.invalidData("review date or time zone") }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = timeZone
        let parts = calendar.dateComponents([.year, .month, .day], from: Date(timeIntervalSince1970: timestamp / 1000))
        return String(format: "%04d-%02d-%02d", parts.year!, parts.month!, parts.day!)
    }
}

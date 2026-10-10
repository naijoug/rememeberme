import Foundation
import RememberMeCore

enum SyncBenchmarkProbe {
    static func run(_ path: String) async throws {
        let url = URL(fileURLWithPath: path).standardizedFileURL
        guard url.deletingLastPathComponent().lastPathComponent.hasPrefix("rememberme-sync-benchmark-"),
              !FileManager.default.fileExists(atPath: url.path) else { throw ClientError.invalidData("new synthetic benchmark directory required") }
        let identity = ConnectedIdentity(origin: "https://benchmark.example.test", userId: "synthetic-benchmark", deviceId: "synthetic-device")
        let owner = SyncConfiguration.owner(for: identity)
        let repository = try LocalRepository(url: url, owner: owner)
        try await repository.configureSync(identity: identity, enabled: true)
        let account = try JSONDecoder().decode(APIAccountIdentity.self, from: JSONValue.encoder().encode(JSONValue.object([
            "userId": .string(identity.userId), "deviceId": .string(identity.deviceId), "epoch": .string("synthetic-epoch"),
            "timezone": .string("UTC"), "syncContext": .bool(false), "syncURLs": .bool(false)])))
        try await repository.initializeSyncEpoch(account)
        let emptyPage = try JSONDecoder().decode(SyncCheckpointPage.self, from: Data(#"{"epoch":"synthetic-epoch","boundary":0,"nextCursor":0,"hasMore":false,"changes":[]}"#.utf8))
        try await repository.applySyncPage(emptyPage, snapshot: true)
        let definition: JSONValue = .object(["word": .string("synthetic"), "phonetics": .array([]), "meanings": .array([])])
        let started = Date()
        var entries: [VocabularyEntry] = []
        for index in 0..<10_000 {
            var entry = VocabularyEntry(word: "synthetic-\(index)", count: 1, timestamp: 1, definition: definition)
            entry.history = (0..<10).map { Encounter(id: "synthetic-\(index)-\($0)", timestamp: Double($0), context: "Synthetic source", url: "https://example.test", definition: definition) }
            entries.append(entry)
        }
        let preview = try await repository.previewLegacy(LegacyCodec.export(entries), mode: .firstMigration)
        try await repository.begin(preview); try await repository.resumeImport(preview.id)
        let setupSeconds = Date().timeIntervalSince(started)
        var status: [Double] = [], wire: [Double] = []
        let freezeStart = Date()
        guard let frozen = try await repository.nextSyncWire() else { throw ClientError.invalidData("benchmark request missing") }
        let initialFreezeMs = Date().timeIntervalSince(freezeStart) * 1000
        for _ in 0..<30 {
            var started = Date(); _ = try await repository.syncStatus(); status.append(Date().timeIntervalSince(started) * 1000)
            started = Date()
            guard try await repository.nextSyncWire()?.body == frozen.body else { throw ClientError.invalidData("benchmark retry changed") }
            wire.append(Date().timeIntervalSince(started) * 1000)
        }
        try await repository.close()
        let reopenStart = Date(), reopened = try LocalRepository(url: url, owner: owner)
        guard let retry = try await reopened.nextSyncWire(), retry.body == frozen.body else { throw ClientError.invalidData("benchmark restart changed") }
        let recoveryMs = Date().timeIntervalSince(reopenStart) * 1000
        var usage = rusage(); getrusage(RUSAGE_SELF, &usage)
        let report: JSONValue = .object(["words": .number(10_000), "historyRecords": .number(100_000), "setupSeconds": .number(setupSeconds),
            "statusP95Ms": .number(status.sorted()[28]), "frozenRetryP95Ms": .number(wire.sorted()[28]), "firstFreezeMs": .number(initialFreezeMs),
            "reopenFrozenRequestMs": .number(recoveryMs), "peakResidentBytes": .number(Double(usage.ru_maxrss))])
        print(String(decoding: try JSONValue.encoder().encode(report), as: UTF8.self)); try await reopened.close()
    }
}

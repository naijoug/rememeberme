import Foundation
import RememberMeCore

@main struct Probe {
    static func main() async throws {
        let args = CommandLine.arguments
        guard args.count >= 3 else { throw ClientError.invalidData("usage: RememberMeProbe contracts|before-publish|after-publish|inspect PATH") }
        if args[1] == "native-sync" { try await NativeSyncProbe.run(Array(args.dropFirst(2))); return }
        if args[1] == "keychain-smoke" {
            guard let uuid = UUID(uuidString: args[2]) else { throw ClientError.invalidData("unique Keychain fixture ID required") }
            let service = "com.rememberme.tests." + uuid.uuidString
            let first = KeychainCredentialVault(origin: "https://keychain-fixture.example.test", service: service)
            let other = KeychainCredentialVault(origin: "https://other-keychain-fixture.example.test", service: service)
            guard try first.load() == nil, try other.load() == nil else { throw ClientError.conflict("refusing to overwrite an existing Keychain fixture") }
            defer { try? first.clear(); try? other.clear() }
            let pair = APICredentials(accessToken: String(repeating: "a", count: 43), refreshToken: String(repeating: "b", count: 43),
                accessExpiresAtMs: 1_700_000_100_000, refreshExpiresAtMs: 1_700_000_900_000,
                userId: "synthetic-user", deviceId: "synthetic-device")
            try first.save(pair)
            let reopened = KeychainCredentialVault(origin: "https://keychain-fixture.example.test", service: service)
            guard try reopened.load() == pair, try other.load() == nil else { throw ClientError.invalidData("Keychain scope or recovery") }
            try reopened.clear()
            guard try first.load() == nil else { throw ClientError.invalidData("Keychain removal") }
            print("Synthetic Keychain write/reopen/origin-isolation/remove passed.")
            return
        }
        if args[1] == "contracts" {
            let data = try Data(contentsOf: URL(fileURLWithPath: args[2]))
            let entries = try LegacyCodec.decode(data)
            let result: JSONValue = .object([
                "sourceDigest": .string(LegacyCodec.digest(data)),
                "entries": .array(entries.map { .object(["id": .string($0.id), "word": .string($0.word),
                    "count": .number($0.count!), "encounters": .array($0.history.map { .string($0.id) })]) })
            ])
            print(String(decoding: try JSONValue.encoder().encode(result), as: UTF8.self))
            return
        }
        if args[1].hasPrefix("capture-") {
            let folder = URL(fileURLWithPath: args[2])
            let inbox = CaptureInbox(directory: folder.appendingPathComponent("inbox"))
            if args[1] == "capture-save" {
                try await inbox.save(CaptureDraft(id: "00000000-0000-0000-0000-000000000001", text: "Synthetic shared text.",
                    sourceURL: "https://example.test/shared", createdAtMs: 1))
                _exit(0)
            }
            let repository = try LocalRepository(url: folder.appendingPathComponent("store.sqlite"))
            if args[1] == "capture-inspect" {
                print("\(try await repository.captureDrafts().count):\(try await repository.entries().count):\(try await repository.pendingOperations().count)")
                try await repository.close(); return
            }
            for draft in try await inbox.scan().drafts {
                try await repository.receiveCapture(draft)
                if args[1] == "capture-before-ack" { _exit(0) }
                try await inbox.acknowledge(draft)
            }
            _exit(0)
        }
        if ["sync-freeze-exit", "sync-inspect"].contains(args[1]) {
            let url = URL(fileURLWithPath: args[2])
            let identity = ConnectedIdentity(origin: "https://process-fixture.example.test", userId: "synthetic-process-user", deviceId: "synthetic-process-device")
            let repository = try LocalRepository(url: url, owner: SyncConfiguration.owner(for: identity))
            let expectedURL = url.deletingLastPathComponent().appendingPathComponent("frozen-fixture.json")
            if args[1] == "sync-inspect" {
                let expected = try JSONDecoder().decode(SyncWireItem.self, from: Data(contentsOf: expectedURL))
                guard let actual = try await repository.nextSyncWire(now: 100_000), actual.id == expected.id,
                      actual.body == expected.body, actual.logicalId == expected.logicalId, actual.attempts == 1,
                      try await repository.syncStatus().pending == 1,
                      try await repository.entry("synthetic-process-entry")?.count == 0.5 else { throw ClientError.invalidData("frozen wire process recovery") }
                print("Frozen request/identity/backoff/local vocabulary survived a separate process.")
                try await repository.close(); return
            }
            try await repository.configureSync(identity: identity, enabled: true)
            let account = try JSONDecoder().decode(APIAccountIdentity.self, from: Data(#"{"userId":"synthetic-process-user","deviceId":"synthetic-process-device","epoch":"synthetic-process-epoch","timezone":"UTC","syncContext":false,"syncURLs":false}"#.utf8))
            try await repository.initializeSyncEpoch(account)
            let page = try JSONDecoder().decode(SyncCheckpointPage.self, from: Data(#"{"epoch":"synthetic-process-epoch","boundary":0,"nextCursor":0,"hasMore":false,"changes":[]}"#.utf8))
            try await repository.applySyncPage(page, snapshot: true)
            try await repository.create(VocabularyEntry(id: "synthetic-process-entry", word: "synthetic", count: 0.5, timestamp: 1))
            guard let wire = try await repository.nextSyncWire() else { throw ClientError.invalidData("no frozen request") }
            try JSONValue.encoder().encode(wire).write(to: expectedURL, options: .atomic)
            try await repository.rejectSyncWire(wire.id, code: "NETWORK_UNAVAILABLE", retryable: true, now: 1000)
            _exit(0)
        }
        let repository = try LocalRepository(url: URL(fileURLWithPath: args[2]))
        if ["import-copy-exit", "import-stage-exit", "import-ready-exit", "import-resume"].contains(args[1]) {
            if args[1] == "import-resume" {
                guard let job = try await repository.recoverableImports().first else { throw ClientError.invalidData("no interrupted import") }
                try await repository.resumeImport(job.id, chunkSize: 1)
                print("\(try await repository.entries().count):\(try await repository.pendingOperations().count)")
                try await repository.close(); return
            }
            try await repository.create(VocabularyEntry(id: "original", word: "original", count: 3, timestamp: 1))
            let bytes = try LegacyCodec.export([VocabularyEntry(word: "recoverable", count: 2, timestamp: 1),
                                               VocabularyEntry(word: "second", count: 4, timestamp: 1)])
            let preview = try await repository.previewLegacy(bytes, mode: .firstMigration)
            try await repository.begin(preview)
            if args[1] == "import-copy-exit" { try await repository.copyImportChunk(preview.id, limit: 1) }
            else if args[1] == "import-stage-exit" { try await repository.stage(preview, start: 0, limit: 1) }
            else { try await repository.stage(preview, start: 0) }
            _exit(0)
        }
        if args[1] == "benchmark" {
            let start = Date()
            var words: [VocabularyEntry] = []
            for index in 0..<10_000 {
                var entry = VocabularyEntry(word: "synthetic-\(index)", count: Double(index % 10), timestamp: 1)
                entry.history = (0..<10).map { event in Encounter(id: "synthetic-\(index)-\(event)", timestamp: Double(event),
                    context: "Synthetic context only.", url: "https://example.test/synthetic", definition: entry.definition) }
                words.append(entry)
            }
            let bytes = try LegacyCodec.export(words)
            let preview = try await repository.previewLegacy(bytes, mode: .firstMigration)
            try await repository.begin(preview)
            for offset in stride(from: 0, to: preview.entries.count, by: 100) { try await repository.stage(preview, start: offset, limit: 100) }
            try await repository.publish(preview.id)
            let importedSeconds = Date().timeIntervalSince(start)
            let appendStart = Date()
            let extra = try LegacyCodec.export([VocabularyEntry(word: "additional", count: 2, timestamp: 1)])
            let appendPreview = try await repository.previewLegacy(extra, mode: .firstMigration)
            try await repository.begin(appendPreview)
            var copyChunks = 0
            while try await repository.batchState(appendPreview.id) == "copying" {
                try await repository.copyImportChunk(appendPreview.id, limit: 500); copyChunks += 1
            }
            try await repository.stage(appendPreview, start: 0); try await repository.publish(appendPreview.id)
            let appendSeconds = Date().timeIntervalSince(appendStart)
            var samples: [Double] = []
            for index in 0..<30 {
                let now = Date()
                _ = try await repository.entries(search: "synthetic-\(index)")
                samples.append(Date().timeIntervalSince(now) * 1000)
            }
            var usage = rusage(); getrusage(RUSAGE_SELF, &usage)
            let result: JSONValue = .object(["words": .number(10_000), "historyRecords": .number(100_000),
                "importSeconds": .number(importedSeconds), "searchP95Ms": .number(samples.sorted()[28]),
                "peakResidentBytes": .number(Double(usage.ru_maxrss)), "existingStoreAppendSeconds": .number(appendSeconds),
                "existingStoreCopyChunks": .number(Double(copyChunks))])
            print(String(decoding: try JSONValue.encoder().encode(result), as: UTF8.self))
            try await repository.close(); return
        }
        if args[1] == "inspect" {
            print("\(try await repository.entries().count):\(try await repository.pendingOperations().count)")
            try await repository.close(); return
        }
        let entry = VocabularyEntry(id: "probe-entry", word: "synthetic")
        let bytes = try LegacyCodec.export([entry])
        let preview = try await repository.previewLegacy(bytes, mode: .firstMigration)
        try await repository.begin(preview)
        try await repository.stage(preview, start: 0)
        if args[1] == "after-publish" { try await repository.publish(preview.id) }
        // Intentionally bypass teardown: the parent verifies recovery in a fresh process.
        _exit(0)
    }
}

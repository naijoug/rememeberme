import Foundation
import CryptoKit

/// Old array receipts and full-JSON plans remain readable. New plans are written
/// one entry at a time so the encoder never materializes the entire object graph.
struct ImportJobManifest: Codable, Sendable {
    var version = 1
    var mode: ImportMode
    var sourceGeneration: String
    var sources: [String]
    var planDigest: String
    var planBytes: Int
    var createdAtMs: Double
    var copyEntityIndex: Int
    var copyOffset: Int
    var copied: Int
    var copyTotal: Int
    var cleanupComplete: Bool?
    var planFormat: String?
}

private struct ImportPlanHeader: Codable {
    var format = "rememberme-import-plan"
    var version = 1
    var preview: ImportPreview
    var itemCount: Int
    var operationCount: Int
    var operationOrder: [String]?
    var remoteBaseCount: Int? = nil
}
private struct ImportPlanItem: Codable {
    var entry: VocabularyEntry
    var operations: [PendingOperation]
    var remoteBase: APIEntry? = nil
}

enum ImportPlanFiles {
    static func file(_ directory: URL, id: String) throws -> URL {
        guard let uuid = UUID(uuidString: id), uuid.uuidString == id else { throw ClientError.invalidData("import identity") }
        return directory.appendingPathComponent(id + ".json")
    }
    static func save(_ preview: ImportPreview, directory: URL) throws -> (digest: String, bytes: Int, created: Bool, format: String) {
        let file = try file(directory, id: preview.id)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        guard !FileManager.default.fileExists(atPath: file.path) else { throw ClientError.conflict("import plan already exists") }
        let temporary = directory.appendingPathComponent(".plan-" + UUID().uuidString + ".pending")
        defer { try? FileManager.default.removeItem(at: temporary) }
        guard FileManager.default.createFile(atPath: temporary.path, contents: nil) else { throw ClientError.invalidData("cannot create import plan") }
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: temporary.path)
        #endif
        let handle = try FileHandle(forWritingTo: temporary)
        defer { try? handle.close() }
        let entryIDs = Set(preview.entries.map(\.id))
        guard entryIDs.count == preview.entries.count, Set(preview.operations.map(\.id)).count == preview.operations.count,
              preview.operations.allSatisfy({ entryIDs.contains($0.entryID) }),
              Set(preview.remoteBases?.keys.map { $0 } ?? []).isSubset(of: entryIDs),
              preview.remoteBases?.allSatisfy({ $0.key == $0.value.id }) != false else {
            throw ClientError.invalidData("import plan identities")
        }
        let grouped = Dictionary(grouping: preview.operations, by: \.entryID)
        var summary = preview; summary.entries = []; summary.operations = []
        if summary.remoteBases != nil { summary.remoteBases = [:] }
        var hasher = SHA256(), bytes = 0
        func append<T: Encodable>(_ value: T) throws {
            try autoreleasepool {
                var data = try JSONValue.encoder().encode(value); data.append(10)
                try handle.write(contentsOf: data); hasher.update(data: data); bytes += data.count
            }
        }
        try append(ImportPlanHeader(preview: summary, itemCount: preview.entries.count, operationCount: preview.operations.count,
            operationOrder: preview.operations.map(\.id), remoteBaseCount: preview.remoteBases?.count))
        for entry in preview.entries { try append(ImportPlanItem(entry: entry, operations: grouped[entry.id] ?? [], remoteBase: preview.remoteBases?[entry.id])) }
        try handle.synchronize()
        try FileManager.default.linkItem(at: temporary, to: file)
        let digest = LegacyCodec.hexBytes(hasher.finalize())
        return (digest, bytes, true, "ndjson-v1")
    }
    static func load(_ directory: URL, id: String, manifest: ImportJobManifest) throws -> ImportPreview {
        guard manifest.version == 1 else { throw ClientError.unsupportedVersion }
        let file = try file(directory, id: id)
        let properties = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard properties.isRegularFile == true, properties.isSymbolicLink != true,
              properties.fileSize == manifest.planBytes else { throw ClientError.invalidData("import plan changed or missing") }
        let preview: ImportPreview
        if manifest.planFormat == nil {
            let data = try Data(contentsOf: file)
            guard LegacyCodec.digest(data) == manifest.planDigest else { throw ClientError.invalidData("import plan changed") }
            preview = try JSONDecoder().decode(ImportPreview.self, from: data)
        } else {
            guard manifest.planFormat == "ndjson-v1" else { throw ClientError.unsupportedVersion }
            let handle = try FileHandle(forReadingFrom: file); defer { try? handle.close() }
            var header: ImportPlanHeader?, entries: [VocabularyEntry] = [], operations: [PendingOperation] = []
            var remoteBases: [String: APIEntry] = [:]
            var buffer = Data(), hasher = SHA256()
            func consume(_ line: Data) throws {
                try autoreleasepool {
                    if header == nil {
                        let decoded = try JSONDecoder().decode(ImportPlanHeader.self, from: line)
                        guard decoded.format == "rememberme-import-plan", decoded.version == 1,
                              decoded.itemCount >= 0, decoded.operationCount >= 0,
                              decoded.preview.entries.isEmpty, decoded.preview.operations.isEmpty,
                              decoded.preview.remoteBases?.isEmpty != false else { throw ClientError.invalidData("import plan header") }
                        header = decoded
                    } else {
                        let item = try JSONDecoder().decode(ImportPlanItem.self, from: line)
                        guard entries.count < header!.itemCount, item.operations.allSatisfy({ $0.entryID == item.entry.id }) else {
                            throw ClientError.invalidData("import plan item")
                        }
                        entries.append(item.entry); operations += item.operations
                        if let base = item.remoteBase {
                            guard base.id == item.entry.id, remoteBases[base.id] == nil else { throw ClientError.invalidData("recovery base identity") }
                            try base.validate(); remoteBases[base.id] = base
                        }
                    }
                }
            }
            while let chunk = try handle.read(upToCount: 65_536), !chunk.isEmpty {
                hasher.update(data: chunk); buffer.append(chunk)
                while let index = buffer.firstIndex(of: 10) {
                    try consume(Data(buffer[..<index])); buffer.removeSubrange(...index)
                }
            }
            let digest = LegacyCodec.hexBytes(hasher.finalize())
            guard buffer.isEmpty, digest == manifest.planDigest, let header,
                  entries.count == header.itemCount, operations.count == header.operationCount,
                  Set(entries.map(\.id)).count == entries.count,
                  Set(operations.map(\.id)).count == operations.count,
                  header.remoteBaseCount == nil || header.remoteBaseCount == remoteBases.count else { throw ClientError.invalidData("import plan integrity") }
            if let order = header.operationOrder {
                let byID = Dictionary(uniqueKeysWithValues: operations.map { ($0.id, $0) })
                guard order.count == operations.count, Set(order) == Set(byID.keys) else { throw ClientError.invalidData("import operation order") }
                operations = order.map { byID[$0]! }
            }
            var result = header.preview; result.entries = entries; result.operations = operations
            if header.preview.remoteBases != nil { result.remoteBases = remoteBases }
            preview = result
        }
        guard preview.id == id, preview.mode == manifest.mode, preview.sources == manifest.sources,
              preview.conflicts.isEmpty, !preview.alreadyImported else { throw ClientError.invalidData("import plan") }
        return preview
    }
    static func remove(_ directory: URL, id: String) throws {
        let file = try file(directory, id: id)
        if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
    }
}

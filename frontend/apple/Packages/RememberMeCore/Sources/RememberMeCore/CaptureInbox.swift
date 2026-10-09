import Foundation

public struct CaptureDraft: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var text: String
    public var sourceURL: String?
    public var createdAtMs: Double
    public init(id: String = UUID().uuidString, text: String, sourceURL: String? = nil,
                createdAtMs: Double = Date().timeIntervalSince1970 * 1000) {
        self.id = id; self.text = text; self.sourceURL = sourceURL; self.createdAtMs = createdAtMs
    }
    public func validate() throws {
        guard let uuid = UUID(uuidString: id), uuid.uuidString == id, createdAtMs.isFinite, createdAtMs >= 0,
              text.utf16.count <= 16_384, (sourceURL?.utf16.count ?? 0) <= 8192,
              !LegacyCodec.trim(text).isEmpty || !(sourceURL ?? "").isEmpty else { throw ClientError.invalidData("share draft") }
    }
    public var navigableURL: URL? {
        guard let sourceURL, let url = URL(string: sourceURL), let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme), url.host != nil else { return nil }
        return url
    }
}

public struct CaptureInboxScan: Sendable {
    public var drafts: [CaptureDraft]
    public var unreadableFiles: [String]
}

/// App and Share Extension each get an instance pointing at the App Group folder.
/// One immutable file per capture ID avoids a shared read/modify/write array race.
public actor CaptureInbox {
    private let directory: URL
    public init(directory: URL) { self.directory = directory }
    public func save(_ draft: CaptureDraft) throws {
        try draft.validate()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = directory.appendingPathComponent(draft.id + ".json")
        if FileManager.default.fileExists(atPath: file.path) {
            guard try JSONDecoder().decode(CaptureDraft.self, from: Data(contentsOf: file)) == draft else { throw ClientError.conflict("capture ID reused") }
            return
        }
        let data = try JSONValue.encoder().encode(draft)
        let temporary = directory.appendingPathComponent(".capture-" + UUID().uuidString + ".pending")
        defer { try? FileManager.default.removeItem(at: temporary) }
        #if os(iOS)
        try data.write(to: temporary, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try data.write(to: temporary, options: .atomic)
        #endif
        let handle = try FileHandle(forWritingTo: temporary)
        defer { try? handle.close() }
        try handle.synchronize()
        do { try FileManager.default.linkItem(at: temporary, to: file) }
        catch {
            // Exclusive hard-link publication cannot overwrite a concurrent writer.
            guard FileManager.default.fileExists(atPath: file.path),
                  try JSONDecoder().decode(CaptureDraft.self, from: Data(contentsOf: file)) == draft else { throw error }
        }
    }
    public func scan() throws -> CaptureInboxScan {
        guard FileManager.default.fileExists(atPath: directory.path) else { return CaptureInboxScan(drafts: [], unreadableFiles: []) }
        var result = CaptureInboxScan(drafts: [], unreadableFiles: [])
        for file in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey]) where file.pathExtension == "json" {
            do {
                let properties = try file.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
                guard properties.isRegularFile == true, (properties.fileSize ?? Int.max) <= 256 * 1024 else { throw ClientError.invalidData("capture file") }
                let draft = try JSONDecoder().decode(CaptureDraft.self, from: Data(contentsOf: file))
                try draft.validate()
                guard file.lastPathComponent == draft.id + ".json" else { throw ClientError.invalidData("capture filename") }
                result.drafts.append(draft)
            } catch { result.unreadableFiles.append(file.lastPathComponent) }
        }
        result.drafts.sort { $0.createdAtMs == $1.createdAtMs ? $0.id < $1.id : $0.createdAtMs < $1.createdAtMs }
        return result
    }
    /// Call only after the app's repository has committed this exact draft.
    public func acknowledge(_ draft: CaptureDraft) throws {
        try draft.validate()
        let file = directory.appendingPathComponent(draft.id + ".json")
        guard FileManager.default.fileExists(atPath: file.path) else { return }
        guard try JSONDecoder().decode(CaptureDraft.self, from: Data(contentsOf: file)) == draft else { throw ClientError.conflict("capture changed") }
        try FileManager.default.removeItem(at: file)
    }
}

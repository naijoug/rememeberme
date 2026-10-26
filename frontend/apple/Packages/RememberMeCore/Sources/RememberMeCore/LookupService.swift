import Foundation

public enum LookupError: Error, Sendable, LocalizedError {
    case invalidWord, localUnavailable, timedOut, notFound, quota, invalidResponse, http(Int)
    public var errorDescription: String? {
        switch self {
        case .invalidWord: return "Online lookup supports one English word. Other entries can use manual definitions."
        case .localUnavailable: return "The packaged dictionary could not be opened."
        case .timedOut: return "Lookup timed out. Try again."
        case .notFound: return "No definition was found. You can still save this word."
        case .quota: return "The provider's free quota is exhausted. Try later."
        case .invalidResponse: return "The provider returned an invalid definition."
        case .http(let code): return "The provider is unavailable (HTTP \(code))."
        }
    }
}
public struct LookupHTTPResponse: Sendable {
    public var status: Int
    public var data: Data
    public init(status: Int, data: Data) { self.status = status; self.data = data }
}
public protocol LookupTransport: Sendable {
    func fetch(_ url: URL) async throws -> LookupHTTPResponse
}
public struct URLSessionLookupTransport: LookupTransport {
    private let session: URLSession
    public init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil; configuration.urlCredentialStorage = nil
        configuration.httpShouldSetCookies = false; configuration.timeoutIntervalForRequest = 8
        configuration.timeoutIntervalForResource = 8.5
        session = URLSession(configuration: configuration)
    }
    public func fetch(_ url: URL) async throws -> LookupHTTPResponse {
        var request = URLRequest(url: url); request.httpShouldHandleCookies = false
        let (bytes, response) = try await session.bytes(for: request)
        guard let response = response as? HTTPURLResponse else { throw LookupError.invalidResponse }
        var data = Data()
        for try await byte in bytes {
            guard data.count < 2 * 1024 * 1024 else { throw LookupError.invalidResponse }
            data.append(byte)
        }
        return LookupHTTPResponse(status: response.statusCode, data: data)
    }
}

private func deadline<T: Sendable>(_ seconds: Double, operation: @escaping @Sendable () async throws -> T) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask { try await operation() }
        group.addTask { try await Task.sleep(for: .seconds(max(0, seconds))); throw LookupError.timedOut }
        defer { group.cancelAll() }
        guard let value = try await group.next() else { throw CancellationError() }
        return value
    }
}

/// Each subscriber can cancel immediately. The underlying request continues while
/// another subscriber remains, and is cancelled when the last subscriber leaves.
private actor Coalescer<Value: Sendable> {
    struct Pending {
        var id: UUID
        var task: Task<Void, Never>
        var waiters: [UUID: CheckedContinuation<Value, Error>]
    }
    private var pending: [String: Pending] = [:]
    private var cancelled = Set<UUID>()
    private var active = Set<UUID>()
    func get(_ key: String, producer: @escaping @Sendable () async throws -> Value) async throws -> Value {
        let subscriber = UUID()
        active.insert(subscriber)
        defer { cancelled.remove(subscriber); active.remove(subscriber) }
        let value: Value = try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                if Task.isCancelled || cancelled.remove(subscriber) != nil { continuation.resume(throwing: CancellationError()); return }
                if pending[key] != nil { pending[key]!.waiters[subscriber] = continuation; return }
                let id = UUID()
                let task = Task {
                    do { let result = try await producer(); finish(key, id: id, result: .success(result)) }
                    catch { finish(key, id: id, result: .failure(error)) }
                }
                pending[key] = Pending(id: id, task: task, waiters: [subscriber: continuation])
            }
        } onCancel: { Task { await self.cancel(key, subscriber: subscriber) } }
        try Task.checkCancellation(); return value
    }
    func subscriberCount(_ key: String) -> Int { pending[key]?.waiters.count ?? 0 }
    private func cancel(_ key: String, subscriber: UUID) {
        guard active.contains(subscriber) else { return }
        guard var request = pending[key], let waiter = request.waiters.removeValue(forKey: subscriber) else {
            cancelled.insert(subscriber); return
        }
        waiter.resume(throwing: CancellationError())
        if request.waiters.isEmpty { request.task.cancel(); pending[key] = nil }
        else { pending[key] = request }
    }
    private func finish(_ key: String, id: UUID, result: Result<Value, Error>) {
        guard let request = pending[key], request.id == id else { return }
        pending[key] = nil
        for waiter in request.waiters.values { waiter.resume(with: result) }
    }
}

public actor LookupService {
    public struct Budgets: Sendable {
        public var local: Double = 1.5
        public var english: Double = 8.5
        public var chinese: Double = 4.5
        public var retryDelay: Double = 0.4
        public init() {}
    }
    private struct Cached: Codable, Sendable { var value: JSONValue; var at: Double }
    private let local: LocalWordNet
    private let transport: any LookupTransport
    private let cacheURL: URL?
    private let budgets: Budgets
    private let clock: @Sendable () -> Double
    private var englishCache: [String: Cached] = [:]
    private var chineseCache: [String: Cached] = [:]
    private var loadedCache = false
    private var chineseProvider: (any ChineseTranslationProvider)?
    private var providerGeneration = UUID()
    private let englishRequests = Coalescer<JSONValue>()
    private let chineseRequests = Coalescer<JSONValue>()

    public init(dictionaryDirectory: URL?, cacheURL: URL? = nil,
                transport: any LookupTransport = URLSessionLookupTransport(), budgets: Budgets = Budgets(),
                chineseProvider: (any ChineseTranslationProvider)? = nil,
                clock: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 * 1000 }) {
        local = LocalWordNet(directory: dictionaryDirectory); self.cacheURL = cacheURL
        self.transport = transport; self.budgets = budgets; self.clock = clock
        self.chineseProvider = chineseProvider
    }
    public func setChineseProvider(_ provider: (any ChineseTranslationProvider)?) {
        guard provider?.cacheNamespace != chineseProvider?.cacheNamespace else { return }
        chineseProvider = provider; providerGeneration = UUID()
    }
    public func english(_ input: String, refresh: Bool = false) async throws -> JSONValue {
        try Task.checkCancellation()
        let word = LegacyCodec.normalize(input)
        guard LegacyCodec.isEnglishWord(word) else { throw LookupError.invalidWord }
        if !refresh, let cached = englishCache[word], clock() >= cached.at, clock() - cached.at < 86_400_000 { return cached.value }
        let local = local, transport = transport, budgets = budgets
        let value = try await englishRequests.get(word) {
            try await deadline(budgets.english) {
                do { if let entry = try await deadline(budgets.local, operation: { try await local.lookup(word) }) { return entry } }
                catch is CancellationError { throw CancellationError() }
                catch { /* A missing/corrupt bundled shard permits online recovery. */ }
                let url = URL(string: "https://api.dictionaryapi.dev/api/v2/entries/en/" + word.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)!)!
                for attempt in 0...1 {
                    do {
                        let response = try await deadline(min(8, budgets.english), operation: { try await transport.fetch(url) })
                        try Self.checkStatus(response.status)
                        guard let first = try JSONDecoder().decode(JSONValue.self, from: response.data).items?.first,
                              var fields = first.fields else { throw LookupError.invalidResponse }
                        fields["phonetics"] = fields["phonetics"] ?? .array([]); fields["source"] = .string("dictionary-api")
                        let definition = JSONValue.object(fields)
                        guard LegacyCodec.validDefinition(definition) else { throw LookupError.invalidResponse }
                        return definition
                    } catch {
                        if error is CancellationError { throw error }
                        if let typed = error as? LookupError {
                            switch typed { case .notFound, .quota, .invalidResponse: throw error; default: break }
                        }
                        if error is DecodingError { throw LookupError.invalidResponse }
                        if attempt == 1 { throw error }
                        try await Task.sleep(for: .seconds(budgets.retryDelay))
                    }
                }
                throw LookupError.notFound
            }
        }
        try Task.checkCancellation()
        englishCache[word] = Cached(value: value, at: clock())
        return value
    }
    public func chinese(_ input: String, refresh: Bool = false) async throws -> JSONValue {
        try Task.checkCancellation()
        let word = LegacyCodec.normalize(input)
        guard LegacyCodec.isEnglishWord(word), word.utf16.count <= 500 else { throw LookupError.invalidWord }
        loadCache()
        let provider = chineseProvider, generation = providerGeneration
        let key = provider.map { $0.cacheNamespace + ":" + word } ?? word
        if !refresh, let cached = chineseCache[key], clock() >= cached.at, clock() - cached.at < Self.translationLifetime(key, cached.value) { return cached.value }
        let transport = transport, seconds = budgets.chinese
        let value = try await chineseRequests.get(key) {
            if let provider {
                return try await deadline(20) { try await provider.translate(word) }
            }
            return try await deadline(seconds) {
                var components = URLComponents(string: "https://api.mymemory.translated.net/get")!
                components.queryItems = [URLQueryItem(name: "q", value: word), URLQueryItem(name: "langpair", value: "en|zh-CN")]
                let response = try await transport.fetch(components.url!)
                try Self.checkStatus(response.status)
                let body = try JSONDecoder().decode(JSONValue.self, from: response.data)
                let status = body["responseStatus"]?.number ?? body["responseStatus"]?.text.flatMap(Double.init)
                if body["quotaFinished"] == .bool(true) || status == 403 || status == 429 { throw LookupError.quota }
                guard status == 200, let text = body["responseData"]?["translatedText"]?.text,
                      !LegacyCodec.normalize(text).isEmpty, text.utf16.count <= 2000,
                      LegacyCodec.normalize(text) != word else { throw LookupError.notFound }
                return .object(["text": .string(text.trimmingCharacters(in: .whitespacesAndNewlines)),
                                "target": .string("zh-CN"), "source": .string("mymemory")])
            }
        }
        try Task.checkCancellation()
        guard generation == providerGeneration else { throw CancellationError() }
        chineseCache[key] = Cached(value: value, at: clock())
        while chineseCache.count > 500 {
            if let oldest = chineseCache.min(by: { $0.value.at < $1.value.at })?.key { chineseCache[oldest] = nil }
        }
        if let cacheURL {
            try? FileManager.default.createDirectory(at: cacheURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            if let data = try? JSONValue.encoder().encode(chineseCache) { try? data.write(to: cacheURL, options: .atomic) }
        }
        return value
    }
    func englishSubscriberCount(_ word: String) async -> Int { await englishRequests.subscriberCount(LegacyCodec.normalize(word)) }
    private static func translationLifetime(_ key: String, _ value: JSONValue) -> Double {
        key.hasPrefix("backend-v3:") && value["source"]?.text == "mymemory" ? 3_600_000 : 604_800_000
    }
    private func loadCache() {
        guard !loadedCache else { return }; loadedCache = true
        guard let cacheURL, let data = try? Data(contentsOf: cacheURL),
              let cache = try? JSONDecoder().decode([String: Cached].self, from: data) else { return }
        for (word, entry) in cache.sorted(by: { $0.value.at < $1.value.at }).suffix(500) {
            guard (LegacyCodec.isEnglishWord(word) || word.hasPrefix("hermes:") || word.hasPrefix("backend-v3:")), entry.at.isFinite, clock() >= entry.at,
                  clock() - entry.at < Self.translationLifetime(word, entry.value),
                  let text = entry.value["text"]?.text, !text.isEmpty, text.utf16.count <= 2000,
                  ["mymemory", "hermes", "magpie"].contains(entry.value["source"]?.text ?? ""), entry.value["target"]?.text == "zh-CN" else { continue }
            chineseCache[word] = entry
        }
    }
    private static func checkStatus(_ status: Int) throws {
        if status == 404 { throw LookupError.notFound }
        if status == 429 { throw LookupError.quota }
        guard (200..<300).contains(status) else { throw LookupError.http(status) }
    }
}

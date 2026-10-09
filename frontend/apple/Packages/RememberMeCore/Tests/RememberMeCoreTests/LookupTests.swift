import Foundation
import Testing
@testable import RememberMeCore

private let repositoryRoot = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    .appendingPathComponent("../../../../../..").standardizedFileURL
private let wordnet = repositoryRoot.appendingPathComponent("frontend/browser-extension/public/dictionary/wordnet")

private actor SyntheticTransport: LookupTransport {
    var urls: [URL] = []
    let status: Int
    let body: String
    let delay: Double
    private var cancellations = 0
    init(status: Int = 200, body: String, delay: Double = 0) {
        self.status = status; self.body = body; self.delay = delay
    }
    func fetch(_ url: URL) async throws -> LookupHTTPResponse {
        urls.append(url)
        do { if delay > 0 { try await Task.sleep(for: .seconds(delay)) } }
        catch { cancellations += 1; throw error }
        return LookupHTTPResponse(status: status, data: Data(body.utf8))
    }
    func calls() -> Int { urls.count }
    func wasCancelled() -> Bool { cancellations > 0 }
}
private let english = "[{\"word\":\"synthetic\",\"phonetics\":[],\"meanings\":[{\"partOfSpeech\":\"noun\",\"definitions\":[{\"definition\":\"Synthetic definition\"}]}]}]"
private let chinese = "{\"responseStatus\":200,\"responseData\":{\"translatedText\":\"合成释义\"}}"
private actor GatedLookupTransport: LookupTransport {
    var count = 0
    var cancelled = false
    private var continuation: CheckedContinuation<Void, Error>?
    func fetch(_ url: URL) async throws -> LookupHTTPResponse {
        count += 1
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (waiting: CheckedContinuation<Void, Error>) in continuation = waiting }
        } onCancel: { Task { await self.reject() } }
        return .init(status: 200, data: Data(english.utf8))
    }
    func complete() { let waiting = continuation; continuation = nil; waiting?.resume() }
    func reject() { cancelled = true; let waiting = continuation; continuation = nil; waiting?.resume(throwing: CancellationError()) }
    func calls() -> Int { count }
    func wasCancelled() -> Bool { cancelled }
}

@Test func packagedExactAndMorphologyNeedNoEnglishNetwork() async throws {
    let transport = SyntheticTransport(body: english)
    let service = LookupService(dictionaryDirectory: wordnet, transport: transport)
    let have = try await service.english("have")
    #expect(have["source"]?.text == "wordnet")
    #expect(have["word"]?.text == "have")
    let having = try await service.english("Having")
    #expect(having["word"]?.text == "have")
    #expect(having["source"]?.text == "wordnet")
    #expect(try await service.english("run")["word"]?.text == "run")
    #expect(await transport.calls() == 0)
}

@Test func absentAndCorruptLocalAssetsPermitEnglishFallback() async throws {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("rememberme-wordnet-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: folder) }
    try Data("not-json".utf8).write(to: folder.appendingPathComponent(LocalWordNet.shard("synthetic") + ".json"))
    let transport = SyntheticTransport(body: english)
    let corrupt = LookupService(dictionaryDirectory: folder, transport: transport)
    #expect(try await corrupt.english("synthetic")["source"]?.text == "dictionary-api")
    let missing = LookupService(dictionaryDirectory: nil, transport: transport)
    #expect(try await missing.english("synthetic")["source"]?.text == "dictionary-api")
    #expect(await transport.calls() == 2)
}

@Test func english404AndInvalidBodyAreNotRetried() async throws {
    let transport = SyntheticTransport(status: 404, body: "{}")
    let service = LookupService(dictionaryDirectory: nil, transport: transport)
    await #expect(throws: (any Error).self) { try await service.english("synthetic") }
    #expect(await transport.calls() == 1)
    let malformed = SyntheticTransport(body: "not-json")
    let invalid = LookupService(dictionaryDirectory: nil, transport: malformed)
    await #expect(throws: (any Error).self) { try await invalid.english("synthetic") }
    #expect(await malformed.calls() == 1)
}

@Test func chineseFailureDoesNotDisablePackagedEnglish() async throws {
    let provider = SyntheticTransport(status: 429, body: "{}")
    let service = LookupService(dictionaryDirectory: wordnet, transport: provider)
    async let local = service.english("have")
    await #expect(throws: (any Error).self) { try await service.chinese("have") }
    #expect(try await local["source"]?.text == "wordnet")
    #expect(await provider.calls() == 1)
}

@Test func chineseCacheSurvivesRestartAndSendsOnlyLookupParameters() async throws {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("rememberme-translation-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: folder) }
    let cache = folder.appendingPathComponent("translation-cache.json")
    let provider = SyntheticTransport(body: chinese)
    let first = LookupService(dictionaryDirectory: nil, cacheURL: cache, transport: provider, clock: { 1_700_000_000_000 })
    #expect(try await first.chinese("Having")["text"]?.text == "合成释义")
    let second = LookupService(dictionaryDirectory: nil, cacheURL: cache, transport: provider, clock: { 1_700_000_001_000 })
    #expect(try await second.chinese("having")["text"]?.text == "合成释义")
    #expect(await provider.calls() == 1)
    let request = await provider.urls[0]
    let query = URLComponents(url: request, resolvingAgainstBaseURL: false)!.queryItems!
    #expect(Set(query.map(\.name)) == ["q", "langpair"])
    #expect(query.first(where: { $0.name == "q" })?.value == "having")
    let expired = LookupService(dictionaryDirectory: nil, cacheURL: cache, transport: provider, clock: { 1_700_700_000_000 })
    _ = try await expired.chinese("having")
    #expect(await provider.calls() == 2)
}

@Test func duplicateSubscribersShareRequestAndOneCancellationKeepsOtherAlive() async throws {
    let provider = GatedLookupTransport()
    let service = LookupService(dictionaryDirectory: nil, transport: provider)
    let first = Task { try await service.english("synthetic") }
    let second = Task { try await service.english("synthetic") }
    while true {
        let subscribers = await service.englishSubscriberCount("synthetic"), calls = await provider.calls()
        if subscribers >= 2 && calls > 0 { break }
        await Task.yield()
    }
    first.cancel()
    await #expect(throws: (any Error).self) { try await first.value }
    await provider.complete()
    #expect(try await second.value["source"]?.text == "dictionary-api")
    #expect(await provider.calls() == 1)
    #expect(await provider.wasCancelled() == false)
}
@Test func cancelledLookupSubscribersCannotReceiveOrPersistACachedReply() async throws {
    let provider = SyntheticTransport(body: english)
    let service = LookupService(dictionaryDirectory: nil, transport: provider)
    _ = try await service.english("synthetic")
    let cancelled = Task {
        withUnsafeCurrentTask { $0?.cancel() }
        return try await service.english("synthetic")
    }
    await #expect(throws: CancellationError.self) { try await cancelled.value }
    #expect(await provider.calls() == 1)
}

@Test func cancellingLastSubscriberCancelsUnderlyingRequest() async throws {
    let provider = SyntheticTransport(body: english, delay: 5)
    let service = LookupService(dictionaryDirectory: nil, transport: provider)
    let task = Task { try await service.english("synthetic") }
    while await provider.calls() == 0 { await Task.yield() }
    task.cancel()
    await #expect(throws: (any Error).self) { try await task.value }
    for _ in 0..<100 { if await provider.wasCancelled() { break }; await Task.yield() }
    #expect(await provider.wasCancelled())
}

@Test func deadlineCoversFullTransportAndFailureIsNotCached() async throws {
    let provider = SyntheticTransport(body: chinese, delay: 5)
    var budget = LookupService.Budgets(); budget.chinese = 0.02
    let service = LookupService(dictionaryDirectory: nil, transport: provider, budgets: budget)
    let start = Date()
    await #expect(throws: (any Error).self) { try await service.chinese("synthetic") }
    #expect(Date().timeIntervalSince(start) < 1)
    #expect(await provider.wasCancelled())
    await #expect(throws: (any Error).self) { try await service.chinese("synthetic") }
    #expect(await provider.calls() == 2)
}

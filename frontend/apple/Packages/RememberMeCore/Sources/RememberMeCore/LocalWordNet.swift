import Foundation

public actor LocalWordNet {
    private let directory: URL?
    private var shards: [String: JSONValue] = [:]
    private var recent: [String] = []
    public init(directory: URL?) { self.directory = directory }

    public static func shard(_ word: String) -> String {
        var hash: UInt32 = 2_166_136_261
        for byte in word.utf8 { hash = (hash ^ UInt32(byte)) &* 16_777_619 }
        return String(format: "%02x", hash & 255)
    }
    public static func candidates(_ word: String) -> [(word: String, partOfSpeech: String)] {
        guard word.count >= 4 else { return [] }
        let rules: [(String, [(String, String)])] = [
            ("noun", [("s", ""), ("ses", "s"), ("xes", "x"), ("zes", "z"), ("ches", "ch"), ("shes", "sh"), ("men", "man"), ("ies", "y")]),
            ("verb", [("s", ""), ("ies", "y"), ("es", "e"), ("es", ""), ("ed", "e"), ("ed", ""), ("ing", "e"), ("ing", "")]),
            ("adjective", [("er", ""), ("est", ""), ("er", "e"), ("est", "e")])
        ]
        var seen = Set<String>(); var result: [(String, String)] = []
        for (part, endings) in rules {
            for (suffix, replacement) in endings where word.hasSuffix(suffix) {
                let base = String(word.dropLast(suffix.count)) + replacement
                if base.count >= 2 && seen.insert(part + ":" + base).inserted { result.append((base, part)) }
            }
        }
        return result
    }
    public func lookup(_ input: String) async throws -> JSONValue? {
        let word = LegacyCodec.normalize(input)
        guard LegacyCodec.isEnglishWord(word) else { return nil }
        if let exact = try await read(word) { return exact }
        for candidate in Self.candidates(word) {
            try Task.checkCancellation()
            if var fields = try await read(candidate.word)?.fields {
                let meanings = (fields["meanings"]?.items ?? []).filter { $0["partOfSpeech"]?.text == candidate.partOfSpeech }
                if !meanings.isEmpty { fields["meanings"] = .array(meanings); return .object(fields) }
            }
        }
        return nil
    }
    private func read(_ word: String) async throws -> JSONValue? {
        guard let directory else { throw LookupError.localUnavailable }
        let key = Self.shard(word)
        let content: JSONValue
        if let cached = shards[key] { content = cached }
        else {
            let url = directory.appendingPathComponent(key + ".json")
            content = try await Task.detached {
                try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
            }.value
            guard content.fields != nil else { throw LookupError.invalidResponse }
            shards[key] = content
        }
        recent.removeAll { $0 == key }; recent.append(key)
        while recent.count > 24 { shards[recent.removeFirst()] = nil }
        guard let compact = content[word] else { return nil }
        guard let rows = compact.items, !rows.isEmpty else { throw LookupError.invalidResponse }
        let meanings = try rows.map { meaning -> JSONValue in
            guard let values = meaning.items, values.count >= 2, let part = values[0].text,
                  let senses = values[1].items, !senses.isEmpty else { throw LookupError.invalidResponse }
            let definitions = try senses.map { sense -> JSONValue in
                guard let values = sense.items, !values.isEmpty, let text = values[0].text,
                      !text.isEmpty else { throw LookupError.invalidResponse }
                var item: [String: JSONValue] = ["definition": .string(text)]
                if values.count > 1 {
                    guard let example = values[1].text else { throw LookupError.invalidResponse }
                    if !example.isEmpty { item["example"] = .string(example) }
                }
                return .object(item)
            }
            return .object(["partOfSpeech": .string(part), "definitions": .array(definitions)])
        }
        return .object(["word": .string(word), "source": .string("wordnet"), "phonetics": .array([]), "meanings": .array(meanings)])
    }
}

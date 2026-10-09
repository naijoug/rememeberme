import Foundation
import CryptoKit

public enum LegacyCodec {
    /// ECMAScript WhiteSpace + LineTerminator, rather than Foundation's wider set.
    private static let whitespace = CharacterSet(charactersIn:
        "\u{0009}\u{000A}\u{000B}\u{000C}\u{000D}\u{0020}\u{00A0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}")
    public static func trim(_ value: String) -> String { value.trimmingCharacters(in: whitespace) }
    public static func normalize(_ value: String) -> String { trim(value).lowercased() }
    public static func hexBytes<S: Sequence>(_ bytes: S) -> String where S.Element == UInt8 {
        let alphabet = Array("0123456789abcdef".utf8)
        var output: [UInt8] = []; output.reserveCapacity(bytes.underestimatedCount * 2)
        for byte in bytes { output.append(alphabet[Int(byte >> 4)]); output.append(alphabet[Int(byte & 15)]) }
        return String(decoding: output, as: UTF8.self)
    }
    public static func keyBytes(_ value: String) -> String { hexBytes(value.utf8) }
    public static func digest(_ data: Data) -> String { hexBytes(SHA256.hash(data: data)) }
    public static func stableID(_ type: String, _ input: [JSONValue]) throws -> String {
        type + ":" + digest(try JSONValue.encoder().encode(input))
    }
    public static func isEnglishWord(_ word: String) -> Bool {
        let value = normalize(word)
        return value.range(of: "^[a-z][a-z'\\-]*[a-z]$|^[a-z]$", options: .regularExpression) != nil
    }
    private static func nonnegative(_ value: JSONValue?) -> Bool {
        guard let value = value?.number else { return false }
        return value.isFinite && value >= 0
    }
    public static func validDefinition(_ value: JSONValue) -> Bool {
        guard value["word"]?.text != nil, value["phonetics"]?.items != nil,
              let meanings = value["meanings"]?.items else { return false }
        if let translation = value["translation"] {
            guard translation["source"]?.text == "mymemory", translation["target"]?.text == "zh-CN",
                  let text = translation["text"]?.text, !normalize(text).isEmpty, text.utf16.count <= 2000 else { return false }
        }
        return meanings.allSatisfy { meaning in
            guard meaning["partOfSpeech"]?.text != nil, let definitions = meaning["definitions"]?.items else { return false }
            return definitions.allSatisfy { $0["definition"]?.text != nil }
        }
    }

    public static func decode(_ data: Data, batchID: String? = nil) throws -> [VocabularyEntry] {
        let json = try JSONDecoder().decode(JSONValue.self, from: data)
        guard let rows = json.items else { throw ClientError.invalidData("expected word array") }
        let source = digest(data)
        var entries: [VocabularyEntry] = []
        var indexByKey: [String: Int] = [:]
        for (index, value) in rows.enumerated() {
            guard let fields = value.fields, let rawWord = value["word"]?.text,
                  !normalize(rawWord).isEmpty, nonnegative(value["count"]),
                  nonnegative(value["createdAt"]), nonnegative(value["updatedAt"]),
                  let history = value["history"]?.items else { throw ClientError.invalidData("entry \(index)") }
            let entryID = try stableID("entry", [.string("legacy-entry-v1"), .string(batchID ?? source), .number(Double(index))])
            var entry = VocabularyEntry(id: entryID, word: normalize(rawWord), count: value["count"]!.number,
                                        timestamp: value["createdAt"]!.number!)
            entry.updatedAt = value["updatedAt"]!.number!; entry.legacyFields = fields; entry.sourceDigest = source
            entry.legacyFields["history"] = nil
            for (position, item) in history.enumerated() {
                guard let original = item.fields, nonnegative(item["timestamp"]),
                      let context = item["context"]?.text, let url = item["url"]?.text,
                      let definition = item["definition"], validDefinition(definition) else {
                    throw ClientError.invalidData("history \(index):\(position)")
                }
                let id = try stableID("encounter", [.string("legacy-encounter-v1"), .string(batchID ?? source),
                                                     .number(Double(index)), .number(Double(position))])
                entry.history.append(Encounter(id: id, timestamp: item["timestamp"]!.number!, context: context,
                    url: url, definition: definition, legacyFields: original))
            }
            entry.definition = entry.history.last?.definition ?? entry.definition
            let key = keyBytes(entry.normalizedKey)
            if let previous = indexByKey[key] {
                let sum = entries[previous].count! + entry.count!
                guard sum.isFinite else { throw ClientError.invalidNumber }
                entries[previous].count = sum
                entries[previous].history = stableHistorySort(entries[previous].history + entry.history)
                entries[previous].definition = entries[previous].history.last?.definition ?? entries[previous].definition
                entries[previous].updatedAt = max(entries[previous].updatedAt, entry.updatedAt)
                entries[previous].aliases.append(entry.id)
            } else { indexByKey[key] = entries.count; entries.append(entry) }
        }
        return entries
    }

    public static func stableHistorySort(_ history: [Encounter]) -> [Encounter] {
        history.enumerated().sorted { a, b in
            a.element.timestamp == b.element.timestamp ? a.offset < b.offset : a.element.timestamp < b.element.timestamp
        }.map(\.element)
    }

    public static func export(_ entries: [VocabularyEntry]) throws -> Data {
        let array = entries.filter { !$0.deleted }.map { entry -> JSONValue in
            var fields = entry.legacyFields
            fields["word"] = .string(entry.normalizedKey); fields["count"] = .number(entry.count ?? 0)
            fields["createdAt"] = .number(entry.createdAt); fields["updatedAt"] = .number(entry.updatedAt)
            fields["history"] = .array(entry.history.map { record in
                var original = record.legacyFields
                original["timestamp"] = .number(record.timestamp); original["context"] = .string(record.context)
                original["url"] = .string(record.url); original["definition"] = record.definition
                return .object(original)
            })
            return .object(fields)
        }
        return try JSONValue.encoder().encode(array)
    }
}

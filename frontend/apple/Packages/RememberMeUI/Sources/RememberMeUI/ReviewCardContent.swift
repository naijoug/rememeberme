import Foundation
import RememberMeCore

/// A bounded, read-only presentation of one encounter. Never persisted as review state.
struct ReviewCardContent: Equatable {
    enum DefinitionSource: Equatable { case encounter, current, unavailable }
    let entryID: String
    let encounterID: String?
    let context: String?
    let sourceURL: URL?
    let definition: JSONValue
    let definitionSource: DefinitionSource

    init(entry: VocabularyEntry, history: [Encounter]) {
        entryID = entry.id
        let encounter = history.prefix(20).first {
            !$0.context.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && Self.containsWord(entry.word, in: $0.context)
        }
        encounterID = encounter?.id
        // Bound presentation, not the saved source. Keep the matching occurrence visible.
        context = encounter.map { Self.excerpt($0.context, word: entry.word) }
        sourceURL = encounter?.navigableURL
        if let encounter, Self.hasMeaning(encounter.definition) {
            definition = encounter.definition; definitionSource = .encounter
        } else if Self.hasMeaning(entry.definition) {
            definition = entry.definition; definitionSource = .current
        } else {
            definition = .null; definitionSource = .unavailable
        }
    }

    static func hasMeaning(_ definition: JSONValue) -> Bool {
        if let text = definition["translation"]?["text"]?.text,
           !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return true }
        return (definition["meanings"]?.items ?? []).contains { meaning in
            (meaning["definitions"]?.items ?? []).contains {
                !($0["definition"]?.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            }
        }
    }

    private static func wordRange(_ word: String, in text: String) -> Range<String.Index>? {
        guard !word.isEmpty else { return nil }
        func wordCharacter(_ character: Character) -> Bool {
            character.isLetter || character.isNumber || ["'", "’", "-", "_"].contains(character)
        }
        var start = text.startIndex
        while start < text.endIndex,
              let range = text.range(of: word, options: [.caseInsensitive, .literal], range: start..<text.endIndex) {
            let leftOK = range.lowerBound == text.startIndex || !wordCharacter(text[text.index(before: range.lowerBound)])
            let rightOK = range.upperBound == text.endIndex || !wordCharacter(text[range.upperBound])
            if leftOK && rightOK { return range }
            start = range.upperBound
        }
        return nil
    }

    static func containsWord(_ word: String, in text: String) -> Bool { wordRange(word, in: text) != nil }

    private static func excerpt(_ text: String, word: String) -> String {
        guard text.count > 1000, let range = wordRange(word, in: text) else { return text }
        let offset = text.distance(from: text.startIndex, to: range.lowerBound)
        let start = text.index(text.startIndex, offsetBy: max(0, offset - 300))
        let end = text.index(start, offsetBy: 1000, limitedBy: text.endIndex) ?? text.endIndex
        return (start > text.startIndex ? "…" : "") + String(text[start..<end]) + (end < text.endIndex ? "…" : "")
    }
}

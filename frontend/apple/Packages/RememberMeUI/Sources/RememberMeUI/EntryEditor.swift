import SwiftUI
import RememberMeCore
#if os(macOS)
import AppKit
#else
import UIKit
#endif

@MainActor final class EntryDraft: ObservableObject {
    @Published var word: String
    @Published var notes: String
    @Published var kind: EntryKind
    @Published var manualMeaning = ""
    @Published var english: JSONValue?
    @Published var chinese: JSONValue?
    @Published var englishError: String?
    @Published var chineseError: String?
    @Published var englishLoading = false
    @Published var chineseLoading = false
    @Published var saving = false
    let original: VocabularyEntry?
    let service: LookupService
    private var task: Task<Void, Never>?
    private var requestID = UUID()

    init(original: VocabularyEntry?, service: LookupService, capture: CaptureDraft? = nil) {
        self.original = original; self.service = service
        word = original?.word ?? ""; notes = original?.notes ?? ""
        if let capture, original == nil {
            let trimmed = LegacyCodec.trim(capture.text)
            word = trimmed.utf16.count <= 500 ? trimmed : ""
        }
        kind = original?.kind ?? .word
        english = original?.definition
        chinese = original?.definition["translation"]
    }
    func clearLookup() {
        task?.cancel(); requestID = UUID()
        englishLoading = false; chineseLoading = false; englishError = nil; chineseError = nil
        if original == nil { english = nil; chinese = nil }
    }
    func lookup() {
        clearLookup()
        let id = UUID(); requestID = id
        let input = word, service = service, refresh = original != nil
        englishLoading = true; chineseLoading = true
        task = Task {
            await withTaskGroup(of: Void.self) { group in
                group.addTask {
                    do {
                        let result = try await service.english(input, refresh: refresh)
                        await MainActor.run { if self.requestID == id { self.english = result; self.englishError = nil; self.englishLoading = false } }
                    } catch {
                        await MainActor.run { if self.requestID == id { self.englishError = error.localizedDescription; self.englishLoading = false } }
                    }
                }
                group.addTask {
                    do {
                        let result = try await service.chinese(input, refresh: refresh)
                        await MainActor.run { if self.requestID == id { self.chinese = result; self.chineseError = nil; self.chineseLoading = false } }
                    } catch {
                        await MainActor.run { if self.requestID == id { self.chineseError = error.localizedDescription; self.chineseLoading = false } }
                    }
                }
            }
        }
    }
    func definition() -> JSONValue {
        var fields = english?.fields ?? ["word": .string(LegacyCodec.normalize(word)), "phonetics": .array([]), "meanings": .array([])]
        if !manualMeaning.isEmpty {
            fields["source"] = .string("manual")
            fields["meanings"] = .array([.object(["partOfSpeech": .string("note"), "definitions": .array([.object(["definition": .string(manualMeaning)])])])])
        }
        if let chinese { fields["translation"] = chinese }
        return .object(fields)
    }
    func paste() {
        #if os(macOS)
        if let text = NSPasteboard.general.string(forType: .string) { word = text }
        #else
        if let text = UIPasteboard.general.string { word = text }
        #endif
    }
}

struct EntryEditor: View {
    @StateObject private var draft: EntryDraft
    @Environment(\.dismiss) private var dismiss
    let save: @MainActor (String, JSONValue, String, VocabularyEntry?, EntryKind) async -> Bool
    let failureMessage: @MainActor () -> String?
    @State private var saveError: String?
    init(original: VocabularyEntry?, service: LookupService,
         capture: CaptureDraft? = nil,
         failureMessage: @escaping @MainActor () -> String? = { nil },
         save: @escaping @MainActor (String, JSONValue, String, VocabularyEntry?, EntryKind) async -> Bool) {
        _draft = StateObject(wrappedValue: EntryDraft(original: original, service: service, capture: capture)); self.save = save; self.failureMessage = failureMessage
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(draft.original == nil ? "Add word" : "Edit definition and notes").font(.title2)
            HStack {
                TextField("Word", text: $draft.word).accessibilityIdentifier("word-editor").disabled(draft.original != nil)
                if draft.original == nil { Button("Paste") { draft.paste() } }
            }
            Picker("Type", selection: $draft.kind) {
                Text("Word").tag(EntryKind.word); Text("Phrase").tag(EntryKind.phrase)
                Text("Abbreviation").tag(EntryKind.abbreviation); Text("Proper noun").tag(EntryKind.properNoun)
            }
            HStack {
                Button(draft.original == nil ? "Look up" : "Refresh definition") { draft.lookup() }
                    .disabled(!LegacyCodec.isEnglishWord(draft.word))
                Text("Chinese lookup uses your connected backend and Hermes, or MyMemory when no backend account is connected. English misses use Free Dictionary API.").font(.caption).foregroundStyle(.secondary)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if draft.chineseLoading { ProgressView("Chinese translation") }
                    if let chinese = draft.chinese?["text"]?.text { Text(verbatim: chinese).textSelection(.enabled) }
                    if let error = draft.chineseError { Text(verbatim: error).foregroundStyle(.red).font(.caption) }
                    if draft.englishLoading { ProgressView("English definition") }
                    if let english = draft.english {
                        if english["source"]?.text == "wordnet" { Text("Offline English · WordNet").font(.caption).foregroundStyle(.secondary) }
                        if let base = english["word"]?.text, base != LegacyCodec.normalize(draft.word) { Text("Base form: \(base)").font(.caption) }
                        DefinitionText(definition: english)
                    }
                    if let error = draft.englishError { Text(verbatim: error).foregroundStyle(.red).font(.caption) }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }.frame(minHeight: 80, maxHeight: 260)
            TextField("Manual meaning (optional; replaces English meanings)", text: $draft.manualMeaning, axis: .vertical)
            TextField("Notes (optional)", text: $draft.notes, axis: .vertical)
            Text("Saving without a definition is allowed. This does not add a forgotten encounter.").font(.caption).foregroundStyle(.secondary)
            if let saveError { Text(verbatim: saveError).font(.caption).foregroundStyle(.red) }
            HStack {
                Button("Cancel", role: .cancel) { draft.clearLookup(); dismiss() }.disabled(draft.saving)
                Button("Save") {
                    draft.saving = true
                    saveError = nil
                    Task {
                        let success = await save(draft.word, draft.definition(), draft.notes, draft.original, draft.kind)
                        draft.saving = false
                        if success { draft.clearLookup(); dismiss() }
                        else { saveError = failureMessage() ?? "The word could not be saved. Check the error and try again." }
                    }
                }.disabled(LegacyCodec.normalize(draft.word).isEmpty || draft.saving)
                if draft.saving { ProgressView() }
            }
        }.padding(24).frame(minWidth: 300, idealWidth: 520)
        .onChange(of: draft.word) { draft.clearLookup() }
        .onDisappear { draft.clearLookup() }
        .interactiveDismissDisabled(draft.saving)
    }
}

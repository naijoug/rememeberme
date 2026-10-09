import SwiftUI
import RememberMeCore

struct CaptureDraftsView: View {
    @ObservedObject var model: VocabularyModel
    @Environment(\.dismiss) private var dismiss
    @State private var selected: CaptureDraft?
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack { Text("Shared drafts").font(.title2); Spacer(); Button("Done") { dismiss() } }
            Text("Choose a word and confirm before it enters your vocabulary. Sharing does not record a forgotten encounter.").font(.caption)
            if model.captures.isEmpty { ContentUnavailableView("No shared drafts", systemImage: "tray") }
            List(model.captures) { draft in
                VStack(alignment: .leading, spacing: 8) {
                    if !draft.text.isEmpty { Text(verbatim: draft.text).lineLimit(4) }
                    if let url = draft.sourceURL { Text(verbatim: url).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
                    HStack {
                        Button("Choose word") { selected = draft }
                        Button("Dismiss draft", role: .destructive) { Task { await model.dismissCapture(draft) } }
                    }
                }
            }
            if let message = model.shareMessage { Text(verbatim: message).font(.caption) }
        }.padding(24).frame(minWidth: 300, idealWidth: 560, minHeight: 300)
        .task { await model.refreshCaptures() }
        .sheet(item: $selected) { draft in
            if let service = model.lookup {
                EntryEditor(original: nil, service: service, capture: draft, failureMessage: { model.error }) { word, definition, notes, _, kind in
                    await model.saveCapture(draft, word: word, definition: definition, notes: notes, kind: kind)
                }
            }
        }
    }
}

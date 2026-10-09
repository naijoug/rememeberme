import SwiftUI
import RememberMeCore

@MainActor final class ReviewModel: ObservableObject {
    @Published var queue: [VocabularyEntry] = []
    @Published var remainingNew = 20
    @Published var revealed = false
    @Published var busy = false
    @Published var error: String?
    let repository: LocalRepository
    init(repository: LocalRepository) { self.repository = repository }
    func load() async {
        do {
            let result = try await repository.reviewQueue()
            let previous = queue.first?.id
            queue = result.entries; remainingNew = result.remainingNewAllowance
            if previous != queue.first?.id { revealed = false }
        } catch { self.error = error.localizedDescription }
    }
    func answer(_ result: ReviewResult) async {
        guard !busy, let entry = queue.first else { return }
        busy = true; defer { busy = false }
        do {
            _ = try await repository.answerReview(entry.id, result: result, expectedReviewVersion: entry.effectiveReviewVersion)
            revealed = false; await load()
        } catch { self.error = error.localizedDescription; await load() }
    }
}

struct ReviewView: View {
    @StateObject private var model: ReviewModel
    @Environment(\.dismiss) private var dismiss
    init(repository: LocalRepository) { _model = StateObject(wrappedValue: ReviewModel(repository: repository)) }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                Text("Today’s review").font(.title2)
                Spacer()
                Button("Done") { dismiss() }
            }
            Text("New words remaining today: \(model.remainingNew)").font(.caption).foregroundStyle(.secondary)
            if let entry = model.queue.first {
                Text(verbatim: entry.word).font(.system(.largeTitle, design: .serif))
                Text(entry.review == nil ? "New word" : "Due for review").font(.caption).foregroundStyle(.secondary)
                ScrollView {
                    if model.revealed { DefinitionText(definition: entry.definition) }
                    else { Text("Recall the meaning, then reveal it.").foregroundStyle(.secondary) }
                }.frame(minHeight: 100, maxHeight: 300)
                if !model.revealed {
                    Button("Reveal meaning") { model.revealed = true }.keyboardShortcut(.space, modifiers: [])
                } else {
                    HStack {
                        Button("Forgot") { Task { await model.answer(.forgot) } }.keyboardShortcut("1", modifiers: [])
                        Button("Fuzzy") { Task { await model.answer(.fuzzy) } }.keyboardShortcut("2", modifiers: [])
                        Button("Remembered") { Task { await model.answer(.remembered) } }.keyboardShortcut("3", modifiers: [])
                    }.disabled(model.busy)
                }
                Text("Review answers change the schedule, independently of forgotten counts.").font(.caption).foregroundStyle(.secondary)
            } else {
                ContentUnavailableView("Review complete for now", systemImage: "checkmark.circle",
                    description: Text("No due words or available new words remain. Come back later."))
            }
            if let error = model.error { Text(verbatim: error).foregroundStyle(.red); Button("Dismiss error") { model.error = nil } }
        }.padding(24).frame(minWidth: 300, idealWidth: 560)
        .task { await model.load() }
        .onReceive(NotificationCenter.default.publisher(for: .rememberMeVocabularyChanged).receive(on: RunLoop.main)) { _ in
            if !model.busy { Task { await model.load() } }
        }
    }
}

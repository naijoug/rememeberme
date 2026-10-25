import SwiftUI
import RememberMeCore

struct ReviewSessionSummary {
    var forgot = 0
    var fuzzy = 0
    var remembered = 0
    var total: Int { forgot + fuzzy + remembered }

    mutating func record(_ result: ReviewResult) {
        switch result {
        case .forgot: forgot += 1
        case .fuzzy: fuzzy += 1
        case .remembered: remembered += 1
        }
    }
}

struct ReviewAnswerReceipt {
    let word: String
    let dueAt: Date
}

@MainActor final class ReviewModel: ObservableObject {
    @Published private(set) var queue: [VocabularyEntry] = []
    @Published private(set) var remainingNew = 20
    @Published private(set) var dueCount = 0
    @Published private(set) var revealed = false
    @Published private(set) var busy = false
    @Published private(set) var loading = false
    @Published private(set) var loaded = false
    @Published private(set) var summary = ReviewSessionSummary()
    @Published private(set) var lastAnswer: ReviewAnswerReceipt?
    @Published private(set) var error: String?
    let repository: LocalRepository
    private var loadID = UUID()

    init(repository: LocalRepository) { self.repository = repository }

    func load() async {
        let id = UUID(); loadID = id
        loading = true
        defer { if loadID == id { loading = false } }
        do {
            let result = try await repository.reviewQueue()
            guard loadID == id, !Task.isCancelled else { return }
            let previous = queue.first
            queue = result.entries
            remainingNew = result.remainingNewAllowance; dueCount = result.dueCount
            // Another window or sync can change this card without changing its ID.
            if previous != queue.first { revealed = false }
            loaded = true; error = nil
        } catch {
            guard loadID == id, !Task.isCancelled else { return }
            queue = []; revealed = false; loaded = false
            self.error = error.localizedDescription
        }
    }

    func reveal() {
        guard loaded, !loading, !busy, !queue.isEmpty else { return }
        revealed = true
    }

    func answer(_ result: ReviewResult) async {
        guard revealed, loaded, !loading, !busy, let entry = queue.first else { return }
        busy = true; defer { busy = false }
        do {
            let saved = try await repository.answerReview(entry.id, result: result, expectedReviewVersion: entry.effectiveReviewVersion)
            summary.record(result)
            if let state = saved.review {
                lastAnswer = ReviewAnswerReceipt(word: saved.word, dueAt: Date(timeIntervalSince1970: state.dueAtMs / 1000))
            }
            revealed = false
            await load()
        } catch {
            let message = error.localizedDescription
            revealed = false
            await load()
            self.error = message
        }
    }
}

struct ReviewView: View {
    @StateObject private var model: ReviewModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    init(repository: LocalRepository) { _model = StateObject(wrappedValue: ReviewModel(repository: repository)) }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Label("Learn words", systemImage: "rectangle.on.rectangle").font(.title2)
                Spacer()
                Button("Done") { dismiss() }
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if model.loaded {
                        HStack {
                            Text("Due now: \(model.dueCount)")
                            Spacer()
                            Text("New words remaining today: \(model.remainingNew)")
                        }.font(.caption).foregroundStyle(.secondary)
                    }
                    if model.loading && !model.loaded {
                        ProgressView("Loading words")
                    } else if let entry = model.queue.first {
                        VStack(alignment: .leading, spacing: 16) {
                            Text(entry.review == nil ? "New word" : "Due for review").font(.caption).foregroundStyle(.secondary)
                            Text(verbatim: entry.word).font(.system(.largeTitle, design: .serif))
                            if model.revealed {
                                DefinitionText(definition: entry.definition)
                                if !entry.notes.isEmpty {
                                    Divider()
                                    Text("Your notes").font(.caption).foregroundStyle(.secondary)
                                    Text(verbatim: entry.notes).textSelection(.enabled)
                                }
                            } else {
                                Text("Recall the meaning, then reveal it.").foregroundStyle(.secondary)
                            }
                        }
                        .frame(maxWidth: .infinity, minHeight: 180, alignment: .topLeading)
                        .padding(20)
                        .background(.quaternary, in: RoundedRectangle(cornerRadius: 16))
                        if !model.revealed {
                            Button("Reveal meaning") { model.reveal() }
                                .keyboardShortcut(.space, modifiers: [])
                                .disabled(model.busy || model.loading)
                        } else {
                            HStack {
                                Button("Forgot") { Task { await model.answer(.forgot) } }.keyboardShortcut("1", modifiers: [])
                                Button("Fuzzy") { Task { await model.answer(.fuzzy) } }.keyboardShortcut("2", modifiers: [])
                                Button("Remembered") { Task { await model.answer(.remembered) } }.keyboardShortcut("3", modifiers: [])
                            }.disabled(model.busy || model.loading)
                            Text("Space reveals the meaning · 1 Forgot · 2 Fuzzy · 3 Remembered")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    } else if model.loaded && model.error == nil {
                        ContentUnavailableView("Review complete for now", systemImage: "checkmark.circle",
                            description: Text("No due words or available new words remain. Add words or come back later."))
                    }
                    if model.summary.total > 0 {
                        Divider()
                        VStack(alignment: .leading, spacing: 8) {
                            Text("This session: \(model.summary.total) answered").font(.headline)
                            Text("Forgot: \(model.summary.forgot) · Fuzzy: \(model.summary.fuzzy) · Remembered: \(model.summary.remembered)")
                                .font(.callout).foregroundStyle(.secondary)
                            if let answer = model.lastAnswer {
                                Text(verbatim: "\(answer.word) · Next review: \(answer.dueAt.formatted(date: .abbreviated, time: .shortened))")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }.accessibilityElement(children: .combine)
                    }
                    Text("Study up to 20 new words per day, with due reviews first. Answers schedule the next review independently of forgotten counts.")
                        .font(.caption).foregroundStyle(.secondary)
                    if let error = model.error {
                        Text(verbatim: error).foregroundStyle(.red)
                        Button("Reload words") { Task { await model.load() } }.disabled(model.busy || model.loading)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        }.padding(24).frame(minWidth: 300, idealWidth: 560, minHeight: 440, idealHeight: 620)
        .task { await model.load() }
        .onReceive(NotificationCenter.default.publisher(for: .rememberMeVocabularyChanged).receive(on: RunLoop.main)) { _ in
            if !model.busy { Task { await model.load() } }
        }
        .onChange(of: scenePhase) {
            if scenePhase == .active && !model.busy { Task { await model.load() } }
        }
    }
}

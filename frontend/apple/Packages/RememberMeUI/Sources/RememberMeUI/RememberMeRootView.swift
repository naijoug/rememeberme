import Foundation
import SwiftUI
import UniformTypeIdentifiers
import RememberMeCore

public struct RememberMeRootView: View {
    @StateObject private var model = VocabularyModel()
    @State private var importing = false
    @State private var importMode: ImportMode = .firstMigration
    @State private var adding = false
    @State private var editing = false
    @State private var deleting = false
    @State private var exporting = false
    @State private var exportWarning = false
    @State private var replacing = false
    @State private var reviewing = false
    @State private var settings = false
    @State private var showingCaptures = false
    @State private var showingImportRecovery = false
    @State private var addingOwner = "anonymous"
    @State private var editingOwner = "anonymous"
    @State private var deletingOwner = "anonymous"
    @State private var importingOwner = "anonymous"
    @AppStorage("rememberme.appearance") private var appearance = "system"
    @Environment(\.scenePhase) private var scenePhase

    public init() {}
    public var body: some View {
        NavigationSplitView {
            List(selection: $model.selection) {
                ForEach(model.entries) { entry in
                    NavigationLink(value: entry.id) {
                        HStack {
                            Text(verbatim: entry.word).font(.system(.body, design: .serif))
                            Spacer()
                            Text(entry.count.map { $0.formatted() } ?? "Not recorded").foregroundStyle(.secondary)
                        }
                    }
                }
                if model.hasMoreEntries {
                    Button("Show more words") { Task { await model.moreEntries() } }.disabled(model.loadingEntries)
                }
                if model.loadingEntries { ProgressView("Loading words") }
            }
            .overlay {
                if model.entries.isEmpty && model.repository != nil {
                    ContentUnavailableView(model.search.isEmpty ? "Your vocabulary, on this device" : "No matching words",
                        systemImage: "book", description: Text(model.search.isEmpty
                            ? "Add a word or import an exported extension JSON." : "Try another search."))
                }
            }
            .navigationTitle("Remember Me")
            .searchable(text: $model.search, prompt: "Search vocabulary")
            .toolbar {
                ToolbarItem { Button { addingOwner = model.activeOwner; adding = true } label: { Label("Add word", systemImage: "plus") }.disabled(model.repository == nil || model.busy) }
                ToolbarItem {
                    Menu {
                        Button("Import extension snapshot") { importingOwner = model.activeOwner; importMode = .firstMigration; importing = true }
                        Button("Merge legacy JSON (adds counts again)") { importingOwner = model.activeOwner; importMode = .legacyMerge; importing = true }
                        Button("Restore complete backup (merge)") { importingOwner = model.activeOwner; importMode = .restoreMerge; importing = true }
                        Button("Replace anonymous vocabulary…") { replacing = true }.disabled(model.activeOwner != "anonymous")
                        Button("Interrupted imports (\(model.interruptedImports.count))") { showingImportRecovery = true }
                        Divider()
                        Button("Today’s review") { reviewing = true }.keyboardShortcut("r", modifiers: [.command, .shift])
                        Button("Settings") { settings = true }.keyboardShortcut(",", modifiers: [.command])
                        Button("Shared drafts (\(model.captures.count))") { showingCaptures = true }
                        Divider()
                        Button("Export complete backup") { Task { await model.prepareExport(legacy: false) } }
                        Button("Export legacy JSON…") { Task { await model.prepareExport(legacy: true) } }
                        Divider()
                        Button("Sort by count") { model.sort = .count; Task { await model.reload() } }
                        Button("Sort by updated time") { model.sort = .updated; Task { await model.reload() } }
                    } label: { Label("Options", systemImage: "ellipsis") }
                    .disabled(model.repository == nil || model.busy)
                }
            }
            .safeAreaInset(edge: .bottom) { Text(model.status).font(.caption).foregroundStyle(.secondary).padding(12) }
            .navigationSplitViewColumnWidth(min: 280, ideal: 300, max: 360)
        } detail: {
            if reviewing {
                ContentUnavailableView("Review in progress", systemImage: "book.closed",
                    description: Text("Close review to return to the word details."))
            } else if let entry = model.detail {
                let owner = model.activeOwner
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        Text(verbatim: entry.word).font(.system(.largeTitle, design: .serif))
                        Text("Forgotten: \(entry.count.map { $0.formatted() } ?? "Not recorded")").foregroundStyle(.secondary)
                        HStack {
                            Button("Record once forgotten") { Task { await model.record(expectedOwner: owner) } }
                            Button("Reset count") { Task { await model.reset(expectedOwner: owner) } }
                        }
                        Text("Reset keeps all history.").font(.caption).foregroundStyle(.secondary)
                        DefinitionText(definition: entry.definition)
                        Button("Edit definition and notes") { editingOwner = owner; editing = true }.disabled(model.lookup == nil)
                        if !entry.notes.isEmpty { Text(verbatim: entry.notes) }
                        if let origin = entry.captureOrigin {
                            Text("Shared source").font(.headline)
                            if !origin.text.isEmpty { Text(verbatim: origin.text).textSelection(.enabled) }
                            if let url = origin.navigableURL { Link(destination: url) { Text(verbatim: origin.sourceURL ?? "") } }
                            else if let source = origin.sourceURL { Text(verbatim: source).font(.caption) }
                        }
                        Text("Records (\(model.recordCount))").font(.headline)
                        ForEach(Array(model.records.enumerated()), id: \.element.id) { index, record in
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Record \(model.recordCount - index)").font(.caption).foregroundStyle(.secondary)
                                Text(verbatim: record.context.isEmpty ? "No context recorded" : record.context)
                                Text(formatTimestamp(record.timestamp)).font(.caption).foregroundStyle(.secondary)
                                if let url = record.navigableURL { Link(destination: url) { Text(verbatim: record.url) }.font(.caption) }
                                else if !record.url.isEmpty { Text(verbatim: record.url).font(.caption) }
                            }.textSelection(.enabled)
                            Divider()
                        }
                        if model.records.count < model.recordCount {
                            Button("Show more records") { Task { await model.moreRecords() } }.disabled(model.loadingRecords)
                        }
                        if model.loadingRecords { ProgressView("Loading records") }
                        Button("Delete word", role: .destructive) { deletingOwner = owner; deleting = true }
                    }.padding(24).frame(maxWidth: 720, alignment: .leading)
                }.navigationTitle(entry.word)
                .alert("Delete this word and its history?", isPresented: $deleting) {
                    Button("Cancel", role: .cancel) {}
                    Button("Delete", role: .destructive) { Task { await model.delete(expectedOwner: deletingOwner) } }
                }
            } else {
                ContentUnavailableView("Your vocabulary, on this device", systemImage: "book",
                    description: Text("Add a word or import an exported extension JSON. No login is needed."))
            }
        }
        .tint(Color(red: 0.35, green: 0.47, blue: 0.38))
        .preferredColorScheme(appearance == "light" ? .light : appearance == "dark" ? .dark : nil)
        .task(id: model.search) {
            try? await Task.sleep(for: .milliseconds(200))
            if !Task.isCancelled { await model.reload() }
        }
        .onChange(of: model.selection) { Task { await model.select() } }
        .onReceive(NotificationCenter.default.publisher(for: .rememberMeVocabularyChanged).receive(on: RunLoop.main)) { _ in
            Task {
                await model.reload()
                if let repository = model.repository { await ReminderSettings.shared.reschedule(repository) }
                await model.account?.localVocabularyChanged()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .rememberMeOpenReview).receive(on: RunLoop.main)) { _ in reviewing = true }
        .onChange(of: scenePhase) {
            if scenePhase == .active {
                Task {
                    if let repository = model.repository { await ReminderSettings.shared.reschedule(repository) }
                    await model.refreshCaptures()
                    await model.refreshInterruptedImports()
                    model.account?.synchronize()
                }
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
            switch result {
            case .success(let url): model.startPreviewFile(url, mode: importMode, expectedOwner: importingOwner)
            case .failure(let error): model.error = error.localizedDescription
            }
        }
        .sheet(isPresented: Binding(get: { model.preview != nil }, set: { if !$0 { model.dismissPreview() } })) {
            ImportPreviewView(model: model)
        }
        .sheet(isPresented: Binding(get: { model.accountRestorePreview != nil || model.accountRestoreLoading }, set: { if !$0 { model.dismissAccountBackup() } })) {
            AccountBackupRestoreView(model: model)
        }
        .sheet(isPresented: $adding) {
            if let service = model.lookup {
                EntryEditor(original: nil, service: service, failureMessage: { model.error }) { word, definition, notes, original, kind in
                    await model.save(word: word, definition: definition, notes: notes, original: original, kind: kind, expectedOwner: addingOwner)
                }
            }
        }
        .sheet(isPresented: $editing) {
            if let service = model.lookup, let original = model.detail {
                EntryEditor(original: original, service: service, failureMessage: { model.error }) { word, definition, notes, original, kind in
                    await model.save(word: word, definition: definition, notes: notes, original: original, kind: kind, expectedOwner: editingOwner)
                }
            }
        }
        .sheet(isPresented: $reviewing) {
            if let repository = model.repository { ReviewView(repository: repository) }
        }
        .sheet(isPresented: $settings) {
            if let repository = model.repository { NativeSettingsView(repository: repository, account: model.account) }
        }
        .sheet(isPresented: $showingCaptures) { CaptureDraftsView(model: model) }
        .sheet(isPresented: $showingImportRecovery) { ImportRecoveryView(model: model) }
        .alert("Replace anonymous vocabulary?", isPresented: $replacing) {
            Button("Cancel", role: .cancel) {}
            Button("Choose backup", role: .destructive) { importingOwner = model.activeOwner; importMode = .replaceAnonymous; importing = true }
        } message: { Text("This replaces the local vocabulary with the selected backup. Export your current backup first. Cloud accounts are not replaced.") }
        .onChange(of: model.exportDocument != nil) {
            if model.exportDocument != nil { if model.exportLosses.isEmpty { exporting = true } else { exportWarning = true } }
        }
        .alert("Legacy export loses new data", isPresented: $exportWarning) {
            Button("Cancel", role: .cancel) { model.exportDocument = nil }
            Button("Continue") { exporting = true }
        } message: { Text(model.exportLosses.joined(separator: "\n")) }
        .fileExporter(isPresented: $exporting, document: model.exportDocument, contentType: .json, defaultFilename: model.exportName) { result in
            model.exportDocument = nil
            switch result {
            case .success: model.status = "Backup exported · Store this file securely"
            case .failure(let error): model.error = error.localizedDescription
            }
        }
        .alert("Could not complete the action", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
        .onChange(of: model.activeOwner) {
            adding = false; editing = false; deleting = false; importing = false; exporting = false; reviewing = false
            replacing = false; showingCaptures = false; showingImportRecovery = false
        }
    }
}

private func formatTimestamp(_ timestamp: Double) -> String {
    guard timestamp.isFinite, timestamp >= 0, timestamp <= 8_640_000_000_000_000 else { return "Time outside display range" }
    return Date(timeIntervalSince1970: timestamp / 1000).formatted(date: .complete, time: .complete)
}

struct DefinitionText: View {
    let definition: JSONValue
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let phonetic = definition["phonetic"]?.text { Text(verbatim: phonetic).foregroundStyle(.secondary) }
            if definition["source"]?.text == "wordnet" { Text("Offline English · WordNet").font(.caption).foregroundStyle(.secondary) }
            if let text = definition["translation"]?["text"]?.text { Text(verbatim: text) }
            let meanings = definition["meanings"]?.items ?? []
            if meanings.isEmpty && definition["translation"] == nil { Text("No definition saved yet.").foregroundStyle(.secondary) }
            ForEach(Array(meanings.enumerated()), id: \.offset) { _, meaning in
                if let part = meaning["partOfSpeech"]?.text { Text(verbatim: part).font(.caption).foregroundStyle(.secondary) }
                ForEach(Array((meaning["definitions"]?.items ?? []).enumerated()), id: \.offset) { _, item in
                    if let text = item["definition"]?.text { Text(verbatim: text).textSelection(.enabled) }
                    if let example = item["example"]?.text { Text(verbatim: example).font(.callout).foregroundStyle(.secondary).textSelection(.enabled) }
                }
            }
        }
    }
}

import SwiftUI
import RememberMeCore

struct ImportPreviewView: View {
    @ObservedObject var model: VocabularyModel
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Import preview").font(.title2)
            if let preview = model.preview {
                Text(preview.alreadyImported ? "This snapshot has already been imported." : "\(preview.entries.count) changes ready to save.")
                if preview.mode == .legacyMerge { Text("Importing this file again adds its counts and history again.") }
                if preview.mode == .replaceAnonymous { Text("This replaces all anonymous local vocabulary. Export a current backup before continuing.").foregroundStyle(.red) }
                if preview.mode == .restoreMerge { Text("Current values are kept unless you explicitly select the backup. Missing words in the backup are not deleted.").font(.callout) }
                if !preview.conflicts.isEmpty {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            ForEach(preview.conflicts) { conflict in
                                Text(verbatim: conflict.reason).foregroundStyle(.red)
                                if preview.mode == .restoreMerge {
                                    Picker("Resolve conflict", selection: Binding(get: { model.restoreChoices[conflict.id] ?? .keepCurrent },
                                        set: { model.restoreChoices[conflict.id] = $0 })) {
                                        Text("Keep current").tag(RestoreChoice.keepCurrent)
                                        if conflict.canUseBackup { Text("Use backup value").tag(RestoreChoice.useBackup) }
                                    }.disabled(model.busy || model.resolving)
                                    if conflict.canUseBackup && model.restoreChoices[conflict.id] == .useBackup {
                                        ForEach(LocalRestoreField.allCases, id: \.self) { field in
                                            Toggle(fieldLabel(field), isOn: Binding(get: { (model.restoreFields[conflict.id] ?? Set(LocalRestoreField.allCases)).contains(field) }, set: { enabled in
                                                var selected = model.restoreFields[conflict.id] ?? Set(LocalRestoreField.allCases)
                                                if enabled { selected.insert(field) } else { selected.remove(field) }
                                                model.restoreFields[conflict.id] = selected
                                            })).disabled(model.busy || model.resolving)
                                        }
                                    }
                                } else if preview.mode == .firstMigration {
                                    legacySelection(conflict.id)
                                }
                            }
                        }
                    }.frame(maxHeight: 300)
                    if preview.mode == .restoreMerge {
                        Button("Apply conflict choices") {
                            for conflict in preview.conflicts where model.restoreChoices[conflict.id] == nil { model.restoreChoices[conflict.id] = .keepCurrent }
                            Task { await model.resolvePreview() }
                        }.disabled(model.busy || model.resolving)
                    } else if preview.mode == .firstMigration {
                        Button("Apply source choices") {
                            for conflict in preview.conflicts where model.legacyChoices[conflict.id] == nil { model.legacyChoices[conflict.id] = .init(.keepCurrent) }
                            Task { await model.resolvePreview() }
                        }.disabled(model.busy || model.resolving)
                        Text("Keeping an entry skips this source for that word. Association retains distinct history without adding counts. A separate entry intentionally retains both copies.").font(.caption)
                    } else {
                        Text("A different source cannot be merged automatically. Choose the explicit legacy merge entrypoint only if you intend to add these counts again.").font(.caption)
                    }
                }
                HStack {
                    Button(model.busy ? "Cancel import" : "Cancel", role: .cancel) {
                        if model.busy { model.cancelImport() } else { model.dismissPreview() }
                    }
                    Button("Import") { model.startImport() }
                        .disabled(model.busy || model.resolving || preview.alreadyImported || !preview.conflicts.isEmpty)
                }
                if model.busy { ProgressView(value: model.importProgress) { Text(model.status) } }
                if model.resolving { ProgressView("Updating preview") }
            }
        }.padding(24).frame(minWidth: 300, idealWidth: 520)
        .interactiveDismissDisabled(model.busy || model.resolving)
    }
    private func fieldLabel(_ field: LocalRestoreField) -> String {
        switch field {
        case .count: "Forgotten count"
        case .definition: "Definition"
        case .notes: "Notes"
        case .review: "Review schedule"
        case .spelling: "Spelling"
        case .kind: "Entry type"
        case .captureOrigin: "Shared source"
        case .deletion: "Deletion state (confirm backup deletion)"
        }
    }
    @ViewBuilder private func legacySelection(_ id: String) -> some View {
        let selection = model.legacyChoices[id] ?? .init(.keepCurrent)
        let candidates = model.legacyCandidates[id] ?? []
        Picker("Source choice", selection: Binding(get: { selection.action }, set: { action in
            model.legacyChoices[id] = .init(action, targetId: selection.targetId ?? candidates.first?.id, fields: selection.fields)
        })) {
            Text("Keep current / skip this word").tag(LegacyImportAction.keepCurrent)
            if !candidates.isEmpty {
                Text("Associate history (keep count)").tag(LegacyImportAction.associateHistory)
                Text("Replace selected fields").tag(LegacyImportAction.replaceFields)
            }
            Text("Create a separate entry").tag(LegacyImportAction.newLifecycle)
        }
        if selection.action == .associateHistory || selection.action == .replaceFields {
            Picker("Target entry", selection: Binding(get: { selection.targetId ?? candidates.first?.id ?? "" }, set: { target in
                var next = selection; next.targetId = target; model.legacyChoices[id] = next
            })) {
                ForEach(candidates) { entry in Text("\(entry.word) · \(entry.count.map { String($0) } ?? "Not recorded") · \(entry.id.suffix(8))").tag(entry.id) }
            }
        }
        if selection.action == .replaceFields {
            ForEach([LocalRestoreField.count, .definition], id: \.self) { field in
                Toggle(fieldLabel(field), isOn: Binding(get: { selection.fields.contains(field) }, set: { enabled in
                    var next = selection
                    if enabled { next.fields.insert(field) } else { next.fields.remove(field) }
                    model.legacyChoices[id] = next
                }))
            }
        }
    }
}

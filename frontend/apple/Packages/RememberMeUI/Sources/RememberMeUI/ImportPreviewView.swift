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
                                }
                            }
                        }
                    }.frame(maxHeight: 300)
                    if preview.mode == .restoreMerge {
                        Button("Apply conflict choices") {
                            for conflict in preview.conflicts where model.restoreChoices[conflict.id] == nil { model.restoreChoices[conflict.id] = .keepCurrent }
                            Task { await model.resolvePreview() }
                        }.disabled(model.busy || model.resolving)
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
}

import SwiftUI
import RememberMeCore

struct AccountBackupRestoreView: View {
    @ObservedObject var model: VocabularyModel
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Restore account backup").font(.title2)
            Text("Export a current complete backup first. Current fields are kept by default. Missing backup words are retained, and sync stays paused after saving.").font(.callout)
            if model.accountRestoreLoading { ProgressView("Reading current cloud vocabulary…") }
            if let preview = model.accountRestorePreview {
                if !preview.online { Text("Cloud versions have not been verified. Reconnect and reload before confirming.").foregroundStyle(.secondary); Text(verbatim: model.status).font(.caption) }
                Text("\(preview.plan.entries.count) selected changes")
                List(preview.items) { item in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(verbatim: item.word).font(.headline)
                        Text(item.backupDeleted ? "Deleted in backup" : "Backup count: \(item.backupCount.map { $0.formatted() } ?? "Not recorded")").font(.caption)
                        Text(!item.currentExists ? "No current word with this ID" : item.currentDeleted ? "Currently deleted" : "Current count: \(item.currentCount.map { $0.formatted() } ?? "Not recorded")").font(.caption)
                        if let reason = item.reason { Text(verbatim: reason).font(.caption).foregroundStyle(.secondary) }
                        let selection = model.accountRestoreChoices[item.id] ?? item.selection
                        Picker("Restore choice", selection: Binding(get: { model.accountRestoreChoices[item.id]?.action ?? item.selection.action }, set: { action in
                            model.accountRestoreChoices[item.id] = .init(action, targetId: model.accountRestoreChoices[item.id]?.targetId ?? item.candidates.first?.id,
                                fields: model.accountRestoreChoices[item.id]?.fields ?? Set(AccountRestoreField.allCases))
                        })) {
                            Text("Keep current fields / skip conflicting item").tag(AccountRestoreAction.keepCurrent)
                            if !item.currentDeleted || item.backupDeleted { Text(item.backupDeleted ? "Confirm backup deletion" : "Use selected backup fields").tag(AccountRestoreAction.useBackup) }
                            if !item.backupDeleted && !item.candidates.isEmpty { Text("Associate history only; keep cloud count").tag(AccountRestoreAction.associateHistory) }
                            if !item.backupDeleted { Text("Create a separate word from this backup").tag(AccountRestoreAction.newLifecycle) }
                        }.disabled(model.busy || model.resolving)
                        if selection.action == .associateHistory {
                            Picker("Target cloud word", selection: Binding(get: { selection.targetId ?? item.candidates.first?.id ?? "" }, set: {
                                model.accountRestoreChoices[item.id] = .init(.associateHistory, targetId: $0, fields: selection.fields)
                            })) {
                                ForEach(item.candidates) { candidate in Text(verbatim: candidate.word + " · " + (candidate.count.map { $0.formatted() } ?? "Not recorded")).tag(candidate.id) }
                            }.disabled(model.busy || model.resolving)
                        }
                        if !item.backupDeleted && [.useBackup, .newLifecycle].contains(selection.action) {
                            ForEach(AccountRestoreField.allCases, id: \.self) { field in
                                Toggle(label(field), isOn: Binding(get: { (model.accountRestoreChoices[item.id] ?? item.selection).fields.contains(field) }, set: { enabled in
                                    var value = model.accountRestoreChoices[item.id] ?? item.selection
                                    if enabled { value.fields.insert(field) } else { value.fields.remove(field) }
                                    model.accountRestoreChoices[item.id] = value
                                })).disabled(model.busy || model.resolving || (!item.currentExists || selection.action == .newLifecycle) && field == .wordAndKind)
                            }
                        }
                    }.padding(.vertical, 6)
                }.frame(minHeight: 200)
                ForEach(preview.plan.conflicts) { Text(verbatim: $0.reason).font(.caption).foregroundStyle(.red) }
                HStack {
                    Button("Apply restore choices") { Task { await model.applyAccountBackupChoices() } }.disabled(model.busy || model.resolving)
                    Button("Reload current cloud versions") { model.refreshAccountBackupPreview() }.disabled(model.busy || model.resolving)
                }
                Text("Restored history does not add forgotten counts or replay review answers. Existing requests stay in their original queue; this restore uses fresh requests and current cloud versions.").font(.caption)
                HStack {
                    Button(model.busy || model.accountRestoreLoading ? "Cancel action" : "Cancel", role: .cancel) {
                        if model.accountRestoreLoading { model.cancelAccountBackupPreview() }
                        else if model.busy { model.cancelImport() } else { model.dismissAccountBackup() }
                    }
                    Button("Confirm selected account changes") { model.confirmAccountBackup() }
                        .disabled(model.busy || model.resolving || !preview.online || !preview.plan.conflicts.isEmpty || preview.plan.entries.isEmpty || preview.items.contains { model.accountRestoreChoices[$0.id] != nil && model.accountRestoreChoices[$0.id] != $0.selection })
                }
                if model.busy && !model.accountRestoreLoading { ProgressView(value: model.importProgress) { Text(model.status) } }
            } else if model.accountRestoreLoading { Button("Cancel", role: .cancel) { model.cancelAccountBackupPreview() } }
            if let error = model.error { Text(verbatim: error).font(.caption).foregroundStyle(.red) }
        }.padding(24).frame(minWidth: 300, idealWidth: 640, minHeight: 400)
        .interactiveDismissDisabled(model.busy || model.accountRestoreLoading)
    }
    private func label(_ field: AccountRestoreField) -> String {
        switch field { case .count: return "Count"; case .definition: return "Current definition"; case .notes: return "Notes"
        case .review: return "Review schedule"; case .wordAndKind: return "Spelling and type"; case .captureOrigin: return "Shared source (saved on this device)" }
    }
}

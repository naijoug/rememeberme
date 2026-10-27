import SwiftUI
import RememberMeCore

struct AccountVocabularyView: View {
    @ObservedObject var model: AccountVocabularyModel
    @ObservedObject var connection: AccountConnectionModel
    @State private var resolving: SyncConflict?
    @State private var separateCopy = false
    @State private var clearingSources = false
    @State private var backfillingSources = false
    init(model: AccountVocabularyModel) { self.model = model; connection = model.connection }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if connection.identity != nil || !model.isAnonymous {
                GroupBox {
                    VStack(alignment: .leading, spacing: 12) {
                        if model.isAnonymous {
                            Text("Opening your account words…").foregroundStyle(.secondary)
                            Button("Retry sync") { model.activateAccount() }.disabled(model.busy)
                        } else {
                            LabeledContent("Account words", value: model.accountWordCount.formatted())
                            Toggle("Cloud sync", isOn: Binding(get: { model.syncEnabled }, set: { model.setSyncEnabled($0) }))
                                .toggleStyle(.switch)
                                .disabled(model.busy || connection.identity == nil || model.epochConflict || model.sourceRemovalPending || !model.conflicts.isEmpty)
                            Text(model.syncEnabled ? "New words sync automatically across your devices." : "Paused. Your account words stay available on this device.")
                                .font(.caption).foregroundStyle(.secondary)
                            LabeledContent("Status") { Text(verbatim: model.status).multilineTextAlignment(.trailing).foregroundStyle(.secondary) }
                            if model.pendingCount > 0 { LabeledContent("Pending changes", value: model.pendingCount.formatted()) }
                            HStack {
                                Button("Sync now") { model.synchronize() }.disabled(model.busy || !model.syncEnabled)
                                if (model.error != nil || model.downloadIncomplete) && !model.syncEnabled && !model.epochConflict && !model.sourceRemovalPending {
                                    Button("Retry connection") { model.activateAccount() }.disabled(model.busy)
                                }
                            }
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(8)
                } label: { Label("Synchronization", systemImage: "arrow.triangle.2.circlepath") }
                if model.deviceWordCount > 0 {
                    GroupBox {
                        VStack(alignment: .leading, spacing: 10) {
                            LabeledContent("Words on this device", value: model.deviceWordCount.formatted())
                            Button("Add device words to account…") { model.prepareOwnership() }.disabled(model.busy)
                            Text("Review words saved before sign-in and add them to your account. The originals stay on this device.")
                                .font(.caption).foregroundStyle(.secondary)
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(8)
                    } label: { Label("Before you signed in", systemImage: "internaldrive") }
                }
                if !model.isAnonymous {
                    DisclosureGroup("Advanced: source privacy") {
                        VStack(alignment: .leading, spacing: 8) {
                            Toggle("Sync encounter contexts", isOn: Binding(get: { model.sourcePrivacy.context }, set: {
                                model.setSourcePrivacy(SyncPrivacy(context: $0, urls: model.sourcePrivacy.urls))
                            })).accessibilityIdentifier("sync-source-context")
                            Toggle("Sync source URLs", isOn: Binding(get: { model.sourcePrivacy.urls }, set: {
                                model.setSourcePrivacy(SyncPrivacy(context: model.sourcePrivacy.context, urls: $0))
                            })).accessibilityIdentifier("sync-source-urls")
                            Text("Sources may contain private webpage text and addresses. Preferences apply to this account; this device also requires your consent. Turning a switch off retains uploaded sources. Changes pause sync.").font(.caption)
                            Button("Backfill historical sources…") { backfillingSources = true }
                                .disabled(!model.sourcePrivacy.context && !model.sourcePrivacy.urls || model.sourceRemovalPending)
                            Button(model.sourceRemovalPending ? "Retry uploaded source removal…" : "Clear uploaded contexts and URLs…", role: .destructive) { clearingSources = true }
                            if model.sourceRemovalPending { Text("Removal is awaiting confirmation. Sync stays paused; retry completes the same request.").font(.caption) }
                        }.disabled(model.busy || connection.identity == nil || model.epochConflict || !model.sourceControlsAvailable)
                    }
                    if model.epochConflict {
                        Text("Your saved vocabulary and pending changes are retained. Keep sync paused until the restored cloud data has been reconciled.").font(.caption)
                        Button("Review restored cloud vocabulary…") { model.prepareEpochRecovery() }.disabled(model.busy || connection.identity == nil)
                    }
                    ForEach(model.conflicts) { conflict in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(verbatim: model.conflictCopies[conflict.id]?.word ?? conflict.entryId).font(.headline)
                            Text("A saved local change needs review.").font(.caption)
                            if let local = model.conflictCopies[conflict.id] {
                                Text("Local count: \(local.count.map { $0.formatted() } ?? "Not recorded")").font(.caption)
                            }
                            if let cloud = conflict.remote {
                                Text(cloud.deleted ? "This cloud word was deleted." : "Cloud count: \(cloud.count.map { $0.formatted() } ?? "Not recorded")").font(.caption)
                                Button("Use cloud values…") { resolving = conflict; separateCopy = false }.disabled(model.busy)
                            }
                            Button("Create a separate word from the local copy…") { resolving = conflict; separateCopy = true }.disabled(model.busy)
                        }.padding(.vertical, 6)
                    }
                }
            }
            if model.busy { HStack { ProgressView().controlSize(.small); Text("Updating account…").font(.caption); Button("Cancel", role: .cancel) { model.cancel() } } }
            if let error = model.error { Text(verbatim: error).foregroundStyle(.red).font(.caption) }
        }
        .task { await model.refreshDeviceWordCount() }
        .sheet(isPresented: Binding(get: { model.preview != nil }, set: { if !$0 { model.dismissPreview() } })) {
            OwnershipPreviewView(model: model)
        }
        .alert("Clear all uploaded sources?", isPresented: $clearingSources) {
            Button("Cancel", role: .cancel) {}
            Button("Clear uploaded sources", role: .destructive) { model.clearUploadedSources() }
        } message: {
            Text("This removes contexts and URLs from cloud history across this account and turns both source switches off. Local sources and exported backups remain. Sync stays paused. Earlier requests cannot upload the cleared sources again.")
        }
        .alert("Backfill historical sources?", isPresented: $backfillingSources) {
            Button("Cancel", role: .cancel) {}
            Button("Queue enabled source fields") { model.backfillHistoricalSources() }
        } message: {
            Text("This queues enabled source fields from this device for historical events already in the cloud. Counts and review schedules stay unchanged. Enable sync afterward to upload. Cancelling a running backfill retains sources already queued.")
        }
        .sheet(isPresented: Binding(get: { model.recoveryPreview != nil }, set: { if !$0 { model.dismissEpochRecovery() } })) {
            EpochRecoveryPreviewView(model: model)
        }
        .alert(separateCopy ? "Create a separate word?" : "Use cloud values?", isPresented: Binding(get: { resolving != nil }, set: { if !$0 { resolving = nil } })) {
            Button("Cancel", role: .cancel) { resolving = nil }
            Button("Confirm") {
                if let resolving {
                    if separateCopy { model.separateCopyForConflict(resolving) } else { model.useCloudForConflict(resolving) }
                }
                resolving = nil
            }
        } message: {
            Text(separateCopy ? "This copies the current local fields and history to a new word, retaining the existing cloud lifecycle. It can intentionally duplicate information. Pending changes for the original local copy will be replaced by this snapshot."
                : "This discards the selected pending local change and uses the current cloud values. Dependent changes remain available for separate review.")
        }
    }
}

struct EpochRecoveryPreviewView: View {
    @ObservedObject var model: AccountVocabularyModel
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Review restored cloud vocabulary").font(.title2)
            Text("Export a current complete backup before confirming. Earlier requests will not be replayed, and sync will remain paused.").font(.callout)
            if let preview = model.recoveryPreview {
                Text("\(preview.items.count) words · \(preview.previousPendingCount) earlier changes retained in the recovery copy")
                List(preview.items) { item in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(verbatim: item.word).font(.headline)
                        Text(item.localExists ? item.localDeleted ? "Deleted locally" : "Local count: \(item.localCount.map { $0.formatted() } ?? "Not recorded")" : "No local word").font(.caption)
                        Text(item.cloudExists ? item.cloudDeleted ? "Deleted in restored cloud" : "Cloud count: \(item.cloudCount.map { $0.formatted() } ?? "Not recorded")" : "Missing from restored cloud").font(.caption)
                        if item.historyConflicts > 0 { Text("\(item.historyConflicts) historical events have different immutable snapshots. Keep the conflict or create a separate word to preserve both.").font(.caption).foregroundStyle(.red) }
                        Picker("Recovery choice", selection: Binding(get: { model.recoveryChoices[item.id] ?? item.choice }, set: { model.recoveryChoices[item.id] = $0 })) {
                            if item.cloudExists && item.historyConflicts == 0 && !(item.localDeleted && !item.cloudDeleted) { Text("Use restored cloud fields").tag(EpochRecoveryChoice.useCloud) }
                            if item.localExists {
                                Text("Keep local change for later review").tag(EpochRecoveryChoice.keepLocalPending)
                                if item.cloudExists && !item.cloudDeleted && item.historyConflicts == 0 { Text(item.localDeleted ? "Submit the local deletion again" : "Restore local fields with a new request").tag(EpochRecoveryChoice.restoreLocalFields) }
                                if !item.localDeleted { Text("Create a separate word from the local snapshot").tag(EpochRecoveryChoice.newLifecycle) }
                            }
                        }.disabled(model.busy)
                    }.padding(.vertical, 6)
                }.frame(minHeight: 200)
                ForEach(preview.plan.conflicts) { Text(verbatim: $0.reason).font(.caption).foregroundStyle(.red) }
                Button("Apply recovery choices") { model.updateEpochRecoveryChoices() }.disabled(model.busy)
                Text("Field restore uses the current cloud version and never replays historical answers or increments from imported history. A separate word has new history IDs and can intentionally duplicate information.").font(.caption)
                HStack {
                    Button(model.busy ? "Cancel action" : "Cancel", role: .cancel) { if model.busy { model.cancel() } else { model.dismissEpochRecovery() } }
                    Button("Confirm recovery and keep sync paused") { model.confirmEpochRecovery() }
                        .disabled(model.busy || !preview.plan.conflicts.isEmpty || preview.items.contains { model.recoveryChoices[$0.id] != nil && model.recoveryChoices[$0.id] != $0.choice })
                }
                if model.busy { ProgressView(model.status) }
                if let error = model.error { Text(verbatim: error).font(.caption).foregroundStyle(.red) }
            }
        }.padding(24).frame(minWidth: 300, idealWidth: 640, minHeight: 400).interactiveDismissDisabled(model.busy)
    }
}

struct OwnershipPreviewView: View {
    @ObservedObject var model: AccountVocabularyModel
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Add device words to account").font(.title2)
            Text(verbatim: model.accountName).font(.headline)
            if let preview = model.preview {
                Text("\(preview.plan.entries.count) selected changes · The original device words are kept.")
                List(preview.items) { item in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(verbatim: item.word).font(.headline)
                        Text(item.deleted ? "Deleted locally" : "Local count: \(item.count.map { $0.formatted() } ?? "Not recorded")").font(.caption)
                        if let reason = item.reason { Text(verbatim: reason).font(.caption).foregroundStyle(.secondary) }
                        Picker("Ownership choice", selection: Binding(get: { model.choices[item.id]?.action ?? item.selection.action },
                            set: { action in model.choices[item.id] = OwnershipSelection(action, targetId: model.choices[item.id]?.targetId ?? item.candidates.first(where: { !$0.deleted })?.id) })) {
                            Text("Keep on this device").tag(OwnershipAction.keepAnonymous)
                            Text(item.sharedBaselineAvailable ? "Migrate original baseline and later changes" : "Copy current local snapshot").tag(OwnershipAction.migrate)
                            if item.candidates.contains(where: { !$0.deleted }) {
                                Text("Associate history; keep cloud count and fields").tag(OwnershipAction.associate)
                                Text("Replace cloud fields with local snapshot").tag(OwnershipAction.replaceFields)
                            }
                            Text("Create a separate word").tag(OwnershipAction.newLifecycle)
                        }.disabled(model.busy)
                        if [.associate, .replaceFields].contains(model.choices[item.id]?.action ?? item.selection.action) {
                            Picker("Cloud word", selection: Binding(get: { model.choices[item.id]?.targetId ?? item.candidates.first(where: { !$0.deleted })?.id ?? "" },
                                set: { model.choices[item.id] = OwnershipSelection(model.choices[item.id]?.action ?? item.selection.action, targetId: $0) })) {
                                ForEach(item.candidates.filter { !$0.deleted }) { candidate in
                                    Text(verbatim: candidate.word + " · " + (candidate.count.map { $0.formatted() } ?? "Not recorded")).tag(candidate.id)
                                }
                            }.disabled(model.busy)
                        }
                    }.padding(.vertical, 6)
                }.frame(minHeight: 200)
                ForEach(preview.plan.conflicts) { Text(verbatim: $0.reason).font(.caption).foregroundStyle(.red) }
                Button("Update preview") { model.updateOwnershipPreview() }.disabled(model.busy)
                Text("Sync pauses while you review. Cancel restores your previous sync setting. Shared migration baselines apply once. Association does not add a count. Field replacement uses current cloud versions. Separate words can intentionally copy existing information.").font(.caption)
                HStack {
                    Button(model.busy ? "Cancel action" : "Cancel", role: .cancel) { if model.busy { model.cancel() } else { model.dismissPreview() } }
                    Button("Add selected words and sync") { model.confirmOwnership() }
                        .disabled(model.busy || preview.plan.entries.isEmpty || !preview.plan.conflicts.isEmpty || !model.choices.isEmpty && preview.items.contains { model.choices[$0.id] != nil && model.choices[$0.id] != $0.selection })
                }
                if model.busy { ProgressView(model.status) }
                if let error = model.error { Text(verbatim: error).font(.caption).foregroundStyle(.red) }
            }
        }.padding(24).frame(minWidth: 300, idealWidth: 640, minHeight: 400)
        .interactiveDismissDisabled(model.busy)
    }
}

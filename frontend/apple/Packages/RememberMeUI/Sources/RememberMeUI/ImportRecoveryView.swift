import SwiftUI
import RememberMeCore

struct ImportRecoveryView: View {
    @ObservedObject var model: VocabularyModel
    @Environment(\.dismiss) private var dismiss
    @State private var discard: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack { Text("Interrupted imports").font(.title2); Spacer(); Button("Done") { dismiss() }.disabled(model.busy) }
            Text("Your current vocabulary remains available. Continue the saved import, or discard its temporary data and preview the source again.").font(.caption)
            if model.interruptedImports.isEmpty {
                ContentUnavailableView("No interrupted imports", systemImage: "checkmark.circle")
            } else {
                List(model.interruptedImports) { job in
                    VStack(alignment: .leading, spacing: 10) {
                        Text(title(job.mode)).font(.headline)
                        if let time = job.createdAtMs {
                            Text(Date(timeIntervalSince1970: time / 1000).formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(.secondary)
                        }
                        Text(progress(job)).font(.callout)
                        if let explanation = job.explanation { Text(verbatim: explanation).font(.caption).foregroundStyle(.secondary) }
                        HStack {
                            if job.canResume { Button("Resume import") { model.resumeImport(job.id) }.disabled(model.busy) }
                            Button(job.state == "cancelled" ? "Finish cleanup" : "Discard import", role: .destructive) { discard = job.id }.disabled(model.busy)
                        }
                    }.padding(.vertical, 8)
                }
            }
            if model.busy { ProgressView(value: model.importProgress) { Text(model.status) } }
            else { Text(model.status).font(.caption).foregroundStyle(.secondary) }
            if let error = model.error { Text(verbatim: error).font(.caption).foregroundStyle(.red) }
        }.padding(24).frame(minWidth: 300, idealWidth: 560, minHeight: 300)
        .task { await model.refreshInterruptedImports() }
        .interactiveDismissDisabled(model.busy)
        .alert("Discard this interrupted import?", isPresented: Binding(get: { discard != nil }, set: { if !$0 { discard = nil } })) {
            Button("Cancel", role: .cancel) { discard = nil }
            Button("Discard", role: .destructive) { if let discard { model.discardImport(discard) }; discard = nil }
        } message: { Text("This removes only its temporary import data. Your current vocabulary and original source file are kept.") }
    }
    private func title(_ mode: ImportMode?) -> String {
        switch mode {
        case .firstMigration: return "Extension snapshot"
        case .legacyMerge: return "Legacy merge"
        case .restoreMerge: return "Backup merge"
        case .replaceAnonymous: return "Anonymous vocabulary replacement"
        case .bindAnonymous: return "Confirmed account ownership copy"
        case .reconcileEpoch: return "Confirmed server recovery choices"
        case .restoreAccount: return "Confirmed account backup restore"
        case nil: return "Earlier import"
        }
    }
    private func progress(_ job: ImportRecovery) -> String {
        switch job.state {
        case "copying": return "Preparing existing vocabulary · \(Int(100 * Double(job.copied) / Double(max(job.copyTotal, 1))))%"
        case "ready": return "Ready to save · \(job.total) changes"
        case "cancelled": return "Cancelled · Cleanup pending"
        default: return "Prepared \(job.processed) of \(job.total) changes"
        }
    }
}

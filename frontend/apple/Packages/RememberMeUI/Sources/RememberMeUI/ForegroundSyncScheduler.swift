import Foundation
import Network

/// A bounded foreground retry flight. Durable request identity/backoff remains in the repository.
@MainActor final class ForegroundSyncScheduler {
    private let action: @MainActor () async -> Bool
    private let sleep: @Sendable (Double) async throws -> Void
    private let delays: [Double]
    private var task: Task<Void, Never>?
    private var generation = UUID()
    private(set) var active = false
    private(set) var online = true
    init(delays: [Double] = [2, 4, 8, 16, 32, 60],
         sleep: @escaping @Sendable (Double) async throws -> Void = { try await Task.sleep(for: .seconds($0)) },
         action: @escaping @MainActor () async -> Bool) {
        self.delays = delays; self.sleep = sleep; self.action = action
    }
    func setActive(_ value: Bool) { active = value; if !value { cancel() } }
    func networkChanged(online value: Bool) {
        let restored = value && !online; online = value
        if !value { cancel() } else if restored { trigger() }
    }
    func cancel() { generation = UUID(); task?.cancel(); task = nil }
    func trigger(immediate: Bool = true) {
        cancel()
        guard active, online else { return }
        let id = generation
        task = Task { [weak self] in
            guard let self else { return }
            defer { if self.generation == id { self.task = nil } }
            for delay in (immediate ? [0] + self.delays : self.delays) {
                do { if delay > 0 { try await self.sleep(delay) }; try Task.checkCancellation() }
                catch { return }
                guard self.generation == id, self.active, self.online else { return }
                if !(await self.action()) { return }
            }
        }
    }
}

@MainActor final class SyncNetworkMonitor {
    private let monitor = NWPathMonitor()
    init(onChange: @escaping @MainActor @Sendable (Bool) -> Void) {
        monitor.pathUpdateHandler = { path in
            let online = path.status == .satisfied
            Task { @MainActor in onChange(online) }
        }
        monitor.start(queue: DispatchQueue(label: "RememberMe.network"))
    }
    deinit { monitor.cancel() }
}

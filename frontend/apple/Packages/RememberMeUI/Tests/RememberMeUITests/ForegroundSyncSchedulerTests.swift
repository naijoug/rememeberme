import Foundation
import Testing
@testable import RememberMeUI

private actor RetryGate {
    private var waiting: CheckedContinuation<Void, Never>?
    private(set) var delays: [Double] = []
    func wait(_ delay: Double) async throws {
        delays.append(delay)
        await withCheckedContinuation { waiting = $0 }
        try Task.checkCancellation()
    }
    func release() { waiting?.resume(); waiting = nil }
}
@Test @MainActor func foregroundRetryIsBoundedAndNetworkRecoveryStartsANewFlight() async throws {
    let gate = RetryGate(); var calls = 0
    let scheduler = ForegroundSyncScheduler(delays: [2, 4], sleep: { try await gate.wait($0) }) { calls += 1; return true }
    scheduler.setActive(true); scheduler.trigger()
    while await gate.delays.count < 1 { await Task.yield() }
    #expect(calls == 1)
    await gate.release()
    while await gate.delays.count < 2 { await Task.yield() }
    #expect(calls == 2)
    await gate.release()
    while calls < 3 { await Task.yield() }
    for _ in 0..<20 { await Task.yield() }
    #expect(calls == 3)
    scheduler.networkChanged(online: false); scheduler.networkChanged(online: true)
    while calls < 4 { await Task.yield() }
    while await gate.delays.count < 3 { await Task.yield() }
    scheduler.setActive(false); await gate.release()
    for _ in 0..<20 { await Task.yield() }
    #expect(calls == 4)
    scheduler.networkChanged(online: false); scheduler.networkChanged(online: true)
    for _ in 0..<20 { await Task.yield() }
    #expect(calls == 4)
}
@Test @MainActor func stoppingSyncCancelsDelayedRetryAndSuccessStopsTheFlight() async throws {
    let gate = RetryGate(); var calls = 0
    let scheduler = ForegroundSyncScheduler(delays: [2], sleep: { try await gate.wait($0) }) { calls += 1; return false }
    scheduler.setActive(true); scheduler.trigger(immediate: false)
    while await gate.delays.isEmpty { await Task.yield() }
    scheduler.cancel(); await gate.release()
    for _ in 0..<20 { await Task.yield() }
    #expect(calls == 0)
    scheduler.trigger()
    while calls < 1 { await Task.yield() }
    for _ in 0..<20 { await Task.yield() }
    #expect(calls == 1)
    #expect(await gate.delays.count == 1)
}

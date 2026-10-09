import Foundation

public struct ServerSnapshotEntry: Sendable {
    public var state: APIEntry
    public var history: [APIHistoryPage.Event]
}
public struct ServerSnapshot: Sendable {
    public var identity: ConnectedIdentity
    public var account: APIAccountIdentity
    public var boundary: Int
    public var entries: [ServerSnapshotEntry]
}
public struct ServerSnapshotProgress: Sendable {
    public var entries: Int
    public var historyPages: Int
}

/// Independent read-only snapshot for recovery previews. It neither changes the
/// active repository/checkpoint nor unpauses a queue from an earlier epoch.
public struct ServerSnapshotLoader: Sendable {
    private let api: any SyncAPI
    public init(api: any SyncAPI) { self.api = api }
    public func download(progress: @Sendable (ServerSnapshotProgress) -> Void = { _ in }) async throws -> ServerSnapshot {
        guard let identity = try await api.identity() else { throw AuthenticationError.notSignedIn }
        let account = try await api.account()
        guard account.userId == identity.userId, account.deviceId == identity.deviceId,
              Set(account.syncCapabilities ?? []).contains("history-version-v1") else { throw AuthenticationError.invalidReply }
        var states: [APIEntry] = [], ids: Set<String> = [], boundary: Int?, cursor = 0
        while true {
            try Task.checkCancellation()
            let page = try await api.page(snapshot: true, epoch: account.epoch, after: cursor, boundary: boundary)
            try page.validate(after: cursor)
            guard page.epoch == account.epoch, boundary == nil || boundary == page.boundary else { throw APIRequestError.invalidResponse }
            boundary = page.boundary; cursor = page.nextCursor
            for change in page.changes {
                guard ids.insert(change.entry.id).inserted else { throw ClientError.invalidData("duplicate lifecycle in fixed snapshot") }
                states.append(change.entry)
            }
            progress(ServerSnapshotProgress(entries: states.count, historyPages: 0))
            if !page.hasMore { break }
        }
        var entries: [ServerSnapshotEntry] = [], historyPages = 0
        for state in states {
            var after = "", events: [APIHistoryPage.Event] = [], positions: Set<Int> = []
            while true {
                try Task.checkCancellation()
                let page = try await api.history(entryId: state.id, after: after, version: state.version, epoch: account.epoch)
                try page.validate(after: after)
                guard page.entryVersion == state.version else { throw APIRequestError.invalidResponse }
                for event in page.events {
                    guard let position = event.position, positions.insert(position).inserted else { throw ClientError.invalidData("duplicate or missing retained history position") }
                    events.append(event)
                }
                after = page.nextCursor; historyPages += 1
                progress(ServerSnapshotProgress(entries: states.count, historyPages: historyPages))
                if !page.hasMore { break }
            }
            events.sort { left, right in
                if state.historyOrdering == "timestamp", left.timestamp != right.timestamp { return left.timestamp < right.timestamp }
                return left.position! < right.position!
            }
            entries.append(ServerSnapshotEntry(state: state, history: events))
        }
        try Task.checkCancellation()
        // A database restore or preference/account switch during download must
        // invalidate the entire preview. Ordinary later mutations remain beyond
        // the fixed boundary and will be compared by subsequent conditional writes.
        let latest = try await api.account()
        guard try await api.identity() == identity, latest.userId == account.userId, latest.deviceId == account.deviceId else { throw AuthenticationError.superseded }
        guard latest.epoch == account.epoch, latest.timezone == account.timezone,
              latest.syncContext == account.syncContext, latest.syncURLs == account.syncURLs else { throw ClientError.stalePreview }
        return ServerSnapshot(identity: identity, account: latest, boundary: boundary ?? 0, entries: entries)
    }
}

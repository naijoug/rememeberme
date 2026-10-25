import Foundation
import Testing
@testable import RememberMeCore

private let fixtures = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    .appendingPathComponent("../../../../../../contracts/fixtures").standardizedFileURL
@Test func unifiedWireFixtureRetainsFractionalCountAndLegacyTimestamp() throws {
    let fixture = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: fixtures.appendingPathComponent("sync-create-v1.json")))
    let request = try JSONDecoder().decode(APIOperation.self, from: JSONValue.encoder().encode(fixture["request"]!))
    #expect(request.operationId == "fixture-create"); #expect(request.kind == "create"); #expect(request.baseVersion == nil)
    let response = try APIOperationResult.decode(JSONValue.encoder().encode(fixture["response"]!))
    #expect(response.entry.count == 0.5); #expect(response.entry.createdAtMs == 0.5)
    #expect(response.entry.updatedAtMs == 1e100)
    #expect(response.entry.version == 1); #expect(response.cursor == 1)
}
@Test func unifiedConflictErrorRemainsExplicitAndNonretryable() throws {
    let data = try Data(contentsOf: fixtures.appendingPathComponent("sync-errors-v1.json"))
    let error = try JSONDecoder().decode(APIErrorBody.self, from: data)
    #expect(error.error.code == "VERSION_CONFLICT"); #expect(error.error.retryable == false)
    #expect(UUID(uuidString: error.error.requestId) != nil)
}
@Test func unifiedLegacyMergeFixtureMatchesTheNativeProjection() throws {
    let fixture = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: fixtures.appendingPathComponent("sync-legacy-merge-v1.json")))
    let request = try JSONDecoder().decode(APIOperation.self, from: JSONValue.encoder().encode(fixture["request"]!))
    let definition = try #require(request.payload["definition"])
    let entry = VocabularyEntry(id: request.entryId, word: "Having", count: 0.5, timestamp: 1, definition: definition)
    var logical = PendingOperation(id: fixture["logicalId"]!.text!, owner: "synthetic-owner", entryID: entry.id, kind: "legacyMerge",
        baseVersion: 1, payload: try LocalRepository.json(entry))
    logical.observedRemoteVersion = 1
    #expect(try SyncProjection.makeWire(logical, privacy: SyncPrivacy(), base: nil) == [request])
}

@Test func reminderSelectionUsesSharedNullableDeviceAndRevisionFixture() throws {
    let fixture = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: fixtures.appendingPathComponent("reminder-device-v1.json")))
    for key in ["response", "released"] {
        let selection = try JSONDecoder().decode(ReminderDeviceSelection.self, from: JSONValue.encoder().encode(fixture[key]!))
        try selection.validate()
        #expect(selection.deviceId == fixture[key]?["deviceId"]?.text)
    }
    for invalid in fixture["invalidResponses"]!.items! {
        let selection = try JSONDecoder().decode(ReminderDeviceSelection.self, from: JSONValue.encoder().encode(invalid))
        #expect(throws: APIRequestError.self) { try selection.validate() }
    }
}

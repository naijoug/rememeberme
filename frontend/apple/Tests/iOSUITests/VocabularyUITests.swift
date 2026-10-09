import XCTest

final class VocabularyUITests: XCTestCase {
    @MainActor func testAccountSettingsKeepsDisposableVocabularyAnonymousWithoutSigningIn() {
        let app = XCUIApplication()
        app.launchArguments = ["-rememberme-test-store", "ui-" + UUID().uuidString]
        app.launch()
        XCTAssertTrue(app.buttons["Options"].waitForExistence(timeout: 15))
        app.buttons["Options"].tap(); app.buttons["Settings"].tap()
        XCTAssertTrue(app.staticTexts["Cloud account"].waitForExistence(timeout: 5))
        app.swipeUp()
        XCTAssertTrue(app.staticTexts["Vocabulary and synchronization"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Anonymous vocabulary"].exists)
        XCTAssertFalse(app.buttons["Open account vocabulary"].exists)
        XCTAssertFalse(app.switches["Enable cloud sync"].exists)
        app.terminate()
    }
    @MainActor func testInterruptedImportResumesAfterRelaunchWithoutAddingCountsTwice() {
        let app = XCUIApplication()
        app.launchArguments = ["-rememberme-test-store", "ui-" + UUID().uuidString, "-rememberme-test-import-recovery"]
        app.launch()
        XCTAssertTrue(app.staticTexts["original"].firstMatch.waitForExistence(timeout: 15))
        XCTAssertFalse(app.staticTexts["recoverable"].exists)
        app.terminate(); app.launch()
        XCTAssertTrue(app.buttons["Options"].waitForExistence(timeout: 15))
        app.buttons["Options"].tap()
        let recovery = app.buttons["Interrupted imports (1)"]
        XCTAssertTrue(recovery.waitForExistence(timeout: 5)); recovery.tap()
        let resume = app.buttons["Resume import"]
        XCTAssertTrue(resume.waitForExistence(timeout: 5)); resume.tap()
        XCTAssertTrue(app.staticTexts["No interrupted imports"].waitForExistence(timeout: 10))
        app.buttons["Done"].tap()
        let word = app.staticTexts["recoverable"].firstMatch
        XCTAssertTrue(word.waitForExistence(timeout: 5)); word.tap()
        XCTAssertTrue(app.staticTexts["Forgotten: 2"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Records (0)"].exists)
        app.terminate()
    }
    @MainActor func testManualEditAndReviewDoNotRewriteEncounterOrForgottenCount() {
        let app = XCUIApplication()
        app.launchArguments = ["-rememberme-test-store", "ui-" + UUID().uuidString]
        app.launch()
        XCTAssertTrue(app.buttons["Add word"].waitForExistence(timeout: 15))
        app.buttons["Add word"].tap()
        let field = app.textFields["word-editor"]
        XCTAssertTrue(field.waitForExistence(timeout: 5)); field.tap(); field.typeText("synthetic")
        app.buttons["Save"].tap()
        let row = app.staticTexts["synthetic"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        if !app.buttons["Record once forgotten"].exists { row.tap() }
        XCTAssertTrue(app.buttons["Record once forgotten"].waitForExistence(timeout: 5))
        app.buttons["Record once forgotten"].tap()
        XCTAssertTrue(app.staticTexts["Forgotten: 1"].waitForExistence(timeout: 5))
        app.buttons["Edit definition and notes"].tap()
        let manual = app.textFields["Manual meaning (optional; replaces English meanings)"]
        XCTAssertTrue(manual.waitForExistence(timeout: 5)); manual.tap(); manual.typeText("Literal synthetic meaning")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["Literal synthetic meaning"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Records (1)"].exists)
        if app.buttons["BackButton"].exists { app.buttons["BackButton"].tap() }
        app.buttons["Options"].tap(); app.buttons["Today’s review"].tap()
        let reveal = app.buttons["Reveal meaning"]
        XCTAssertTrue(reveal.waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Literal synthetic meaning"].exists)
        reveal.tap(); XCTAssertTrue(app.staticTexts["Literal synthetic meaning"].waitForExistence(timeout: 5))
        app.buttons["Remembered"].tap()
        XCTAssertTrue(app.staticTexts["Review complete for now"].waitForExistence(timeout: 5))
        app.buttons["Done"].tap()
        if !app.buttons["Record once forgotten"].exists { app.staticTexts["synthetic"].firstMatch.tap() }
        XCTAssertTrue(app.staticTexts["Forgotten: 1"].waitForExistence(timeout: 5))
        app.terminate()
    }
    @MainActor func testLocalWordSurvivesRelaunchAndResetRetainsHistory() {
        let app = XCUIApplication()
        app.launchArguments = ["-rememberme-test-store", "ui-" + UUID().uuidString]
        app.launch()
        let add = app.buttons["Add word"]
        XCTAssertTrue(add.waitForExistence(timeout: 15))
        XCTAssertTrue(add.isEnabled)
        add.tap()
        let field = app.textFields["word-editor"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap(); field.typeText("synthetic")
        app.buttons["Save"].tap()
        let row = app.staticTexts["synthetic"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        if !app.buttons["Record once forgotten"].exists { row.tap() }
        let record = app.buttons["Record once forgotten"]
        XCTAssertTrue(record.waitForExistence(timeout: 5))
        record.tap()
        XCTAssertTrue(app.staticTexts["Forgotten: 1"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Records (1)"].exists)
        app.terminate(); app.launch()
        let saved = app.staticTexts["synthetic"].firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 10))
        if !app.buttons["Reset count"].exists { saved.tap() }
        XCTAssertTrue(app.buttons["Reset count"].waitForExistence(timeout: 5))
        app.buttons["Reset count"].tap()
        XCTAssertTrue(app.staticTexts["Forgotten: 0"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Records (1)"].exists)
        app.buttons["Delete word"].tap()
        let cancel = app.buttons["Cancel"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 5))
        cancel.tap()
        XCTAssertTrue(app.staticTexts["Records (1)"].exists)
        app.buttons["Delete word"].tap(); app.buttons["Delete"].tap()
        XCTAssertTrue(app.staticTexts["Your vocabulary, on this device"].waitForExistence(timeout: 5))
        app.terminate()
    }
}

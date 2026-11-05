import XCTest
import UIKit

final class VocabularyUITests: XCTestCase {
    #if os(macOS)
    @MainActor func testMacSettingsStaysInVocabularyWindow() {
        let app = XCUIApplication()
        app.launchArguments = ["-rememberme-test-store", "ui-" + UUID().uuidString, "-rememberme-test-import-recovery"]
        app.launch()
        defer { app.terminate() }
        let word = app.buttons["original, 3"]
        XCTAssertTrue(word.waitForExistence(timeout: 15))
        word.tap()
        XCTAssertTrue(app.staticTexts["Forgotten: 3"].waitForExistence(timeout: 5))
        let windowCount = app.windows.count

        app.buttons["open-settings"].tap()
        XCTAssertTrue(app.buttons["Sign in with GitHub"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.windows.count, windowCount)
        XCTAssertEqual(app.sheets.count, 0)
        app.radioButtons["General"].tap()
        XCTAssertTrue(app.checkBoxes["Remind me on this device"].waitForExistence(timeout: 5))
        app.radioButtons["Privacy"].tap()
        XCTAssertTrue(app.staticTexts["Complete backups include saved sentences and full URLs. Credentials and pending requests are excluded."].waitForExistence(timeout: 5))
        app.radioButtons["Updates"].tap()
        XCTAssertTrue(app.staticTexts["Installed version"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.windows.count, windowCount)
        let screenshot = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
        screenshot.name = "Settings inside vocabulary window"; screenshot.lifetime = .keepAlways; add(screenshot)
        app.buttons["back-to-vocabulary"].tap()
        XCTAssertTrue(app.staticTexts["Forgotten: 3"].waitForExistence(timeout: 5))

        app.typeKey(",", modifierFlags: .command)
        XCTAssertTrue(app.buttons["Sign in with GitHub"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.windows.count, windowCount)
        word.tap()
        XCTAssertTrue(app.staticTexts["Forgotten: 3"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["back-to-vocabulary"].exists)
    }
    #endif

    @MainActor func testOriginalSentenceReviewHidesMeaningUntilRevealAndPreservesCount() {
        let app = XCUIApplication()
        app.launchArguments = ["-rememberme-test-store", "ui-" + UUID().uuidString, "-rememberme-test-review-context"]
        app.launch()
        XCTAssertTrue(app.staticTexts["bank"].firstMatch.waitForExistence(timeout: 15))
        app.buttons["Learn words"].tap()
        XCTAssertTrue(app.staticTexts["The bank is beside the park."].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Saved fixture meaning"].exists)
        XCTAssertFalse(app.staticTexts["Current fixture meaning"].exists)
        let front = XCTAttachment(screenshot: app.screenshot()); front.name = "Original sentence front"; front.lifetime = .keepAlways; add(front)
        app.buttons["Reveal meaning"].tap()
        XCTAssertTrue(app.staticTexts["Saved fixture meaning"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Current fixture meaning"].exists)
        let back = XCTAttachment(screenshot: app.screenshot()); back.name = "Original sentence revealed"; back.lifetime = .keepAlways; add(back)
        app.buttons["Remembered"].tap()
        XCTAssertTrue(app.staticTexts["Review complete for now"].waitForExistence(timeout: 5))
        app.buttons["Done"].tap()
        app.staticTexts["bank"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Forgotten: 3"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Records (1)"].exists)
        app.terminate()
    }
    @MainActor func testReviewDynamicTypeDarkModeAndAccessibility() throws {
        let app = XCUIApplication()
        let store = "ui-" + UUID().uuidString
        app.launchArguments = ["-rememberme-test-store", store, "-rememberme-test-review-context", "-rememberme.appearance", "light"]
        app.launch()
        XCTAssertTrue(app.buttons["Learn words"].waitForExistence(timeout: 15)); app.buttons["Learn words"].tap()
        let sentence = app.staticTexts["The bank is beside the park."]
        XCTAssertTrue(sentence.waitForExistence(timeout: 5))
        let normalHeight = sentence.frame.height
        try app.performAccessibilityAudit(for: [.contrast, .sufficientElementDescription, .textClipped])
        app.terminate()
        app.launchArguments[app.launchArguments.firstIndex(of: "light")!] = "dark"
        app.launch()
        XCTAssertTrue(app.buttons["Learn words"].waitForExistence(timeout: 15)); app.buttons["Learn words"].tap()
        XCTAssertTrue(app.buttons["Reveal meaning"].waitForExistence(timeout: 5)); app.buttons["Reveal meaning"].tap()
        XCTAssertTrue(app.staticTexts["Saved fixture meaning"].waitForExistence(timeout: 5))
        try app.performAccessibilityAudit(for: [.contrast, .sufficientElementDescription, .textClipped])
        let dark = XCTAttachment(screenshot: app.screenshot()); dark.name = "iPhone dark contrast review"; dark.lifetime = .keepAlways; add(dark)
        app.terminate()
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", UIContentSizeCategory.accessibilityExtraExtraExtraLarge.rawValue]
        app.launch()
        XCTAssertTrue(app.buttons["Learn words"].waitForExistence(timeout: 15)); app.buttons["Learn words"].tap()
        XCTAssertTrue(sentence.waitForExistence(timeout: 5))
        XCTAssertGreaterThan(sentence.frame.height, normalHeight)
        XCTAssertFalse(app.staticTexts["Saved fixture meaning"].exists)
        let scroll = app.scrollViews["review-scroll"]
        XCTAssertTrue(scroll.exists)
        for _ in 0..<6 {
            if app.buttons["Reveal meaning"].isHittable { break }
            scroll.swipeUp()
        }
        app.buttons["Reveal meaning"].tap()
        XCTAssertTrue(app.staticTexts["Saved fixture meaning"].waitForExistence(timeout: 5))
        // Colors are audited above in both schemes with the text visible. At
        // maximum size the SDK contrast scan samples offscreen text as blank;
        // retain its failure attachments and audit wrapping/names here instead.
        try app.performAccessibilityAudit(for: [.sufficientElementDescription, .textClipped])
        scroll.swipeUp()
        let evidence = XCTAttachment(screenshot: app.screenshot()); evidence.name = "iPhone maximum accessibility text review"; evidence.lifetime = .keepAlways; add(evidence)
        app.terminate()
    }

    @MainActor func testAccountSettingsKeepsDisposableVocabularyAnonymousWithoutSigningIn() {
        let app = XCUIApplication()
        app.launchArguments = ["-rememberme-test-store", "ui-" + UUID().uuidString]
        app.launch()
        XCTAssertTrue(app.buttons["Options"].waitForExistence(timeout: 15))
        app.buttons["Options"].tap(); app.buttons["Settings"].tap()
        XCTAssertTrue(app.buttons["Sign in with GitHub"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.textFields["HTTPS API address"].exists)
        XCTAssertFalse(app.buttons["Open account vocabulary"].exists)
        XCTAssertFalse(app.switches["Cloud sync"].exists)
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
        XCTAssertTrue(app.buttons["Learn words"].waitForExistence(timeout: 5))
        app.buttons["Learn words"].tap()
        let reveal = app.buttons["Reveal meaning"]
        XCTAssertTrue(reveal.waitForExistence(timeout: 5))
        let beforeReveal = XCTAttachment(screenshot: app.screenshot())
        beforeReveal.name = "iPad review before reveal"; beforeReveal.lifetime = .keepAlways; add(beforeReveal)
        XCTAssertFalse(app.staticTexts["Literal synthetic meaning"].exists)
        reveal.tap(); XCTAssertTrue(app.staticTexts["Literal synthetic meaning"].waitForExistence(timeout: 5))
        let afterReveal = XCTAttachment(screenshot: app.screenshot())
        afterReveal.name = "iPad review after reveal"; afterReveal.lifetime = .keepAlways; add(afterReveal)
        app.buttons["Remembered"].tap()
        XCTAssertTrue(app.staticTexts["Review complete for now"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "This session: 1 answered")).firstMatch.exists)
        let completed = XCTAttachment(screenshot: app.screenshot())
        completed.name = "iPad review completed"; completed.lifetime = .keepAlways; add(completed)
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

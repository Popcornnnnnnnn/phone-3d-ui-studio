import XCTest

final class StudioInterfaceTests: XCTestCase {
    func testConnectionModesAndAppearance() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["Start tracking"].waitForExistence(timeout: 10))
        capture("01-tracking-light", app: app)

        app.staticTexts["Mac connection"].tap()
        XCTAssertTrue(app.buttons["Scan QR code"].waitForExistence(timeout: 3))
        capture("02-connection", app: app)
        app.buttons["Enter address manually"].tap()
        let address = app.textFields.firstMatch
        XCTAssertTrue(address.waitForExistence(timeout: 3))
        address.tap()
        let current = address.value as? String ?? ""
        address.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count))
        address.typeText("invalid")
        XCTAssertFalse(app.buttons["Save"].isEnabled)
        address.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 7))
        address.typeText("ws://192.168.1.10:4319/")
        XCTAssertTrue(app.buttons["Save"].isEnabled)
        // Cancel keeps the saved address unchanged during layout review.
        capture("03-address", app: app)
        app.buttons["Cancel"].tap()
        app.staticTexts["Mac connection"].tap()

        app.segmentedControls.buttons["Screen mirroring"].tap()
        XCTAssertTrue(app.buttons["Start sharing"].waitForExistence(timeout: 3))
        capture("04-mirroring-light", app: app)
        app.buttons["Appearance settings"].tap()
        app.segmentedControls.buttons["Dark"].tap()
        capture("05-appearance", app: app)
        app.buttons["Done"].tap()
        capture("06-mirroring-dark", app: app)
        app.segmentedControls.buttons["Tracking"].tap()
        XCTAssertTrue(app.buttons["Start tracking"].waitForExistence(timeout: 3))
        capture("07-tracking-dark", app: app)
        app.buttons["Appearance settings"].tap()
        app.segmentedControls.buttons["System"].tap()
        app.buttons["Done"].tap()
    }

    private func capture(_ name: String, app: XCUIApplication) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}

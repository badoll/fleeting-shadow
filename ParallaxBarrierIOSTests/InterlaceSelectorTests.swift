import XCTest
@testable import ParallaxBarrierIOS

final class InterlaceSelectorTests: XCTestCase {
    func testRowsDefaultAlternatesByY() {
        let config = InterlaceConfiguration.standard
        XCTAssertNotEqual(
            InterlaceSelector.eyeIndex(x: 0, y: 0, configuration: config),
            InterlaceSelector.eyeIndex(x: 0, y: 1, configuration: config)
        )
    }

    func testColumnsDefaultAlternatesByX() {
        var config = InterlaceConfiguration.standard
        config.axis = .columns
        XCTAssertNotEqual(
            InterlaceSelector.eyeIndex(x: 0, y: 0, configuration: config),
            InterlaceSelector.eyeIndex(x: 1, y: 0, configuration: config)
        )
    }

    func testSwapEyesFlipsResult() {
        var config = InterlaceConfiguration.standard
        let original = InterlaceSelector.eyeIndex(x: 0, y: 0, configuration: config)
        config.swapEyes = true
        XCTAssertEqual(
            InterlaceSelector.eyeIndex(x: 0, y: 0, configuration: config),
            1 - original
        )
    }

    func testPositiveAndNegativePhase() {
        var positive = InterlaceConfiguration.standard
        positive.phasePixels = 1
        var negative = InterlaceConfiguration.standard
        negative.phasePixels = -1

        XCTAssertEqual(InterlaceSelector.eyeIndex(x: 0, y: 0, configuration: positive), 1)
        XCTAssertEqual(InterlaceSelector.eyeIndex(x: 0, y: 0, configuration: negative), 1)
    }

    func testFractionalPitchIsStable() {
        var config = InterlaceConfiguration.standard
        config.pitchPixels = 1.5

        XCTAssertEqual(InterlaceSelector.eyeIndex(x: 0, y: 0, configuration: config), 0)
        XCTAssertEqual(InterlaceSelector.eyeIndex(x: 0, y: 1.49, configuration: config), 0)
        XCTAssertEqual(InterlaceSelector.eyeIndex(x: 0, y: 1.51, configuration: config), 1)
    }

    func testSlantedSlopeChangesSelection() {
        var config = InterlaceConfiguration.standard
        config.axis = .slanted
        config.slope = 1

        XCTAssertNotEqual(
            InterlaceSelector.eyeIndex(x: 0, y: 0, configuration: config),
            InterlaceSelector.eyeIndex(x: 0, y: 1, configuration: config)
        )
    }

    func testTinyPitchIsClamped() {
        var config = InterlaceConfiguration.standard
        config.pitchPixels = -1

        XCTAssertEqual(InterlaceSelector.eyeIndex(x: 0, y: 0, configuration: config), 0)
        XCTAssertTrue((0...1).contains(InterlaceSelector.eyeIndex(x: 0, y: 100, configuration: config)))
    }
}

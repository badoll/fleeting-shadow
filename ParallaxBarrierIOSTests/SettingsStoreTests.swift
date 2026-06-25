import Foundation
import XCTest
@testable import ParallaxBarrierIOS

final class SettingsStoreTests: XCTestCase {
    func testDefaultSettingsEncodeDecode() {
        let (store, defaults, suiteName) = makeStore()
        defer { defaults.removePersistentDomain(forName: suiteName) }

        store.save(.standard)
        XCTAssertEqual(store.load(), .standard)
    }

    func testSavedSettingsReload() {
        let (store, defaults, suiteName) = makeStore()
        defer { defaults.removePersistentDomain(forName: suiteName) }

        var settings = AppSettings.standard
        settings.outputMode = .sideBySide
        settings.interlace.phasePixels = 3.25
        store.save(settings)

        XCTAssertEqual(store.load(), settings.validated())
    }

    func testCorruptJSONFallsBackToDefaults() {
        let (store, defaults, suiteName) = makeStore()
        defer { defaults.removePersistentDomain(forName: suiteName) }

        store.corruptForTesting(Data([0xff, 0x00, 0x23]))
        XCTAssertEqual(store.load(), .standard)
    }

    func testOutOfRangeValuesAreValidatedOnLoad() throws {
        let (store, defaults, suiteName) = makeStore()
        defer { defaults.removePersistentDomain(forName: suiteName) }

        var invalid = AppSettings.standard
        invalid.interlace.pitchPixels = 100
        invalid.camera.maxOffset = 100
        invalid.renderScale = 0.1
        invalid.targetFPS = 12

        let data = try JSONEncoder().encode(invalid)
        defaults.set(data, forKey: SettingsStore.defaultKey)

        let loaded = store.load()
        XCTAssertEqual(loaded.interlace.pitchPixels, 16)
        XCTAssertEqual(loaded.camera.maxOffset, 12)
        XCTAssertEqual(loaded.renderScale, 1)
        XCTAssertEqual(loaded.targetFPS, 60)
    }

    func testVersionOneDefaultCameraRangeMigratesToWiderDefault() throws {
        let (store, defaults, suiteName) = makeStore()
        defer { defaults.removePersistentDomain(forName: suiteName) }

        var oldDefaults = AppSettings.standard
        oldDefaults.schemaVersion = 1
        oldDefaults.camera.maxOffset = 2.5

        let data = try JSONEncoder().encode(oldDefaults)
        defaults.set(data, forKey: SettingsStore.defaultKey)

        let loaded = store.load()
        XCTAssertEqual(loaded.schemaVersion, AppSettings.schemaVersion)
        XCTAssertEqual(loaded.camera.maxOffset, CameraConfiguration.standard.maxOffset)
    }

    func testResetReturnsAndPersistsDefaults() {
        let (store, defaults, suiteName) = makeStore()
        defer { defaults.removePersistentDomain(forName: suiteName) }

        var settings = AppSettings.standard
        settings.outputMode = .leftEye
        store.save(settings)

        XCTAssertEqual(store.reset(), .standard)
        XCTAssertEqual(store.load(), .standard)
    }

    private func makeStore() -> (SettingsStore, UserDefaults, String) {
        let suiteName = "ParallaxBarrierIOSTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        return (SettingsStore(defaults: defaults), defaults, suiteName)
    }
}

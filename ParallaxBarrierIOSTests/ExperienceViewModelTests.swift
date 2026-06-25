import CoreGraphics
import XCTest
@testable import ParallaxBarrierIOS

final class ExperienceViewModelTests: XCTestCase {
    @MainActor
    func testDragGesturesAccumulateAcrossSwipes() {
        let (store, defaults, suiteName) = makeStore()
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let viewModel = ExperienceViewModel(settingsStore: store)
        let viewSize = CGSize(width: 400, height: 800)

        viewModel.updateDrag(translation: CGSize(width: 40, height: 0), viewSize: viewSize)
        let firstOffset = viewModel.cameraInputSnapshot.dragOffset.x
        viewModel.endDrag()

        viewModel.updateDrag(translation: CGSize(width: 40, height: 0), viewSize: viewSize)
        let secondOffset = viewModel.cameraInputSnapshot.dragOffset.x

        XCTAssertGreaterThan(secondOffset, firstOffset + 1.0)
    }

    @MainActor
    func testAccumulatedDragClampsToWideCameraLimit() {
        let (store, defaults, suiteName) = makeStore()
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let viewModel = ExperienceViewModel(settingsStore: store)
        let viewSize = CGSize(width: 400, height: 800)

        viewModel.updateDrag(translation: CGSize(width: 1_000, height: -1_000), viewSize: viewSize)

        XCTAssertEqual(viewModel.cameraInputSnapshot.dragOffset.x, AppSettings.standard.camera.maxOffset)
        XCTAssertEqual(viewModel.cameraInputSnapshot.dragOffset.y, AppSettings.standard.camera.maxOffset)
    }

    private func makeStore() -> (SettingsStore, UserDefaults, String) {
        let suiteName = "ParallaxBarrierIOSTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        return (SettingsStore(defaults: defaults), defaults, suiteName)
    }
}

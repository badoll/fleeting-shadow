import Foundation
import SwiftUI
import simd

@MainActor
final class ExperienceViewModel: ObservableObject {
    @Published var settings: AppSettings {
        didSet { normalizePersistAndApplySettings() }
    }
    @Published var showsControls = false
    @Published var showingSettings = false
    @Published var showingCalibration = false
    @Published var isActive = true
    @Published var statistics = RenderStatistics.empty
    @Published var rendererError: RendererError?
    @Published var motionWarning: String?

    let motionAvailable: Bool

    private let settingsStore: SettingsStore
    private let motionController: MotionController
    private var isNormalizingSettings = false
    private var dragOffset = SIMD2<Float>.zero
    private var dragGestureStartOffset: SIMD2<Float>?
    private var motionOffset = SIMD2<Float>.zero
    private var recenterGeneration: UInt64 = 0
    private var calibrationEntrySettings: AppSettings?

    init(
        settingsStore: SettingsStore = SettingsStore(),
        motionController: MotionController = MotionController()
    ) {
        self.settingsStore = settingsStore
        self.motionController = motionController
        self.settings = settingsStore.load()
        self.motionAvailable = motionController.isAvailable
        self.motionController.onMotionUpdate = { [weak self] offset in
            Task { @MainActor in
                self?.motionOffset = offset
            }
        }
        configureMotion()
    }

    var renderSettingsSnapshot: RenderSettingsSnapshot {
        RenderSettingsSnapshot(settings: settings)
    }

    var cameraInputSnapshot: CameraInputSnapshot {
        CameraInputSnapshot(
            dragOffset: dragOffset,
            motionOffset: motionOffset,
            recenterGeneration: recenterGeneration
        )
    }

    func toggleControls() {
        showsControls.toggle()
    }

    func openSettings() {
        showingSettings = true
    }

    func beginCalibration() {
        guard calibrationEntrySettings == nil else { return }
        calibrationEntrySettings = settings
        settings.outputMode = .calibration
        showingCalibration = true
    }

    func saveCalibration() {
        if let entry = calibrationEntrySettings {
            settings.outputMode = entry.outputMode
        }
        calibrationEntrySettings = nil
        showingCalibration = false
    }

    func cancelCalibration() {
        if let entry = calibrationEntrySettings {
            settings = entry
        }
        calibrationEntrySettings = nil
        showingCalibration = false
    }

    func cancelCalibrationIfNeeded() {
        guard calibrationEntrySettings != nil else { return }
        cancelCalibration()
    }

    func resetCalibrationDefaults() {
        settings.interlace = .standard
        settings.outputMode = .calibration
    }

    func resetAllSettings() {
        settings = settingsStore.reset()
        dragOffset = .zero
        dragGestureStartOffset = nil
        motionOffset = .zero
        recenterGeneration &+= 1
    }

    func recenter() {
        dragOffset = .zero
        dragGestureStartOffset = nil
        motionOffset = .zero
        recenterGeneration &+= 1
    }

    func updateDrag(translation: CGSize, viewSize: CGSize) {
        guard settings.camera.dragEnabled else {
            dragGestureStartOffset = nil
            return
        }
        let startingOffset = dragGestureStartOffset ?? dragOffset
        if dragGestureStartOffset == nil {
            dragGestureStartOffset = startingOffset
        }

        let minimumDimension = max(min(viewSize.width, viewSize.height), 1)
        let scale = CGFloat(settings.camera.maxOffset) / (minimumDimension * 0.35)
        var offset = startingOffset + SIMD2<Float>(
            Float(translation.width * scale),
            Float(-translation.height * scale)
        )
        offset.x = SettingsValidation.clamped(offset.x, -settings.camera.maxOffset, settings.camera.maxOffset)
        offset.y = SettingsValidation.clamped(offset.y, -settings.camera.maxOffset, settings.camera.maxOffset)
        dragOffset = offset
    }

    func endDrag() {
        dragGestureStartOffset = nil
    }

    func updateStatistics(_ statistics: RenderStatistics) {
        self.statistics = statistics
    }

    func setRendererError(_ error: RendererError) {
        rendererError = error
    }

    func handleScenePhase(_ scenePhase: ScenePhase) {
        isActive = AppLifecycleController.isActive(scenePhase)
        configureMotion()
    }

    private func normalizePersistAndApplySettings() {
        guard !isNormalizingSettings else { return }
        let validated = settings.validated()
        if validated != settings {
            isNormalizingSettings = true
            settings = validated
            isNormalizingSettings = false
        }
        settingsStore.save(settings)
        configureMotion()
    }

    private func configureMotion() {
        guard isActive, settings.camera.motionEnabled else {
            motionController.stop()
            return
        }

        guard motionAvailable else {
            motionWarning = "设备姿态不可用，已继续使用拖动控制。"
            motionController.stop()
            return
        }

        let started = motionController.start(
            maxOffset: settings.camera.maxOffset,
            sensitivity: settings.camera.motionSensitivity
        )
        motionWarning = started ? nil : "设备姿态不可用，已继续使用拖动控制。"
    }
}

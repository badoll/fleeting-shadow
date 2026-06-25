import Foundation

enum SettingsValidation {
    static func clamped(_ value: Float, _ lowerBound: Float, _ upperBound: Float) -> Float {
        guard value.isFinite else { return lowerBound }
        return min(max(value, lowerBound), upperBound)
    }

    static func validated(_ settings: AppSettings) -> AppSettings {
        var value = settings
        let loadedSchemaVersion = value.schemaVersion
        value.schemaVersion = AppSettings.schemaVersion

        if loadedSchemaVersion < 2 && abs(value.camera.maxOffset - 2.5) < 0.001 {
            value.camera.maxOffset = CameraConfiguration.standard.maxOffset
        }

        value.stereo.eyeSeparation = clamped(value.stereo.eyeSeparation, 0.0, 0.5)
        value.stereo.focusDistance = clamped(value.stereo.focusDistance, 0.02, 100.0)
        value.stereo.fovDegrees = clamped(value.stereo.fovDegrees, 20.0, 110.0)

        value.interlace.pitchPixels = clamped(value.interlace.pitchPixels, 0.5, 16.0)
        value.interlace.phasePixels = clamped(value.interlace.phasePixels, -16.0, 16.0)
        value.interlace.slope = clamped(value.interlace.slope, -2.0, 2.0)

        value.camera.maxOffset = clamped(value.camera.maxOffset, 0.25, 12.0)
        value.camera.motionSensitivity = clamped(value.camera.motionSensitivity, 0.1, 4.0)

        let allowedRenderScales: [Float] = [1.0, 0.75, 0.5]
        if !allowedRenderScales.contains(where: { abs($0 - value.renderScale) < 0.001 }) {
            value.renderScale = 1.0
        }

        if value.targetFPS != 60 && value.targetFPS != 30 {
            value.targetFPS = 60
        }

        return value
    }
}

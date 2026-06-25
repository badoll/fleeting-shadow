import Foundation

enum OutputMode: String, Codable, CaseIterable, Identifiable {
    case mono
    case leftEye
    case rightEye
    case sideBySide
    case interlaced
    case calibration

    var id: String { rawValue }

    var title: String {
        switch self {
        case .mono: return "单眼"
        case .leftEye: return "左眼"
        case .rightEye: return "右眼"
        case .sideBySide: return "并排"
        case .interlaced: return "交错"
        case .calibration: return "校准"
        }
    }

    var shaderValue: UInt32 {
        switch self {
        case .mono: return 0
        case .leftEye: return 1
        case .rightEye: return 2
        case .sideBySide: return 3
        case .interlaced: return 4
        case .calibration: return 5
        }
    }
}

enum InterlaceAxis: String, Codable, CaseIterable, Identifiable {
    case rows
    case columns
    case slanted

    var id: String { rawValue }

    var title: String {
        switch self {
        case .rows: return "行"
        case .columns: return "列"
        case .slanted: return "斜向"
        }
    }

    var shaderValue: UInt32 {
        switch self {
        case .rows: return 0
        case .columns: return 1
        case .slanted: return 2
        }
    }
}

struct InterlaceConfiguration: Codable, Equatable {
    var axis: InterlaceAxis
    var pitchPixels: Float
    var phasePixels: Float
    var slope: Float
    var swapEyes: Bool

    static let standard = InterlaceConfiguration(
        axis: .rows,
        pitchPixels: 1.0,
        phasePixels: 0.0,
        slope: 0.0,
        swapEyes: false
    )
}

struct StereoConfiguration: Codable, Equatable {
    var eyeSeparation: Float
    var focusDistance: Float
    var fovDegrees: Float

    static let standard = StereoConfiguration(
        eyeSeparation: 0.064,
        focusDistance: 10.0,
        fovDegrees: 60.0
    )
}

struct CameraConfiguration: Codable, Equatable {
    var dragEnabled: Bool
    var motionEnabled: Bool
    var maxOffset: Float
    var motionSensitivity: Float

    static let standard = CameraConfiguration(
        dragEnabled: true,
        motionEnabled: false,
        maxOffset: 8.0,
        motionSensitivity: 1.0
    )
}

struct AppSettings: Codable, Equatable {
    static let schemaVersion = 2

    var schemaVersion: Int
    var outputMode: OutputMode
    var stereo: StereoConfiguration
    var interlace: InterlaceConfiguration
    var camera: CameraConfiguration
    var renderScale: Float
    var targetFPS: Int
    var debugHUDEnabled: Bool

    static let standard = AppSettings(
        schemaVersion: AppSettings.schemaVersion,
        outputMode: .interlaced,
        stereo: .standard,
        interlace: .standard,
        camera: .standard,
        renderScale: 1.0,
        targetFPS: 60,
        debugHUDEnabled: false
    )

    func validated() -> AppSettings {
        SettingsValidation.validated(self)
    }
}

struct RenderSettingsSnapshot: Equatable {
    let outputMode: OutputMode
    let stereo: StereoConfiguration
    let interlace: InterlaceConfiguration
    let camera: CameraConfiguration
    let renderScale: Float
    let targetFPS: Int
    let debugHUDEnabled: Bool

    init(settings: AppSettings) {
        let validated = settings.validated()
        outputMode = validated.outputMode
        stereo = validated.stereo
        interlace = validated.interlace
        camera = validated.camera
        renderScale = validated.renderScale
        targetFPS = validated.targetFPS
        debugHUDEnabled = validated.debugHUDEnabled
    }
}

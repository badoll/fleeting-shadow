import Foundation

enum InterlaceSelector {
    static func eyeIndex(
        x: Float,
        y: Float,
        configuration: InterlaceConfiguration
    ) -> Int {
        let pitch = max(configuration.pitchPixels, 0.01)
        let coordinate: Float

        switch configuration.axis {
        case .rows:
            coordinate = y
        case .columns:
            coordinate = x
        case .slanted:
            coordinate = x + configuration.slope * y
        }

        let stripe = Int(floor((coordinate + configuration.phasePixels) / pitch))
        var index = ((stripe % 2) + 2) % 2
        if configuration.swapEyes {
            index = 1 - index
        }
        return index
    }
}

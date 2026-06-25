import CoreMotion
import Foundation
import simd

final class MotionController {
    private let manager = CMMotionManager()
    private var filteredOffset = SIMD2<Float>.zero
    private var maxOffset: Float = CameraConfiguration.standard.maxOffset
    private var sensitivity: Float = 1.0

    var onMotionUpdate: ((SIMD2<Float>) -> Void)?

    var isAvailable: Bool {
        manager.isDeviceMotionAvailable
    }

    @discardableResult
    func start(maxOffset: Float, sensitivity: Float) -> Bool {
        self.maxOffset = maxOffset
        self.sensitivity = sensitivity

        guard manager.isDeviceMotionAvailable else {
            stop()
            return false
        }

        if manager.isDeviceMotionActive {
            return true
        }

        filteredOffset = .zero
        manager.deviceMotionUpdateInterval = 1.0 / 60.0
        manager.startDeviceMotionUpdates(to: .main) { [weak self] motion, _ in
            guard let self, let motion else { return }
            let attitude = motion.attitude
            var raw = SIMD2<Float>(
                Float(attitude.roll) * self.sensitivity,
                Float(-attitude.pitch) * self.sensitivity
            )
            raw.x = SettingsValidation.clamped(raw.x, -self.maxOffset, self.maxOffset)
            raw.y = SettingsValidation.clamped(raw.y, -self.maxOffset, self.maxOffset)
            self.filteredOffset += (raw - self.filteredOffset) * 0.15
            self.onMotionUpdate?(self.filteredOffset)
        }

        return true
    }

    func stop() {
        if manager.isDeviceMotionActive {
            manager.stopDeviceMotionUpdates()
        }
        filteredOffset = .zero
        onMotionUpdate?(.zero)
    }
}

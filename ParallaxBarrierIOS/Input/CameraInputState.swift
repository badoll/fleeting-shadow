import simd

struct CameraInputSnapshot: Equatable {
    var dragOffset: SIMD2<Float>
    var motionOffset: SIMD2<Float>
    var recenterGeneration: UInt64

    static let zero = CameraInputSnapshot(
        dragOffset: .zero,
        motionOffset: .zero,
        recenterGeneration: 0
    )
}

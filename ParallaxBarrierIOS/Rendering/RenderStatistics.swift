import Foundation
import simd

struct RenderStatistics: Equatable {
    var framesPerSecond: Double
    var drawableSize: SIMD2<Int32>
    var eyeTextureSize: SIMD2<Int32>
    var renderScale: Float
    var outputMode: OutputMode
    var interlace: InterlaceConfiguration
    var cameraOffset: SIMD2<Float>
    var gpuFrameTimeMilliseconds: Double?

    static let empty = RenderStatistics(
        framesPerSecond: 0,
        drawableSize: .zero,
        eyeTextureSize: .zero,
        renderScale: 1,
        outputMode: .interlaced,
        interlace: .standard,
        cameraOffset: .zero,
        gpuFrameTimeMilliseconds: nil
    )
}

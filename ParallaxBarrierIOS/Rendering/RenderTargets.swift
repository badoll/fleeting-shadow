import CoreGraphics
import Foundation
import Metal
import simd

final class RenderTargets {
    private(set) var leftColor: MTLTexture?
    private(set) var rightColor: MTLTexture?
    private(set) var depth: MTLTexture?
    private(set) var size: SIMD2<Int32> = .zero

    func ensure(
        device: MTLDevice,
        drawableSize: CGSize,
        renderScale: Float
    ) throws {
        let width = max(1, Int(floor(drawableSize.width * CGFloat(renderScale))))
        let height = max(1, Int(floor(drawableSize.height * CGFloat(renderScale))))
        let requestedSize = SIMD2<Int32>(Int32(width), Int32(height))

        guard requestedSize != size || leftColor == nil || rightColor == nil || depth == nil else {
            return
        }

        let colorDescriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .bgra8Unorm_srgb,
            width: width,
            height: height,
            mipmapped: false
        )
        colorDescriptor.usage = [.renderTarget, .shaderRead]
        colorDescriptor.storageMode = .private

        let depthDescriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .depth32Float,
            width: width,
            height: height,
            mipmapped: false
        )
        depthDescriptor.usage = [.renderTarget]
        depthDescriptor.storageMode = .private

        guard
            let left = device.makeTexture(descriptor: colorDescriptor),
            let right = device.makeTexture(descriptor: colorDescriptor),
            let depthTexture = device.makeTexture(descriptor: depthDescriptor)
        else {
            throw RendererError.resourceCreationFailed("eye render targets")
        }

        left.label = "Left Eye Color"
        right.label = "Right Eye Color"
        depthTexture.label = "Eye Depth"

        leftColor = left
        rightColor = right
        depth = depthTexture
        size = requestedSize
    }
}

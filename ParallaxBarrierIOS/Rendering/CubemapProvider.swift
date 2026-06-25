import Foundation
import Metal
import MetalKit

enum CubemapProvider {
    private static let bundledFaceNames = ["px", "nx", "py", "ny", "pz", "nz"]
    private static let bundledSubdirectory = "Cubemap"

    static func makeCubemap(device: MTLDevice) throws -> MTLTexture {
        let bundledURLs = bundledFaceNames.map {
            Bundle.main.url(forResource: $0, withExtension: "png", subdirectory: bundledSubdirectory)
        }

        if bundledURLs.allSatisfy({ $0 == nil }) {
            return try makeProceduralCubemap(device: device)
        }

        guard bundledURLs.allSatisfy({ $0 != nil }) else {
            throw RendererError.resourceCreationFailed("incomplete bundled cubemap")
        }

        return try makeBundledCubemap(device: device, faceURLs: bundledURLs.compactMap { $0 })
    }

    private static func makeBundledCubemap(device: MTLDevice, faceURLs: [URL]) throws -> MTLTexture {
        let loader = MTKTextureLoader(device: device)
        let options: [MTKTextureLoader.Option: Any] = [
            .SRGB: true
        ]
        let faceTextures = try faceURLs.map { try loader.newTexture(URL: $0, options: options) }

        guard let firstFace = faceTextures.first else {
            throw RendererError.resourceCreationFailed("empty bundled cubemap")
        }
        guard faceTextures.allSatisfy({ $0.width == firstFace.width && $0.height == firstFace.height }) else {
            throw RendererError.resourceCreationFailed("cubemap faces must share the same size")
        }

        let descriptor = MTLTextureDescriptor()
        descriptor.textureType = .typeCube
        descriptor.pixelFormat = firstFace.pixelFormat
        descriptor.width = firstFace.width
        descriptor.height = firstFace.height
        descriptor.mipmapLevelCount = 1
        descriptor.arrayLength = 1
        descriptor.usage = [.shaderRead]
        descriptor.storageMode = .private

        guard let cubemap = device.makeTexture(descriptor: descriptor) else {
            throw RendererError.resourceCreationFailed("bundled cubemap")
        }
        cubemap.label = "Bundled Pisa Cubemap"

        guard let commandQueue = device.makeCommandQueue(),
              let commandBuffer = commandQueue.makeCommandBuffer(),
              let blitEncoder = commandBuffer.makeBlitCommandEncoder() else {
            throw RendererError.resourceCreationFailed("cubemap blit encoder")
        }

        let size = MTLSize(width: firstFace.width, height: firstFace.height, depth: 1)
        for (slice, faceTexture) in faceTextures.enumerated() {
            blitEncoder.copy(
                from: faceTexture,
                sourceSlice: 0,
                sourceLevel: 0,
                sourceOrigin: MTLOrigin(x: 0, y: 0, z: 0),
                sourceSize: size,
                to: cubemap,
                destinationSlice: slice,
                destinationLevel: 0,
                destinationOrigin: MTLOrigin(x: 0, y: 0, z: 0)
            )
        }
        blitEncoder.endEncoding()
        commandBuffer.commit()
        commandBuffer.waitUntilCompleted()

        if commandBuffer.error != nil {
            throw RendererError.resourceCreationFailed("cubemap blit")
        }

        return cubemap
    }

    private static func makeProceduralCubemap(device: MTLDevice, size: Int = 64) throws -> MTLTexture {
        let descriptor = MTLTextureDescriptor()
        descriptor.textureType = .typeCube
        descriptor.pixelFormat = .rgba8Unorm_srgb
        descriptor.width = size
        descriptor.height = size
        descriptor.mipmapLevelCount = 1
        descriptor.arrayLength = 1
        descriptor.usage = [.shaderRead]
        descriptor.storageMode = .shared

        guard let texture = device.makeTexture(descriptor: descriptor) else {
            throw RendererError.resourceCreationFailed("procedural cubemap")
        }
        texture.label = "Procedural Cubemap"

        for face in 0..<6 {
            var pixels = [UInt8](repeating: 0, count: size * size * 4)

            for y in 0..<size {
                for x in 0..<size {
                    let u = Float(x) / Float(max(size - 1, 1))
                    let v = Float(y) / Float(max(size - 1, 1))
                    let base = (y * size + x) * 4
                    let faceTint = faceColor(face)

                    pixels[base] = UInt8(clamping: Int((0.25 + 0.65 * u) * faceTint.r * 255))
                    pixels[base + 1] = UInt8(clamping: Int((0.25 + 0.65 * v) * faceTint.g * 255))
                    pixels[base + 2] = UInt8(clamping: Int((0.35 + 0.45 * (1.0 - u * v)) * faceTint.b * 255))
                    pixels[base + 3] = 255
                }
            }

            let region = MTLRegionMake2D(0, 0, size, size)
            texture.replace(
                region: region,
                mipmapLevel: 0,
                slice: face,
                withBytes: pixels,
                bytesPerRow: size * 4,
                bytesPerImage: size * size * 4
            )
        }

        return texture
    }

    private static func faceColor(_ face: Int) -> (r: Float, g: Float, b: Float) {
        switch face {
        case 0: return (1.0, 0.72, 0.55)
        case 1: return (0.55, 0.9, 1.0)
        case 2: return (0.72, 1.0, 0.62)
        case 3: return (0.85, 0.58, 1.0)
        case 4: return (1.0, 0.95, 0.55)
        default: return (0.55, 0.72, 1.0)
        }
    }
}

import Foundation
import Metal
import simd

struct FrameUniforms {
    var viewProjection: simd_float4x4
    var cameraPositionAndTime: SIMD4<Float>
    var viewport: SIMD4<Float>
}

struct SkyboxUniforms {
    var inverseViewProjection: simd_float4x4
}

struct CompositeUniforms {
    var drawable: SIMD4<Float>
    var interlace: SIMD4<Float>
    var mode: SIMD4<UInt32>
}

enum UniformLayout {
    static let sceneStride = 256
    static let skyboxStride = 256
}

struct FrameResources {
    let sceneUniforms: MTLBuffer
    let skyboxUniforms: MTLBuffer
    let compositeUniforms: MTLBuffer

    static func make(device: MTLDevice) throws -> FrameResources {
        guard
            let scene = device.makeBuffer(length: UniformLayout.sceneStride * 2, options: [.storageModeShared]),
            let skybox = device.makeBuffer(length: UniformLayout.skyboxStride * 2, options: [.storageModeShared]),
            let composite = device.makeBuffer(length: MemoryLayout<CompositeUniforms>.stride, options: [.storageModeShared])
        else {
            throw RendererError.resourceCreationFailed("uniform buffer")
        }

        scene.label = "Scene Uniforms"
        skybox.label = "Skybox Uniforms"
        composite.label = "Composite Uniforms"

        return FrameResources(
            sceneUniforms: scene,
            skyboxUniforms: skybox,
            compositeUniforms: composite
        )
    }
}

extension MTLBuffer {
    func write<T>(_ value: T, offset: Int = 0) {
        withUnsafePointer(to: value) { pointer in
            contents()
                .advanced(by: offset)
                .copyMemory(from: UnsafeRawPointer(pointer), byteCount: MemoryLayout<T>.stride)
        }
    }
}

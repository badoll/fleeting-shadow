import Foundation
import Metal
import MetalKit

final class PipelineLibrary {
    let spherePipeline: MTLRenderPipelineState
    let skyboxPipeline: MTLRenderPipelineState
    let compositePipeline: MTLRenderPipelineState
    let sphereDepthState: MTLDepthStencilState
    let skyboxDepthState: MTLDepthStencilState

    init(device: MTLDevice, view: MTKView) throws {
        guard let library = device.makeDefaultLibrary() else {
            throw RendererError.resourceCreationFailed("default Metal library")
        }

        spherePipeline = try Self.makePipeline(
            device: device,
            library: library,
            label: "Sphere Pipeline",
            vertexFunction: "sphereVertex",
            fragmentFunction: "sphereFragment",
            colorPixelFormat: view.colorPixelFormat,
            depthPixelFormat: view.depthStencilPixelFormat
        )
        skyboxPipeline = try Self.makePipeline(
            device: device,
            library: library,
            label: "Skybox Pipeline",
            vertexFunction: "skyboxVertex",
            fragmentFunction: "skyboxFragment",
            colorPixelFormat: view.colorPixelFormat,
            depthPixelFormat: view.depthStencilPixelFormat
        )
        compositePipeline = try Self.makePipeline(
            device: device,
            library: library,
            label: "Composite Pipeline",
            vertexFunction: "compositeVertex",
            fragmentFunction: "compositeFragment",
            colorPixelFormat: view.colorPixelFormat,
            depthPixelFormat: view.depthStencilPixelFormat
        )

        let sphereDepthDescriptor = MTLDepthStencilDescriptor()
        sphereDepthDescriptor.isDepthWriteEnabled = true
        sphereDepthDescriptor.depthCompareFunction = .less
        guard let sphereDepthState = device.makeDepthStencilState(descriptor: sphereDepthDescriptor) else {
            throw RendererError.resourceCreationFailed("sphere depth state")
        }
        self.sphereDepthState = sphereDepthState

        let skyboxDepthDescriptor = MTLDepthStencilDescriptor()
        skyboxDepthDescriptor.isDepthWriteEnabled = false
        skyboxDepthDescriptor.depthCompareFunction = .always
        guard let skyboxDepthState = device.makeDepthStencilState(descriptor: skyboxDepthDescriptor) else {
            throw RendererError.resourceCreationFailed("skybox depth state")
        }
        self.skyboxDepthState = skyboxDepthState
    }

    private static func makePipeline(
        device: MTLDevice,
        library: MTLLibrary,
        label: String,
        vertexFunction: String,
        fragmentFunction: String,
        colorPixelFormat: MTLPixelFormat,
        depthPixelFormat: MTLPixelFormat
    ) throws -> MTLRenderPipelineState {
        guard let vertex = library.makeFunction(name: vertexFunction) else {
            throw RendererError.missingFunction(vertexFunction)
        }
        guard let fragment = library.makeFunction(name: fragmentFunction) else {
            throw RendererError.missingFunction(fragmentFunction)
        }

        let descriptor = MTLRenderPipelineDescriptor()
        descriptor.label = label
        descriptor.vertexFunction = vertex
        descriptor.fragmentFunction = fragment
        descriptor.colorAttachments[0].pixelFormat = colorPixelFormat
        descriptor.depthAttachmentPixelFormat = depthPixelFormat

        do {
            return try device.makeRenderPipelineState(descriptor: descriptor)
        } catch {
            throw RendererError.pipelineCreationFailed("\(label): \(error.localizedDescription)")
        }
    }
}

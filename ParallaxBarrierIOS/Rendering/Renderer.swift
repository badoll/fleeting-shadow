import Foundation
import Metal
import MetalKit
import QuartzCore
import simd

final class Renderer: NSObject, MTKViewDelegate {
    private let device: MTLDevice
    private let commandQueue: MTLCommandQueue
    private let pipelines: PipelineLibrary
    private let targets = RenderTargets()
    private let frameSemaphore = DispatchSemaphore(value: 3)
    private let frameResources: [FrameResources]
    private let sphereVertexBuffer: MTLBuffer
    private let sphereIndexBuffer: MTLBuffer
    private let instanceBuffer: MTLBuffer
    private let indexCount: Int
    private let cubemap: MTLTexture
    private let sceneSampler: MTLSamplerState
    private let nearestSampler: MTLSamplerState

    private let settingsLock = NSLock()
    private var settingsSnapshot: RenderSettingsSnapshot

    private let inputLock = NSLock()
    private var inputSnapshot: CameraInputSnapshot = .zero

    private let activeLock = NSLock()
    private var activeValue = true

    private var frameIndex = 0
    private var elapsedSeconds: Double = 0
    private var lastFrameTime: CFTimeInterval?
    private var cameraOffset = SIMD2<Float>.zero

    private var statsWindowStart = CACurrentMediaTime()
    private var statsFrameCount = 0
    private let statsLock = NSLock()
    private var latestGPUFrameMilliseconds: Double?

    private let statsHandler: (RenderStatistics) -> Void
    private let errorHandler: (RendererError) -> Void

    init(
        view: MTKView,
        settings: RenderSettingsSnapshot,
        input: CameraInputSnapshot,
        statsHandler: @escaping (RenderStatistics) -> Void,
        errorHandler: @escaping (RendererError) -> Void
    ) throws {
        guard let device = view.device ?? MTLCreateSystemDefaultDevice() else {
            throw RendererError.metalUnavailable
        }
        self.device = device
        view.device = device
        view.colorPixelFormat = .bgra8Unorm_srgb
        view.depthStencilPixelFormat = .depth32Float
        view.framebufferOnly = true
        view.enableSetNeedsDisplay = false
        view.isPaused = false
        view.preferredFramesPerSecond = settings.targetFPS

        guard let commandQueue = device.makeCommandQueue() else {
            throw RendererError.resourceCreationFailed("command queue")
        }
        self.commandQueue = commandQueue
        self.pipelines = try PipelineLibrary(device: device, view: view)
        self.frameResources = try (0..<3).map { _ in try FrameResources.make(device: device) }

        let mesh = SphereMesh.make()
        guard
            let vertexBuffer = device.makeBuffer(
                bytes: mesh.vertices,
                length: MemoryLayout<SphereVertex>.stride * mesh.vertices.count,
                options: [.storageModeShared]
            ),
            let indexBuffer = device.makeBuffer(
                bytes: mesh.indices,
                length: MemoryLayout<UInt16>.stride * mesh.indices.count,
                options: [.storageModeShared]
            )
        else {
            throw RendererError.resourceCreationFailed("sphere mesh buffers")
        }
        vertexBuffer.label = "Sphere Vertices"
        indexBuffer.label = "Sphere Indices"
        sphereVertexBuffer = vertexBuffer
        sphereIndexBuffer = indexBuffer
        indexCount = mesh.indices.count

        let instances = SceneSimulation.makeInstances()
        guard let instanceBuffer = device.makeBuffer(
            bytes: instances,
            length: MemoryLayout<SphereInstance>.stride * instances.count,
            options: [.storageModeShared]
        ) else {
            throw RendererError.resourceCreationFailed("sphere instance buffer")
        }
        instanceBuffer.label = "Sphere Instances"
        self.instanceBuffer = instanceBuffer

        self.cubemap = try CubemapProvider.makeCubemap(device: device)
        guard
            let sceneSampler = TextureFactory.makeSampler(device: device, filteringNearest: false),
            let nearestSampler = TextureFactory.makeSampler(device: device, filteringNearest: true)
        else {
            throw RendererError.resourceCreationFailed("samplers")
        }
        self.sceneSampler = sceneSampler
        self.nearestSampler = nearestSampler

        self.settingsSnapshot = settings
        self.inputSnapshot = input
        self.statsHandler = statsHandler
        self.errorHandler = errorHandler
        super.init()
        view.delegate = self
    }

    func updateSettings(_ settings: RenderSettingsSnapshot) {
        settingsLock.lock()
        settingsSnapshot = settings
        settingsLock.unlock()
    }

    func updateInput(_ input: CameraInputSnapshot) {
        inputLock.lock()
        inputSnapshot = input
        inputLock.unlock()
    }

    func setActive(_ active: Bool) {
        activeLock.lock()
        activeValue = active
        if !active {
            lastFrameTime = nil
        }
        activeLock.unlock()
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    func draw(in view: MTKView) {
        guard isActive else { return }
        guard frameSemaphore.wait(timeout: .now()) == .success else { return }

        do {
            let committed = try drawFrame(in: view)
            if !committed {
                frameSemaphore.signal()
            }
        } catch let rendererError as RendererError {
            frameSemaphore.signal()
            errorHandler(rendererError)
        } catch {
            frameSemaphore.signal()
            errorHandler(.resourceCreationFailed(error.localizedDescription))
        }
    }

    private var isActive: Bool {
        activeLock.lock()
        let value = activeValue
        activeLock.unlock()
        return value
    }

    private func currentSettings() -> RenderSettingsSnapshot {
        settingsLock.lock()
        let value = settingsSnapshot
        settingsLock.unlock()
        return value
    }

    private func currentInput() -> CameraInputSnapshot {
        inputLock.lock()
        let value = inputSnapshot
        inputLock.unlock()
        return value
    }

    private func drawFrame(in view: MTKView) throws -> Bool {
        let drawableSize = view.drawableSize
        guard drawableSize.width > 0, drawableSize.height > 0 else { return false }

        let settings = currentSettings()
        try targets.ensure(device: device, drawableSize: drawableSize, renderScale: settings.renderScale)

        guard
            let drawable = view.currentDrawable,
            let drawableDescriptor = view.currentRenderPassDescriptor,
            let leftColor = targets.leftColor,
            let rightColor = targets.rightColor,
            let depth = targets.depth,
            let commandBuffer = commandQueue.makeCommandBuffer()
        else {
            return false
        }
        commandBuffer.label = "Parallax Barrier Frame"

        let semaphore = frameSemaphore
        commandBuffer.addCompletedHandler { [weak self] completedBuffer in
            if completedBuffer.gpuEndTime > completedBuffer.gpuStartTime {
                self?.setLatestGPUFrameMilliseconds(
                    (completedBuffer.gpuEndTime - completedBuffer.gpuStartTime) * 1000
                )
            }
            semaphore.signal()
        }

        let frame = frameResources[frameIndex % frameResources.count]
        frameIndex += 1

        let now = CACurrentMediaTime()
        let deltaTime = frameDeltaTime(now: now)
        elapsedSeconds += Double(deltaTime)
        updateCamera(deltaTime: deltaTime, settings: settings, input: currentInput())

        let aspect = Float(drawableSize.width / max(drawableSize.height, 1))
        let centralCamera = CentralCamera(
            position: SIMD3<Float>(cameraOffset.x, cameraOffset.y, 3),
            target: .zero,
            up: SIMD3<Float>(0, 1, 0),
            fovDegrees: settings.stereo.fovDegrees,
            near: 0.01,
            far: 100,
            aspect: aspect
        )
        let cameras = StereoCameraRig.makeCameras(centralCamera: centralCamera, stereo: settings.stereo)

        switch settings.outputMode {
        case .mono:
            encodeScene(
                commandBuffer: commandBuffer,
                target: leftColor,
                depth: depth,
                camera: cameras.central,
                uniformSlot: 0,
                frame: frame
            )
        case .leftEye:
            encodeScene(
                commandBuffer: commandBuffer,
                target: leftColor,
                depth: depth,
                camera: cameras.left,
                uniformSlot: 0,
                frame: frame
            )
        case .rightEye:
            encodeScene(
                commandBuffer: commandBuffer,
                target: rightColor,
                depth: depth,
                camera: cameras.right,
                uniformSlot: 1,
                frame: frame
            )
        case .sideBySide, .interlaced:
            encodeScene(
                commandBuffer: commandBuffer,
                target: leftColor,
                depth: depth,
                camera: cameras.left,
                uniformSlot: 0,
                frame: frame
            )
            encodeScene(
                commandBuffer: commandBuffer,
                target: rightColor,
                depth: depth,
                camera: cameras.right,
                uniformSlot: 1,
                frame: frame
            )
        case .calibration:
            break
        }

        encodeComposite(
            commandBuffer: commandBuffer,
            descriptor: drawableDescriptor,
            leftTexture: leftColor,
            rightTexture: rightColor,
            drawableSize: drawableSize,
            settings: settings,
            frame: frame
        )

        commandBuffer.present(drawable)
        commandBuffer.commit()
        updateStatistics(now: now, drawableSize: drawableSize, settings: settings)
        return true
    }

    private func frameDeltaTime(now: CFTimeInterval) -> Float {
        defer { lastFrameTime = now }
        guard let lastFrameTime else { return 1.0 / 60.0 }
        let delta = max(0, min(now - lastFrameTime, 1.0 / 15.0))
        return Float(delta)
    }

    private func updateCamera(
        deltaTime: Float,
        settings: RenderSettingsSnapshot,
        input: CameraInputSnapshot
    ) {
        var target = SIMD2<Float>.zero
        if settings.camera.dragEnabled, settings.outputMode != .calibration {
            target += input.dragOffset
        }
        if settings.camera.motionEnabled, settings.outputMode != .calibration {
            target += input.motionOffset
        }

        let maxOffset = settings.camera.maxOffset
        target.x = SettingsValidation.clamped(target.x, -maxOffset, maxOffset)
        target.y = SettingsValidation.clamped(target.y, -maxOffset, maxOffset)

        let alpha = 1.0 - exp(-3.08 * deltaTime)
        cameraOffset += (target - cameraOffset) * alpha
    }

    private func encodeScene(
        commandBuffer: MTLCommandBuffer,
        target: MTLTexture,
        depth: MTLTexture,
        camera: EyeCamera,
        uniformSlot: Int,
        frame: FrameResources
    ) {
        let descriptor = MTLRenderPassDescriptor()
        descriptor.colorAttachments[0].texture = target
        descriptor.colorAttachments[0].loadAction = .clear
        descriptor.colorAttachments[0].storeAction = .store
        descriptor.colorAttachments[0].clearColor = MTLClearColor(red: 0.04, green: 0.05, blue: 0.07, alpha: 1)
        descriptor.depthAttachment.texture = depth
        descriptor.depthAttachment.loadAction = .clear
        descriptor.depthAttachment.storeAction = .dontCare
        descriptor.depthAttachment.clearDepth = 1.0

        guard let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: descriptor) else {
            return
        }
        encoder.label = "Eye Scene Pass"
        encoder.setViewport(MTLViewport(
            originX: 0,
            originY: 0,
            width: Double(target.width),
            height: Double(target.height),
            znear: 0,
            zfar: 1
        ))

        var viewRotation = camera.viewMatrix
        viewRotation.columns.3 = SIMD4<Float>(0, 0, 0, 1)
        let skyboxUniforms = SkyboxUniforms(
            inverseViewProjection: simd_inverse(camera.projectionMatrix * viewRotation)
        )
        let frameUniforms = FrameUniforms(
            viewProjection: camera.viewProjectionMatrix,
            cameraPositionAndTime: SIMD4<Float>(
                camera.position.x,
                camera.position.y,
                camera.position.z,
                Float(elapsedSeconds * 0.1)
            ),
            viewport: SIMD4<Float>(
                Float(target.width),
                Float(target.height),
                1.0 / Float(max(target.width, 1)),
                1.0 / Float(max(target.height, 1))
            )
        )

        let sceneOffset = UniformLayout.sceneStride * uniformSlot
        let skyboxOffset = UniformLayout.skyboxStride * uniformSlot
        frame.sceneUniforms.write(frameUniforms, offset: sceneOffset)
        frame.skyboxUniforms.write(skyboxUniforms, offset: skyboxOffset)

        encoder.setRenderPipelineState(pipelines.skyboxPipeline)
        encoder.setDepthStencilState(pipelines.skyboxDepthState)
        encoder.setFragmentBuffer(frame.skyboxUniforms, offset: skyboxOffset, index: 0)
        encoder.setFragmentTexture(cubemap, index: 0)
        encoder.setFragmentSamplerState(sceneSampler, index: 0)
        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)

        encoder.setRenderPipelineState(pipelines.spherePipeline)
        encoder.setDepthStencilState(pipelines.sphereDepthState)
        encoder.setCullMode(.back)
        encoder.setVertexBuffer(sphereVertexBuffer, offset: 0, index: 0)
        encoder.setVertexBuffer(instanceBuffer, offset: 0, index: 1)
        encoder.setVertexBuffer(frame.sceneUniforms, offset: sceneOffset, index: 2)
        encoder.setFragmentBuffer(frame.sceneUniforms, offset: sceneOffset, index: 0)
        encoder.setFragmentTexture(cubemap, index: 0)
        encoder.setFragmentSamplerState(sceneSampler, index: 0)
        encoder.drawIndexedPrimitives(
            type: .triangle,
            indexCount: indexCount,
            indexType: .uint16,
            indexBuffer: sphereIndexBuffer,
            indexBufferOffset: 0,
            instanceCount: SceneSimulation.sphereCount
        )
        encoder.endEncoding()
    }

    private func encodeComposite(
        commandBuffer: MTLCommandBuffer,
        descriptor: MTLRenderPassDescriptor,
        leftTexture: MTLTexture,
        rightTexture: MTLTexture,
        drawableSize: CGSize,
        settings: RenderSettingsSnapshot,
        frame: FrameResources
    ) {
        var uniforms = CompositeUniforms(
            drawable: SIMD4<Float>(
                Float(drawableSize.width),
                Float(drawableSize.height),
                1.0 / Float(max(drawableSize.width, 1)),
                1.0 / Float(max(drawableSize.height, 1))
            ),
            interlace: SIMD4<Float>(
                settings.interlace.pitchPixels,
                settings.interlace.phasePixels,
                settings.interlace.slope,
                settings.interlace.swapEyes ? 1.0 : 0.0
            ),
            mode: SIMD4<UInt32>(
                settings.outputMode.shaderValue,
                settings.interlace.axis.shaderValue,
                0,
                0
            )
        )
        frame.compositeUniforms.write(uniforms)

        guard let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: descriptor) else {
            return
        }
        encoder.label = "Composite Pass"
        encoder.setRenderPipelineState(pipelines.compositePipeline)
        encoder.setFragmentBuffer(frame.compositeUniforms, offset: 0, index: 0)
        encoder.setFragmentTexture(leftTexture, index: 0)
        encoder.setFragmentTexture(rightTexture, index: 1)
        encoder.setFragmentSamplerState(nearestSampler, index: 0)
        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        encoder.endEncoding()
    }

    private func updateStatistics(
        now: CFTimeInterval,
        drawableSize: CGSize,
        settings: RenderSettingsSnapshot
    ) {
        statsFrameCount += 1
        let elapsed = now - statsWindowStart
        guard elapsed >= 0.25 else { return }

        let fps = Double(statsFrameCount) / elapsed
        statsFrameCount = 0
        statsWindowStart = now
        let gpuFrameTimeMilliseconds = latestGPUFrameTime()

        statsHandler(RenderStatistics(
            framesPerSecond: fps,
            drawableSize: SIMD2<Int32>(Int32(drawableSize.width), Int32(drawableSize.height)),
            eyeTextureSize: targets.size,
            renderScale: settings.renderScale,
            outputMode: settings.outputMode,
            interlace: settings.interlace,
            cameraOffset: cameraOffset,
            gpuFrameTimeMilliseconds: gpuFrameTimeMilliseconds
        ))
    }

    private func setLatestGPUFrameMilliseconds(_ value: Double) {
        statsLock.lock()
        latestGPUFrameMilliseconds = value
        statsLock.unlock()
    }

    private func latestGPUFrameTime() -> Double? {
        statsLock.lock()
        let value = latestGPUFrameMilliseconds
        statsLock.unlock()
        return value
    }
}

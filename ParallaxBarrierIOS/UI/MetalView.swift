import Metal
import MetalKit
import SwiftUI

struct MetalView: UIViewRepresentable {
    var settings: RenderSettingsSnapshot
    var input: CameraInputSnapshot
    var isActive: Bool
    var onStatistics: (RenderStatistics) -> Void
    var onError: (RendererError) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> MTKView {
        let view = MTKView(frame: .zero)
        guard let device = MTLCreateSystemDefaultDevice() else {
            DispatchQueue.main.async { onError(.metalUnavailable) }
            return view
        }
        view.device = device

        do {
            context.coordinator.renderer = try Renderer(
                view: view,
                settings: settings,
                input: input,
                statsHandler: { statistics in
                    DispatchQueue.main.async {
                        onStatistics(statistics)
                    }
                },
                errorHandler: { error in
                    DispatchQueue.main.async {
                        onError(error)
                    }
                }
            )
        } catch let rendererError as RendererError {
            DispatchQueue.main.async { onError(rendererError) }
        } catch {
            DispatchQueue.main.async {
                onError(.resourceCreationFailed(error.localizedDescription))
            }
        }

        return view
    }

    func updateUIView(_ uiView: MTKView, context: Context) {
        uiView.preferredFramesPerSecond = settings.targetFPS
        uiView.isPaused = !isActive
        context.coordinator.renderer?.updateSettings(settings)
        context.coordinator.renderer?.updateInput(input)
        context.coordinator.renderer?.setActive(isActive)
    }

    static func dismantleUIView(_ uiView: MTKView, coordinator: Coordinator) {
        coordinator.renderer?.setActive(false)
        uiView.delegate = nil
    }

    final class Coordinator {
        var renderer: Renderer?
    }
}

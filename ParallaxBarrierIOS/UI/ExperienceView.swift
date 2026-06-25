import SwiftUI

struct ExperienceView: View {
    @ObservedObject var viewModel: ExperienceViewModel

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .top) {
                MetalView(
                    settings: viewModel.renderSettingsSnapshot,
                    input: viewModel.cameraInputSnapshot,
                    isActive: viewModel.isActive,
                    onStatistics: viewModel.updateStatistics,
                    onError: viewModel.setRendererError
                )
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 4)
                        .onChanged { value in
                            viewModel.updateDrag(translation: value.translation, viewSize: proxy.size)
                        }
                        .onEnded { _ in
                            viewModel.endDrag()
                        }
                )
                .simultaneousGesture(
                    TapGesture(count: 2)
                        .onEnded { viewModel.recenter() }
                )
                .simultaneousGesture(
                    TapGesture(count: 1)
                        .onEnded { viewModel.toggleControls() }
                )

                if viewModel.showsControls {
                    ControlOverlay(viewModel: viewModel)
                        .padding(.horizontal, 18)
                        .padding(.top, 14)
                }

                if viewModel.settings.debugHUDEnabled {
                    DebugHUDView(statistics: viewModel.statistics)
                        .padding(.top, 88)
                        .padding(.trailing, 16)
                        .frame(maxWidth: .infinity, alignment: .topTrailing)
                }

                if let error = viewModel.rendererError {
                    RendererErrorOverlay(error: error)
                }
            }
        }
        .ignoresSafeArea()
        .sheet(isPresented: $viewModel.showingSettings) {
            SettingsView(viewModel: viewModel)
        }
        .sheet(isPresented: $viewModel.showingCalibration) {
            CalibrationView(viewModel: viewModel)
                .interactiveDismissDisabled()
                .onDisappear {
                    viewModel.cancelCalibrationIfNeeded()
                }
        }
        .statusBarHidden(true)
    }
}

private struct RendererErrorOverlay: View {
    let error: RendererError

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 44, weight: .semibold))
                .foregroundStyle(.yellow)
            Text(error.localizedDescription)
                .font(.title3.weight(.semibold))
                .multilineTextAlignment(.center)
                .foregroundStyle(.white)
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.opacity(0.82))
        .accessibilityElement(children: .combine)
    }
}

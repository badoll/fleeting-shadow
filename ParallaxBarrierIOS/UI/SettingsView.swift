import Foundation
import SwiftUI

struct SettingsView: View {
    @ObservedObject var viewModel: ExperienceViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("输出") {
                    Picker("输出模式", selection: $viewModel.settings.outputMode) {
                        ForEach(OutputMode.allCases) { mode in
                            Text(mode.title).tag(mode)
                        }
                    }

                    Picker("渲染比例", selection: $viewModel.settings.renderScale) {
                        Text("1.0").tag(Float(1.0))
                        Text("0.75").tag(Float(0.75))
                        Text("0.5").tag(Float(0.5))
                    }

                    Picker("目标 FPS", selection: $viewModel.settings.targetFPS) {
                        Text("60").tag(60)
                        Text("30").tag(30)
                    }
                    Toggle("Debug HUD", isOn: $viewModel.settings.debugHUDEnabled)
                }

                Section("输入") {
                    Toggle("拖动控制", isOn: $viewModel.settings.camera.dragEnabled)
                    Toggle("设备姿态控制", isOn: $viewModel.settings.camera.motionEnabled)
                        .disabled(!viewModel.motionAvailable)
                    sliderRow(
                        title: "姿态灵敏度",
                        value: $viewModel.settings.camera.motionSensitivity,
                        range: 0.1...4.0,
                        step: 0.01,
                        format: "%.2f"
                    )
                    sliderRow(
                        title: "最大偏移",
                        value: $viewModel.settings.camera.maxOffset,
                        range: 0.25...12.0,
                        step: 0.05,
                        format: "%.2f"
                    )
                }

                Section("双目相机") {
                    sliderRow(
                        title: "Eye separation",
                        value: $viewModel.settings.stereo.eyeSeparation,
                        range: 0.0...0.25,
                        step: 0.001,
                        format: "%.3f"
                    )
                    sliderRow(
                        title: "Focus distance",
                        value: $viewModel.settings.stereo.focusDistance,
                        range: 0.02...50.0,
                        step: 0.01,
                        format: "%.2f"
                    )
                    sliderRow(
                        title: "FOV",
                        value: $viewModel.settings.stereo.fovDegrees,
                        range: 20.0...110.0,
                        step: 1.0,
                        format: "%.0f"
                    )
                }

                Section("关于") {
                    Text("本 App 输出双视点隔行图像。普通 iPhone 屏幕不保证产生裸眼 3D；真实立体效果需要匹配的视差屏障、柱状透镜或定制显示设备单独验收。")
                        .font(.body)
                    Button(role: .destructive) {
                        viewModel.resetAllSettings()
                    } label: {
                        Label("恢复全部默认设置", systemImage: "arrow.counterclockwise")
                    }
                }
            }
            .navigationTitle("设置")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
        }
    }

    private func sliderRow(
        title: String,
        value: Binding<Float>,
        range: ClosedRange<Float>,
        step: Float,
        format: String
    ) -> some View {
        VStack(alignment: .leading) {
            HStack {
                Text(title)
                Spacer()
                Text(String(format: format, value.wrappedValue))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
            Slider(value: value, in: range, step: step)
                .accessibilityLabel(title)
        }
    }
}

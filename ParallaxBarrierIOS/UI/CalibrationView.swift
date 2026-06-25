import Foundation
import SwiftUI

struct CalibrationView: View {
    @ObservedObject var viewModel: ExperienceViewModel

    var body: some View {
        NavigationStack {
            Form {
                Section("预览") {
                    CalibrationPatternView(configuration: viewModel.settings.interlace)
                        .frame(height: 180)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .accessibilityLabel("校准预览")
                }

                Section("交错参数") {
                    Picker("Axis", selection: $viewModel.settings.interlace.axis) {
                        ForEach(InterlaceAxis.allCases) { axis in
                            Text(axis.title).tag(axis)
                        }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityLabel("交错方向")

                    sliderRow(
                        title: "Pitch",
                        value: $viewModel.settings.interlace.pitchPixels,
                        range: 0.5...16.0,
                        step: 0.01,
                        format: "%.2f px"
                    )
                    sliderRow(
                        title: "Phase",
                        value: $viewModel.settings.interlace.phasePixels,
                        range: -16.0...16.0,
                        step: 0.01,
                        format: "%.2f px"
                    )
                    sliderRow(
                        title: "Slope",
                        value: $viewModel.settings.interlace.slope,
                        range: -2.0...2.0,
                        step: 0.001,
                        format: "%.3f"
                    )
                    Toggle("Swap Eyes", isOn: $viewModel.settings.interlace.swapEyes)
                        .accessibilityLabel("交换左右眼")
                }

                Section {
                    Button {
                        viewModel.resetCalibrationDefaults()
                    } label: {
                        Label("恢复默认值", systemImage: "arrow.counterclockwise")
                    }
                }
            }
            .navigationTitle("校准")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") {
                        viewModel.cancelCalibration()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        viewModel.saveCalibration()
                    }
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

private struct CalibrationPatternView: View {
    let configuration: InterlaceConfiguration

    var body: some View {
        Canvas { context, size in
            let step = max(CGFloat(2), min(size.width, size.height) / 120)
            var y: CGFloat = 0
            while y < size.height {
                var x: CGFloat = 0
                while x < size.width {
                    let eye = InterlaceSelector.eyeIndex(
                        x: Float(x),
                        y: Float(y),
                        configuration: configuration
                    )
                    let rect = CGRect(x: x, y: y, width: step + 0.5, height: step + 0.5)
                    context.fill(
                        Path(rect),
                        with: .color(eye == 0 ? Color.red : Color.cyan)
                    )
                    x += step
                }
                y += step
            }
        }
        .overlay {
            HStack {
                Text("L")
                    .font(.system(size: 96, weight: .black))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                Text("R")
                    .font(.system(size: 96, weight: .black))
                    .foregroundStyle(.black)
                    .frame(maxWidth: .infinity)
            }
            .minimumScaleFactor(0.5)
        }
    }
}

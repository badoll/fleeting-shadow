import SwiftUI

struct ControlOverlay: View {
    @ObservedObject var viewModel: ExperienceViewModel

    var body: some View {
        ViewThatFits(in: .horizontal) {
            VStack(spacing: 10) {
                HStack(spacing: 12) {
                    outputModePicker
                    recenterButton
                    calibrationButton
                    settingsButton
                    debugToggle
                }
                warningLabel
            }

            VStack(spacing: 10) {
                outputModePicker

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 8)], spacing: 8) {
                    recenterButton
                    calibrationButton
                    settingsButton
                    debugToggle
                }

                warningLabel
            }
        }
        .padding(12)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private var outputModePicker: some View {
        Picker("输出模式", selection: $viewModel.settings.outputMode) {
            ForEach(OutputMode.allCases) { mode in
                Text(mode.title).tag(mode)
            }
        }
        .pickerStyle(.segmented)
        .accessibilityLabel("输出模式")
    }

    private var recenterButton: some View {
        Button {
            viewModel.recenter()
        } label: {
            Label("归中", systemImage: "scope")
        }
        .buttonStyle(.borderedProminent)
        .frame(maxWidth: .infinity)
        .accessibilityLabel("归中")
    }

    private var calibrationButton: some View {
        Button {
            viewModel.beginCalibration()
        } label: {
            Label("校准", systemImage: "slider.horizontal.3")
        }
        .buttonStyle(.bordered)
        .frame(maxWidth: .infinity)
        .accessibilityLabel("打开校准")
    }

    private var settingsButton: some View {
        Button {
            viewModel.openSettings()
        } label: {
            Label("设置", systemImage: "gearshape")
        }
        .buttonStyle(.bordered)
        .frame(maxWidth: .infinity)
        .accessibilityLabel("打开设置")
    }

    private var debugToggle: some View {
        Toggle(isOn: $viewModel.settings.debugHUDEnabled) {
            Image(systemName: "waveform.path.ecg")
        }
        .toggleStyle(.button)
        .frame(maxWidth: .infinity)
        .accessibilityLabel("Debug HUD")
    }

    @ViewBuilder
    private var warningLabel: some View {
        if let warning = viewModel.motionWarning {
            Text(warning)
                .font(.footnote)
                .foregroundStyle(.yellow)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

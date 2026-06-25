import Foundation
import SwiftUI

struct DebugHUDView: View {
    let statistics: RenderStatistics

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            row("FPS", String(format: "%.1f", statistics.framesPerSecond))
            row("Drawable", "\(statistics.drawableSize.x)x\(statistics.drawableSize.y)")
            row("Eye", "\(statistics.eyeTextureSize.x)x\(statistics.eyeTextureSize.y)")
            row("Scale", String(format: "%.2f", statistics.renderScale))
            row("Mode", statistics.outputMode.title)
            row("Axis", statistics.interlace.axis.title)
            row("Pitch", String(format: "%.2f", statistics.interlace.pitchPixels))
            row("Phase", String(format: "%.2f", statistics.interlace.phasePixels))
            row("Slope", String(format: "%.3f", statistics.interlace.slope))
            row("Swap", statistics.interlace.swapEyes ? "on" : "off")
            row("Camera", String(format: "%.2f, %.2f", statistics.cameraOffset.x, statistics.cameraOffset.y))
            if let gpu = statistics.gpuFrameTimeMilliseconds {
                row("GPU", String(format: "%.2f ms", gpu))
            }
        }
        .font(.system(size: 12, weight: .medium, design: .monospaced))
        .foregroundStyle(.white)
        .padding(10)
        .background(Color.black.opacity(0.58), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private func row(_ key: String, _ value: String) -> some View {
        HStack {
            Text(key)
                .foregroundStyle(.white.opacity(0.72))
            Spacer(minLength: 12)
            Text(value)
        }
    }
}

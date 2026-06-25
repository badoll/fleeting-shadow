import Foundation
import simd

enum CameraMath {
    static func perspectiveOffCenterRH(
        left: Float,
        right: Float,
        bottom: Float,
        top: Float,
        near: Float,
        far: Float
    ) -> simd_float4x4 {
        precondition(left.isFinite && right.isFinite && bottom.isFinite && top.isFinite)
        precondition(near > 0 && far > near)
        precondition(abs(right - left) > 0.000001 && abs(top - bottom) > 0.000001)

        let x = 2.0 * near / (right - left)
        let y = 2.0 * near / (top - bottom)
        let a = (right + left) / (right - left)
        let b = (top + bottom) / (top - bottom)
        let c = far / (near - far)
        let d = (far * near) / (near - far)

        return simd_float4x4(columns: (
            SIMD4<Float>(x, 0, 0, 0),
            SIMD4<Float>(0, y, 0, 0),
            SIMD4<Float>(a, b, c, -1),
            SIMD4<Float>(0, 0, d, 0)
        ))
    }

    static func perspectiveRH(
        fovYRadians: Float,
        aspect: Float,
        near: Float,
        far: Float
    ) -> simd_float4x4 {
        precondition(fovYRadians > 0 && fovYRadians < .pi)
        precondition(aspect > 0)
        let top = near * tan(fovYRadians * 0.5)
        let right = top * aspect
        return perspectiveOffCenterRH(
            left: -right,
            right: right,
            bottom: -top,
            top: top,
            near: near,
            far: far
        )
    }

    static func lookAtRH(
        eye: SIMD3<Float>,
        target: SIMD3<Float>,
        up: SIMD3<Float>
    ) -> simd_float4x4 {
        var backward = eye - target
        if simd_length(backward) < 0.0001 {
            backward = SIMD3<Float>(0, 0, 1)
        }
        let zAxis = backward.safelyNormalized

        var upVector = up
        if simd_length(simd_cross(upVector, zAxis)) < 0.0001 {
            upVector = abs(zAxis.y) < 0.9 ? SIMD3<Float>(0, 1, 0) : SIMD3<Float>(1, 0, 0)
        }

        let xAxis = simd_cross(upVector, zAxis).safelyNormalized
        let yAxis = simd_cross(zAxis, xAxis)

        return simd_float4x4(columns: (
            SIMD4<Float>(xAxis.x, yAxis.x, zAxis.x, 0),
            SIMD4<Float>(xAxis.y, yAxis.y, zAxis.y, 0),
            SIMD4<Float>(xAxis.z, yAxis.z, zAxis.z, 0),
            SIMD4<Float>(
                -simd_dot(xAxis, eye),
                -simd_dot(yAxis, eye),
                -simd_dot(zAxis, eye),
                1
            )
        ))
    }

    static func project(
        worldPoint: SIMD3<Float>,
        viewProjection: simd_float4x4
    ) -> SIMD3<Float> {
        let clip = viewProjection * SIMD4<Float>(worldPoint, 1)
        guard abs(clip.w) > 0.000001 else {
            return SIMD3<Float>(.nan, .nan, .nan)
        }
        let ndc = clip / clip.w
        return SIMD3<Float>(ndc.x, ndc.y, ndc.z)
    }
}

import Foundation
import simd

struct CentralCamera {
    var position: SIMD3<Float>
    var target: SIMD3<Float>
    var up: SIMD3<Float>
    var fovDegrees: Float
    var near: Float
    var far: Float
    var aspect: Float
}

struct EyeCamera: Equatable {
    var position: SIMD3<Float>
    var viewMatrix: simd_float4x4
    var projectionMatrix: simd_float4x4
    var viewProjectionMatrix: simd_float4x4
}

struct StereoCameraPair: Equatable {
    var central: EyeCamera
    var left: EyeCamera
    var right: EyeCamera
}

enum StereoCameraRig {
    static func makeCameras(
        centralCamera: CentralCamera,
        stereo: StereoConfiguration
    ) -> StereoCameraPair {
        let near = max(centralCamera.near, 0.001)
        let far = max(centralCamera.far, near + 0.001)
        let focusDistance = max(stereo.focusDistance, near + 0.001)
        let eyeSeparation = max(stereo.eyeSeparation, 0)
        let fovRadians = SettingsValidation.clamped(centralCamera.fovDegrees, 1, 179) * .pi / 180.0
        let aspect = max(centralCamera.aspect, 0.001)

        let centralView = CameraMath.lookAtRH(
            eye: centralCamera.position,
            target: centralCamera.target,
            up: centralCamera.up
        )
        let centralProjection = CameraMath.perspectiveRH(
            fovYRadians: fovRadians,
            aspect: aspect,
            near: near,
            far: far
        )
        let centralEye = EyeCamera(
            position: centralCamera.position,
            viewMatrix: centralView,
            projectionMatrix: centralProjection,
            viewProjectionMatrix: centralProjection * centralView
        )

        let forward = (centralCamera.target - centralCamera.position).safelyNormalized
        var rightVector = simd_cross(forward, centralCamera.up).safelyNormalized
        if simd_length(rightVector) < 0.0001 {
            rightVector = SIMD3<Float>(1, 0, 0)
        }

        let eyeHalf = eyeSeparation * 0.5
        let shift = eyeHalf * near / focusDistance
        let top = near * tan(fovRadians * 0.5)
        let bottom = -top
        let halfWidth = top * aspect

        let leftProjection = CameraMath.perspectiveOffCenterRH(
            left: -halfWidth + shift,
            right: halfWidth + shift,
            bottom: bottom,
            top: top,
            near: near,
            far: far
        )
        let rightProjection = CameraMath.perspectiveOffCenterRH(
            left: -halfWidth - shift,
            right: halfWidth - shift,
            bottom: bottom,
            top: top,
            near: near,
            far: far
        )

        let leftPosition = centralCamera.position - rightVector * eyeHalf
        let rightPosition = centralCamera.position + rightVector * eyeHalf
        let leftView = CameraMath.lookAtRH(eye: leftPosition, target: leftPosition + forward, up: centralCamera.up)
        let rightView = CameraMath.lookAtRH(eye: rightPosition, target: rightPosition + forward, up: centralCamera.up)

        let leftEye = EyeCamera(
            position: leftPosition,
            viewMatrix: leftView,
            projectionMatrix: leftProjection,
            viewProjectionMatrix: leftProjection * leftView
        )
        let rightEye = EyeCamera(
            position: rightPosition,
            viewMatrix: rightView,
            projectionMatrix: rightProjection,
            viewProjectionMatrix: rightProjection * rightView
        )

        return StereoCameraPair(central: centralEye, left: leftEye, right: rightEye)
    }
}

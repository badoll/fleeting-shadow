import simd
import XCTest
@testable import ParallaxBarrierIOS

final class StereoCameraRigTests: XCTestCase {
    func testZeroEyeSeparationProducesMatchingEyes() {
        var stereo = StereoConfiguration.standard
        stereo.eyeSeparation = 0

        let pair = StereoCameraRig.makeCameras(
            centralCamera: defaultCentralCamera(),
            stereo: stereo
        )

        XCTAssertTrue(matricesAlmostEqual(pair.left.viewMatrix, pair.right.viewMatrix))
        XCTAssertTrue(matricesAlmostEqual(pair.left.projectionMatrix, pair.right.projectionMatrix))
    }

    func testDefaultEyePositionsAreSymmetric() {
        let pair = StereoCameraRig.makeCameras(
            centralCamera: defaultCentralCamera(),
            stereo: .standard
        )

        XCTAssertEqual(pair.left.position.x, -pair.right.position.x, accuracy: 0.0001)
        XCTAssertEqual(pair.left.position.y, pair.right.position.y, accuracy: 0.0001)
        XCTAssertEqual(pair.left.position.z, pair.right.position.z, accuracy: 0.0001)
    }

    func testProjectionOffsetsHaveOppositeSigns() {
        let pair = StereoCameraRig.makeCameras(
            centralCamera: defaultCentralCamera(),
            stereo: .standard
        )

        let leftOffset = pair.left.projectionMatrix.columns.2.x
        let rightOffset = pair.right.projectionMatrix.columns.2.x
        XCTAssertGreaterThan(leftOffset, 0)
        XCTAssertLessThan(rightOffset, 0)
        XCTAssertEqual(abs(leftOffset), abs(rightOffset), accuracy: 0.0001)
    }

    func testInvalidFocusDistanceIsClamped() {
        var stereo = StereoConfiguration.standard
        stereo.focusDistance = 0

        let pair = StereoCameraRig.makeCameras(
            centralCamera: defaultCentralCamera(),
            stereo: stereo
        )

        XCTAssertTrue(pair.left.projectionMatrix.isFinite)
        XCTAssertTrue(pair.right.projectionMatrix.isFinite)
    }

    private func defaultCentralCamera() -> CentralCamera {
        CentralCamera(
            position: SIMD3<Float>(0, 0, 3),
            target: .zero,
            up: SIMD3<Float>(0, 1, 0),
            fovDegrees: 60,
            near: 0.01,
            far: 100,
            aspect: 16.0 / 9.0
        )
    }

    private func matricesAlmostEqual(
        _ lhs: simd_float4x4,
        _ rhs: simd_float4x4,
        accuracy: Float = 0.0001
    ) -> Bool {
        for column in 0..<4 {
            for row in 0..<4 where abs(lhs[column][row] - rhs[column][row]) > accuracy {
                return false
            }
        }
        return true
    }
}

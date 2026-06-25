import simd
import XCTest
@testable import ParallaxBarrierIOS

final class CameraMathTests: XCTestCase {
    func testPerspectiveMatrixIsFinite() {
        let matrix = CameraMath.perspectiveRH(
            fovYRadians: .pi / 3,
            aspect: 16.0 / 9.0,
            near: 0.01,
            far: 100
        )
        XCTAssertTrue(matrix.isFinite)
    }

    func testLookAtProjectsOriginToCenter() {
        let view = CameraMath.lookAtRH(
            eye: SIMD3<Float>(0, 0, 3),
            target: .zero,
            up: SIMD3<Float>(0, 1, 0)
        )
        let projection = CameraMath.perspectiveRH(
            fovYRadians: .pi / 3,
            aspect: 16.0 / 9.0,
            near: 0.01,
            far: 100
        )
        let projected = CameraMath.project(worldPoint: .zero, viewProjection: projection * view)
        XCTAssertEqual(projected.x, 0, accuracy: 0.0001)
        XCTAssertEqual(projected.y, 0, accuracy: 0.0001)
        XCTAssertGreaterThan(projected.z, 0)
        XCTAssertLessThan(projected.z, 1)
    }

    func testNearAndFarDepthMapping() {
        let near: Float = 0.01
        let far: Float = 100
        let projection = CameraMath.perspectiveRH(
            fovYRadians: .pi / 3,
            aspect: 1,
            near: near,
            far: far
        )

        let nearProjected = CameraMath.project(
            worldPoint: SIMD3<Float>(0, 0, -near),
            viewProjection: projection
        )
        let farProjected = CameraMath.project(
            worldPoint: SIMD3<Float>(0, 0, -far),
            viewProjection: projection
        )

        XCTAssertEqual(nearProjected.z, 0, accuracy: 0.0001)
        XCTAssertEqual(farProjected.z, 1, accuracy: 0.0001)
    }
}

import XCTest
@testable import ParallaxBarrierIOS

final class SeededRandomTests: XCTestCase {
    func testSameSeedGeneratesSameInstances() {
        let first = SceneSimulation.makeInstances(seed: 42)
        let second = SceneSimulation.makeInstances(seed: 42)
        XCTAssertEqual(first, second)
        XCTAssertEqual(first.count, 500)
    }

    func testInstanceRanges() {
        let instances = SceneSimulation.makeInstances(seed: 99)

        for instance in instances {
            XCTAssertGreaterThanOrEqual(instance.initialZ, -5.0)
            XCTAssertLessThanOrEqual(instance.initialZ, 5.0)
            XCTAssertGreaterThanOrEqual(instance.scale, 1.0)
            XCTAssertLessThanOrEqual(instance.scale, 4.0)
        }
    }
}

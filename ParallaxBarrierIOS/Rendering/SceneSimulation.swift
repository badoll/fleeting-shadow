import Foundation

enum SceneSimulation {
    static let sphereCount = 500
    static let seed: UInt64 = 0x5EED_500

    static func makeInstances(
        count: Int = SceneSimulation.sphereCount,
        seed: UInt64 = SceneSimulation.seed
    ) -> [SphereInstance] {
        var generator = SeededRandomNumberGenerator(seed: seed)
        return (0..<count).map { _ in
            let z = generator.nextFloat(in: -5.0...5.0)
            let scale = generator.nextFloat(in: 1.0...4.0)
            let phase = generator.nextFloat(in: 0.0...(.pi * 2.0))
            return SphereInstance(parameters: SIMD4<Float>(z, scale, phase, 0))
        }
    }
}

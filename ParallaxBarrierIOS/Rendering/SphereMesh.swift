import Foundation
import simd

struct SphereVertex {
    var position: SIMD3<Float>
    var normal: SIMD3<Float>
}

struct SphereInstance: Equatable {
    var parameters: SIMD4<Float>

    var initialZ: Float { parameters.x }
    var scale: Float { parameters.y }
}

struct SphereMeshData {
    var vertices: [SphereVertex]
    var indices: [UInt16]
}

enum SphereMesh {
    static func make(
        radius: Float = 0.1,
        longitudeSegments: Int = 32,
        latitudeSegments: Int = 16
    ) -> SphereMeshData {
        precondition(longitudeSegments >= 3)
        precondition(latitudeSegments >= 2)

        var vertices: [SphereVertex] = []
        vertices.reserveCapacity((longitudeSegments + 1) * (latitudeSegments + 1))

        for latitude in 0...latitudeSegments {
            let v = Float(latitude) / Float(latitudeSegments)
            let theta = v * .pi
            let sinTheta = sin(theta)
            let cosTheta = cos(theta)

            for longitude in 0...longitudeSegments {
                let u = Float(longitude) / Float(longitudeSegments)
                let phi = u * .pi * 2.0
                let normal = SIMD3<Float>(
                    sinTheta * cos(phi),
                    cosTheta,
                    sinTheta * sin(phi)
                )
                vertices.append(SphereVertex(position: normal * radius, normal: normal))
            }
        }

        var indices: [UInt16] = []
        indices.reserveCapacity(longitudeSegments * latitudeSegments * 6)
        let stride = longitudeSegments + 1

        for latitude in 0..<latitudeSegments {
            for longitude in 0..<longitudeSegments {
                let first = latitude * stride + longitude
                let second = first + stride

                indices.append(UInt16(first))
                indices.append(UInt16(second))
                indices.append(UInt16(first + 1))

                indices.append(UInt16(first + 1))
                indices.append(UInt16(second))
                indices.append(UInt16(second + 1))
            }
        }

        return SphereMeshData(vertices: vertices, indices: indices)
    }
}

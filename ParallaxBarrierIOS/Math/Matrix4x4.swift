import simd

extension simd_float4x4 {
    static var identityMatrix: simd_float4x4 {
        matrix_identity_float4x4
    }

    var isFinite: Bool {
        for column in 0..<4 {
            for row in 0..<4 where !self[column][row].isFinite {
                return false
            }
        }
        return true
    }
}

extension SIMD3 where Scalar == Float {
    var safelyNormalized: SIMD3<Float> {
        let length = simd_length(self)
        guard length > 0.00001, length.isFinite else {
            return SIMD3<Float>(0, 0, 1)
        }
        return self / length
    }
}

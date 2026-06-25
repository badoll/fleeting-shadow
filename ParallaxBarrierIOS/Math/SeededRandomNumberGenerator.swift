import Foundation

struct SeededRandomNumberGenerator: RandomNumberGenerator {
    private(set) var state: UInt64

    init(seed: UInt64) {
        state = seed == 0 ? 0x9E3779B97F4A7C15 : seed
    }

    mutating func next() -> UInt64 {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        var value = state
        value ^= value >> 33
        value &*= 0xff51afd7ed558ccd
        value ^= value >> 33
        value &*= 0xc4ceb9fe1a85ec53
        value ^= value >> 33
        return value
    }

    mutating func nextFloat(in range: ClosedRange<Float>) -> Float {
        let unit = Float(Double(next() >> 11) / 9_007_199_254_740_992.0)
        return range.lowerBound + (range.upperBound - range.lowerBound) * unit
    }
}

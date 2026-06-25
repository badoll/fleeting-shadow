import Foundation
import Metal

enum TextureFactory {
    static func makeSampler(device: MTLDevice, filteringNearest: Bool) -> MTLSamplerState? {
        let descriptor = MTLSamplerDescriptor()
        descriptor.minFilter = filteringNearest ? .nearest : .linear
        descriptor.magFilter = filteringNearest ? .nearest : .linear
        descriptor.mipFilter = .notMipmapped
        descriptor.sAddressMode = .clampToEdge
        descriptor.tAddressMode = .clampToEdge
        descriptor.rAddressMode = .clampToEdge
        return device.makeSamplerState(descriptor: descriptor)
    }
}

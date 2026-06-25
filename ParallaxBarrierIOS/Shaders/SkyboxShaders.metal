#include <metal_stdlib>
#include "ShaderTypes.h"
using namespace metal;

struct SkyboxVertexOut {
    float4 position [[position]];
    float2 ndc;
};

vertex SkyboxVertexOut skyboxVertex(uint vertexID [[vertex_id]]) {
    float2 positions[3] = {
        float2(-1.0, -1.0),
        float2(3.0, -1.0),
        float2(-1.0, 3.0)
    };

    SkyboxVertexOut out;
    out.position = float4(positions[vertexID], 1.0, 1.0);
    out.ndc = positions[vertexID];
    return out;
}

fragment float4 skyboxFragment(
    SkyboxVertexOut in [[stage_in]],
    constant SkyboxUniforms &uniforms [[buffer(0)]],
    texturecube<float> cubemap [[texture(0)]],
    sampler cubeSampler [[sampler(0)]]
) {
    float4 world = uniforms.inverseViewProjection * float4(in.ndc, 1.0, 1.0);
    float safeW = abs(world.w) > 0.0001 ? world.w : 0.0001;
    float3 direction = normalize(world.xyz / safeW);
    float3 color = cubemap.sample(cubeSampler, direction).rgb;
    return float4(color, 1.0);
}

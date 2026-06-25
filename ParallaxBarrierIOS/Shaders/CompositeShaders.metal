#include <metal_stdlib>
#include "ShaderTypes.h"
#include "CalibrationShaders.metal"
using namespace metal;

struct CompositeVertexOut {
    float4 position [[position]];
};

vertex CompositeVertexOut compositeVertex(uint vertexID [[vertex_id]]) {
    float2 positions[3] = {
        float2(-1.0, -1.0),
        float2(3.0, -1.0),
        float2(-1.0, 3.0)
    };

    CompositeVertexOut out;
    out.position = float4(positions[vertexID], 0.0, 1.0);
    return out;
}

static inline uint positiveModulo2(int value) {
    int modValue = value % 2;
    return uint(modValue < 0 ? modValue + 2 : modValue);
}

static inline uint interlacedEyeIndex(float2 pixel, constant CompositeUniforms &uniforms) {
    uint axis = uniforms.mode.y;
    float pitch = max(uniforms.interlace.x, 0.01);
    float phase = uniforms.interlace.y;
    float slope = uniforms.interlace.z;
    bool swapEyes = uniforms.interlace.w > 0.5;

    float coordinate = pixel.y;
    if (axis == 1) {
        coordinate = pixel.x;
    } else if (axis == 2) {
        coordinate = pixel.x + slope * pixel.y;
    }

    int stripe = int(floor((coordinate + phase) / pitch));
    uint eye = positiveModulo2(stripe);
    return swapEyes ? 1 - eye : eye;
}

static inline float4 sampleEye(
    texture2d<float> eyeTexture,
    sampler eyeSampler,
    float2 uv
) {
    return eyeTexture.sample(eyeSampler, clamp(uv, float2(0.0), float2(1.0)));
}

fragment float4 compositeFragment(
    CompositeVertexOut in [[stage_in]],
    constant CompositeUniforms &uniforms [[buffer(0)]],
    texture2d<float> leftEye [[texture(0)]],
    texture2d<float> rightEye [[texture(1)]],
    sampler eyeSampler [[sampler(0)]]
) {
    float2 pixel = in.position.xy;
    float2 uv = pixel * uniforms.drawable.zw;
    uint mode = uniforms.mode.x;

    if (mode == 0 || mode == 1) {
        return sampleEye(leftEye, eyeSampler, uv);
    }

    if (mode == 2) {
        return sampleEye(rightEye, eyeSampler, uv);
    }

    if (mode == 3) {
        if (uv.x < 0.5) {
            return sampleEye(leftEye, eyeSampler, float2(uv.x * 2.0, uv.y));
        }
        return sampleEye(rightEye, eyeSampler, float2((uv.x - 0.5) * 2.0, uv.y));
    }

    uint eyeIndex = interlacedEyeIndex(pixel, uniforms);
    if (mode == 5) {
        return calibrationColor(eyeIndex, uv);
    }

    return eyeIndex == 0
        ? sampleEye(leftEye, eyeSampler, uv)
        : sampleEye(rightEye, eyeSampler, uv);
}

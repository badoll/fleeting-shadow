#ifndef CalibrationShaders_metal
#define CalibrationShaders_metal

#include <metal_stdlib>
using namespace metal;

static inline float rectangleMask(float2 uv, float2 lower, float2 upper) {
    float2 insideLower = step(lower, uv);
    float2 insideUpper = step(uv, upper);
    return insideLower.x * insideLower.y * insideUpper.x * insideUpper.y;
}

static inline float segmentDistance(float2 point, float2 start, float2 end) {
    float2 segment = end - start;
    float t = clamp(dot(point - start, segment) / max(dot(segment, segment), 0.0001), 0.0, 1.0);
    return length(point - (start + segment * t));
}

static inline float letterLMask(float2 uv) {
    float vertical = rectangleMask(uv, float2(0.25, 0.22), float2(0.36, 0.76));
    float bottom = rectangleMask(uv, float2(0.25, 0.64), float2(0.72, 0.76));
    return max(vertical, bottom);
}

static inline float letterRMask(float2 uv) {
    float vertical = rectangleMask(uv, float2(0.26, 0.22), float2(0.36, 0.78));
    float top = rectangleMask(uv, float2(0.30, 0.22), float2(0.66, 0.33));
    float middle = rectangleMask(uv, float2(0.30, 0.46), float2(0.64, 0.56));
    float right = rectangleMask(uv, float2(0.60, 0.28), float2(0.70, 0.52));
    float diagonal = 1.0 - step(0.045, segmentDistance(uv, float2(0.40, 0.54), float2(0.72, 0.78)));
    return max(max(max(vertical, top), max(middle, right)), diagonal);
}

static inline float4 calibrationColor(uint eyeIndex, float2 uv) {
    if (eyeIndex == 0) {
        float horizontalLines = 1.0 - step(0.025, abs(fract(uv.y * 18.0) - 0.5));
        float mask = max(letterLMask(uv), horizontalLines * 0.5);
        float3 color = mix(float3(0.95, 0.05, 0.04), float3(1.0), mask);
        return float4(color, 1.0);
    }

    float verticalLines = 1.0 - step(0.025, abs(fract(uv.x * 18.0) - 0.5));
    float mask = max(letterRMask(uv), verticalLines * 0.45);
    float3 color = mix(float3(0.0, 0.92, 0.95), float3(0.0), mask);
    return float4(color, 1.0);
}

#endif

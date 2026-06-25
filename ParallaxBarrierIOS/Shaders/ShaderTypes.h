#ifndef ShaderTypes_h
#define ShaderTypes_h

#ifdef __METAL_VERSION__
#include <metal_stdlib>
using namespace metal;

struct InstanceData {
    float4 parameters;
};

struct FrameUniforms {
    float4x4 viewProjection;
    float4 cameraPositionAndTime;
    float4 viewport;
};

struct SkyboxUniforms {
    float4x4 inverseViewProjection;
};

struct CompositeUniforms {
    float4 drawable;
    float4 interlace;
    uint4 mode;
};
#else
#include <simd/simd.h>

typedef struct {
    vector_float4 parameters;
} InstanceData;

typedef struct {
    matrix_float4x4 viewProjection;
    vector_float4 cameraPositionAndTime;
    vector_float4 viewport;
} FrameUniforms;

typedef struct {
    matrix_float4x4 inverseViewProjection;
} SkyboxUniforms;

typedef struct {
    vector_float4 drawable;
    vector_float4 interlace;
    vector_uint4 mode;
} CompositeUniforms;
#endif

#endif

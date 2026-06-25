#include <metal_stdlib>
#include "ShaderTypes.h"
using namespace metal;

struct SphereVertexIn {
    float3 position;
    float3 normal;
};

struct SphereVertexOut {
    float4 position [[position]];
    float3 worldPosition;
    float3 worldNormal;
    float3 cameraPosition;
};

vertex SphereVertexOut sphereVertex(
    uint vertexID [[vertex_id]],
    uint instanceID [[instance_id]],
    device const SphereVertexIn *vertices [[buffer(0)]],
    device const InstanceData *instances [[buffer(1)]],
    constant FrameUniforms &uniforms [[buffer(2)]]
) {
    SphereVertexIn vertexIn = vertices[vertexID];
    float4 parameters = instances[instanceID].parameters;
    float timer = uniforms.cameraPositionAndTime.w;
    float index = float(instanceID);

    float3 center = float3(
        5.0 * cos(timer + index),
        5.0 * sin(timer + index * 1.1),
        parameters.x
    );
    float scale = parameters.y;
    float3 worldPosition = center + vertexIn.position * scale;
    float3 worldNormal = normalize(vertexIn.normal);

    SphereVertexOut out;
    out.position = uniforms.viewProjection * float4(worldPosition, 1.0);
    out.worldPosition = worldPosition;
    out.worldNormal = worldNormal;
    out.cameraPosition = uniforms.cameraPositionAndTime.xyz;
    return out;
}

fragment float4 sphereFragment(
    SphereVertexOut in [[stage_in]],
    texturecube<float> cubemap [[texture(0)]],
    sampler cubeSampler [[sampler(0)]]
) {
    float3 normal = normalize(in.worldNormal);
    float3 incident = normalize(in.worldPosition - in.cameraPosition);
    float3 reflected = reflect(incident, normal);
    return float4(cubemap.sample(cubeSampler, reflected).rgb, 1.0);
}

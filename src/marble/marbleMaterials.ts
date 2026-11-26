import { Matrix4, MeshPhysicalMaterial, Vector2, Vector3 } from 'three'

export function createClippedMarbleMaterial(
  color: string,
  inverse: Matrix4,
  slotGeometry: Vector2,
  screenBounds: Vector3,
) {
  const material = new MeshPhysicalMaterial({
    color,
    roughness: 0.14,
    metalness: 0.12,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.55,
  })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.inversePhone = { value: inverse }
    shader.uniforms.slotGeometry = { value: slotGeometry }
    shader.uniforms.screenBounds = { value: screenBounds }
    shader.vertexShader = 'uniform mat4 inversePhone; varying vec3 phoneFragment;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\nphoneFragment = (inversePhone * modelMatrix * vec4(transformed, 1.0)).xyz;',
    )
    shader.fragmentShader = 'uniform vec2 slotGeometry; uniform vec3 screenBounds; varying vec3 phoneFragment;\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>
      vec2 delta = abs(phoneFragment.xy) - screenBounds.xy;
      float edgeDistance = length(max(delta, 0.0)) + min(max(delta.x, delta.y), 0.0) - screenBounds.z;
      if (edgeDistance <= 0.0 && phoneFragment.z >= slotGeometry.y - slotGeometry.x && phoneFragment.z < slotGeometry.y) discard;`,
    )
  }
  material.customProgramCacheKey = () => 'marble-finite-slot-device-profile-v3'
  return material
}

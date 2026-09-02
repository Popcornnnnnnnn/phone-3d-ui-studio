import { useEffect, useMemo } from 'react'
import { ExtrudeGeometry } from 'three'
import { IPHONE_17_SCENE } from '../model/iphone17'
import { createRoundedRectangleShape } from '../model/roundedRectangle'

function CameraLens({ name, y }: { name: string; y: number }) {
  const radius = IPHONE_17_SCENE.rearLensDiameter / 2

  return (
    <group
      name={name}
      position={[0.43, y, -IPHONE_17_SCENE.depth / 2 - 0.046]}
      rotation={[Math.PI / 2, 0, 0]}
    >
      <mesh>
        <cylinderGeometry args={[radius * 1.12, radius * 1.12, 0.05, 72]} />
        <meshPhysicalMaterial
          color="#55575a"
          clearcoat={0.52}
          metalness={0.94}
          roughness={0.18}
        />
      </mesh>
      <mesh position={[0, -0.031, 0]}>
        <cylinderGeometry args={[radius * 0.98, radius * 0.98, 0.026, 72]} />
        <meshPhysicalMaterial
          color="#08090b"
          clearcoat={0.92}
          metalness={0.5}
          roughness={0.08}
        />
      </mesh>
      <mesh position={[0, -0.048, 0]}>
        <cylinderGeometry args={[radius * 0.78, radius * 0.78, 0.012, 72]} />
        <meshPhysicalMaterial
          color="#10141d"
          clearcoat={1}
          metalness={0.12}
          roughness={0.035}
        />
      </mesh>
      <mesh position={[0, -0.057, 0]}>
        <cylinderGeometry args={[radius * 0.43, radius * 0.43, 0.006, 56]} />
        <meshPhysicalMaterial
          color="#030407"
          clearcoat={1}
          metalness={0.28}
          roughness={0.02}
        />
      </mesh>
      <mesh position={[-radius * 0.28, -0.063, radius * 0.26]}>
        <sphereGeometry args={[radius * 0.105, 24, 24]} />
        <meshBasicMaterial color="#6e87a8" transparent opacity={0.5} />
      </mesh>
    </group>
  )
}

export function RearCameraSystem() {
  const backSurface = -IPHONE_17_SCENE.depth / 2
  const islandGeometry = useMemo(() => {
    const depth = 0.035
    const geometry = new ExtrudeGeometry(
      createRoundedRectangleShape(0.43, 0.93, 0.205),
      {
        bevelEnabled: true,
        bevelSegments: 6,
        bevelSize: 0.012,
        bevelThickness: 0.008,
        curveSegments: 24,
        depth,
        steps: 1,
      },
    )
    geometry.translate(0, 0, -depth)
    return geometry
  }, [])

  useEffect(() => () => islandGeometry.dispose(), [islandGeometry])

  return (
    <group name="dual-fusion-camera-system">
      <mesh
        geometry={islandGeometry}
        name="camera-island"
        position={[0.43, 0.88, backSurface - 0.009]}
      >
        <meshPhysicalMaterial
          color="#242523"
          clearcoat={0.48}
          metalness={0.5}
          roughness={0.24}
        />
      </mesh>

      <CameraLens name="rear-camera-main" y={1.08} />
      <CameraLens name="rear-camera-ultrawide" y={0.68} />

      <mesh name="flash" position={[0.08, 0.94, backSurface - 0.024]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.061, 0.061, 0.018, 48]} />
        <meshPhysicalMaterial
          color="#f4ead2"
          clearcoat={0.82}
          emissive="#fff7db"
          emissiveIntensity={0.18}
          roughness={0.18}
        />
      </mesh>
      <mesh name="rear-microphone" position={[0.08, 0.78, backSurface - 0.025]}>
        <sphereGeometry args={[0.018, 24, 24]} />
        <meshBasicMaterial color="#111210" />
      </mesh>
    </group>
  )
}

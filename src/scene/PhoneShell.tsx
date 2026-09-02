import { useEffect, useMemo } from 'react'
import { DoubleSide, ExtrudeGeometry } from 'three'
import { IPHONE_17_SCENE } from '../model/iphone17'
import {
  createRoundedRectangleGeometry,
  createRoundedRectangleShape,
} from '../model/roundedRectangle'

export function PhoneShell() {
  const { width, height, depth, glassWidth, glassHeight } = IPHONE_17_SCENE
  const frameGeometry = useMemo(() => {
    const bevelThickness = 0.021
    const innerDepth = depth - bevelThickness * 2
    const geometry = new ExtrudeGeometry(
      createRoundedRectangleShape(width, height, 0.205),
      {
        bevelEnabled: true,
        bevelSegments: 8,
        bevelSize: 0.026,
        bevelThickness,
        curveSegments: 24,
        depth: innerDepth,
        steps: 1,
      },
    )
    geometry.translate(0, 0, -innerDepth / 2)
    return geometry
  }, [depth, height, width])
  const glassGeometry = useMemo(
    () => createRoundedRectangleGeometry(glassWidth, glassHeight, 0.182, 24),
    [glassHeight, glassWidth],
  )

  useEffect(
    () => () => {
      frameGeometry.dispose()
      glassGeometry.dispose()
    },
    [frameGeometry, glassGeometry],
  )

  return (
    <>
      <mesh geometry={frameGeometry} name="body-frame" castShadow receiveShadow>
        <meshPhysicalMaterial
          color="#303133"
          clearcoat={0.42}
          clearcoatRoughness={0.16}
          metalness={0.9}
          roughness={0.24}
        />
      </mesh>
      <mesh geometry={glassGeometry} name="front-glass" position={[0, 0, depth / 2 + 0.001]}>
        <meshPhysicalMaterial
          color="#050607"
          clearcoat={1}
          clearcoatRoughness={0.025}
          roughness={0.055}
          side={DoubleSide}
        />
      </mesh>
      <mesh geometry={glassGeometry} name="back-glass" position={[0, 0, -depth / 2 - 0.001]}>
        <meshPhysicalMaterial
          color="#3d3e3d"
          clearcoat={0.38}
          clearcoatRoughness={0.24}
          metalness={0.08}
          roughness={0.31}
          side={DoubleSide}
        />
      </mesh>
    </>
  )
}

import { useEffect, useMemo } from 'react'
import { DoubleSide, Shape, ShapeGeometry } from 'three'
import { IPHONE_17_SCENE } from '../model/iphone17'

function createAppleBody() {
  const shape = new Shape()

  shape.moveTo(0.02, -0.29)
  shape.bezierCurveTo(-0.08, -0.29, -0.13, -0.23, -0.2, -0.13)
  shape.bezierCurveTo(-0.28, -0.02, -0.29, 0.12, -0.23, 0.22)
  shape.bezierCurveTo(-0.18, 0.31, -0.09, 0.33, 0, 0.28)
  shape.bezierCurveTo(0.06, 0.25, 0.11, 0.25, 0.18, 0.29)
  shape.bezierCurveTo(0.24, 0.32, 0.31, 0.29, 0.35, 0.24)
  shape.bezierCurveTo(0.27, 0.18, 0.24, 0.1, 0.27, 0.02)
  shape.bezierCurveTo(0.29, -0.04, 0.34, -0.09, 0.4, -0.11)
  shape.bezierCurveTo(0.36, -0.2, 0.3, -0.29, 0.22, -0.35)
  shape.bezierCurveTo(0.14, -0.41, 0.08, -0.37, 0.02, -0.34)
  shape.bezierCurveTo(-0.03, -0.31, -0.04, -0.29, 0.02, -0.29)

  return new ShapeGeometry(shape, 24)
}

function createAppleLeaf() {
  const shape = new Shape()
  shape.absellipse(0, 0, 0.095, 0.18, 0, Math.PI * 2, false, 0)
  return new ShapeGeometry(shape, 20)
}

export function AppleMark() {
  const bodyGeometry = useMemo(() => createAppleBody(), [])
  const leafGeometry = useMemo(() => createAppleLeaf(), [])

  useEffect(
    () => () => {
      bodyGeometry.dispose()
      leafGeometry.dispose()
    },
    [bodyGeometry, leafGeometry],
  )

  const z = -IPHONE_17_SCENE.depth / 2 - 0.013

  return (
    <group name="rear-apple-mark" position={[0, -0.04, z]} scale={0.4}>
      <mesh geometry={bodyGeometry}>
        <meshPhysicalMaterial
          color="#252625"
          clearcoat={0.28}
          metalness={0.2}
          roughness={0.34}
          side={DoubleSide}
        />
      </mesh>
      <mesh geometry={leafGeometry} position={[0.09, 0.42, 0]} rotation={[0, 0, -0.55]}>
        <meshPhysicalMaterial
          color="#252625"
          clearcoat={0.28}
          metalness={0.2}
          roughness={0.34}
          side={DoubleSide}
        />
      </mesh>
    </group>
  )
}

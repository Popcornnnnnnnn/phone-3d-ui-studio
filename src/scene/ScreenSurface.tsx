import { useGLTF } from '@react-three/drei'
import { useEffect, useMemo } from 'react'
import { AdditiveBlending, Mesh, type BufferGeometry } from 'three'
import { IPHONE_17_SCENE, type ScreenOrientation } from '../model/iphone17'
import { createRoundedRectangleGeometry } from '../model/roundedRectangle'
import type { ScreenMedia } from '../studio/screenMedia'
import {
  LOCAL_IPHONE_17_ASSET_URL,
  LOCAL_IPHONE_17_MODEL_SCALE,
} from './LocalIPhone17Asset'
import { ScreenSurfaceMaterial } from './ScreenSurfaceMaterial'

interface ScreenSurfaceProps {
  media: ScreenMedia | null
  orientation: ScreenOrientation
  useImportedGeometry?: boolean
}

function ScreenGlass({ geometry }: { geometry: BufferGeometry }) {
  return (
    <mesh name="screen-glass" geometry={geometry}>
      {/* A reflection-only coat preserves the display's existing color pipeline.
          Polygon offset stabilizes the shared surface without raising another edge. */}
      <meshPhysicalMaterial
        color="#000000"
        metalness={0}
        roughness={0.18}
        specularIntensity={0.45}
        envMapIntensity={0.6}
        transparent
        opacity={0.18}
        blending={AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
      />
    </mesh>
  )
}

function ProceduralScreenSurface({ media, orientation }: ScreenSurfaceProps) {
  const geometry = useMemo(
    () =>
      createRoundedRectangleGeometry(
        IPHONE_17_SCENE.displayWidth,
        IPHONE_17_SCENE.displayHeight,
        0.135,
      ),
    [],
  )

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <group position={[0, 0, IPHONE_17_SCENE.depth / 2 + 0.0008]}>
      <mesh geometry={geometry} name="screen-mesh">
        <ScreenSurfaceMaterial media={media} orientation={orientation} />
      </mesh>
      <ScreenGlass geometry={geometry} />
    </group>
  )
}

function ImportedScreenSurface({ media, orientation }: ScreenSurfaceProps) {
  const { scene } = useGLTF(LOCAL_IPHONE_17_ASSET_URL)
  const geometry = useMemo(() => {
    const screen = scene.getObjectByName('17-Screen')
    if (!(screen instanceof Mesh)) return null

    const clone = screen.geometry.clone()
    const uvs = clone.getAttribute('uv')

    for (let index = 0; index < uvs.count; index += 1) {
      uvs.setY(index, 1 - uvs.getY(index))
    }

    uvs.needsUpdate = true
    return clone
  }, [scene])

  useEffect(() => () => geometry?.dispose(), [geometry])

  if (!geometry) {
    return <ProceduralScreenSurface media={media} orientation={orientation} />
  }

  return (
    <group
      position={[0, 0, 0.0008]}
      scale={LOCAL_IPHONE_17_MODEL_SCALE}
    >
      <mesh geometry={geometry} name="screen-mesh">
        <ScreenSurfaceMaterial media={media} orientation={orientation} />
      </mesh>
      <ScreenGlass geometry={geometry} />
    </group>
  )
}

export function ScreenSurface({
  media,
  orientation,
  useImportedGeometry = false,
}: ScreenSurfaceProps) {
  if (!useImportedGeometry) {
    return <ProceduralScreenSurface media={media} orientation={orientation} />
  }

  return <ImportedScreenSurface media={media} orientation={orientation} />
}

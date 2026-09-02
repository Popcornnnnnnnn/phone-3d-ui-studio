import { useEffect, useMemo } from 'react'
import { Shape, ShapeGeometry } from 'three'
import { IPHONE_17_SCENE, type ScreenOrientation } from '../model/iphone17'
import type { ScreenMedia } from '../studio/screenMedia'
import { ScreenSurfaceMaterial } from './ScreenSurfaceMaterial'

interface ScreenSurfaceProps {
  media: ScreenMedia | null
  orientation: ScreenOrientation
}

function createRoundedScreenGeometry(width: number, height: number, radius: number) {
  const left = -width / 2
  const right = width / 2
  const bottom = -height / 2
  const top = height / 2
  const shape = new Shape()

  shape.moveTo(left + radius, bottom)
  shape.lineTo(right - radius, bottom)
  shape.quadraticCurveTo(right, bottom, right, bottom + radius)
  shape.lineTo(right, top - radius)
  shape.quadraticCurveTo(right, top, right - radius, top)
  shape.lineTo(left + radius, top)
  shape.quadraticCurveTo(left, top, left, top - radius)
  shape.lineTo(left, bottom + radius)
  shape.quadraticCurveTo(left, bottom, left + radius, bottom)

  const geometry = new ShapeGeometry(shape, 20)
  const positions = geometry.getAttribute('position')
  const uvs = geometry.getAttribute('uv')

  for (let index = 0; index < positions.count; index += 1) {
    uvs.setXY(
      index,
      (positions.getX(index) - left) / width,
      (positions.getY(index) - bottom) / height,
    )
  }

  uvs.needsUpdate = true
  return geometry
}

export function ScreenSurface({ media, orientation }: ScreenSurfaceProps) {
  const geometry = useMemo(
    () =>
      createRoundedScreenGeometry(
        IPHONE_17_SCENE.displayWidth,
        IPHONE_17_SCENE.displayHeight,
        0.135,
      ),
    [],
  )

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh
      geometry={geometry}
      name="screen-mesh"
      position={[0, 0, IPHONE_17_SCENE.depth / 2 + 0.02]}
    >
      <ScreenSurfaceMaterial media={media} orientation={orientation} />
    </mesh>
  )
}

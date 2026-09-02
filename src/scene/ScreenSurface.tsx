import { useEffect, useMemo } from 'react'
import { IPHONE_17_SCENE, type ScreenOrientation } from '../model/iphone17'
import { createRoundedRectangleGeometry } from '../model/roundedRectangle'
import type { ScreenMedia } from '../studio/screenMedia'
import { ScreenSurfaceMaterial } from './ScreenSurfaceMaterial'

interface ScreenSurfaceProps {
  media: ScreenMedia | null
  orientation: ScreenOrientation
}

export function ScreenSurface({ media, orientation }: ScreenSurfaceProps) {
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
    <mesh
      geometry={geometry}
      name="screen-mesh"
      position={[0, 0, IPHONE_17_SCENE.depth / 2 + 0.02]}
    >
      <ScreenSurfaceMaterial media={media} orientation={orientation} />
    </mesh>
  )
}

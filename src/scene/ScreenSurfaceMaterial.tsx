import { useEffect, useMemo } from 'react'
import {
  ClampToEdgeWrapping,
  LinearFilter,
  SRGBColorSpace,
  VideoTexture,
} from 'three'
import { IPHONE_17_SCENE, type ScreenOrientation } from '../model/iphone17'
import {
  getContainMapping,
  getScreenTargetAspect,
  type ScreenMedia,
} from '../studio/screenMedia'
import { screenFragmentShader, screenVertexShader } from './screenSurfaceShader'

interface ScreenSurfaceMaterialProps {
  media: ScreenMedia | null
  orientation: ScreenOrientation
}

export function ScreenSurfaceMaterial({
  media,
  orientation,
}: ScreenSurfaceMaterialProps) {
  const videoTexture = useMemo(() => {
    if (!media || media.kind !== 'video') return null

    const nextTexture = new VideoTexture(media.element)
    nextTexture.colorSpace = SRGBColorSpace
    nextTexture.minFilter = LinearFilter
    nextTexture.magFilter = LinearFilter
    nextTexture.generateMipmaps = false
    nextTexture.wrapS = ClampToEdgeWrapping
    nextTexture.wrapT = ClampToEdgeWrapping
    return nextTexture
  }, [media])

  useEffect(() => () => videoTexture?.dispose(), [videoTexture])

  const texture = media?.kind === 'texture' ? media.texture : videoTexture

  const uniforms = useMemo(() => {
    if (!media || !texture) return null

    const targetAspect = getScreenTargetAspect(
      IPHONE_17_SCENE.displayWidth,
      IPHONE_17_SCENE.displayHeight,
      orientation,
    )
    const mapping = getContainMapping(media.width, media.height, targetAspect)

    return {
      contentScale: { value: mapping.contentScale },
      decodeVideoTexture: { value: texture instanceof VideoTexture ? 1 : 0 },
      landscape: { value: orientation === 'landscape' ? 1 : 0 },
      screenTexture: { value: texture },
    }
  }, [media, orientation, texture])

  if (!uniforms) {
    return <meshBasicMaterial color="#0b0e14" toneMapped={false} />
  }

  return (
    <shaderMaterial
      fragmentShader={screenFragmentShader}
      toneMapped={false}
      uniforms={uniforms}
      vertexShader={screenVertexShader}
    />
  )
}

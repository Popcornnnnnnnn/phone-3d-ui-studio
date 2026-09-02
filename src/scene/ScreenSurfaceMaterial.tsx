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

interface ScreenSurfaceMaterialProps {
  media: ScreenMedia | null
  orientation: ScreenOrientation
}

const vertexShader = /* glsl */ `
  varying vec2 vScreenUv;

  void main() {
    vScreenUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform sampler2D screenTexture;
  uniform vec2 contentScale;
  uniform float landscape;
  varying vec2 vScreenUv;

  void main() {
    vec2 displayUv = landscape > 0.5
      ? vec2(1.0 - vScreenUv.y, vScreenUv.x)
      : vScreenUv;
    vec2 sourceUv = (displayUv - vec2(0.5)) / contentScale + vec2(0.5);
    bool outside = sourceUv.x < 0.0 || sourceUv.x > 1.0
      || sourceUv.y < 0.0 || sourceUv.y > 1.0;

    gl_FragColor = outside
      ? vec4(0.004, 0.006, 0.01, 1.0)
      : texture2D(screenTexture, sourceUv);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export function ScreenSurfaceMaterial({
  media,
  orientation,
}: ScreenSurfaceMaterialProps) {
  const texture = useMemo(() => {
    if (!media) return null

    const nextTexture = new VideoTexture(media.element)
    nextTexture.colorSpace = SRGBColorSpace
    nextTexture.minFilter = LinearFilter
    nextTexture.magFilter = LinearFilter
    nextTexture.generateMipmaps = false
    nextTexture.wrapS = ClampToEdgeWrapping
    nextTexture.wrapT = ClampToEdgeWrapping
    return nextTexture
  }, [media])

  useEffect(() => () => texture?.dispose(), [texture])

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
      landscape: { value: orientation === 'landscape' ? 1 : 0 },
      screenTexture: { value: texture },
    }
  }, [media, orientation, texture])

  if (!uniforms) {
    return <meshBasicMaterial color="#0b0e14" toneMapped={false} />
  }

  return (
    <shaderMaterial
      fragmentShader={fragmentShader}
      toneMapped={false}
      uniforms={uniforms}
      vertexShader={vertexShader}
    />
  )
}

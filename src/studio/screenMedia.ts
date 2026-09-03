import type { Texture } from 'three'
import type { ScreenOrientation } from '../model/iphone17'

interface ScreenMediaBase {
  kind: 'texture' | 'video'
  name: string
  width: number
  height: number
}

export interface VideoScreenMedia extends ScreenMediaBase {
  kind: 'video'
  element: HTMLVideoElement
}

export interface TextureScreenMedia extends ScreenMediaBase {
  kind: 'texture'
  texture: Texture
}

export type ScreenMedia = TextureScreenMedia | VideoScreenMedia

export interface ScreenContainMapping {
  contentScale: readonly [x: number, y: number]
  sourceAspect: number
  targetAspect: number
}

export function getScreenTargetAspect(
  portraitWidth: number,
  portraitHeight: number,
  orientation: ScreenOrientation,
) {
  if (portraitWidth <= 0 || portraitHeight <= 0) {
    throw new Error('Screen dimensions must be positive')
  }

  return orientation === 'portrait'
    ? portraitWidth / portraitHeight
    : portraitHeight / portraitWidth
}

export function getContainMapping(
  sourceWidth: number,
  sourceHeight: number,
  targetAspect: number,
): ScreenContainMapping {
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetAspect <= 0) {
    throw new Error('Source dimensions and target aspect must be positive')
  }

  const sourceAspect = sourceWidth / sourceHeight
  const contentScale: [number, number] = [1, 1]

  if (sourceAspect > targetAspect) {
    contentScale[1] = targetAspect / sourceAspect
  } else {
    contentScale[0] = sourceAspect / targetAspect
  }

  return { contentScale, sourceAspect, targetAspect }
}

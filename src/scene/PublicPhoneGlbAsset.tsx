import { useGLTF } from '@react-three/drei'
import { Component, useEffect, useMemo, type ReactNode } from 'react'
import { Group, Mesh, MeshStandardMaterial, type Material, type Object3D } from 'three'
import {
  millimetersToScene,
  phoneFinish,
  type PhoneFinishId,
  type PhoneProfile,
} from '../../shared/phoneGeometry.mjs'
import {
  PUBLIC_DRACO_DECODER_PATH,
  publicPhoneGlbUrl,
  type PublicPhoneAssetSpec,
} from '../model/publicPhoneAssets'

function cloneAndTintMaterials(
  scene: Group,
  asset: PublicPhoneAssetSpec,
  finishId: PhoneFinishId,
) {
  const cloned = scene.clone(true)
  const finish = phoneFinish(finishId)
  const frameSet = new Set(asset.frameMaterials)
  const backSet = new Set(asset.backMaterials)
  const accentSet = new Set(asset.accentMaterials)
  const clonedMaterials: Material[] = []
  const cache = new Map<Material, Material>()

  cloned.traverse((obj: Object3D) => {
    if (!(obj instanceof Mesh)) return
    obj.castShadow = true
    obj.receiveShadow = true

    const applyMat = (src: Material): Material => {
      const existing = cache.get(src)
      if (existing) return existing
      const copy = src.clone()
      if (copy instanceof MeshStandardMaterial) {
        if (frameSet.has(src.name)) {
          copy.color.set(finish.frameHex)
          copy.envMapIntensity = Math.max(copy.envMapIntensity, 1.15)
        } else if (backSet.has(src.name)) {
          copy.color.set(finish.backHex)
          copy.envMapIntensity = Math.max(copy.envMapIntensity, 0.9)
        } else if (asset.id === 'iphone-16' && accentSet.has(src.name)) {
          copy.color.set(finish.buttonHex)
        }
        copy.needsUpdate = true
      }
      cache.set(src, copy)
      clonedMaterials.push(copy)
      return copy
    }

    if (Array.isArray(obj.material)) {
      obj.material = obj.material.map(applyMat)
    } else if (obj.material) {
      obj.material = applyMat(obj.material)
    }
  })

  return { cloned, clonedMaterials }
}

export function PublicPhoneGlbAsset({
  asset,
  profile,
  finishId,
}: {
  asset: PublicPhoneAssetSpec
  profile: PhoneProfile
  finishId: PhoneFinishId
}) {
  const url = publicPhoneGlbUrl(asset)
  const { scene } = useGLTF(url, PUBLIC_DRACO_DECODER_PATH)

  const { cloned, clonedMaterials } = useMemo(
    () => cloneAndTintMaterials(scene, asset, finishId),
    [asset, finishId, scene],
  )

  useEffect(() => {
    return () => {
      clonedMaterials.forEach((mat) => mat.dispose())
    }
  }, [clonedMaterials])

  const targetWidth = millimetersToScene(profile.bodyMm.width)
  const targetHeight = millimetersToScene(profile.bodyMm.height)
  const targetDepth = millimetersToScene(profile.bodyMm.depth)

  const scale: [number, number, number] = [
    targetWidth / asset.normalized.bodyWidth,
    targetHeight / asset.normalized.bodyHeight,
    targetDepth / asset.normalized.bodyDepth,
  ]

  return <primitive object={cloned} scale={scale} />
}

interface BoundaryProps {
  fallback: ReactNode
  children: ReactNode
}

export class PhoneGlbErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  render() {
    if (this.state.failed) return this.props.fallback
    return this.props.children
  }
}

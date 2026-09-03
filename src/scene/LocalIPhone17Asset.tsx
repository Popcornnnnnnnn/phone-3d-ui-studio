import { useGLTF } from '@react-three/drei'
import { useEffect, useMemo } from 'react'
import {
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
} from 'three'
import { IPHONE_17_MM, MODEL_HEIGHT } from '../model/iphone17'

export const LOCAL_IPHONE_17_ASSET_URL =
  '/local-assets/iphone-17/iphone-17-black.glb'

export const LOCAL_IPHONE_17_MODEL_SCALE =
  MODEL_HEIGHT / (IPHONE_17_MM.height / 1000)

export function LocalIPhone17Asset() {
  const { scene } = useGLTF(LOCAL_IPHONE_17_ASSET_URL)
  const materials = useMemo(() => {
    const body = scene.getObjectByName('17-Body')
    const sourceBodyMaterial =
      body instanceof Mesh && body.material instanceof MeshStandardMaterial
        ? body.material
        : null

    return {
      aluminum: new MeshPhysicalMaterial({
        color: '#56595d',
        metalness: 0.68,
        roughness: 0.4,
        clearcoat: 0.12,
        clearcoatRoughness: 0.3,
        normalMap: sourceBodyMaterial?.normalMap ?? null,
        normalScale: sourceBodyMaterial?.normalScale,
        metalnessMap: sourceBodyMaterial?.metalnessMap ?? null,
        roughnessMap: sourceBodyMaterial?.roughnessMap ?? null,
      }),
      portRim: new MeshPhysicalMaterial({
        color: '#8c9095',
        metalness: 0.82,
        roughness: 0.26,
        clearcoat: 0.16,
      }),
      cameraPlate: new MeshPhysicalMaterial({
        color: '#2b2c2d',
        metalness: 0.12,
        roughness: 0.24,
        clearcoat: 0.78,
        clearcoatRoughness: 0.12,
      }),
      cameraRing: new MeshPhysicalMaterial({
        color: '#3f4144',
        metalness: 0.82,
        roughness: 0.2,
        clearcoat: 0.32,
      }),
      lens: new MeshPhysicalMaterial({
        color: '#030711',
        metalness: 0.18,
        roughness: 0.045,
        clearcoat: 1,
        clearcoatRoughness: 0.015,
      }),
      black: new MeshPhysicalMaterial({
        color: '#050607',
        metalness: 0.12,
        roughness: 0.18,
        clearcoat: 0.55,
      }),
      cavity: new MeshBasicMaterial({
        color: '#010204',
        toneMapped: false,
      }),
      logo: new MeshPhysicalMaterial({
        color: '#111214',
        metalness: 0.38,
        roughness: 0.13,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
      }),
      flash: new MeshPhysicalMaterial({
        color: '#fff1cf',
        emissive: '#fff4d9',
        emissiveIntensity: 0.35,
        metalness: 0,
        roughness: 0.16,
        clearcoat: 0.9,
      }),
    }
  }, [scene])
  const model = useMemo(() => {
    const clone = scene.clone(true)

    clone.traverse((object) => {
      if (object instanceof Mesh) {
        object.castShadow = true
        object.receiveShadow = false

        if (object.name === '17-GlassRough' || object.name === '17-Matte') {
          object.visible = false
        } else if (
          object.name === '17-Body' ||
          object.name === '17-Control' ||
          object.name === '17-power' ||
          object.name === '17-VolumeDown' ||
          object.name === '17-VolumeUp' ||
          object.name === '17-CameraButton'
        ) {
          object.material = materials.aluminum
        } else if (object.name === '17-GlassClear') {
          object.material = materials.cameraPlate
        } else if (object.name === '17-Logo') {
          object.material = materials.logo
        } else if (object.name === '17-Flash') {
          object.material = materials.flash
        } else if (/Lens|lens|Glass/.test(object.name)) {
          object.material = materials.lens
        } else if (/Camera.*Edge|Camera.*Gray/.test(object.name)) {
          object.material = materials.cameraRing
        } else if (
          /Camera.*Black|Camera.*Plastic|17-Mic|17-Island|17-Screen/.test(
            object.name,
          )
        ) {
          object.material = materials.black
        } else if (/17-USB|17-Screw/.test(object.name)) {
          object.material = materials.portRim
        } else if (object.name === '17-NetTop') {
          object.material = materials.cavity
        }
      }
    })

    return clone
  }, [materials, scene])

  useEffect(
    () => () => {
      Object.values(materials).forEach((material) => material.dispose())
    },
    [materials],
  )

  return (
    <primitive
      name="local-iphone-17-asset"
      object={model}
      scale={LOCAL_IPHONE_17_MODEL_SCALE}
    />
  )
}

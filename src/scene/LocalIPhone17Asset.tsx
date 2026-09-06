import { useGLTF } from '@react-three/drei'
import { useEffect, useMemo } from 'react'
import {
  Box3,
  DoubleSide,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Vector3,
} from 'three'
import { IPHONE_17_MM, MODEL_HEIGHT } from '../model/iphone17'

export const LOCAL_IPHONE_17_ASSET_URL =
  '/local-assets/iphone-17/iphone-17-black.glb'

export const LOCAL_IPHONE_17_MODEL_SCALE =
  MODEL_HEIGHT / (IPHONE_17_MM.height / 1000)

// The source GLB leaves a real opening in the rear shell and covers it with a
// zero-thickness transmissive flash disc. Build a solid assembly in front of
// that disc so the environment can never show through the opening.
const IMPORTED_FLASH_CENTER = {
  x: 0.00531482697 * LOCAL_IPHONE_17_MODEL_SCALE,
  y: 0.05232620239 * LOCAL_IPHONE_17_MODEL_SCALE,
  z: -0.00408 * LOCAL_IPHONE_17_MODEL_SCALE,
} as const

function ImportedFlashAssembly() {
  const outerRadius = 0.00332 * LOCAL_IPHONE_17_MODEL_SCALE
  const diffuserRadius = 0.00274 * LOCAL_IPHONE_17_MODEL_SCALE
  const backingDepth = 0.0004 * LOCAL_IPHONE_17_MODEL_SCALE
  const diffuserDepth = 0.00012 * LOCAL_IPHONE_17_MODEL_SCALE

  return (
    <group
      name="rebuilt-rear-flash"
      position={[
        IMPORTED_FLASH_CENTER.x,
        IMPORTED_FLASH_CENTER.y,
        IMPORTED_FLASH_CENTER.z,
      ]}
      rotation={[Math.PI / 2, 0, 0]}
    >
      <mesh castShadow name="rear-flash-opaque-backing">
        <cylinderGeometry
          args={[outerRadius, outerRadius, backingDepth, 64]}
        />
        <meshStandardMaterial
          color="#3a3429"
          depthWrite
          metalness={0.28}
          opacity={1}
          roughness={0.34}
          side={DoubleSide}
          transparent={false}
        />
      </mesh>
      <mesh
        name="rear-flash-diffuser"
        position={[0, -backingDepth / 2 - diffuserDepth / 2 - 0.0002, 0]}
      >
        <cylinderGeometry
          args={[diffuserRadius, diffuserRadius, diffuserDepth, 64]}
        />
        <meshPhysicalMaterial
          clearcoat={0.72}
          clearcoatRoughness={0.2}
          color="#f6ecd2"
          depthWrite
          emissive="#fff4d6"
          emissiveIntensity={0.16}
          metalness={0}
          opacity={1}
          roughness={0.24}
          side={DoubleSide}
          transparent={false}
        />
      </mesh>
    </group>
  )
}

export function LocalIPhone17Asset() {
  const { scene } = useGLTF(LOCAL_IPHONE_17_ASSET_URL)
  const earpieceBacking = useMemo(() => {
    const grille = scene.getObjectByName('17-NetTop')
    if (!(grille instanceof Mesh)) return null

    const bounds = new Box3().setFromObject(grille)
    const center = bounds.getCenter(new Vector3())
    const size = bounds.getSize(new Vector3())
    const depth = 0.0006

    // The perforated grille needs a solid recessed interior. Extend behind
    // the rim so oblique views cannot see the environment through its edges.
    return {
      position: [center.x, center.y, bounds.min.z - depth / 2 - 0.00002].map(
        (value) => value * LOCAL_IPHONE_17_MODEL_SCALE,
      ) as [number, number, number],
      size: [size.x + 0.0004, size.y + 0.0004, depth] as [number, number, number],
    }
  }, [scene])
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
      earpiece: new MeshStandardMaterial({
        color: '#17191b',
        metalness: 0.15,
        roughness: 0.85,
        side: DoubleSide,
      }),
      logo: new MeshPhysicalMaterial({
        color: '#a5a9ae',
        metalness: 0.48,
        roughness: 0.26,
        clearcoat: 0.82,
        clearcoatRoughness: 0.12,
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

        if (
          object.name === '17-GlassRough' ||
          object.name === '17-Matte' ||
          object.name === '17-USB' ||
          /17-Screw/.test(object.name)
        ) {
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
        } else if (object.name === '17-NetTop') {
          object.material = materials.earpiece
        } else if (/Lens|lens|Glass/.test(object.name)) {
          object.material = materials.lens
        } else if (/Camera.*Edge|Camera.*Gray/.test(object.name)) {
          object.material = materials.cameraRing
        } else if (object.name === '17-Screen') {
          // ScreenSurface renders this geometry separately with the live media.
          // Keeping the model's black copy underneath causes angle-dependent
          // edge peeking and depth competition at grazing views.
          object.visible = false
        } else if (
          /Camera.*Black|Camera.*Plastic|17-Mic|17-Island/.test(
            object.name,
          )
        ) {
          object.material = materials.black
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
    <>
      <primitive
        name="local-iphone-17-asset"
        object={model}
        scale={LOCAL_IPHONE_17_MODEL_SCALE}
      />
      <ImportedFlashAssembly />
      {earpieceBacking && (
        <mesh
          name="top-earpiece-opaque-backing"
          position={earpieceBacking.position}
          scale={LOCAL_IPHONE_17_MODEL_SCALE}
        >
          <boxGeometry args={earpieceBacking.size} />
          <meshBasicMaterial color="#030405" toneMapped={false} />
        </mesh>
      )}
    </>
  )
}

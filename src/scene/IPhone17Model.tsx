import { RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Color, DoubleSide, Quaternion, type Group } from 'three'
import {
  IPHONE_17_SCENE,
  TABLETOP_PHONE_CENTER_Y,
  millimetersToScene,
  type ReviewView,
  type ScreenOrientation,
} from '../model/iphone17'
import { createRoundedRectangleGeometry } from '../model/roundedRectangle'
import type { PoseSample } from '../studio/contracts'
import type { ScreenMedia } from '../studio/screenMedia'
import { AppleMark } from './AppleMark'
import {
  LOCAL_IPHONE_17_ASSET_URL,
  LocalIPhone17Asset,
} from './LocalIPhone17Asset'
import { PhoneShell } from './PhoneShell'
import { RearCameraSystem } from './RearCameraSystem'
import { ScreenSurface } from './ScreenSurface'

interface IPhone17ModelProps {
  animate: boolean
  view: ReviewView
  orientation: ScreenOrientation
  screenMedia: ScreenMedia | null
  livePoseRef?: RefObject<PoseSample | null>
  useTabletopStandard?: boolean
}

const viewRotations: Record<ReviewView, [number, number, number]> = {
  calibration: [0, 0, 0],
  hero: [0.055, 0.08, -0.025],
  front: [0, 0, 0],
  back: [0, 0, 0],
}

const importedDynamicIsland = {
  width: millimetersToScene(20.74),
  height: millimetersToScene(6.07),
  centerY: millimetersToScene(67.02),
} as const

function SideButton({
  name,
  side,
  y,
  height,
}: {
  name: string
  side: -1 | 1
  y: number
  height: number
}) {
  return (
    <RoundedBox
      name={name}
      args={[0.022, height, 0.065]}
      radius={0.011}
      smoothness={6}
      position={[side * (IPHONE_17_SCENE.width / 2 + 0.009), y, 0]}
    >
      <meshPhysicalMaterial
        color="#363735"
        clearcoat={0.35}
        metalness={0.92}
        roughness={0.22}
      />
    </RoundedBox>
  )
}

function useLocalAssetAvailability() {
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    void fetch(LOCAL_IPHONE_17_ASSET_URL, {
      method: 'HEAD',
      signal: controller.signal,
    })
      .then((response) => setAvailable(response.ok))
      .catch(() => setAvailable(false))

    return () => controller.abort()
  }, [])

  return available
}

function ProceduralIPhone17Shell() {
  const { height } = IPHONE_17_SCENE

  return (
    <>
      <PhoneShell />
      <AppleMark />
      <RearCameraSystem />

      <SideButton name="action-button" side={-1} y={0.82} height={0.16} />
      <SideButton name="volume-up" side={-1} y={0.47} height={0.23} />
      <SideButton name="volume-down" side={-1} y={0.15} height={0.23} />
      <SideButton name="side-button" side={1} y={0.4} height={0.34} />
      <SideButton name="camera-control" side={1} y={-0.65} height={0.34} />

      <RoundedBox
        name="usb-c-port"
        args={[0.23, 0.018, 0.052]}
        radius={0.009}
        smoothness={4}
        position={[0, -height / 2 - 0.006, 0]}
      >
        <meshBasicMaterial color="#030407" />
      </RoundedBox>
    </>
  )
}

function DynamicIslandSurface() {
  const geometry = useMemo(
    () =>
      createRoundedRectangleGeometry(
        importedDynamicIsland.width,
        importedDynamicIsland.height,
        importedDynamicIsland.height / 2,
        32,
      ),
    [],
  )

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh
      geometry={geometry}
      name="dynamic-island"
      position={[
        0,
        importedDynamicIsland.centerY,
        IPHONE_17_SCENE.depth / 2 + 0.0012,
      ]}
    >
      <meshBasicMaterial color="#020305" toneMapped={false} />
    </mesh>
  )
}

const bottomFaceVertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const bottomFaceFragmentShader = /* glsl */ `
  uniform vec3 centerColor;
  uniform vec3 edgeColor;
  varying vec2 vUv;

  void main() {
    vec2 centered = abs(vUv - 0.5) * 2.0;
    float horizontalFade = smoothstep(0.7, 1.0, centered.x);
    float verticalFade = smoothstep(0.35, 1.0, centered.y);
    float edgeFade = max(horizontalFade, verticalFade);
    float softSheen = exp(-pow((vUv.y - 0.58) * 4.2, 2.0)) * 0.028;
    float alpha = 1.0 - smoothstep(0.72, 1.0, centered.x);
    vec3 color = mix(centerColor, edgeColor, edgeFade) + softSheen;
    gl_FragColor = vec4(color, alpha);
  }
`

const bottomSpeakerCenters = [
  -0.342,
  -0.292,
  -0.244,
  0.244,
  0.292,
  0.338,
  0.385,
  0.432,
] as const

function ImportedBottomFace() {
  const { height } = IPHONE_17_SCENE
  const faceY = -height / 2 + 0.014
  const faceGeometry = useMemo(
    () => createRoundedRectangleGeometry(1.02, 0.1, 0.045, 28),
    [],
  )
  const portRimGeometry = useMemo(
    () => createRoundedRectangleGeometry(0.185, 0.046, 0.023, 24),
    [],
  )
  const portOpeningGeometry = useMemo(
    () => createRoundedRectangleGeometry(0.164, 0.034, 0.017, 24),
    [],
  )
  const gradientUniforms = useMemo(
    () => ({
      centerColor: { value: new Color('#2c333b') },
      edgeColor: { value: new Color('#11161c') },
    }),
    [],
  )

  useEffect(
    () => () => {
      faceGeometry.dispose()
      portRimGeometry.dispose()
      portOpeningGeometry.dispose()
    },
    [faceGeometry, portOpeningGeometry, portRimGeometry],
  )

  return (
    <group name="rebuilt-bottom-face">
      <mesh
        geometry={faceGeometry}
        name="bottom-face-gradient"
        position={[0, faceY, 0]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <shaderMaterial
          fragmentShader={bottomFaceFragmentShader}
          side={DoubleSide}
          toneMapped={false}
          transparent
          uniforms={gradientUniforms}
          vertexShader={bottomFaceVertexShader}
          depthWrite={false}
        />
      </mesh>

      {bottomSpeakerCenters.map((x) => (
        <mesh
          key={x}
          position={[x, faceY - 0.001, 0]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <circleGeometry args={[0.0185, 32]} />
          <meshBasicMaterial color="#010204" toneMapped={false} />
        </mesh>
      ))}

      {[-0.145, 0.145].map((x) => (
        <mesh
          key={x}
          position={[x, faceY - 0.0012, 0]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <circleGeometry args={[0.009, 24]} />
          <meshBasicMaterial color="#343a42" toneMapped={false} />
        </mesh>
      ))}

      <mesh
        geometry={portRimGeometry}
        name="usb-c-rim"
        position={[0, faceY - 0.002, 0]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <meshBasicMaterial color="#4b525b" toneMapped={false} />
      </mesh>
      <mesh
        geometry={portOpeningGeometry}
        name="usb-c-inner-tunnel"
        position={[0, faceY - 0.003, 0]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <meshBasicMaterial color="#000103" toneMapped={false} />
      </mesh>
    </group>
  )
}

export function IPhone17Model({
  animate,
  view,
  orientation,
  screenMedia,
  livePoseRef,
  useTabletopStandard = false,
}: IPhone17ModelProps) {
  const group = useRef<Group>(null)
  const targetQuaternion = useRef(new Quaternion())
  const hasLocalAsset = useLocalAssetAvailability()

  useFrame((state, delta) => {
    if (!group.current) return

    const livePose = livePoseRef?.current
    if (livePose) {
      targetQuaternion.current.set(...livePose.quaternion)
      group.current.quaternion.slerp(
        targetQuaternion.current,
        1 - Math.exp(-delta * 20),
      )
      group.current.position.y +=
        (TABLETOP_PHONE_CENTER_Y - group.current.position.y) *
        (1 - Math.exp(-delta * 12))
      return
    }

    if (useTabletopStandard) {
      targetQuaternion.current.set(-Math.SQRT1_2, 0, 0, Math.SQRT1_2)
      group.current.quaternion.slerp(
        targetQuaternion.current,
        1 - Math.exp(-delta * 20),
      )
      group.current.position.y +=
        (TABLETOP_PHONE_CENTER_Y - group.current.position.y) *
        (1 - Math.exp(-delta * 12))
      return
    }

    const target = viewRotations[view]
    const time = state.clock.elapsedTime
    const idleYaw = animate && view === 'hero' ? Math.sin(time * 0.62) * 0.12 : 0
    const idlePitch = animate && view === 'hero' ? Math.sin(time * 0.45) * 0.035 : 0
    const easing = 1 - Math.exp(-delta * 5)

    group.current.rotation.x += (target[0] + idlePitch - group.current.rotation.x) * easing
    group.current.rotation.y += (target[1] + idleYaw - group.current.rotation.y) * easing
    const orientationRotation = orientation === 'landscape' ? Math.PI / 2 : 0
    group.current.rotation.z +=
      (target[2] + orientationRotation - group.current.rotation.z) * easing
    group.current.position.y =
      0.1 + (animate && view === 'hero' ? Math.sin(time * 0.8) * 0.025 : 0)
  })

  return (
    <group
      name="iphone-17-root"
      ref={group}
      rotation={[
        useTabletopStandard ? -Math.PI / 2 : viewRotations[view][0],
        useTabletopStandard ? 0 : viewRotations[view][1],
        useTabletopStandard
          ? 0
          : viewRotations[view][2] +
            (orientation === 'landscape' ? Math.PI / 2 : 0),
      ]}
      position={[0, useTabletopStandard ? TABLETOP_PHONE_CENTER_Y : 0.1, 0]}
    >
      {hasLocalAsset ? (
        <Suspense fallback={<ProceduralIPhone17Shell />}>
          <LocalIPhone17Asset />
          <ImportedBottomFace />
        </Suspense>
      ) : (
        <ProceduralIPhone17Shell />
      )}

      <ScreenSurface
        media={screenMedia}
        orientation={orientation}
        useImportedGeometry={hasLocalAsset}
      />
      <DynamicIslandSurface />

    </group>
  )
}

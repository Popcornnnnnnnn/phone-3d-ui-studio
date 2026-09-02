import { RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Group } from 'three'
import {
  IPHONE_17_SCENE,
  type ReviewView,
  type ScreenOrientation,
} from '../model/iphone17'
import type { ScreenMedia } from '../studio/screenMedia'
import { AppleMark } from './AppleMark'
import { PhoneShell } from './PhoneShell'
import { RearCameraSystem } from './RearCameraSystem'
import { ScreenSurface } from './ScreenSurface'

interface IPhone17ModelProps {
  accent: string
  animate: boolean
  view: ReviewView
  orientation: ScreenOrientation
  screenMedia: ScreenMedia | null
}

const viewRotations: Record<ReviewView, [number, number, number]> = {
  studio: [0.055, 0.08, -0.025],
  front: [0, 0, 0],
  back: [0, 0, 0],
}

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

function ScreenArtwork({
  accent,
  orientation,
}: {
  accent: string
  orientation: ScreenOrientation
}) {
  const landscape = orientation === 'landscape'

  return (
    <group
      name="demo-screen-content"
      position={[0, 0, 0.101]}
      rotation={[0, 0, landscape ? -Math.PI / 2 : 0]}
    >
      <RoundedBox
        args={landscape ? [2.46, 1.19, 0.008] : [1.19, 2.46, 0.008]}
        radius={0.105}
        smoothness={6}
      >
        <meshBasicMaterial color="#0e1118" toneMapped={false} />
      </RoundedBox>
      <RoundedBox
        args={landscape ? [0.92, 0.92, 0.008] : [1.02, 0.72, 0.008]}
        radius={0.075}
        smoothness={5}
        position={landscape ? [-0.64, 0, 0.008] : [0, 0.63, 0.008]}
      >
        <meshBasicMaterial color={accent} toneMapped={false} />
      </RoundedBox>
      <RoundedBox
        args={landscape ? [0.98, 0.4, 0.008] : [1.02, 0.42, 0.008]}
        radius={0.06}
        smoothness={5}
        position={landscape ? [0.55, 0.25, 0.008] : [0, -0.09, 0.008]}
      >
        <meshBasicMaterial color="#1b202b" toneMapped={false} />
      </RoundedBox>
      <RoundedBox
        args={landscape ? [0.46, 0.42, 0.008] : [0.48, 0.52, 0.008]}
        radius={0.06}
        smoothness={5}
        position={landscape ? [0.29, -0.28, 0.008] : [-0.27, -0.67, 0.008]}
      >
        <meshBasicMaterial color="#202633" toneMapped={false} />
      </RoundedBox>
      <RoundedBox
        args={landscape ? [0.46, 0.42, 0.008] : [0.48, 0.52, 0.008]}
        radius={0.06}
        smoothness={5}
        position={landscape ? [0.81, -0.28, 0.008] : [0.27, -0.67, 0.008]}
      >
        <meshBasicMaterial color="#171c25" toneMapped={false} />
      </RoundedBox>
    </group>
  )
}

export function IPhone17Model({
  accent,
  animate,
  view,
  orientation,
  screenMedia,
}: IPhone17ModelProps) {
  const group = useRef<Group>(null)
  const { height, depth } = IPHONE_17_SCENE

  useFrame((state, delta) => {
    if (!group.current) return

    const target = viewRotations[view]
    const time = state.clock.elapsedTime
    const idleYaw = animate && view === 'studio' ? Math.sin(time * 0.62) * 0.12 : 0
    const idlePitch = animate && view === 'studio' ? Math.sin(time * 0.45) * 0.035 : 0
    const easing = 1 - Math.exp(-delta * 5)

    group.current.rotation.x += (target[0] + idlePitch - group.current.rotation.x) * easing
    group.current.rotation.y += (target[1] + idleYaw - group.current.rotation.y) * easing
    const orientationRotation = orientation === 'landscape' ? Math.PI / 2 : 0
    group.current.rotation.z +=
      (target[2] + orientationRotation - group.current.rotation.z) * easing
    group.current.position.y =
      0.1 + (animate && view === 'studio' ? Math.sin(time * 0.8) * 0.025 : 0)
  })

  return (
    <group
      name="iphone-17-root"
      ref={group}
      rotation={[
        viewRotations[view][0],
        viewRotations[view][1],
        viewRotations[view][2] + (orientation === 'landscape' ? Math.PI / 2 : 0),
      ]}
      position={[0, 0.1, 0]}
    >
      <PhoneShell />

      <ScreenSurface media={screenMedia} orientation={orientation} />
      {!screenMedia && <ScreenArtwork accent={accent} orientation={orientation} />}

      <RoundedBox
        name="dynamic-island"
        args={[0.43, 0.115, 0.016]}
        radius={0.056}
        smoothness={8}
        position={[0, 1.18, depth / 2 + 0.035]}
      >
        <meshBasicMaterial color="#020305" toneMapped={false} />
      </RoundedBox>

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
    </group>
  )
}

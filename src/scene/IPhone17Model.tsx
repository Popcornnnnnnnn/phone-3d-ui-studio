import { RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Group } from 'three'
import {
  IPHONE_17_SCENE,
  type ReviewView,
  type ScreenOrientation,
} from '../model/iphone17'

interface IPhone17ModelProps {
  accent: string
  animate: boolean
  view: ReviewView
  orientation: ScreenOrientation
}

const viewRotations: Record<ReviewView, [number, number, number]> = {
  studio: [0.08, -0.3, -0.04],
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
      args={[0.025, height, 0.06]}
      radius={0.012}
      smoothness={4}
      position={[side * (IPHONE_17_SCENE.width / 2 + 0.011), y, 0]}
    >
      <meshStandardMaterial color="#16171a" metalness={0.88} roughness={0.24} />
    </RoundedBox>
  )
}

function RearLens({ name, y }: { name: string; y: number }) {
  const radius = IPHONE_17_SCENE.rearLensDiameter / 2

  return (
    <group name={name} position={[0.43, y, -0.142]} rotation={[Math.PI / 2, 0, 0]}>
      <mesh>
        <cylinderGeometry args={[radius * 1.08, radius * 1.08, 0.055, 64]} />
        <meshStandardMaterial color="#111216" metalness={0.92} roughness={0.19} />
      </mesh>
      <mesh position={[0, -0.031, 0]}>
        <cylinderGeometry args={[radius * 0.78, radius * 0.78, 0.012, 64]} />
        <meshPhysicalMaterial
          color="#05070b"
          metalness={0.35}
          roughness={0.08}
          clearcoat={1}
          clearcoatRoughness={0.08}
        />
      </mesh>
      <mesh position={[-radius * 0.2, -0.039, radius * 0.18]}>
        <sphereGeometry args={[radius * 0.13, 20, 20]} />
        <meshBasicMaterial color="#38506e" transparent opacity={0.72} />
      </mesh>
    </group>
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
}: IPhone17ModelProps) {
  const group = useRef<Group>(null)
  const { width, height, depth, glassWidth, glassHeight, displayWidth, displayHeight } =
    IPHONE_17_SCENE

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
      <RoundedBox name="body-frame" args={[width, height, depth]} radius={0.17} smoothness={10}>
        <meshPhysicalMaterial
          color="#18191c"
          metalness={0.86}
          roughness={0.27}
          clearcoat={0.32}
          clearcoatRoughness={0.2}
        />
      </RoundedBox>

      <RoundedBox
        name="front-glass"
        args={[glassWidth, glassHeight, 0.018]}
        radius={0.155}
        smoothness={10}
        position={[0, 0, depth / 2 + 0.005]}
      >
        <meshPhysicalMaterial
          color="#07090d"
          roughness={0.08}
          clearcoat={1}
          clearcoatRoughness={0.04}
        />
      </RoundedBox>

      <RoundedBox
        name="screen-mesh"
        args={[displayWidth, displayHeight, 0.012]}
        radius={0.135}
        smoothness={10}
        position={[0, 0, depth / 2 + 0.018]}
      >
        <meshBasicMaterial color="#0b0e14" toneMapped={false} />
      </RoundedBox>
      <ScreenArtwork accent={accent} orientation={orientation} />

      <RoundedBox
        name="dynamic-island"
        args={[0.43, 0.115, 0.016]}
        radius={0.056}
        smoothness={8}
        position={[0, 1.18, depth / 2 + 0.035]}
      >
        <meshBasicMaterial color="#020305" toneMapped={false} />
      </RoundedBox>

      <RoundedBox
        name="back-glass"
        args={[glassWidth, glassHeight, 0.018]}
        radius={0.155}
        smoothness={10}
        position={[0, 0, -depth / 2 - 0.005]}
      >
        <meshPhysicalMaterial color="#161719" roughness={0.34} clearcoat={0.28} />
      </RoundedBox>

      <RoundedBox
        name="camera-plate"
        args={[0.52, 0.88, 0.055]}
        radius={0.17}
        smoothness={10}
        position={[0.43, 0.91, -depth / 2 - 0.035]}
      >
        <meshPhysicalMaterial color="#1c1d20" roughness={0.3} clearcoat={0.45} />
      </RoundedBox>
      <RearLens name="rear-camera-main" y={1.08} />
      <RearLens name="rear-camera-ultrawide" y={0.74} />

      <mesh name="flash" position={[0.04, 0.98, -0.139]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.062, 0.062, 0.025, 40]} />
        <meshPhysicalMaterial color="#fff2c9" roughness={0.22} clearcoat={0.8} />
      </mesh>
      <mesh name="rear-microphone" position={[0.15, 0.83, -0.143]}>
        <sphereGeometry args={[0.018, 20, 20]} />
        <meshBasicMaterial color="#050609" />
      </mesh>

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

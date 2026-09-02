import { RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Group } from 'three'

interface PhonePlaceholderProps {
  accent: string
  animate: boolean
}

export function PhonePlaceholder({ accent, animate }: PhonePlaceholderProps) {
  const group = useRef<Group>(null)

  useFrame((state, delta) => {
    if (!group.current || !animate) return

    const targetY = Math.sin(state.clock.elapsedTime * 0.62) * 0.32 - 0.2
    group.current.rotation.y += (targetY - group.current.rotation.y) * delta * 1.8
    group.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.45) * 0.045
    group.current.position.y = 0.12 + Math.sin(state.clock.elapsedTime * 0.8) * 0.035
  })

  return (
    <group ref={group} rotation={[0.08, -0.2, -0.04]} position={[0, 0.12, 0]}>
      <RoundedBox args={[1.42, 2.9, 0.18]} radius={0.18} smoothness={8}>
        <meshStandardMaterial
          color="#22252c"
          metalness={0.78}
          roughness={0.28}
        />
      </RoundedBox>

      <RoundedBox
        name="screen-mesh"
        args={[1.31, 2.74, 0.018]}
        radius={0.145}
        smoothness={8}
        position={[0, 0, 0.101]}
      >
        <meshStandardMaterial color="#10141d" roughness={0.16} metalness={0.1} />
      </RoundedBox>

      <mesh position={[0, 0.02, 0.113]}>
        <planeGeometry args={[1.18, 2.42]} />
        <meshBasicMaterial color={accent} toneMapped={false} />
      </mesh>

      <RoundedBox
        args={[0.48, 0.12, 0.028]}
        radius={0.06}
        smoothness={6}
        position={[0, 1.18, 0.124]}
      >
        <meshBasicMaterial color="#090a0d" />
      </RoundedBox>

      <mesh position={[-0.48, 1.12, -0.12]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.15, 0.15, 0.035, 40]} />
        <meshStandardMaterial color="#08090c" metalness={0.8} roughness={0.2} />
      </mesh>
      <mesh position={[-0.48, 0.76, -0.12]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.15, 0.15, 0.035, 40]} />
        <meshStandardMaterial color="#08090c" metalness={0.8} roughness={0.2} />
      </mesh>
    </group>
  )
}

import { ContactShadows, OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import type { StudioPreset } from '../studio/presets'
import { PhonePlaceholder } from './PhonePlaceholder'

interface StudioSceneProps {
  preset: StudioPreset
  animate: boolean
}

export function StudioScene({ preset, animate }: StudioSceneProps) {
  return (
    <Canvas
      shadows="basic"
      dpr={[1, 2]}
      camera={{ position: [3.3, 1.8, 4.8], fov: 34, near: 0.1, far: 100 }}
      gl={{ antialias: true, alpha: false }}
    >
      <color attach="background" args={[preset.background]} />
      <fog attach="fog" args={[preset.background, 7, 15]} />
      <ambientLight intensity={0.28} />
      <directionalLight
        castShadow
        color="#ffffff"
        intensity={preset.keyLight}
        position={[3.5, 5.2, 3.8]}
        shadow-mapSize={[1024, 1024]}
      />
      <pointLight
        color={preset.accent}
        intensity={preset.fillLight}
        position={[-3.2, 1.4, 2.2]}
      />
      <PhonePlaceholder accent={preset.accent} animate={animate} />
      <ContactShadows
        position={[0, -1.58, 0]}
        opacity={0.52}
        scale={7}
        blur={2.5}
        far={4.5}
        color={preset.floor}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.6, 0]} receiveShadow>
        <planeGeometry args={[24, 24]} />
        <meshStandardMaterial color={preset.floor} roughness={0.86} />
      </mesh>
      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={3.1}
        maxDistance={7.5}
        minPolarAngle={0.72}
        maxPolarAngle={2.2}
        target={[0, 0.05, 0]}
      />
    </Canvas>
  )
}

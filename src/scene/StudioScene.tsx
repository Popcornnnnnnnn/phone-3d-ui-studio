import { ContactShadows, OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import type { ReviewView, ScreenOrientation } from '../model/iphone17'
import type { StudioPreset } from '../studio/presets'
import type { ScreenMedia } from '../studio/screenMedia'
import { IPhone17Model } from './IPhone17Model'

interface StudioSceneProps {
  preset: StudioPreset
  animate: boolean
  view: ReviewView
  orientation: ScreenOrientation
  screenMedia: ScreenMedia | null
}

const cameraPositions: Record<ReviewView, [number, number, number]> = {
  studio: [3.3, 1.8, 4.8],
  front: [0, 0.1, 5.4],
  back: [0, 0.1, -5.4],
}

function ReviewCamera({ view }: { view: ReviewView }) {
  const camera = useThree((state) => state.camera)

  useEffect(() => {
    camera.position.set(...cameraPositions[view])
    camera.lookAt(0, 0.05, 0)
    camera.updateProjectionMatrix()
  }, [camera, view])

  return null
}

export function StudioScene({
  preset,
  animate,
  view,
  orientation,
  screenMedia,
}: StudioSceneProps) {
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
        position={view === 'back' ? [-3.5, 5.2, -3.8] : [3.5, 5.2, 3.8]}
        shadow-mapSize={[1024, 1024]}
      />
      <pointLight
        color={preset.accent}
        intensity={preset.fillLight}
        position={[-3.2, 1.4, 2.2]}
      />
      {view === 'back' && (
        <pointLight color={preset.accent} intensity={0.7} position={[2.5, 0.8, -3]} />
      )}
      <ReviewCamera view={view} />
      <IPhone17Model
        accent={preset.accent}
        animate={animate}
        view={view}
        orientation={orientation}
        screenMedia={screenMedia}
      />
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
        enabled={view === 'studio'}
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

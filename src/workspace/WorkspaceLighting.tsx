import { Environment, Lightformer } from '@react-three/drei'
import { useAppearance } from '../appearance'

/** Studio rim + softbox reflection rig tuned to light or dark studio themes. */
export function WorkspaceLighting({ daylight }: { daylight?: boolean } = {}) {
  const { colorScheme } = useAppearance()
  const isLight = daylight ?? colorScheme === 'light'

  return <>
    <ambientLight intensity={isLight ? 0.85 : 0.36} />
    <hemisphereLight
      args={[isLight ? '#ffffff' : '#dce7ff', isLight ? '#c9ced8' : '#101622', isLight ? 0.88 : 0.58]}
    />
    <directionalLight position={[1.8, 2.8, 1.5]} intensity={isLight ? 1.95 : 2.0} color="#ffffff" />
    <directionalLight position={[-2.2, 0.55, -2.0]} intensity={isLight ? 0.55 : 0.7} color="#b8d4ff" />
    <Environment resolution={256}>
      <color attach="background" args={[isLight ? '#d8e0ec' : '#111724']} />
      <Lightformer
        form="circle"
        intensity={isLight ? 2.1 : 1.75}
        color="#ffffff"
        position={isLight ? [0.6, 3.6, 1.2] : [1.1, 3.8, 0.9]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={isLight ? [7.0, 7.0, 1] : [6.5, 6.5, 1]}
      />
      <Lightformer
        form="circle"
        intensity={isLight ? 1.7 : 1.85}
        color="#e0edff"
        position={[-3.8, 1.4, 1.4]}
        rotation={[0, Math.PI / 2, 0]}
        scale={[4.8, 5.4, 1]}
      />
      <Lightformer
        form="circle"
        intensity={isLight ? 1.5 : 1.65}
        color="#fff3e2"
        position={[3.8, 1.1, -1.6]}
        rotation={[0, -Math.PI / 2, 0]}
        scale={[4.8, 5.0, 1]}
      />
      <Lightformer
        form="circle"
        intensity={isLight ? 1.5 : 1.8}
        color="#b8d4ff"
        position={[-1.6, 2.4, -3.8]}
        scale={[5.2, 5.4, 1]}
      />
      <Lightformer
        form="circle"
        intensity={isLight ? 1.05 : 0.72}
        color="#9db2d1"
        position={[0, -2.8, 1.4]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[6.4, 4.4, 1]}
      />
    </Environment>
  </>
}

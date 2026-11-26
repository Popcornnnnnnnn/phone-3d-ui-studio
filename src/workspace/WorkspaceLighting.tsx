import { Environment, Lightformer } from '@react-three/drei'
import { useAppearance } from '../appearance'

/** Studio rim + softbox reflection rig tuned to light or dark studio themes. */
export function WorkspaceLighting({ daylight }: { daylight?: boolean } = {}) {
  const { colorScheme } = useAppearance()
  const isLight = daylight ?? colorScheme === 'light'

  return <>
    <ambientLight intensity={isLight ? 0.9 : 0.45} />
    <hemisphereLight
      args={[isLight ? '#ffffff' : '#dce7ff', isLight ? '#c9ced8' : '#11151f', isLight ? 0.95 : 0.7]}
    />
    <directionalLight position={[1.4, 2.4, 1.6]} intensity={isLight ? 2.1 : 2.3} color="#ffffff" />
    <directionalLight position={[-1.4, 0.8, -1.6]} intensity={isLight ? 1.0 : 1.55} color="#c2d9ff" />
    <Environment resolution={256}>
      <Lightformer
        form="rect"
        intensity={isLight ? 3.2 : 3.6}
        color="#ffffff"
        position={[0, 3.2, 0.8]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[4.2, 5.2, 1]}
      />
      <Lightformer
        form="rect"
        intensity={isLight ? 2.4 : 3.0}
        color="#e0edff"
        position={[-3.2, 1.1, 1.4]}
        rotation={[0, Math.PI / 2, 0]}
        scale={[2.2, 4.6, 1]}
      />
      <Lightformer
        form="rect"
        intensity={isLight ? 2.0 : 2.6}
        color="#fff3e2"
        position={[3.2, 0.8, -1.8]}
        rotation={[0, -Math.PI / 2, 0]}
        scale={[2.4, 4.2, 1]}
      />
      <Lightformer
        form="rect"
        intensity={isLight ? 2.1 : 2.8}
        color="#b8d4ff"
        position={[-1.5, 2.6, -3.2]}
        scale={[2.2, 4.8, 1]}
      />
      <Lightformer
        form="rect"
        intensity={isLight ? 1.3 : 1.0}
        color="#9db2d1"
        position={[0, -2.5, 1.5]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[5, 3, 1]}
      />
    </Environment>
  </>
}

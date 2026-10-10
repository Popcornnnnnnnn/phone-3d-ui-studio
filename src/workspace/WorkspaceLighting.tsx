import { Environment, Lightformer } from '@react-three/drei'

/** The same neutral studio reflection rig at either physical or display scale. */
export function WorkspaceLighting() {
  return <>
    <ambientLight intensity={1} />
    <hemisphereLight args={['#fff', '#c9ced8', 1]} />
    <directionalLight position={[1, 2, 1]} intensity={2.2} />
    <directionalLight position={[-1, 0.5, -1]} intensity={1} />
    <Environment resolution={256}>
      <Lightformer intensity={3} position={[0, 3, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[3, 5, 1]} />
      <Lightformer intensity={2} position={[-3, 1, 1]} rotation={[0, Math.PI / 2, 0]} scale={[2, 4, 1]} />
      <Lightformer intensity={1.5} position={[3, 0.5, -2]} rotation={[0, -Math.PI / 2, 0]} scale={[2, 3, 1]} />
      <Lightformer intensity={2} position={[-1.8, 3, -3]} scale={[1.25, 4.5, 1]} />
    </Environment>
  </>
}

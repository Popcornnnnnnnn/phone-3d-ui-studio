import { Environment, Lightformer } from '@react-three/drei'

/** The same neutral studio reflection rig at either physical or display scale. */
export function WorkspaceLighting({ daylight = true }: { daylight?: boolean } = {}) {
  return <>
    <ambientLight intensity={daylight ? 1.0 : 0.72} />
    <hemisphereLight args={[daylight ? '#ffffff' : '#dbe8ff', daylight ? '#c9ced8' : '#182233', daylight ? 1.0 : 0.85]} />
    <directionalLight position={[1.2, 2.2, 1.4]} intensity={daylight ? 2.2 : 1.95} />
    <directionalLight position={[-1.2, 0.6, -1.4]} intensity={daylight ? 1.1 : 1.35} />
    <Environment resolution={256}>
      <Lightformer form="rect" intensity={daylight ? 3.2 : 2.6} color="#ffffff" position={[0, 3.2, 0.8]} rotation={[Math.PI / 2, 0, 0]} scale={[4, 5, 1]} />
      <Lightformer form="rect" intensity={2.4} color="#e8f1ff" position={[-3.2, 1.1, 1.4]} rotation={[0, Math.PI / 2, 0]} scale={[2.2, 4.5, 1]} />
      <Lightformer form="rect" intensity={2.0} color="#fff6eb" position={[3.2, 0.8, -1.8]} rotation={[0, -Math.PI / 2, 0]} scale={[2.4, 4.0, 1]} />
      <Lightformer form="rect" intensity={2.2} color="#dce7f7" position={[-1.5, 2.6, -3.2]} scale={[2.0, 4.8, 1]} />
      <Lightformer form="rect" intensity={1.4} color="#cbd8ea" position={[0, -2.5, 1.5]} rotation={[-Math.PI / 2, 0, 0]} scale={[5, 3, 1]} />
    </Environment>
  </>
}

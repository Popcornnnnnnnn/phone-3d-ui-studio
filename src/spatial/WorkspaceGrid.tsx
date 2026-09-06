import { Grid } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { DoubleSide, type Mesh, type ShaderMaterial } from 'three'

/** World-anchored lines with camera-following coverage, rather than a finite board. */
export function WorkspaceGrid() {
  const grid = useRef<Mesh>(null)
  useFrame(({ camera, controls }) => {
    if (!grid.current) return
    const distance = controls && 'getDistance' in controls ? (controls.getDistance as () => number)() : camera.position.length()
    const material = grid.current.material as ShaderMaterial
    material.uniforms.fadeDistance.value = Math.max(5, distance * 12)
    // Keep 10 cm detail nearby; coarser decades stay legible when zoomed far out.
    const cell = 0.1 * 10 ** Math.max(0, Math.floor(Math.log10(Math.max(1, distance))))
    material.uniforms.cellSize.value = cell
    material.uniforms.sectionSize.value = cell * 10
    const far = Math.max(2000, distance * 100, Math.abs(camera.position.y) * 10)
    if (Math.abs(camera.far - far) > 1) { camera.far = far; camera.updateProjectionMatrix() }
  })
  return <Grid ref={grid} position={[0, 0.0001, 0]} args={[4, 4]} infiniteGrid followCamera
    cellSize={0.1} sectionSize={1} cellColor="#c2cdbd" sectionColor="#9ba99e"
    cellThickness={0.6} sectionThickness={0.9} fadeDistance={10} fadeStrength={1.5} side={DoubleSide} />
}

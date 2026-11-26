import { useAppearance, workspaceColors } from '../appearance'
import { Grid } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { DoubleSide, type Mesh, type ShaderMaterial } from 'three'

/** World-anchored studio lines with restrained architectural subtlety. */
export function WorkspaceGrid() {
  const grid = useRef<Mesh>(null)
  const { colorScheme } = useAppearance()
  const colors = workspaceColors[colorScheme]
  useFrame(({ camera, controls }) => {
    if (!grid.current) return
    const distance = controls && 'getDistance' in controls ? (controls.getDistance as () => number)() : camera.position.length()
    const material = grid.current.material as ShaderMaterial
    material.uniforms.fadeDistance.value = Math.max(2.8, distance * 7)
    const cell = 0.1 * 10 ** Math.max(0, Math.floor(Math.log10(Math.max(1, distance))))
    material.uniforms.cellSize.value = cell
    material.uniforms.sectionSize.value = cell * 10
    const far = Math.max(2000, distance * 100, Math.abs(camera.position.y) * 10)
    if (Math.abs(camera.far - far) > 1) { camera.far = far; camera.updateProjectionMatrix() }
  })
  return <Grid ref={grid} position={[0, 0.0001, 0]} args={[4, 4]} infiniteGrid followCamera
    cellSize={0.1} sectionSize={1} cellColor={colors.grid} sectionColor={colors.gridSection}
    cellThickness={0.35} sectionThickness={0.55} fadeDistance={4.5} fadeStrength={2.4} side={DoubleSide} />
}

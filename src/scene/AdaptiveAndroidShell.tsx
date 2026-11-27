import { RoundedBox } from '@react-three/drei'
import { useEffect, useMemo } from 'react'
import { ExtrudeGeometry } from 'three'
import {
  millimetersToScene,
  phoneFinish,
  type PhoneFinishId,
  type PhoneProfile,
} from '../../shared/phoneGeometry.mjs'
import {
  createRoundedRectangleGeometry,
  createRoundedRectangleShape,
} from '../model/roundedRectangle'

export function AdaptiveAndroidShell({
  profile,
  finishId,
}: {
  profile: PhoneProfile
  finishId: PhoneFinishId
}) {
  const finish = phoneFinish(finishId)
  const width = millimetersToScene(profile.bodyMm.width)
  const height = millimetersToScene(profile.bodyMm.height)
  const depth = millimetersToScene(profile.bodyMm.depth)
  const displayWidth = millimetersToScene(profile.displayMm.width)
  const displayHeight = millimetersToScene(profile.displayMm.height)

  const cornerRadius = Math.min(width, height) * 0.115
  const bevel = Math.min(depth * 0.14, 0.022)
  const frameDepth = Math.max(depth - bevel * 2, depth * 0.65)

  const geometries = useMemo(() => {
    const outerShape = createRoundedRectangleShape(width - bevel * 2, height - bevel * 2, cornerRadius)
    const chassis = new ExtrudeGeometry(outerShape, {
      depth: frameDepth,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 5,
      curveSegments: 24,
      steps: 1,
    })
    chassis.translate(0, 0, -frameDepth / 2)

    const backPlate = createRoundedRectangleGeometry(width * 0.91, height * 0.955, cornerRadius * 0.85, 24)
    const frontBezel = createRoundedRectangleGeometry(width * 0.976, height * 0.986, cornerRadius * 0.94, 24)
    const screenBacking = createRoundedRectangleGeometry(displayWidth, displayHeight, Math.min(width, height) * 0.100, 24)

    return { chassis, backPlate, frontBezel, screenBacking }
  }, [bevel, cornerRadius, displayHeight, displayWidth, frameDepth, height, width])

  useEffect(
    () => () => {
      geometries.chassis.dispose()
      geometries.backPlate.dispose()
      geometries.frontBezel.dispose()
      geometries.screenBacking.dispose()
    },
    [geometries],
  )

  const visorY = height * 0.305
  const visorZ = -depth / 2 - 0.018
  const lensPositions = [-width * 0.21, 0, width * 0.21]

  return (
    <group name="android-adaptive-shell">
      {/* Brushed aluminum unibody frame */}
      <mesh geometry={geometries.chassis} castShadow receiveShadow name="android-chassis">
        <meshPhysicalMaterial
          color={finish.frameHex}
          metalness={0.86}
          roughness={0.24}
          clearcoat={0.25}
          clearcoatRoughness={0.2}
          envMapIntensity={1.25}
        />
      </mesh>

      {/* Frosted glass rear plate */}
      <mesh
        geometry={geometries.backPlate}
        position={[0, 0, -depth / 2 - 0.0005]}
        rotation={[0, Math.PI, 0]}
        name="android-back-glass"
      >
        <meshPhysicalMaterial
          color={finish.backHex}
          metalness={0.08}
          roughness={0.34}
          clearcoat={0.4}
          clearcoatRoughness={0.18}
          envMapIntensity={1.0}
        />
      </mesh>

      {/* Front matte black glass bezel & dark screen backing */}
      <mesh geometry={geometries.frontBezel} position={[0, 0, depth / 2 + 0.0001]} name="android-front-bezel">
        <meshStandardMaterial color="#050608" roughness={0.22} metalness={0.05} />
      </mesh>
      <mesh geometry={geometries.screenBacking} position={[0, 0, depth / 2 + 0.0004]} name="android-screen-backing">
        <meshBasicMaterial color="#030406" />
      </mesh>

      {/* Punch-hole selfie camera (centered at top of screen) */}
      <mesh
        position={[0, displayHeight / 2 - 0.082, depth / 2 + 0.0014]}
        name="android-punch-hole"
      >
        <circleGeometry args={[0.028, 24]} />
        <meshBasicMaterial color="#020305" toneMapped={false} />
      </mesh>

      {/* Flagship horizontal rear camera visor */}
      <group position={[0, visorY, visorZ]} name="android-camera-visor">
        <RoundedBox
          args={[width * 0.88, 0.255, 0.044]}
          radius={0.055}
          smoothness={6}
          castShadow
        >
          <meshPhysicalMaterial
            color="#111419"
            metalness={0.78}
            roughness={0.22}
            clearcoat={0.45}
            envMapIntensity={1.25}
          />
        </RoundedBox>

        {lensPositions.map((lx, idx) => (
          <group key={idx} position={[lx, 0, -0.022]} rotation={[Math.PI / 2, 0, 0]}>
            <mesh>
              <cylinderGeometry args={[0.072, 0.076, 0.016, 28]} />
              <meshPhysicalMaterial
                color={finish.frameHex}
                metalness={0.9}
                roughness={0.18}
                envMapIntensity={1.3}
              />
            </mesh>
            <mesh position={[0, -0.009, 0]}>
              <cylinderGeometry args={[0.054, 0.054, 0.004, 24]} />
              <meshPhysicalMaterial
                color="#090d16"
                metalness={0.2}
                roughness={0.06}
                clearcoat={1}
                reflectivity={1}
              />
            </mesh>
          </group>
        ))}

        {/* LED flash dot */}
        <mesh position={[width * 0.34, 0.045, -0.023]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.022, 0.022, 0.004, 16]} />
          <meshStandardMaterial color="#f5ebd2" emissive="#2a2210" roughness={0.25} />
        </mesh>
      </group>

      {/* Side power & volume rocker buttons (right edge +X) */}
      <RoundedBox
        args={[0.022, 0.16, 0.055]}
        radius={0.01}
        smoothness={4}
        position={[width / 2 + 0.006, 0.42, 0]}
      >
        <meshStandardMaterial color={finish.buttonHex} metalness={0.9} roughness={0.22} />
      </RoundedBox>
      <RoundedBox
        args={[0.022, 0.34, 0.055]}
        radius={0.01}
        smoothness={4}
        position={[width / 2 + 0.006, 0.06, 0]}
      >
        <meshStandardMaterial color={finish.buttonHex} metalness={0.9} roughness={0.22} />
      </RoundedBox>

      {/* Bottom USB-C slot */}
      <RoundedBox
        args={[0.21, 0.018, 0.05]}
        radius={0.009}
        smoothness={4}
        position={[0, -height / 2 - 0.004, 0]}
      >
        <meshBasicMaterial color="#030407" />
      </RoundedBox>
    </group>
  )
}

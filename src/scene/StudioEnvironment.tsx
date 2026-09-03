import { Grid, Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BackSide, Color, type ShaderMaterial } from 'three'
import { STUDIO_FLOOR_Y } from '../model/iphone17'
import type { StudioPreset } from '../studio/presets'

interface StudioEnvironmentProps {
  preset: StudioPreset
  ambientMotion: boolean
  showGrid: boolean
  showAxes: boolean
  showShadows: boolean
}

const backdropVertexShader = /* glsl */ `
  varying vec3 vPosition;
  void main() {
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const backdropFragmentShader = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uBottom;
  uniform vec3 uAccent;
  uniform float uTime;
  uniform float uMotion;
  varying vec3 vPosition;

  void main() {
    float vertical = smoothstep(-9.0, 12.0, vPosition.y);
    vec3 base = mix(uBottom, uTop, vertical);
    float drift = uTime * 0.055 * uMotion;
    vec2 accentCenter = vec2(
      -3.5 + sin(drift * 0.73) * 4.0,
      1.5 + cos(drift * 0.57) * 2.3
    );
    float accentDistance = length(vPosition.xy - accentCenter);
    float accentGlow = 1.0 - smoothstep(3.0, 15.0, accentDistance);
    float softWave = sin(vPosition.x * 0.085 + drift) *
      cos(vPosition.y * 0.07 - drift * 0.8);
    float blend = 0.055 * accentGlow + 0.012 * softWave * uMotion;
    gl_FragColor = vec4(mix(base, uAccent, clamp(blend, 0.0, 0.08)), 1.0);
  }
`

const shadowVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const shadowFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    vec2 centered = (vUv - 0.5) * vec2(1.0, 1.55);
    float distanceFromCenter = length(centered);
    float alpha = (1.0 - smoothstep(0.08, 0.5, distanceFromCenter)) * uOpacity;
    gl_FragColor = vec4(uColor, alpha);
  }
`

function useReducedMotion() {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return reduced
}

function SeamlessBackdrop({
  preset,
  ambientMotion,
}: Pick<StudioEnvironmentProps, 'preset' | 'ambientMotion'>) {
  const materialRef = useRef<ShaderMaterial>(null)
  const reducedMotion = useReducedMotion()
  const autoPausedRef = useRef(false)
  const performanceRef = useRef({ elapsed: 0, frames: 0, lowWindows: 0 })
  const uniforms = useMemo(
    () => ({
      uTop: { value: new Color(preset.backgroundTop) },
      uBottom: { value: new Color(preset.backgroundBottom) },
      uAccent: { value: new Color(preset.backgroundAccent) },
      uTime: { value: 0 },
      uMotion: { value: 1 },
    }),
    [
      preset.backgroundAccent,
      preset.backgroundBottom,
      preset.backgroundTop,
    ],
  )

  useEffect(() => {
    if (ambientMotion) autoPausedRef.current = false
    performanceRef.current = { elapsed: 0, frames: 0, lowWindows: 0 }
  }, [ambientMotion])

  useFrame((state, delta) => {
    const material = materialRef.current
    if (!material) return

    const performance = performanceRef.current
    performance.elapsed += delta
    performance.frames += 1
    if (performance.elapsed >= 2) {
      const fps = performance.frames / performance.elapsed
      performance.lowWindows = fps < 40 ? performance.lowWindows + 1 : 0
      if (performance.lowWindows >= 2) autoPausedRef.current = true
      performance.elapsed = 0
      performance.frames = 0
    }

    const motionActive = ambientMotion && !reducedMotion && !autoPausedRef.current
    material.uniforms.uMotion.value = motionActive ? 1 : 0
    if (motionActive) material.uniforms.uTime.value = state.clock.elapsedTime
  })

  return (
    <mesh renderOrder={-10}>
      <sphereGeometry args={[30, 48, 32]} />
      <shaderMaterial
        ref={materialRef}
        side={BackSide}
        uniforms={uniforms}
        vertexShader={backdropVertexShader}
        fragmentShader={backdropFragmentShader}
        depthWrite={false}
      />
    </mesh>
  )
}

function SoftShadow({
  preset,
  opacity,
  scale,
  yOffset,
}: {
  preset: StudioPreset
  opacity: number
  scale: [number, number, number]
  yOffset: number
}) {
  const uniforms = useMemo(
    () => ({
      uColor: { value: new Color(preset.shadow) },
      uOpacity: { value: opacity },
    }),
    [opacity, preset.shadow],
  )

  return (
    <mesh
      position={[0, STUDIO_FLOOR_Y + yOffset, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={scale}
      renderOrder={-1}
    >
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        transparent
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={shadowVertexShader}
        fragmentShader={shadowFragmentShader}
      />
    </mesh>
  )
}

function SpatialGuides({
  showGrid,
  showAxes,
}: Pick<StudioEnvironmentProps, 'showGrid' | 'showAxes'>) {
  const guideY = STUDIO_FLOOR_Y + 0.014

  return (
    <>
      {showGrid && (
        <Grid
          position={[0, guideY, 0]}
          args={[12, 12]}
          cellColor="#9aa5ae"
          cellSize={0.25}
          cellThickness={0.42}
          fadeDistance={7}
          fadeStrength={1.6}
          infiniteGrid
          sectionColor="#788792"
          sectionSize={1}
          sectionThickness={0.7}
        />
      )}
      {showAxes && (
        <group position={[0, guideY + 0.006, 0]}>
          <Line color="#b78484" lineWidth={1.1} points={[[0, 0, 0], [1.1, 0, 0]]} />
          <Line color="#86a58e" lineWidth={1.1} points={[[0, 0, 0], [0, 1.1, 0]]} />
          <Line color="#8198ad" lineWidth={1.1} points={[[0, 0, 0], [0, 0, 1.1]]} />
        </group>
      )}
    </>
  )
}

export function StudioEnvironment(props: StudioEnvironmentProps) {
  return (
    <>
      <SeamlessBackdrop preset={props.preset} ambientMotion={props.ambientMotion} />
      {props.showShadows && (
        <>
          <SoftShadow
            preset={props.preset}
            opacity={0.035}
            scale={[2.8, 4.4, 1]}
            yOffset={0.004}
          />
          <SoftShadow
            preset={props.preset}
            opacity={0.075}
            scale={[1.65, 3.2, 1]}
            yOffset={0.008}
          />
        </>
      )}
      <SpatialGuides showGrid={props.showGrid} showAxes={props.showAxes} />
    </>
  )
}

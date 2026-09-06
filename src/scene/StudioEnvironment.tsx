import { Grid, Line, useTexture } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  Vector2,
  type ShaderMaterial,
} from 'three'
import { STUDIO_FLOOR_Y } from '../model/iphone17'
import type { StudioPreset } from '../studio/presets'
import {
  OBSERVATORY_STAR_COUNT,
  createObservatoryMeteorEvent,
  createObservatoryStarBufferData,
  type ObservatoryMeteorEvent,
} from './observatoryStarfield'

interface StudioEnvironmentProps {
  preset: StudioPreset
  ambientMotion: boolean
  interactingRef: RefObject<boolean>
  showGrid: boolean
  showAxes: boolean
  showShadows: boolean
}

interface EnvironmentMotionState {
  active: boolean
  autoPaused: boolean
  elapsed: number
  frames: number
  lowWindows: number
}

const DAYLIGHT_SKY_URL = '/daylight-sky-natural-v2.png'
const DAYLIGHT_SKY_ASPECT = 1672 / 941

const backdropVertexShader = /* glsl */ `
  varying vec3 vPosition;
  varying vec2 vScreenPosition;

  void main() {
    vPosition = position;
    vec4 clipPosition = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vScreenPosition = clipPosition.xy / max(clipPosition.w, 0.0001);
    gl_Position = clipPosition;
  }
`

const backdropFragmentShader = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uBottom;
  uniform vec3 uAccent;
  uniform float uTime;
  uniform float uMotion;
  uniform float uInteractionDim;
  uniform float uDaylight;
  uniform sampler2D uDaylightTexture;
  uniform float uViewportAspect;
  uniform float uDaylightTextureAspect;
  varying vec3 vPosition;
  varying vec2 vScreenPosition;

  void main() {
    // Keep the tonal structure pinned to the viewport. A world-space gradient
    // made the scene cross darker bands while the review camera orbited.
    float vertical = smoothstep(-0.95, 0.85, vScreenPosition.y);
    vec3 base = mix(uBottom, uTop, vertical);

    vec2 daylightUv = vScreenPosition * 0.5 + 0.5;
    if (uViewportAspect > uDaylightTextureAspect) {
      daylightUv.y = (daylightUv.y - 0.5) *
        (uDaylightTextureAspect / uViewportAspect) + 0.5;
    } else {
      daylightUv.x = (daylightUv.x - 0.5) *
        (uViewportAspect / uDaylightTextureAspect) + 0.5;
    }
    daylightUv.y = daylightUv.y * 0.94 + 0.035;

    // Move the photographic sky as one atmosphere. The source crop keeps
    // overscan around the frame, while altitude-based drift makes the cloud
    // bands visibly travel without repeating or mirroring the image.
    float daylightTime = uTime * uMotion;
    daylightUv.x = (daylightUv.x - 0.5) * 0.88 + 0.5;
    float skyDrift = sin(daylightTime * 0.18) * 0.07 +
      sin(daylightTime * 0.071 + 1.7) * 0.025;
    float altitudeParallax = mix(
      1.18,
      0.66,
      smoothstep(0.0, 1.0, daylightUv.y)
    );
    vec2 movingDaylightUv = daylightUv;
    movingDaylightUv.x += skyDrift * altitudeParallax;
    movingDaylightUv.y += cos(daylightTime * 0.13 + 0.6) * 0.018;
    vec3 daylightSky = texture2D(
      uDaylightTexture,
      clamp(movingDaylightUv, vec2(0.012), vec2(0.988))
    ).rgb;

    if (uDaylight > 0.5) {
      float lowerHaze = 1.0 - smoothstep(-0.76, 0.16, vScreenPosition.y);
      float hazeFlow = 0.5 + 0.5 * sin(
        vScreenPosition.x * 2.7 + daylightTime * 0.075 +
        sin(vScreenPosition.y * 2.1 - daylightTime * 0.038)
      );
      daylightSky = mix(
        daylightSky,
        vec3(0.78, 0.90, 0.985),
        lowerHaze * (0.008 + hazeFlow * 0.012) * uMotion
      );
    }
    base = mix(base, daylightSky, uDaylight);

    float drift = uTime * 0.035 * uMotion;
    vec2 accentCenter = vec2(
      -0.34 + sin(drift * 0.71) * 0.18,
      0.2 + cos(drift * 0.53) * 0.12
    );
    float accentDistance = length(vScreenPosition - accentCenter);
    float accentGlow = 1.0 - smoothstep(0.2, 1.42, accentDistance);

    vec2 glowPosition = (vScreenPosition - vec2(0.0, 0.015)) * vec2(0.72, 1.0);
    float phoneGlow = 1.0 - smoothstep(0.05, 0.94, length(glowPosition));
    phoneGlow *= phoneGlow;

    float softWave = sin(vScreenPosition.x * 2.2 + drift) *
      cos(vScreenPosition.y * 1.8 - drift * 0.8);
    float accentGlowStrength = mix(0.055, 0.008, uDaylight);
    float phoneGlowStrength = mix(0.15, 0.06, uDaylight);
    float waveStrength = mix(0.008, 0.0015, uDaylight);
    float accentBlend = accentGlowStrength * accentGlow +
      phoneGlowStrength * phoneGlow + waveStrength * softWave * uMotion;
    vec3 color = mix(base, uAccent, clamp(accentBlend, 0.0, 0.2));

    float vignette = smoothstep(
      0.58,
      1.28,
      length(vScreenPosition * vec2(0.78, 1.0))
    );
    float vignetteStrength = mix(0.20, 0.055, uDaylight);
    color *= 1.0 - vignette * vignetteStrength;
    gl_FragColor = vec4(color * uInteractionDim, 1.0);
    #include <colorspace_fragment>
  }
`

const starVertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aOpacity;
  attribute float aMode;
  attribute float aPeriod;
  attribute float aPhase;
  attribute vec2 aDrift;
  attribute float aTint;
  attribute float aKind;

  uniform vec2 uViewport;
  uniform float uPixelRatio;
  uniform float uTime;
  uniform float uMotion;
  uniform vec2 uMeteorOrigin;
  uniform vec2 uMeteorTravel;
  uniform float uMeteorProgress;
  uniform float uMeteorLength;
  uniform float uMeteorActive;

  varying float vOpacity;
  varying float vTint;
  varying float vKind;
  varying vec2 vMeteorDirection;

  void main() {
    vKind = aKind;
    vTint = aTint;

    if (aKind > 0.5) {
      if (uMeteorActive < 0.5) {
        vMeteorDirection = vec2(1.0, -1.0);
        vOpacity = 0.0;
        gl_Position = vec4(2.0, 2.0, 0.999, 1.0);
        gl_PointSize = 1.0;
        return;
      }
      vec2 meteorPosition = uMeteorOrigin + uMeteorTravel * uMeteorProgress;
      vec2 pixelDirection = uMeteorTravel * uViewport;
      vMeteorDirection = normalize(pixelDirection + vec2(0.0001));
      vOpacity = 1.0;
      gl_Position = vec4(meteorPosition, 0.999, 1.0);
      gl_PointSize = uMeteorLength * uPixelRatio;
      return;
    }

    float phase = (uTime / aPeriod) * 6.28318530718 + aPhase;
    vec2 pixelDrift = aDrift * vec2(sin(phase * 0.47), cos(phase * 0.39));
    vec2 ndcDrift = (pixelDrift * 2.0 / uViewport) * uMotion;
    float alpha = aOpacity;

    if (aMode > 0.5 && aMode < 1.5) {
      alpha *= mix(0.68, 1.0, sin(phase) * 0.5 + 0.5);
    } else if (aMode >= 1.5) {
      float flash = pow(max(0.0, sin(phase)), 8.0);
      alpha *= 0.7 + flash * 0.55;
    }

    vOpacity = clamp(alpha, 0.0, 1.0);
    vMeteorDirection = vec2(1.0, -1.0);
    gl_Position = vec4(position.xy + ndcDrift, 0.999, 1.0);
    gl_PointSize = max(1.0, aSize * uPixelRatio);
  }
`

const starFragmentShader = /* glsl */ `
  uniform float uMeteorActive;
  uniform float uMeteorOpacity;
  uniform float uMeteorProgress;
  uniform float uInteractionDim;
  uniform float uDaylight;

  varying float vOpacity;
  varying float vTint;
  varying float vKind;
  varying vec2 vMeteorDirection;

  void main() {
    if (vKind > 0.5) {
      vec2 point = gl_PointCoord - 0.5;
      point.y *= -1.0;
      vec2 direction = normalize(vMeteorDirection);
      float along = dot(point, direction);
      float across = abs(point.x * direction.y - point.y * direction.x);
      float segment = 1.0 - smoothstep(0.37, 0.48, abs(along));
      float core = 1.0 - smoothstep(0.004, 0.018, across);
      float glow = 1.0 - smoothstep(0.008, 0.054, across);
      float head = smoothstep(-0.42, 0.38, along);
      float envelope = sin(clamp(uMeteorProgress, 0.0, 1.0) * 3.14159265359);
      float meteor = clamp(segment * (core * (0.42 + 0.58 * head) + glow * 0.16), 0.0, 1.0);
      float alpha = meteor * envelope * uMeteorOpacity * uMeteorActive *
        uInteractionDim * (1.0 - uDaylight);
      if (alpha < 0.002) discard;
      gl_FragColor = vec4(mix(vec3(0.50, 0.72, 0.95), vec3(0.92, 0.98, 1.0), head), alpha);
      #include <colorspace_fragment>
      return;
    }

    float radius = length(gl_PointCoord - 0.5);
    float star = 1.0 - smoothstep(0.22, 0.5, radius);
    float atmosphereOpacity = 1.0 - uDaylight;
    float alpha = star * vOpacity * uInteractionDim * atmosphereOpacity;
    if (alpha < 0.01) discard;
    vec3 cool = vec3(0.50, 0.69, 0.92);
    vec3 white = vec3(0.92, 0.97, 1.0);
    gl_FragColor = vec4(mix(cool, white, 0.5 + vTint * 0.5), alpha);
    #include <colorspace_fragment>
  }
`

const footprintVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const footprintFragmentShader = /* glsl */ `
  uniform vec3 uShadow;
  uniform vec3 uReflection;
  varying vec2 vUv;

  void main() {
    vec2 point = vUv - 0.5;
    float broadDistance = length(point * vec2(1.0, 1.75));
    float coreDistance = length(point * vec2(1.0, 2.7));
    float broad = 1.0 - smoothstep(0.08, 0.5, broadDistance);
    float core = 1.0 - smoothstep(0.03, 0.28, coreDistance);

    vec2 reflectionPoint = (point - vec2(0.0, 0.09)) * vec2(1.0, 4.1);
    float reflection = 1.0 - smoothstep(0.02, 0.52, length(reflectionPoint));
    reflection *= smoothstep(-0.34, 0.08, point.y);

    float shadowAlpha = broad * 0.11 + core * 0.15;
    float reflectionAlpha = reflection * 0.045;
    float alpha = shadowAlpha + reflectionAlpha;
    vec3 color = mix(
      uShadow,
      uReflection,
      reflectionAlpha / max(alpha, 0.0001)
    );
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`

function useReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return reduced
}

function easedInteractionDim(
  current: number,
  interacting: boolean,
  delta: number,
  interactingValue = 0.75,
) {
  const target = interacting ? interactingValue : 1
  return current + (target - current) * (1 - Math.exp(-delta * 11))
}

function SeamlessBackdrop({
  preset,
  interactingRef,
  motionStateRef,
}: Pick<StudioEnvironmentProps, 'preset' | 'interactingRef'> & {
  motionStateRef: RefObject<EnvironmentMotionState>
}) {
  const materialRef = useRef<ShaderMaterial>(null)
  const daylightTexture = useTexture(DAYLIGHT_SKY_URL)
  const width = useThree((state) => state.size.width)
  const height = useThree((state) => state.size.height)

  const uniforms = useMemo(
    () => ({
      uTop: { value: new Color(preset.backgroundTop) },
      uBottom: { value: new Color(preset.backgroundBottom) },
      uAccent: { value: new Color(preset.backgroundAccent) },
      uTime: { value: 0 },
      uMotion: { value: 1 },
      uInteractionDim: { value: 1 },
      uDaylight: { value: preset.daylight ? 1 : 0 },
      uDaylightTexture: { value: daylightTexture },
      uViewportAspect: { value: width / Math.max(1, height) },
      uDaylightTextureAspect: { value: DAYLIGHT_SKY_ASPECT },
    }),
    [
      preset.backgroundAccent,
      preset.backgroundBottom,
      preset.backgroundTop,
      preset.daylight,
      daylightTexture,
      height,
      width,
    ],
  )

  useFrame((state, delta) => {
    const material = materialRef.current
    if (!material) return
    const motionActive = motionStateRef.current.active
    material.uniforms.uMotion.value = motionActive ? 1 : 0
    material.uniforms.uTime.value = motionActive ? state.clock.elapsedTime : 0
    material.uniforms.uInteractionDim.value = easedInteractionDim(
      material.uniforms.uInteractionDim.value,
      interactingRef.current,
      delta,
      1,
    )
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

function ObservatoryStarfield({
  preset,
  interactingRef,
  motionStateRef,
}: Pick<StudioEnvironmentProps, 'preset' | 'interactingRef'> & {
  motionStateRef: RefObject<EnvironmentMotionState>
}) {
  const materialRef = useRef<ShaderMaterial>(null)
  const width = useThree((state) => state.size.width)
  const height = useThree((state) => state.size.height)
  const pixelRatio = useThree((state) => state.viewport.dpr)
  const geometry = useMemo(() => {
    const field = createObservatoryStarBufferData()
    const nextGeometry = new BufferGeometry()
    nextGeometry.setAttribute('position', new BufferAttribute(field.positions, 3))
    nextGeometry.setAttribute('aSize', new BufferAttribute(field.sizes, 1))
    nextGeometry.setAttribute('aOpacity', new BufferAttribute(field.opacities, 1))
    nextGeometry.setAttribute('aMode', new BufferAttribute(field.modes, 1))
    nextGeometry.setAttribute('aPeriod', new BufferAttribute(field.periods, 1))
    nextGeometry.setAttribute('aPhase', new BufferAttribute(field.phases, 1))
    nextGeometry.setAttribute('aDrift', new BufferAttribute(field.drift, 2))
    nextGeometry.setAttribute('aTint', new BufferAttribute(field.tints, 1))
    nextGeometry.setAttribute('aKind', new BufferAttribute(field.kinds, 1))
    return nextGeometry
  }, [])
  const uniforms = useMemo(
    () => ({
      uViewport: { value: new Vector2(width, height) },
      uPixelRatio: { value: pixelRatio },
      uTime: { value: 0 },
      uMotion: { value: 1 },
      uInteractionDim: { value: 1 },
      uMeteorActive: { value: 0 },
      uMeteorOrigin: { value: new Vector2() },
      uMeteorTravel: { value: new Vector2(0.1, -0.1) },
      uMeteorProgress: { value: 0 },
      uMeteorLength: { value: 60 },
      uMeteorOpacity: { value: 0.45 },
      uDaylight: { value: preset.daylight ? 1 : 0 },
    }),
    [height, pixelRatio, preset.daylight, width],
  )
  const scheduleRef = useRef<{
    current: ObservatoryMeteorEvent | null
    startedAt: number
    nextAt: number
    wasMotionActive: boolean
  }>({
    current: null,
    startedAt: 0,
    nextAt: Number.POSITIVE_INFINITY,
    wasMotionActive: false,
  })

  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame((state, delta) => {
    const material = materialRef.current
    if (!material) return

    const time = state.clock.elapsedTime
    const motionActive = motionStateRef.current.active
    const schedule = scheduleRef.current
    material.uniforms.uMotion.value = motionActive ? 1 : 0
    material.uniforms.uTime.value = motionActive ? time : 0
    material.uniforms.uInteractionDim.value = easedInteractionDim(
      material.uniforms.uInteractionDim.value,
      interactingRef.current,
      delta,
      1,
    )

    if (!motionActive) {
      schedule.wasMotionActive = false
      schedule.current = null
      material.uniforms.uMeteorActive.value = 0
      return
    }

    if (!schedule.wasMotionActive) {
      schedule.wasMotionActive = true
      schedule.nextAt = time + createObservatoryMeteorEvent().delaySeconds
    }

    if (!schedule.current && time >= schedule.nextAt) {
      schedule.current = createObservatoryMeteorEvent()
      schedule.startedAt = time
      material.uniforms.uMeteorOrigin.value.set(...schedule.current.origin)
      material.uniforms.uMeteorTravel.value.set(...schedule.current.travel)
      material.uniforms.uMeteorLength.value = schedule.current.lengthPx
      material.uniforms.uMeteorOpacity.value = schedule.current.peakOpacity
    }

    if (!schedule.current) {
      material.uniforms.uMeteorActive.value = 0
      return
    }

    const progress =
      (time - schedule.startedAt) / schedule.current.durationSeconds
    if (progress >= 1) {
      const nextMeteor = createObservatoryMeteorEvent()
      schedule.current = null
      schedule.nextAt = time + nextMeteor.delaySeconds
      material.uniforms.uMeteorActive.value = 0
      return
    }

    material.uniforms.uMeteorProgress.value = Math.max(0, progress)
    material.uniforms.uMeteorActive.value = 1
  })

  return (
    <points
      geometry={geometry}
      frustumCulled={false}
      renderOrder={-9}
      userData={{
        observatoryDrawCalls: 1,
        starCount: OBSERVATORY_STAR_COUNT,
      }}
    >
      <shaderMaterial
        ref={materialRef}
        transparent
        depthTest
        depthWrite={false}
        blending={AdditiveBlending}
        toneMapped={false}
        uniforms={uniforms}
        vertexShader={starVertexShader}
        fragmentShader={starFragmentShader}
      />
    </points>
  )
}

function StudioFootprint({ preset }: { preset: StudioPreset }) {
  const uniforms = useMemo(
    () => ({
      uShadow: { value: new Color(preset.shadow) },
      uReflection: { value: new Color(preset.fillColor) },
    }),
    [preset.fillColor, preset.shadow],
  )

  return (
    <mesh
      position={[0, STUDIO_FLOOR_Y + 0.006, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={[3.05, 4.3, 1]}
      renderOrder={-1}
    >
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        transparent
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={footprintVertexShader}
        fragmentShader={footprintFragmentShader}
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
          cellColor="#62758a"
          cellSize={0.25}
          cellThickness={0.36}
          fadeDistance={7}
          fadeStrength={1.75}
          infiniteGrid
          sectionColor="#7892aa"
          sectionSize={1}
          sectionThickness={0.58}
        />
      )}
      {showAxes && (
        <group position={[0, guideY + 0.006, 0]}>
          <Line color="#a26f78" lineWidth={1.1} points={[[0, 0, 0], [1.1, 0, 0]]} />
          <Line color="#6f9984" lineWidth={1.1} points={[[0, 0, 0], [0, 1.1, 0]]} />
          <Line color="#6f8fae" lineWidth={1.1} points={[[0, 0, 0], [0, 0, 1.1]]} />
        </group>
      )}
    </>
  )
}

export function StudioEnvironment(props: StudioEnvironmentProps) {
  const reducedMotion = useReducedMotion()
  const motionStateRef = useRef<EnvironmentMotionState>({
    active: props.ambientMotion && !reducedMotion,
    autoPaused: false,
    elapsed: 0,
    frames: 0,
    lowWindows: 0,
  })

  useEffect(() => {
    const motion = motionStateRef.current
    motion.autoPaused = false
    motion.elapsed = 0
    motion.frames = 0
    motion.lowWindows = 0
    motion.active = props.ambientMotion && !reducedMotion
  }, [props.ambientMotion, reducedMotion])

  useFrame((_, delta) => {
    const motion = motionStateRef.current
    if (!props.ambientMotion || reducedMotion) {
      motion.active = false
      return
    }

    motion.elapsed += delta
    motion.frames += 1
    if (motion.elapsed >= 2) {
      const fps = motion.frames / motion.elapsed
      motion.lowWindows = fps < 40 ? motion.lowWindows + 1 : 0
      if (motion.lowWindows >= 2) motion.autoPaused = true
      motion.elapsed = 0
      motion.frames = 0
    }
    motion.active = !motion.autoPaused
  })

  return (
    <>
      <SeamlessBackdrop
        preset={props.preset}
        interactingRef={props.interactingRef}
        motionStateRef={motionStateRef}
      />
      <ObservatoryStarfield
        preset={props.preset}
        interactingRef={props.interactingRef}
        motionStateRef={motionStateRef}
      />
      {props.showShadows && <StudioFootprint preset={props.preset} />}
      <SpatialGuides showGrid={props.showGrid} showAxes={props.showAxes} />
    </>
  )
}

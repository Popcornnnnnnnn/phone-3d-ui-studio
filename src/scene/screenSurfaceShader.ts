import { MIN_SCREEN_VIEW_BRIGHTNESS } from './screenAppearance'

// Shared by the live material and the deterministic browser quality probe.
export const screenVertexShader = /* glsl */ `
  varying vec2 vScreenUv;
  varying float vViewFacing;

  void main() {
    vScreenUv = uv;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vec3 viewNormal = normalize(normalMatrix * normal);
    vec3 viewDirection = normalize(-viewPosition.xyz);
    vViewFacing = abs(dot(viewNormal, viewDirection));
    gl_Position = projectionMatrix * viewPosition;
  }
`

export const screenFragmentShader = /* glsl */ `
  uniform sampler2D screenTexture;
  uniform vec2 contentScale;
  uniform float decodeVideoTexture;
  uniform float landscape;
  varying vec2 vScreenUv;
  varying float vViewFacing;

  void main() {
    vec2 displayUv = landscape > 0.5
      ? vec2(1.0 - vScreenUv.y, vScreenUv.x)
      : vScreenUv;
    vec2 sourceUv = (displayUv - vec2(0.5)) / contentScale + vec2(0.5);
    bool outside = sourceUv.x < 0.0 || sourceUv.x > 1.0
      || sourceUv.y < 0.0 || sourceUv.y > 1.0;

    vec4 screenColor = texture2D(screenTexture, sourceUv);
    if (decodeVideoTexture > 0.5) {
      // Three.js uploads VideoTexture sources as linear RGBA and applies this
      // decode in its built-in materials. Custom shaders must mirror it.
      screenColor = sRGBTransferEOTF(screenColor);
    }

    // An OLED display remains emissive, but a small view-angle response keeps
    // it visually attached to the changing highlights on the glass and frame.
    float viewBrightness = mix(
      ${MIN_SCREEN_VIEW_BRIGHTNESS.toFixed(2)},
      1.0,
      smoothstep(0.0, 1.0, clamp(vViewFacing, 0.0, 1.0))
    );
    screenColor.rgb *= viewBrightness;

    gl_FragColor = outside
      ? vec4(0.004, 0.006, 0.01, 1.0)
      : screenColor;

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

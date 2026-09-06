# Day and night scene audit

## Audit scope

- Surface: Phone 3D UI Studio scene selector and 3D viewport.
- User goal: switch cleanly between a coordinated daytime atmosphere and the existing successful black night atmosphere.
- Capture state: Live iPhone, Hero view, Ambient motion on, 1280 x 720 browser viewport.
- Comparison evidence: `design-evidence/audit-day-vs-night.jpg`.
- Current angle audit evidence: `design-evidence/audit-evening-01-night-hero-before.png`, `design-evidence/audit-evening-02-night-back-before.png`, `design-evidence/audit-edge-01-daylight-back-before.png`, and `design-evidence/audit-edge-03-daylight-turned-before.png`.
- Naturalness audit evidence: `design-evidence/audit-daylight-natural-03-current-before.png` and `design-evidence/final-daylight-natural-before-after-comparison.jpg`.

## Steps

1. Daylight — needs work
   - Evidence: `design-evidence/audit-01-daylight-hero.png`.
   - Strength: the scene is immediately recognizable as daytime and the black phone remains readable.
   - Risk: most of the lower canvas is compressed into nearly the same pale value. The blue sky loses depth and the phone feels pasted onto a bright card instead of suspended in an atmosphere.
   - Risk: broad clouds, a faster ribbon, haze, and the sun cycle move at unrelated speeds and in opposing directions. Each effect is individually plausible, but together they do not describe one coherent wind or light source.
   - Risk: the very bright cloud mass and live phone screen compete for attention. The background's moving luminance also makes the phone lighting feel disconnected from the sky.
   - Risk: the white center glow behind the phone removes the natural blue separation that would give the scene depth.
   - Naturalness root cause: the base image contains a blown-out white field and radial cirrus that converge on the phone. Two derived cloud assets then repeat mirrored cloud and sun structures at unrelated scales, so the result reads as composited effects rather than one sky.
   - Motion follow-up: the first natural single-sky pass changed only 1.37% of sampled background pixels by six RGB levels over three seconds, so its movement was technically present but practically invisible.
   - Recommendation: replace the stack with one evenly exposed photographic sky that has no visible sun or horizon, keep its center calm, and animate that single atmosphere with a bounded slow drift.

2. Carbon night — healthy
   - Evidence: `design-evidence/audit-02-night-hero.png`.
   - Strength: the sparse stars, dark value range, central falloff, and restrained accent light establish a clear hierarchy. The screen is the brightest object and the phone feels embedded in the scene.
   - Strength: motion supports the atmosphere without causing the whole background luminance to fluctuate.
   - Recommendation: preserve this preset's visual and motion behavior.

3. Deep blue — redundant
   - Evidence: `design-evidence/audit-03-deep-blue-hero.png`.
   - Risk: it is a second night-like choice rather than a distinct user goal. Three studio presets obscure the simpler Day / Night model the product now needs.
   - Recommendation: remove this option and rename Carbon to Night.

4. Back view — needs work in both modes
   - Evidence: `design-evidence/back-audit-daylight.png` and `design-evidence/back-audit-night.png`.
   - Risk: the main softbox remains biased toward the front face while the Back camera looks at the negative-Z side. The rear shell therefore receives mostly weak ambient and rim light.
   - Risk: the near-black, narrow-highlight Logo material collapses into a silhouette even in Daylight; in Night it is nearly indistinguishable from the rear glass.
   - Recommendation: add a Back-only broad softbox and cool edge fill, then use a brighter graphite metallic Logo response. Keep these changes local to the phone so the successful Night background is not lifted.

5. Night rotation and Daylight silhouette — needs work
   - Evidence: `design-evidence/audit-evening-01-night-hero-before.png`, `design-evidence/audit-evening-02-night-back-before.png`, and `design-evidence/audit-edge-03-daylight-turned-before.png`.
   - Risk: Night uses a world-space vertical gradient, so orbiting the camera samples a different tonal band. The interaction path also deliberately multiplies Night by 0.75, producing a visible brightness drop while dragging.
   - Risk: the default latency Canvas disables multisample antialiasing. The defect is easy to miss against the former near-black background but reads as a soft, broken fringe against the bright Daylight sky.
   - Recommendation: move the environment's major tonal structure to screen space, remove interaction dimming, lift Night into a blue-hour evening palette, and enable MSAA while retaining the fixed DPR and disabled shadow cost of latency mode.

## Highest-impact changes

1. Return the daylight sky's blue midtones and reduce the white cloud/haze coverage.
2. Make all daylight cloud layers travel in the same direction, using speed differences only for depth.
3. Remove the bright white phone-centered glow; replace it with a restrained sky-blue atmosphere so the phone belongs in the scene.
4. Slow and narrow the sun variation so cloud motion, rather than global brightness pulsing, carries the animation.
5. Present exactly two modes: Daylight and Night. Keep the current Carbon night rendering unchanged.
6. Give Back view its own mode-aware fill and a readable metallic Logo, without brightening either environment.
7. Keep the evening gradient and accent in screen space so orbiting changes the phone angle, not the background exposure.
8. Enable lightweight multisample antialiasing in the default fixed-DPR renderer so the device silhouette stays clean against Daylight.
9. Replace the repeated Daylight layers and artificial sun pulse with one generated natural-sky plate, then use only subtle whole-sky drift and low-amplitude lower-atmosphere variation.

## Accessibility risks and evidence limits

- The visible Ambient motion control provides a direct motion-off option, and the implementation also responds to the system reduced-motion preference.
- Screenshots cannot verify keyboard order, screen-reader announcements, or motion sensitivity over a long session. Those require interaction and assistive-technology testing.
- No text contrast regression was observed in the inspector; the audit is scoped to the scene selector and viewport rather than full-product accessibility compliance.

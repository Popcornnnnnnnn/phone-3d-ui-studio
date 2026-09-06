# Daylight and Night scene design QA

## Comparison target

- Source visual truth: `design-evidence/audit-02-night-hero.png` for the successful night hierarchy, `design-evidence/audit-daylight-natural-03-current-before.png` for the latest Daylight defect, and `design-audit.md` for the diagnosed coordination requirements.
- Final Daylight asset: `public/daylight-sky-natural-v2.png` (1672 x 941 px), generated as a realistic late-morning sky with no sun, horizon, symmetry, or blown highlights.
- Normalized source crop: `design-evidence/daylight-source-canvas-crop.jpg` (928 x 644 px).
- Implementation captures: `design-evidence/final-01-daylight-t0.png`, `design-evidence/final-02-daylight-tplus3.png`, `design-evidence/final-03-night.png`, `design-evidence/final-04-daylight-back.png`, and `design-evidence/final-05-night-back.png` (1280 x 720 px each).
- Combined full-view evidence: `design-evidence/final-day-night-comparison.jpg`.
- Before/after/reference evidence: `design-evidence/final-before-day-after-day-night-comparison.jpg`.
- Back readability evidence: `design-evidence/final-back-before-after-comparison.jpg`.
- Evening stability evidence: `design-evidence/final-evening-01-hero.png`, `design-evidence/final-evening-02-turned.png`, `design-evidence/final-evening-03-back.png`, and `design-evidence/final-evening-before-after-comparison.jpg`.
- Daylight edge evidence: `design-evidence/final-edge-01-daylight-turned.png`, `design-evidence/final-edge-02-daylight-back.png`, and `design-evidence/final-edge-before-after-comparison.jpg`.
- Naturalness evidence: `design-evidence/final-daylight-natural-01-after.png`, `design-evidence/final-daylight-natural-05-night-regression.png`, and `design-evidence/final-daylight-natural-before-after-comparison.jpg`.
- Motion evidence: `design-evidence/motion-audit-before-top-t0.png`, `design-evidence/motion-audit-before-top-tplus3.png`, `design-evidence/motion-after-v2-t0.png`, `design-evidence/motion-after-v2-tplus3.png`, `design-evidence/motion-before-after-v2-3s-comparison.jpg`, `design-evidence/motion-paused-t0.png`, and `design-evidence/motion-paused-tplus3.png`.
- Browser viewport: 1280 x 720 CSS px at device pixel ratio 2. The browser capture is normalized to 1280 x 720 output pixels; the WebGL canvas occupies 928 x 644 CSS px.
- Density normalization: the 1672 x 941 source was center-cropped and downsampled to the 928 x 644 canvas target before the focused comparison.
- State: Daylight and Night modes, Ambient motion on, Hero view. The second Daylight capture was taken three seconds after the first.

## Findings

- No actionable P0, P1, or P2 issues remain.
- Fonts and typography: unchanged by this background-only revision; labels retain their existing family, weight, spacing, hierarchy, and wrapping.
- Spacing and layout rhythm: the scene selector now uses two equal columns, matching the binary Daylight / Night mental model. The canvas, phone placement, control rail, margins, and review controls remain unchanged.
- Colors and visual tokens: Daylight restores blue midtones behind the phone, uses a warm key and cool fill, and removes the broad white center glow that previously flattened the scene. Night retains the former Carbon palette and light values.
- Phone readability: Back view now has a broad mode-aware rear softbox, a restrained cool edge fill, and a slightly higher ambient floor. These lights affect the model only; Daylight and Night backgrounds keep their established value ranges. The Logo uses a wider, brighter graphite-metal response instead of collapsing to black.
- Image quality and asset fidelity: Daylight now uses one purpose-built photographic sky plate with even blue exposure, asymmetric sparse cirrus, clean central negative space, and no visible sun or horizon. Cover-style cropping is preserved without stretching; the former mirrored cloud and ribbon overlays are no longer loaded or rendered.
- Copy and content: the ambiguous `Studio preset` heading is now `Scene mode`; the two choices are `Daylight` and `Night`. The redundant `Deep blue` option is removed.
- Interaction and motion: the photographic sky moves as one bounded atmosphere, with altitude-dependent horizontal drift and a smaller vertical component. In matched three-second background samples, pixels changing by at least six RGB levels rose from 1.37% before the motion correction to 12.41% after it; the maximum-channel mean difference rose from 1.03 to 2.70. Clouds now travel perceptibly without duplicated formations or global exposure pulsing. With Ambient motion off, the same three-second measurement is exactly 0.00%, confirming the control still pauses the environment.
- Angle stability: Night no longer drops to 75% brightness during pointer interaction, and its major gradient, accent, wave, vignette, and phone glow are screen-space stable. Four unobstructed background patches average 51.0 luma both before and after an orbit, so rotating the phone no longer changes scene exposure.
- Edge quality: the default fixed-DPR latency Canvas now keeps multisample antialiasing enabled while shadows remain disabled. Daylight's high-contrast phone silhouette no longer breaks into the fuzzy stair-step fringe visible in the audit capture.
- Occlusion: all daylight motion remains on the environment sphere behind the 3D phone, so clouds and haze do not render through the device.
- Console: no new errors. The existing Three.js `Clock` deprecation warning remains unrelated to this revision.

## Comparison history

- Initial P1: the first daylight revision lacked perceptible motion.
- Second P1: increasing the motion by stacking opposing cloud layers, a fast ribbon, haze, and a strong sun cycle created obvious movement but made the scene visually uncoordinated and washed out.
- Third P1: the former Night palette averaged only 7.9 luma across unobstructed background samples and dimmed to 75% during orbit interaction, while its world-space gradient shifted as the camera moved.
- Fourth P2: disabling antialiasing in the default latency Canvas left the device edge visibly broken against Daylight's bright sky.
- Fifth P1: even after the coordination pass, the bright radial base image plus mirrored cloud and ribbon overlays still made Daylight look composited and artificial.
- Sixth P1: the first single-sky implementation was natural in a still frame but moved too slowly to be perceptible during normal viewing; only 1.37% of sampled background pixels changed by six RGB levels over three seconds.
- Final fix: replaced all three Daylight image layers with one evenly exposed natural sky, removed the artificial sun pulse, retained a clearly perceptible bounded whole-sky drift and minimal lower haze, reduced Daylight vignette/glow energy, removed Deep blue, and renamed Carbon to Night without changing its visual values. A separate Back-only lighting pass restores rear-shell, camera, and Logo legibility in both modes.
- Motion fix: increased the single sky plate's bounded travel, added stronger altitude-based parallax, preserved overscan to prevent edge smearing, and added a smaller vertical drift. The revised three-second pair reaches 12.41% of sampled pixels changing by six RGB levels while the paused pair remains pixel-identical.
- Post-fix evidence: the Daylight captures three seconds apart retain clear movement while keeping a stable blue value structure. The final Daylight / Night comparison shows two distinct, balanced modes with consistent control layout and phone hierarchy.
- Back-view evidence: the rear-shell sample rose from 25.9 to 28.9 luma in Night and 40.9 to 45.4 in Daylight, while the Logo region rose from 5.6 to 67.4 and 8.7 to 79.8 respectively. This makes the branding readable without flattening the black finish.
- Evening post-fix evidence: the Night scene is now a readable blue-hour gradient with stars, not a near-black deep-night field. Its background patch average remains 51.0 luma across the captured Hero and rotated states.
- Daylight post-fix evidence: the before/after comparison removes the blown white field, radial convergence, and repeated cloud structures while keeping a real sky and readable black phone. The motion pair confirms a coherent drift, and the Night regression capture confirms the brighter blue-hour mode is unchanged.

## Open questions

- None blocking. The external live-screen connection changed between some audit captures; this affects only the phone screen content and is not used to judge the environment balance.

## Implementation checklist

- [x] Replace the overexposed repeated sky stack with one natural photographic plate and preserve cover cropping.
- [x] Keep daylight motion visible but directionally coherent.
- [x] Restore blue midtones and reduce white haze coverage.
- [x] Keep the phone in front of all environmental effects.
- [x] Respect Ambient motion and reduced-motion settings.
- [x] Verify Hero and Front views.
- [x] Present exactly two modes: Daylight and Night.
- [x] Preserve the former Carbon night rendering.
- [x] Verify Back view and Logo readability in both modes.
- [x] Remove interaction-driven Night dimming and world-space exposure shifts.
- [x] Lift Night into a stable blue-hour evening palette.
- [x] Verify Daylight edges with default-renderer antialiasing enabled.
- [x] Check browser console and complete the repository check suite.

## Follow-up polish

- No P3 polish is required for this coordination correction.

final result: passed

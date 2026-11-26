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

## 2026-09-22 — Native Mac preview

Scope: native SwiftUI window and connection sheet, embedded Web workspace,
runtime ownership, iPhone pairing configuration, and device geometry profiles.
Applied the explicitly requested Mac UI System in use mode: the SwiftUI macOS
App Template resource plus the English-language, adaptive appearance, hover
feedback, and shared-layout contracts. No central Gallery records were changed.

Observed defects and fixes:

- The first connection sheet truncated manual connection guidance. Moved it to
  a full-width wrapping row; inspected the complete instruction in the live
  light and dark sheets.
- The first desktop layout scrolled the entire scene while reaching controls.
  The final layout keeps the scene in place with a separately scrolling
  inspector. Verified at the default window and the system-tiled minimum
  window (980-point width, 680-point content-height constraint), in both themes.
- The procedural iPhone 17's opaque front glass sat in front of its screen.
  Lowered the glass below the existing authoritative screen plane. The same
  packaged app, without private GLBs, now visibly renders the green screen
  and projected ball. iPhone 16 Plus's simplified profile was also rendered
  with synthetic input.
- WKWebView's separate native fullscreen window emitted a hidden event on
  exit and paused the round. The Mac preview now uses an in-window Expand
  view action. Confirmed Expand, Esc, and return to the inspector keep the
  synthetic round live. The browser entry retains native fullscreen support.

Validation:

- `npm run check`: 412 tests in 41 files, lint, TypeScript and production build
  passed. The pre-existing large-chunk warning remains. The final viewport
  adjustment also passed scoped lint, typecheck and the packaged build.
- iPhone: 59 Swift tests and an unsigned physical-device SDK build passed.
  No device install or account/provisioning change was performed.
- `npm run app:smoke`: two independently running bundled sessions served their
  assets with no Homebrew/Node on PATH. EOF and SIGTERM closed every owned
  port; stopping one session left the other usable. Private GLBs were absent.
- Ad-hoc application signature verified. The bundled official Node binary
  links only system libraries, with no Homebrew dependencies.
- Live native UI: English Settings opened with Command-comma; Light, Dark,
  and System took effect. Dark persisted across a quit/relaunch. In the
  foreground theme-switch check, world ID, epoch, active ball ID, phone
  connection ID, and running phase were identical before and after switching.
  Existing background/hidden-window pause behavior is retained.
- Native QR sheet, visible controls and focus states, inspector scrolling,
  Expand/Esc, window resizing, and Restart Local Session were exercised.
  The synthetic producer was stopped, preferences restored to System, and
  the final window left in a clean Waiting for iPhone state.

Remaining acceptance: the physical iPhone was unavailable in developer tools.
QR camera scanning, five-minute wireless play, interruption recovery, measured
camera/body calibration, and additional physical-device accuracy are not
claimed. Public distribution also requires Mac signing/notarization and an
iPhone distribution path; the local app is a developer preview.

### Shared iPhone and Mac icon

The user selected the existing iPhone app artwork. `macos/build.sh` now builds
the Mac ICNS directly from `ios/App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png`
at the standard 16–1024 pixel sizes. The original artwork is unchanged; generated
logo candidates are not used. The native build, plist validation, ICNS round trip
and application signature verification passed. After reopening the idle Mac app,
its actual standard About panel visibly showed the original phone-and-green-orbit
icon. The app was returned to its waiting-for-iPhone main window.

## 2026-09-22 — Marble interface redesign, three rendered iterations

Request: the native Marble screen had a tiny phone in an oversized green grid,
repeated connection states, and a scrolling wall of inactive settings and help.
The user also required the original detailed phone model to be restored.

1. Replaced the disconnected inspector with one working Connect iPhone action
   and three short setup steps. Neutral light/dark surfaces replace the green
   wash. The preview has a larger phone, a restrained background and an explicit
   Preview label; no inactive game sliders. Removed the native runtime-status
   pill. The local main-frame message opens the existing native QR sheet, which
   was operated successfully in the real app.
2. The first rendered preview's phone overlapped its bottom caption. Increased
   camera distance and adjusted the target, then checked both appearances and
   the minimum 980-point-wide window. Text and controls fit without an idle
   scroller. Connected controls have progressive disclosure for help and numeric
   diagnostics. Removed redundant positioning instructions. The actual thin
   overlay indicator appeared during scrolling and vanished at rest without
   moving content; it does not affect hit testing or the accessibility tree.
3. The expanded viewport's status badge overlapped its Restore view button.
   Removed that duplicate in expanded mode and rechecked the native window.
   Reset view, Expand/Esc and unrestricted orbit were operated. The final app
   is open at its standard size in System appearance and a clean preview state.

Original model: the earlier distributable build intentionally omitted the private
GLB and blocked its route, so the Mac displayed the procedural fallback. Added
an explicit `app:build:local` personal build which copies only the existing
`local-assets/iphone-17/iphone-17-black.glb`. The loopback web server permits that
exact file, while continuing to reject other private paths and outside files.
The default distributable build still excludes private models. A bundled-model
check verified byte identity with the original; rendered inspection confirmed
USB/speaker details, side controls, rear cameras and logo. The user-selected
original iPhone/Mac app icon remains unchanged. Simple studio reflection lights
make the existing detailed materials legible; no replacement model was made.

Validation for this change:
- ESLint passed; TypeScript, Vite production build, native Swift build and
  application signature verification passed in the final personal app build.
- Nine focused tests passed: desktop asset serving/pairing, WorldClient and
  optional-model response validation. Exact GLB GET/HEAD and unrelated private
  path rejection are covered.
- `npm run app:smoke -- --with-local-model` passed: exact model bytes and MIME,
  two independent bundled sessions, valid pairing data, owned-port cleanup and
  unaffected second session. No system Node is required.
- Actual native UI: light/dark, minimum/default window, original model front/back,
  native Connect sheet, ready/running/paused states, 15→17 mm slider adjustment,
  pending-change feedback, reset to 15 mm, details scrolling, and Expand/Esc.
- The initial synthetic start paused on a freshness gap; a restart was observed
  running by both the UI and a read-only snapshot check. Expand/Esc then kept the
  round running. Existing freshness/background protections were retained.
- All injected device input was explicitly synthetic, and the test producer was
  stopped. No physical iPhone pairing, motion accuracy or latency is claimed.

Rendered evidence was inspected through CUA in this task. Build/lint logs for
these rounds are under `captures/marble-ui-20260922/` (ignored local artifacts).

## 2026-09-22 — Workspace switching and mirroring controls

User-reported defects: slow mode switches, Calibration text crowded against its
button, and scene switches rendered as a green dot or an undifferentiated gray
bar. Code inspection confirmed top-level conditional unmounting recreated each
Canvas, GL context, materials and model GPU uploads on return. The off switch's
track and thumb had identical colors; the selected track blended into its row.

Changes:
- Desktop retains only the three visited workspaces, with stable canvas sizes
  and view/settings state. Hidden panels are inert and absent from accessibility.
  Their frame loops, live sockets/reconnect timers and refresh intervals stop;
  local video pauses. Returning reconnects to the current session. Marble keeps
  the previous stop-on-leave behavior rather than running an invisible round.
- The render scheduler also suspends the diagnostic vsync mode while hidden.
  Static optional-model availability is reused across model instances, avoiding
  a new HEAD request and procedural-shell construction on each first tab visit.
- Scene helper rows now have switch semantics and a white thumb that moves
  between a gray off track and green on track. Labels use ordinary case and
  spacing; preset labels have larger padding. Calibration/Hero use half-width
  buttons, with Side/Front/Back below. Long pose-mode labels use two columns.
- Mirroring's video, pose and WebRTC routes now honor the desktop URL's bridge
  endpoint instead of the unrelated fixed development port 4319.

Evidence:
- 82 relevant tests passed across render scheduling, live-source routing, model
  availability, WorldClient and spatial tracking. Added regression coverage for
  hidden vsync canvases and all three channels using the dynamic app endpoint.
  ESLint, TypeScript, production/native build and signing verification passed.
- Actual packaged WKWebView: visited Marble, Tracking, and Screen mirroring,
  then returned repeatedly. The warm mirroring view retained its rendered model,
  Hero camera, Grid and scene preset; the first-visit blank loading stage did not
  recur on return. This is rendered observation, not a numeric latency benchmark;
  first visits still initialize each renderer. Residency is bounded to three
  visited canvases and trades retained GPU resources for warm switch speed.
- On the actual app session (bridge 59903), health showed one video browser,
  one pose browser and one WebRTC browser while mirroring was active; all three
  were zero after switching to Marble, then returned to one each without growth.
- A synthetic Marble round reached running, stopped to ready with zero balls
  when switching away, and successfully started again after returning. The
  producer was stopped after testing. No physical iPhone performance is claimed.
- Light/dark and minimum/default window sizes were inspected. Both switch states
  were visible. Option-Tab navigation reached Ambient motion; Space changed its
  checked state. Calibration and Synchronized retained comfortable padding in
  the narrow inspector. Daylight/Night scene changes also rendered correctly.
- Restored System appearance, prior window size, Calibration camera, Daylight,
  Ambient motion on, Grid on and Axes off; app left on Screen mirroring.

Logs: `captures/mirroring-switch-20260922/` (ignored local artifacts).

## 2026-09-22 — Unified workspace chrome and pairing controls

User-reported defects: the three modes had unrelated visual styles, the native
toolbar/Web navigation/page title formed three stacked header rows, and the
pairing sheet's close, copy and completion buttons had inconsistent treatment.

Changes:
- One compact native toolbar now contains the workspace picker, Connect iPhone
  and Session controls. Desktop Web navigation and duplicate product/page
  headers are removed. Native selection and Cmd-1/2/3 switch the existing cached
  workspaces without reloading the WebView. Browser navigation remains available.
- All three modes share a neutral stage, 300-point inspector, type scale,
  connection card, section spacing, viewport actions and transient scrollbar.
  Mirroring opens in the neutral Studio environment and Hero view. Daylight and
  Night remain selectable. Scene, motion, diagnostics and device information
  are disclosures; stream statistics are inside Diagnostics.
- Pairing uses a compact 620-point sheet, a lightweight close icon, a separate
  neutral Copy button and green Done button. Copy/Done share 32-point sizing and
  6-point corners; copying shows a stable-width Copied/checkmark state. Escape
  closes and Return activates Done. Instructions reflect the selected workspace.
- Original detailed iPhone GLB and original iPhone app icon are retained. Local
  personal build still includes only the specifically permitted private model.

Validation:
- 85 focused tests passed across presets, render scheduling, live source,
  WorldClient and spatial tracking. ESLint passed. Final personal build passed
  TypeScript, Vite, native Swift compilation and ad-hoc signing.
- Actual packaged app was inspected over three build/review iterations. All
  three modes showed one toolbar and matching stage/inspector styling. Native
  picker clicks and Cmd-1/3 changed workspaces correctly.
- Minimum 980-point window and normal size were inspected in light/dark. The
  final wider picker displays Screen mirroring without truncation. Core source
  and view controls fit the narrow inspector; advanced details remain scrollable.
- Final pairing buttons were inspected in both appearances. Copy feedback and
  Return-to-close were operated; Escape-to-close also worked. The final light
  sheet shows the neutral copy action and green completion action with matching
  rounded rectangles. Studio/Daylight/Night options remain in the scene menu.
- System appearance and prior window size were restored. App is left open on
  Screen mirroring with its revised pairing sheet visible. No physical iPhone
  pairing, capture performance or motion accuracy is claimed by this UI check.

Rendered evidence was inspected through CUA in this task. Logs are under
`captures/unified-ui-20260922/` (ignored local artifacts).

## 2026-09-22 — iPhone interface redesign and simslim validation

The user reported an inconsistent phone UI and asymmetric icons. Rebuilt the
tracking and mirroring pages around the same layout, typography, 16-point cards,
48-point main actions and a single adaptive green accent. Symbols use fixed
20/32-point slots and common weights. Removed the repeated brand hero and Mac
address card; connection actions now expand in one place. Advanced capture and
diagnostic controls are collapsed. The capture action is named Start sharing;
framework names remain only in the advanced fallback explanation. Appearance
supports System/Light/Dark and remembers the selection. Marble's Exit target is
44 points and its overlay respects safe areas; the full-screen canvas is retained.

The user requested simulator validation using simslim. Installed simslim 0.10.0
into a temporary tool directory and created two isolated iOS 27 simulators:
iPhone 17 (402-point width) and iPhone SE 3 (375-point width). Each had the chosen
86-service profile verified. Existing simulators and physical phone settings
were not modified by slimming. The initial duplicate Device Hub instances opened
for preview were closed; verification continued headlessly with XCTest and
simulator screenshots.

The iOS simulator SDK lacks ScreenCaptureKit. Moved the unchanged presentation
types to CapturePresentation.swift and conditionally compiled the device
controller. A simulator-only controller keeps capture idle and gives an explicit
physical-iPhone requirement on Start sharing. It does not fake streaming,
connection, capture results or benchmarks. Swift import autolinking retains the
real device framework dependency. Physical-device builds still use the original
capture implementation.

Validation:
- Signed device build and simulator build passed after the final UI edits.
- Actual XCTest UI flow passed on both iPhone 17 and iPhone SE simulators:
  expand pairing, open/cancel address editor, switch modes, choose Dark, then
  restore System. The SE run also rejected an invalid address and enabled Save
  for a valid address without saving it.
- Inspected screenshots of both modes, light/dark, expanded pairing and the
  keyboard/address sheet. On the 375-point screen, the mode labels are complete
  and the primary action remains visible in the initial viewport. Icon slots,
  button baselines and card edges align. A second pass fixed disclosure labels
  that looked disabled and matched the legacy capture button to the shared style.
- Actual camera capture, QR scanning, live tracking and Marble gameplay were not
  validated in Simulator. The phone was unavailable at the final device check;
  the redesigned build has not been installed on that phone during this pass.

Evidence: `captures/ios-ui-20260922/` contains simulator screenshots, XCTest
result bundles and exported attachments (ignored local artifacts).

## 2026-09-23 — Remove unsupported iOS 27 capture warnings

Xcode showed five deprecation issues: the ReplayKit picker, sample handler,
sample-buffer type and orientation key, plus `UIScreen.main` in the benchmark
clock. The app targets iOS 27 and already uses ScreenCaptureKit for its normal
screen-sharing path. Apple's iOS 27 SDK marks the ReplayKit sample handler as
unsupported, so the old broadcast fallback was removed from the app, project
and bundle. The connection sheet no longer checks for that removed broadcast
session. Benchmark frame-rate selection now reads the foreground window scene's
screen rather than the deprecated global screen.

The personal iOS device build and simulator build both succeeded, including
signing validation; the device bundle contains no broadcast extension. No
deprecated-symbol warnings remain in their logs. Xcode's Issue Navigator was
refreshed by building the regenerated project and displayed no issues. The only
terminal warning was AppIntents metadata extraction skipped because this app
has no AppIntents dependency. The updated app was installed and launched on the
connected iPhone 17. This verifies installation and launch, not capture quality
or a real screen-sharing session.

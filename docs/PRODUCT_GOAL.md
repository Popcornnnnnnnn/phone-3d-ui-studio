# Product goal

## Primary outcome

Phone 3D UI Studio is a local Mac tool that creates a live digital twin of a physical iPhone:

- the physical iPhone screen drives the screen texture of the 3D phone in real time;
- the physical iPhone attitude drives the orientation of the 3D phone in real time;
- screen frames and pose samples remain timestamped and visibly stale when synchronization is lost;
- the final composited 3D scene can be previewed and recorded locally.

The physical device is the source of truth. Picking up, tilting, or rotating the real iPhone should produce the corresponding movement on the Mac after one explicit zero-pose calibration.

## Why this project exists

Established tools such as [Rotato](https://rotato.app/) already place screenshots, recordings, or mirrored screens on 3D device models and provide hand-authored camera animation and export. Rebuilding a general-purpose mockup animator is not the goal.

The product hypothesis is narrower: combine a live phone screen with live device-attitude data so that the rendered phone follows the real phone rather than a preset timeline.

## Supporting foundation

The existing prerecorded-video and simulated-motion workflow remains useful as a renderer test harness. It proves the model, replaceable screen surface, materials, camera, and compositor without depending on live transport. It is a supporting foundation, not the final product.

## Explicit non-goals

- Competing with Rotato as a general 3D mockup, template, or marketing-video editor.
- Building a large device catalogue, template marketplace, or production-grade keyframe timeline.
- Cloud relay, user accounts, collaborative editing, or hosted storage.
- App Store distribution, Android parity, or Windows support in the baseline.
- Capturing DRM-protected or system-restricted content.

Camera presets and local recording may be added only when they directly support demonstrating, validating, or capturing the live physical-device twin.

## Product acceptance

The core goal is accepted only when one physical iPhone can complete this flow:

1. Connect through an explicit, user-consented local flow.
2. Display its live screen on the corresponding 3D screen surface.
3. Lay the physical phone screen-up with its Dynamic Island pointing toward the Mac, then use **Calibrate tabletop pose** to map that orientation to the studio table.
4. Use **Reset standard view** whenever orbit controls need to return to the charging-port-level calibration camera.
5. Drive the 3D phone orientation from real device attitude while the screen remains live.
6. Survive an orientation change and ordinary suspend/reconnect behavior.
7. Record the final composited scene for at least 60 seconds.
8. Surface stale screen or pose data instead of silently presenting old state as current.

Target measurements remain: median pose latency at most 80 ms, median screen latency at most 250 ms, and normal screen/pose relative skew within 100 ms on the test LAN.

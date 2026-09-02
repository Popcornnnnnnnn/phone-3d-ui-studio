# Architecture baseline

## Data flow

```text
Phone screen capture ---- video transport ----> HTML video / media source
                                                     |
                                                     v
                                               Three.js VideoTexture
                                                     |
Phone attitude -------- pose transport ------> phone group quaternion
                                                     |
                                                     v
                                  3D studio + camera + compositor
                                                     |
                                                     v
                                          preview and recording
```

## Component boundaries

- **Renderer** owns the Three.js scene, phone asset, screen texture, camera, lighting, background, and compositing.
- **Studio state** owns serializable presets and timeline state; it contains no captured media bytes.
- **Screen source** exposes frames plus timestamps and can be prerecorded or live.
- **Pose source** exposes quaternions plus timestamps and can be simulated or device-backed.
- **Synchronizer** aligns and marks freshness; it does not silently pretend missing data is current.
- **Recorder** consumes the final composited output.

## Initial technology direction

- TypeScript, React, Vite.
- Three.js through React Three Fiber; Drei for standard scene helpers.
- WebRTC for a future local video path where it is justified by the feasibility spike.
- WebSocket or WebRTC DataChannel for pose samples.
- Browser MediaRecorder for the first export path, with OBS as a diagnostic/reference option rather than a required runtime dependency.

These are baseline choices, not proof of platform feasibility. The M3 and M4 spikes may replace transport details without changing the renderer contracts.

## Repository data boundaries

Never commit:

- phone screen recordings or screenshots containing personal data;
- signing certificates, provisioning profiles, API keys, pairing secrets, or `.env` files;
- generated exports, caches, build output, dependencies, or local databases.

Use synthetic/demo UI media for fixtures and documentation.

## Prerecorded screen source

The M2 prerecorded path keeps the user's media outside project state:

1. The file picker receives a local `File` selected by the user.
2. A short-lived object URL feeds a muted, looping `HTMLVideoElement`.
3. A `VideoTexture` is attached only to the independently named `screen-mesh`.
4. Replacing the source or leaving the app pauses the element, clears its source, disposes the texture, and revokes the object URL.

The selected file bytes and local path are never copied, uploaded, or serialized. The screen shader rotates display coordinates for landscape mode and applies contain scaling from source and target aspect ratios. Pixels outside the fitted source are black, so mismatched media is letterboxed or pillarboxed rather than stretched or cropped.

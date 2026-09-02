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


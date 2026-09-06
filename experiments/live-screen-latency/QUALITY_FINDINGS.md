# Quality checkpoint — 2026-09-05

User acceptance, 2026-09-06 13:09: the user confirmed “不发糊，没问题” in
response to the current Chrome FRONT static text/icon clarity check. Static
picture acceptance is now passed for the installed color-only 960 × 2088 /
15 Mbps build. Fast-motion clarity and sustained wireless/pose acceptance are
not covered by this statement and remain to be tested separately.

## Physical color repair verified — 2026-09-06 13:05

The isolated **color-only** app has now been installed on the same iPhone and
is streaming. The original build/archive hashes and strict signature check
passed before installation. The bridge was not restarted; trace-v1, 15 Mbps,
960 × 2088 and Wi-Fi remain in use. No trace-v2 or resolution change was bundled.

Actual device SPS/PPS parsed by CoreMedia now explicitly reports BT.709 primaries,
sRGB transfer and BT.709 matrix, matching the pre-encode buffer attachments.
The native decoded output no longer contains the guessed-color marker. Chrome
152 reports `bt709 / iec61966-2-1 / bt709`, full range. This verifies the repaired
metadata on physical iPhone output, not only a successful property setter.

Evidence: `captures/color-metadata-device-after-20260906-a`, run
`a697bed7-ebe7-444d-ac69-37d9fffa362c`, frame 247, capture 13:00:00.013,
80,471-byte IDR. Input PNG SHA-256:
`563a64871ccddcd4439d5db6b2e8e52b270648674055d2a183396d1920b9a216`;
encoded SHA-256:
`b3c175783f23a9848e85f41df05ff248780ede7654cf2d6ba1db2551f286ea0e`.
The native parser/metrics and Chrome JSON plus decoded/rendered PNGs are saved
in its `native-decoded/` and `browser/` directories.

| Exact physical input → output, 960 × 2088 | RGB RMSE | SSIM8x8 |
| --- | ---: | ---: |
| Pre-encode → native decode | 1.5256 | 0.998185 |
| Pre-encode → Chrome decode | 1.3339 | 0.998196 |
| Chrome decode → production 1:1 screen shader | 0.002447 | ~1.000000 |

All four pre-existing app-screen ROIs are byte-identical between Chrome decode
and shader output. The final PNG and the live FRONT preview were visually
inspected: no obvious vertical block streaking in this static sample. The new
input is not byte-identical to the older baseline, so do **not** turn the old/new
RMSE difference into a causal improvement percentage. The earlier identical-IDR
Mac color control isolates causality; this device test verifies actual metadata
and current picture output. Native-resolution loss, moving-frame clarity and
user acceptance remain open; no latency or 30-minute acceptance is claimed.

The first snapshot request timed out because the background static screen
produced no matching fresh frame within ten seconds. One changed-condition retry
returned to the existing test app and armed before the minute-clock redraw;
it succeeded. No repeated capture loop or app reinstall was used. A fixed fixture
entry was added to the existing dev-only browser replay (no live connection).
Focused ESLint and TypeScript checks passed. The temporary replay tab is removed
after export; the original Chrome live receiver remains the handoff surface.

Per the user's explicit cleanup request, all 13 identified Phone Studio browser
test downloads were copied into `captures/downloads-archive-20260906-1304`,
SHA-256 verified, then moved from Downloads into the recoverable Trash folder
`/Users/forge/.Trash/Phone3D-test-downloads-20260906-1304`. No other download was
touched. Older schema-v1 color-region JSONs remain archived as excluded evidence,
not promoted to accepted region measurements.

## Native-resolution control — 2026-09-06 03:15

The new Xcode device screenshot command supplied a **1206 × 2622 native PNG**
without stopping sharing. Two independently timestamped native captures have
byte-identical app content below native row 200; only the status bar is excluded.
Between them, the existing one-shot sampler captured a paired **960 × 2088 SCK
pre-encode buffer and its exact IDR** (frame 8707, run
`05ebe24b-bf2d-4fff-aea3-ccf8dd96d51d`, 15 Mbps). This establishes a static-content
comparison, not simultaneous native/SCK timestamps or a latency measurement.

The inspected SCK buffer contains two near-black bottom padding rows. Comparing
the full padded height against native content introduces geometric drift and
greatly inflates error. The first `analysis/metrics.json` is **excluded** from
loss conclusions. Authoritative schema-v2 results crop those two verified rows
and align the 960 × 2086 content to the native image. The reusable probe refuses
this fixture-specific alignment if the dimensions, padding, color declaration,
or unchanged native-content checks fail.

| Static app body, excluding status bar | RGB RMSE | SSIM8x8 |
| --- | ---: | ---: |
| Native → actual SCK content reconstructed at native size | 4.9677 | 0.991610 |
| Native → Lanczos down/up size-only control | 3.8918 | 0.993558 |
| Actual SCK → Lanczos reference at the same 960-pixel width | 2.9066 | 0.997616 |

The capture contains about **63.33% of native content pixels**, before H.264.
This is a pixel-count ratio, not a percentage of perceived quality. Size
reduction alone loses detail; the actual SCK/NV12 path also differs from the
Lanczos control. These errors cannot be subtracted to assign a percentage of
blur to each stage: Apple's scaler and this control use different processing.
The two padding rows are a measurement-alignment issue, not the main explanation
for the user's blur. This result does not rank moving-frame quality or prove
that native-resolution streaming will preserve wireless latency.

Evidence: `captures/native-resolution-check-20260906-a`, particularly
`analysis-aligned/metrics.json`. `scripts/source-resolution-probe.py` records
input hashes, sRGB handling, exact regions, padding checks and metric definition.
Identity, known-error PSNR and mismatched-shape self-checks pass. No iPhone
installation, app relaunch, capture restart or bridge restart was performed.

### Isolated device color candidate is ready

`captures/wireless-color-only-candidate-20260906` was built from the preserved
known-good source, changing **only `ios/Shared/H264Encoder.swift`**. It retains
trace-v1 and the existing transport, app controller, project and assets. The
signed physical-iOS build, strict code-signature verification and exact-candidate
native color self-check pass. Its source archive SHA-256 is
`63b29e5819a3e15e8d64c47eaef2e2ad857bec7ad8dd0386f4bc097f7caa93f4`;
implementation debug-dylib SHA-256 is
`5ad91b9ef69e4f31bf5cd7d51bfcd7f17c12fc788b308724db0fde956eabf8be`.
See its `PROVENANCE.md`. It is **not installed**. Use this color-only candidate
for the first physical A/B, not the combined color/trace-v2 integration build.

Next device gate: install once sharing consent can be completed, verify actual
device SPS/VUI and same-frame picture output, then separately test a higher
capture resolution with a fixed transport/bitrate. Native screenshots are now
available, but screenshot access does not provide a system-picker input API.
Do not interrupt the current sharing session until restart can be completed.

## Color-metadata repair candidate — 2026-09-06 02:45

**A separate color defect is now isolated and repaired in source, but not yet
installed/verified on the physical iPhone.** Apple's parser found no explicit
primaries/transfer/matrix in the saved physical H.264 format; VideoToolbox marked
its output `ColorInfoGuessedBy = VideoToolbox`. Chrome chose full-range 601/sRGB,
while the HD native decoder guessed 709/709. This explains why those two decoded
PNGs were not identical; it does not prove every residual error is color-related.

The actual production encoder now supplies the input pixel buffer's explicit
color primaries, transfer and matrix to VideoToolbox before preparing a session.
Missing tags remain missing (no invented 709). A tag change, including removal,
starts a new keyframe session so old metadata cannot leak into a changed source.
Individual property return statuses remain in diagnostics; successful setters
alone are not proof of device SPS/VUI. Apple's [color property documentation](https://developer.apple.com/documentation/videotoolbox/kvtcompressionpropertykey_ycbcrmatrix)
notes that some hardware can enforce read-only colorimetry.

Controlled evidence uses a byte-defined 640 × 384 Mac RGB color-bar/gradient
fixture converted to the same tagged 709/sRGB NV12 buffer. Baseline and candidate
pre-encode PNG SHA-256 both equal
`f92531139dd4d03085b729e887f713e1420fe9353828f4b7e66cfc21d9f12a40`.
The IDR slice bytes are **identical** (NAL type 5, 1,416 bytes; SHA-256
`b43f6b99e2aed54163e06864cace4bd161bd33137780659fcdf55e95ef8e41be`).
Only parameter/metadata records differ. This is a metadata interpretation repair,
not a bitrate, spatial-resolution or image-compression improvement.

| Same input and IDR picture payload | Untagged control RGB RMSE | Explicit tags RGB RMSE |
| --- | ---: | ---: |
| Pre-encode → native decoder | 21.5701 | 6.7705 |
| Pre-encode → Chrome WebCodecs | 7.6602 | 0.5796 |
| Pre-encode → production browser screen shader | 8.0597 | 2.5402 |

Chrome now reports BT.709 matrix/primaries and sRGB transfer, matching the input.
The candidate's actual SPS parsed by CoreMedia also contains these three tags;
the native output no longer carries the guessed-color marker. Chrome render
SSIM8x8 improves from 0.981328 to 0.999012. Replaying both encoded files again
reproduced the same full-image metrics. These are Mac-generated fixtures, **not
physical wireless benefit or user-perceived acceptance**.

Evidence:

- `captures/color-metadata-control-20260906-a` (includes the pre-change encoder
  source), `captures/color-metadata-explicit-20260906-a`, and their native PNGs.
- `captures/color-metadata-physical-20260906-a/metrics.json` records the original
  device SPS parse / native guessed-color attachments.
- `captures/color-metadata-browser-20260906-a/{control,explicit}.json` are Chrome
  downloads with source hashes and **schemaVersion 2** reviewed top-left regions.
  The first downloads in Downloads used vertically mislabelled color regions;
  only their full-image metrics were valid. The correction was visually checked
  against the exported PNG and covered by a region-coordinate test; use v2 for
  region conclusions. Candidate decoded/rendered PNGs are saved alongside v2.

The saturated-color fixture also reveals edge sampling differences between
Canvas2D VideoFrame drawing and direct WebGL VideoFrameTexture upload (candidate
decode → shader RMSE 2.4827, max 95 at strong chroma edges). The earlier near-zero
shader result remains limited to the two **app-screen** samples, not all content.
Do not fix this by unconditionally adding a full-frame Canvas2D copy to the live
path without a same-picture/performance control. Color reconstruction/filtering
is a remaining hypothesis, not yet a proven blur root cause.

Checks: final full web check passed (lint, typecheck, 335 tests, build); 43 shared
Swift tests passed. The native encoder self-check additionally verified absent tags,
copied source tags, same-tag reuse, changed-matrix keyframe and removed-tag reset.
Signed iOS App + broadcast extension build succeeded at `/tmp/phone3d-color-device`.
The saved candidate is `captures/wireless-color-candidate-20260906`; it also
contains the preceding incremental-trace v2 work. Neither candidate feature is
installed, and the running bridge has not been restarted in this checkpoint.

Next acceptance: install this saved candidate once shared-screen restart/consent
can be completed, collect a new physical same-frame snapshot, confirm actual
SPS/VUI and Chrome metadata, and visually compare UI text/icons/gradients. Then
continue native-resolution/viewport and motion-quality work. No 30-minute or
end-to-end latency acceptance is claimed here.

## Scope and status

Goal active. Tooling, controlled Mac codec experiments, and a physical-iPhone
same-frame A/B are complete. The selected production candidate is now 15 Mbps.
User image acceptance, motion quality, and sustained performance remain open.

The probe compiles the actual `ios/Shared/H264Encoder.swift` with the shared
protocol and replays the user-provided 1206 × 2622 still as 960 × 2088 NV12.
It encodes 120 identical frames at 60 Hz presentation timestamps, without
real-time pacing, and decodes locally with VideoToolbox. It saves frames 0,
59, and 119. This is NOT an iPhone, SCK, browser, or wireless benchmark.

## Validated comparison

Local evidence: `captures/quality-20260905-b/metrics.json` and `comparison.html`.
Images and reports remain in git-ignored captures. The known fixture's sRGB
transfer and BT.709 matrix are supplied explicitly to the local decoder.

| Setting | First-frame SSIM8x8 | First-frame RGB RMSE | Frame 119 SSIM8x8 |
| --- | ---: | ---: | ---: |
| 5 Mbps, speed-priority | 0.9680 | 6.219 | 0.9909 |
| 5 Mbps, system default | 0.9680 | 6.219 | 0.9909 |
| 10 Mbps, system default | 0.9829 | 4.789 | 0.9946 |
| 15 Mbps, system default | 0.9878 | 4.116 | 0.9950 |

Metrics compare decoded RGB with the same-size pre-encode NV12 reference;
they exclude source scaling loss. SSIM8x8 is non-overlapping 8 × 8 luminance
SSIM with population moments, not a library-independent perceptual grade.
Identity and deliberately destroyed-reference checks pass.

1. Higher bitrate improves this image's initial encoded detail. The first-frame
   RGB RMSE falls by about 34% from 5 to 15 Mbps; this is NOT a claim that
   perceived image quality improves by 34%.
2. Speed-priority and system-default output metrics and total encoded bytes
   match on this Mac. That does not establish equivalence on iPhone, and
   system default does not mean explicitly disabling speed priority.
3. Static refinement matters: feeding many identical frames improves output.
   SCK/transport may not deliver the same sequence during a static homescreen.
   Investigate frame availability and refresh before attributing all persistent
   blockiness to resolution or assuming settled-static scores describe the UI.
4. This is a static source; average produced rates are below the requested
   budget. Neither those byte rates nor Mac callback times predict dynamic
   wireless throughput, latency, or power consumption.

## Rejected measurement version

`captures/quality-20260905-a` omitted decoder format color extensions when
reconstructing a description from avcC. That caused a visible color-conversion
difference and inflated RGB error. Version B fixes the fixture's local decoder
description. Version A must not be used to rank production quality. This is a
probe correction, not proof of a production color bug.

## Implementation and checks

- Added a bounded 1–20 Mbps setter to the shared encoder. The initial default was
  5 Mbps; the subsequent device candidate is 15 Mbps, with the same 1.2x
  one-second peak allowance. Reconfiguration uses
  the existing session-generation and keyframe boundary.
- The probe validates unsupported rates, checks the requested tuning and rate
  property statuses, bounds each callback wait to 3 seconds, limits the whole
  run to 60 seconds, and refuses to overwrite an existing output directory.
- Mac production-encoder compile/run, ESLint, and 25 platform-neutral Swift
  tests pass. The unsigned iOS device build also reports BUILD SUCCEEDED;
  the subsequent signed snapshot build also passed and was installed.
  These do not replace physical-device acceptance.

## Physical iPhone same-frame result

The SCK host and browser were connected over `en0:wifi`. Three samples used the
same 960 × 2088 app screen and production hardware encoder; only average bitrate
changed. Each row compares the PNG exported from the exact admitted input buffer
with the matching forced-IDR payload decoded by VideoToolbox.

| Rate | IDR bytes | SSIM8x8 | RGB PSNR | RGB RMSE |
| --- | ---: | ---: | ---: | ---: |
| 5 Mbps | 47,223 | 0.9797 | 34.71 dB | 4.687 |
| 10 Mbps | 51,444 | 0.9822 | 36.10 dB | 3.994 |
| 15 Mbps | 59,384 | 0.9931 | 37.53 dB | 3.390 |

Evidence is stored locally under the ignored directories
`captures/device-quality-ab-{5,10,15}mbps-20260905-a` and their `-decoded-`
counterparts. The sampled 15 Mbps IDR was visually cleaner. The initial browser
inspection showed no vertical streaks, but the user subsequently reproduced
them during normal streaming. The snapshot also forces an IDR, so this evidence
does not isolate the cause of persistent inter-frame corruption. The initial
in-app inspection is not a performance baseline; subsequent live testing uses
the user's single Chrome receiver.

This fixed-size A/B establishes bitrate's effect on these forced IDRs. It does not
establish scrolling quality, wireless latency under sustained 15 Mbps content,
or user perceptual acceptance. The encoder default is therefore raised to the
15 Mbps candidate, while 20 Mbps remains untested and is not selected.

## Same-frame device sampling implementation

- Added an explicit one-shot sampler to the SCK host. It retains the exact
  input buffer and matches frame ID, capture generation, and encoder epoch to
  one forced IDR. PNG export happens on a utility queue. No request means no
  retained sample or capture files; reconfiguration cancels pending work.
- At most eight samples are retained in the app's cache. No automatic deletion.
  Waiting for a frame is capped at 10 seconds. Transporting a diagnostic image
  is not included in latency acceptance.
- The bridge's `/quality/snapshot` POST endpoint is loopback-only, requires the
  `x-phone3d-quality-probe: 1` header, chooses one capable streaming SCK host,
  checks run identity and the returned app-cache path, and refuses concurrent
  benchmarks. It returns metadata only, never broadcasts image bytes.
- `scripts/quality-snapshot.mjs` retrieves the exact sample via paired-device
  file transfer. It refuses to overwrite outputs and records a transfer failure
  so an existing sample can be retrieved without recapturing.
- `quality-probe.mjs --sample` decodes the actual IDR and compares it with the
  paired pre-encode PNG. Annex-B SPS/PPS are parsed into the decoder format;
  fixture color overrides are not applied to real device samples. RGB metrics
  may include color conversion as well as compression and must be interpreted
  with the exported color attachments.
- 315 Web/Bridge tests, full web checks, signed iPhone build, and a native
  synthetic same-frame encode/export/decode self-check pass. The self-check
  proves tooling behavior, not physical capture or wireless quality.

```sh
node scripts/quality-snapshot.mjs DEVICE_ID captures/device-quality-new 15
node scripts/quality-probe.mjs --sample captures/device-quality-new captures/device-quality-decoded-new
```

## Static-to-motion recovery checkpoint

A later forced IDR again cleared the user's vertical smearing. This supports a
reference/refresh problem, not a conclusively isolated original root cause.
Frame-count-only recovery could leave static SCK content without an IDR for
minutes. A wall-clock recovery request now occurs after a 250 ms admission gap
or two seconds since the last request. The first user test after installation
did not reproduce obvious smearing, but the user reported poor responsiveness
and blur during rapid scrolling. This is a partial recovery result, not image
or motion-quality acceptance.

## Motion timestamp defect and controlled correction

At approximately 17:19–17:21 local time, one-second diagnostic counter deltas
during animation frequently showed 50–60 capture callbacks but only 18–26
encoded/admitted frames. A 17:20 transition included two ACK hard timeouts.
The raw TCP transport admits one frame and waits for its bridge ACK before
accepting another input. Idle-inclusive rolling averages must not be used as
the scrolling FPS, and these phone counters are not browser presentation FPS.

The production encoder nevertheless used `frameId / targetFps` for PTS and
`1 / targetFps` for every duration. At 20 admitted FPS and a 60 FPS request,
three seconds of captures become one second of encoder media time. Apple's
[DataRateLimits contract](https://developer.apple.com/documentation/videotoolbox/kvtcompressionpropertykey_dataratelimits)
applies to decode time, so this is a rate-control defect.

The candidate now preserves SCK/ReplayKit source timestamp intervals, rebased
per encoder session. Unknown future frame duration is `.invalid`, as required
by the EncodeFrame API. Duplicate, invalid, or regressing source times use a
nominal step and recover on the next valid interval. The frame IDs, target
60 FPS, 960 × 2088 output, 15 Mbps budget, tuning, and transport are unchanged.

`quality-probe.mjs --motion` replays the same 60 vertically wrapped pictures
at 20 Hz source timestamps through the Mac hardware production encoder. Both
variants have exactly two IDRs (frames 0 and 30). Same-frame input/decoded PNGs
and metrics are in ignored `captures/motion-timebase-{before,after}-20260905-b`.

| Metric | Frame-counter time | Source time |
| --- | ---: | ---: |
| Encoded bytes / 3 source seconds | 2,137,867 | 4,667,299 |
| Produced rate / source duration | 5.701 Mbps | 12.446 Mbps |
| Frame 29 SSIM8x8 | 0.9106 | 0.9841 |
| Frame 29 RGB RMSE | 12.051 | 5.933 |
| Frame 29 RGB PSNR | 26.51 dB | 32.67 dB |

All six sampled moving frames improved; the initial IDR is identical. Direct
PNG inspection confirms clearer lettering/icon edges and fewer blocks. This is
an unpaced Mac codec experiment, not iPhone quality, wireless throughput, or
latency acceptance. Version A's after-run failed the GOP identity check
(`[0,39,40]` versus `[0,40]`) and was excluded; version B requests IDRs sooner
to prevent that confound. No numbers from the invalid pair are used here.

31 platform-neutral Swift tests and the focused probe lint pass. The signed
Xcode 27 beta device build succeeded; the candidate was installed at approximately
17:36 local time. Sharing restart and physical image/performance acceptance are
still pending. Device diagnostics
now include `encoderMediaTimeline`, cumulative encoded/accepted payload bytes,
and encoded keyframes so actual output can be measured without repeatedly
forcing a diagnostic IDR.

## Next discriminating test

Restart sharing with the source-timestamp candidate and repeat the same rapid
scroll. Check both motion clarity and whether larger payloads increase ACK
waiting, stalls, or decoder resets. Record a Chrome visual check and the user's
judgment. Do not consider reduced blur a latency win. Once picture quality is
accepted, address the one-frame ACK bottleneck with bounded in-flight work,
preserving H.264 dependencies, then validate wireless pose/video and perform the
30-minute sustained run. No resolution or bitrate increase is bundled here.

## Reproduce

```sh
node scripts/quality-probe.mjs /absolute/path/reference.png captures/new-quality-run
node scripts/quality-report.mjs captures/new-quality-run
```

The tool uses Apple's installed SDK/frameworks and Node; no extra package,
network service, or screen-capture permission is required for this offline step.
# Browser same-frame replay checkpoint — 2026-09-06 02:20

The previously missing browser material stage now has deterministic evidence in
`captures/browser-quality-20260906-a`. The local development-only
`/quality-review.html` replays each exact physical iPhone IDR, verifies dimensions
and timestamp, and uses the **production** software WebCodecs configuration,
`VideoFrameTexture`, and shared screen vertex/fragment shaders. It creates no
live receiver or device commands. Source bytes and PNG SHA-256, frame identity,
Chrome version, decoder color metadata, full-image and named-region metrics are
in the downloaded JSON. The 15 Mbps decoded/rendered PNGs are saved beside it.

| Physical saved sample | Input → Chrome decode RGB RMSE / SSIM8x8 | Chrome decode → screen shader RGB RMSE / maximum byte error |
| --- | --- | --- |
| 5 Mbps, frame 64 | 4.1028 / 0.980272 | 0 / 0 (identical RGB) |
| 15 Mbps, frame 71 | 2.6919 / 0.994008 | 0.001824 / 1 |

For the 15 Mbps sample, all four named regions (title/body text, icon, pale
gradient, capture text) are **byte-identical RGB** between browser decode and
shader output. The whole-image deviation is twenty one-level RGB channel
differences among 6,013,440 channels. A second deterministic 15 Mbps replay
returned the same full-image metrics. The four-stage page was visually inspected
in normal Chrome; its compact preview is explicitly not the pixel-metric source.

This isolates one cause: **the front-facing, 1:1 production texture/material path
does not introduce material blur on these samples**. It does not establish that
the actual tilted/zoomed model, viewport framebuffer, or moving-frame stream is
lossless. Do not compare the two separate physical frame IDs as an exact
same-input bitrate A/B; each sample is aligned with its own pre-encode reference.
The references themselves are 960 × 2088 captured buffers, not native-resolution
iPhone screenshots. Quality acceptance by the user is still outstanding.

The native VideoToolbox PNG and Chrome decode are not pixel-identical (15 Mbps
RMSE 2.3114, SSIM 0.999065). Chrome reports full-range, BT.709 primaries, sRGB
transfer, **SMPTE 170M matrix**, while the input manifest records BT.709 matrix.
This is a diagnostic lead, not yet a proven encoder color bug: color conversion
and chroma reconstruction differ between paths, and Chrome is actually closer
to the input reference on this sample. Verify actual SPS/VUI and controlled
color patches before changing encoder color metadata. Do not override the
browser matrix solely to match the input manifest.

Implementation is a behavior-preserving extraction of the live shaders into
`src/scene/screenSurfaceShader.ts` plus the local diagnostic page and bounded
Annex-B/metric helpers. `npm run check` passed: lint, typecheck, 334 tests, build
(existing bundle-size warning only). No iPhone install, capture restart, bridge
restart, bitrate change, or latency improvement was claimed in this checkpoint.

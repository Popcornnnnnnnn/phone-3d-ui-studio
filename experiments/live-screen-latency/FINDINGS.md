# Live iPhone screen latency findings

Measured on 2026-09-04 and 2026-09-05 with a physical iPhone 17 connected to
the Mac over the USB device network. The final measurements use
ScreenCaptureKit in the host app and a single visible Chromium receiver.

## Accepted production configuration

Resolution follow-up: the current renderer now matches display DPR, capped at
2, without enabling shadows or changing the phase scheduler. The configuration
and measurements below describe the **previous DPR 1 baseline**. Reproduce it
with `?renderDpr=1`; its performance numbers must not be attributed to DPR 2.

- Capture: ScreenCaptureKit, 960 × 2088, 60 fps target.
- Encoder: VideoToolbox H.264, `legacy` profile with `speed-priority` tuning.
- Bitstream: Annex-B.
- Frame transport: raw TCP on port 4320, `TCP_NODELAY`, one-frame ACK window.
- Control and pose transport: WebSocket on port 4319.
- Route: IPv6 link-local over the iPhone USB network interface for both
  transports.
- Browser decoder: WebCodecs with `prefer-software`.
- Renderer: DPR 1, MSAA enabled, shadows disabled, phase-aware R3F scheduler at
  120 Hz with one bounded phase credit.
- Receiver policy: one active browser tab. A per-tab ID now survives reloads,
  and the bridge replaces older sockets for the same tab and role.

## Final installed-build result

The final validation was three consecutive 10-second runs. Every run was
eligible, used the verified USB route, stayed at thermal state `nominal`, and
reported zero decoder errors.

| Metric | Median | Worst/min |
| --- | ---: | ---: |
| Fresh rendered rate | 59.73 fps | 59.70 fps min |
| Capture-to-R3F submission p50 | 22.29 ms | — |
| Capture-to-R3F submission p95 | 30.59 ms | 31.88 ms worst |
| Random-interaction-to-next-render p50 | 31.47 ms | — |
| Random-interaction-to-next-render p95 | 42.28 ms | 44.00 ms worst |
| Random-interaction-to-next-render p99 | 52.80 ms | — |
| Interaction coverage | 99.67% | — |
| Arrival gap p95 | 22.90 ms | — |
| Decode p95 | 5.50 ms | — |
| Render queue p95 | 8.20 ms | — |
| Dropped before decode | 0 total | 0 |
| Missing frame IDs | 0 total | 0 |
| Decoder resets | 0 total | 0 |

Run IDs:

- `7472acae-d7ce-4d5d-b172-492b424bae54`
- `a8f70f11-9e96-4418-9ff3-36447d26b4d4`
- `1828d46f-5d9a-45b2-a4d0-766c3ce10e30`

The raw local result is
`/tmp/phone3d-final-production-3run-20260905.json`. `/tmp` evidence is
ephemeral; the run IDs and aggregate values above are the durable record.

Relative to the earlier low-latency confirmation in this experiment (57.79
fps, interaction p95 46.53 ms, p99 66.86 ms), the final installed build is
3.37% faster in fresh-frame rate, 9.14% lower at interaction p95, and 21.03%
lower at interaction p99. The isolated encoder A/B showed a larger 16.1% p95
and 28.8% p99 improvement for `legacy + speed-priority` over the earlier
low-latency encoder profile; the smaller final-build delta includes normal
cross-run system variance.

The latency endpoint is CPU-side React Three Fiber render submission. It does
not include Chromium compositor presentation, display scan-out, or photon
time. Stage percentiles are not additive.

## Accepted and rejected experiments

| Experiment | Decision | Evidence |
| --- | --- | --- |
| DPR 1, no shadows vs quality Canvas | Accept latency Canvas | +5.68% fps; interaction p95 -11.94%; p99 -7.68% |
| Phase-aware renderer vs native R3F vsync | Accept phase scheduler | About 24% lower interaction p95 and 35% higher fresh fps in the controlled comparison |
| 120 Hz vs 90 Hz phase cap | Keep 120 Hz | Three nominal runs each: interaction p95 41.40 vs 44.61 ms; 120 Hz was 7.2% lower with no stability penalty |
| `legacy + speed-priority` encoder | Accept | Three-run median interaction p95 39.04 ms and p99 47.59 ms in the encoder A/B |
| Hardware WebCodecs | Reject | Current tested Chromium builds intermittently accepted configuration but produced no valid rendered stream |
| 720/640 short edge | Reject | 720 fell to about 29.93 fps; 640 was worse |
| 120 fps source request | Reject for production | Actual source stayed near the 60 fps ceiling and caused 16 pre-decode drops plus two pending resets |
| Video-conferencing encoder preset | Reject | Insufficient timestamp coverage and multi-second tails |
| AVCC bitstream | Reject | No material win; capture p95 was worse than Annex-B |
| Disable MSAA | No decision; keep current default | The attempted comparison coincided with a verified upstream SCK transition to 30 Hz, so it was causally invalid |

## Reliability work that changed benchmark validity

Two non-renderer defects were found during sustained testing:

1. SwiftUI `TimelineView(.animation)` allowed the automatic benchmark stimulus
   to settle at exactly 30 Hz even though the capture target was 60 fps. The
   stimulus now uses a `CADisplayLink` with an explicit frame-rate range. On the
   installed build, the first validation returned to 59.69 fps with no drops or
   resets.
2. A single in-app Browser tab could retain connections from previous hot
   reloads under different random client IDs. This caused frame-lease handoffs,
   decoder pending resets, and false 30 fps results. The tab identity is now
   stored in `sessionStorage`; the bridge replaces older same-ID/same-role
   sockets. After the migration reload, a second reload stayed at exactly one
   browser connection for five consecutive health samples with no lease
   handoff.

Invalid runs are deliberately excluded when the browser becomes hidden, the
lease changes, the phone route is not proven, the producer identity changes,
thermal state reaches serious/critical, timestamp coverage is insufficient, or
the decoder drops/resets.

## Reproduction

Keep one Studio tab visible and confirm `/health` reports one phone and one
browser. Then run:

```sh
BENCHMARK_DURATION_MS=10000 \
BENCHMARK_WARMUP_MS=2000 \
BENCHMARK_OUTPUT_PATH=/tmp/phone3d-production.json \
node scripts/benchmark-sweep.mjs \
  60:legacy:speed-priority:software:960 \
  60:legacy:speed-priority:software:960 \
  60:legacy:speed-priority:software:960
```

Use `npm run check` for the complete web and bridge regression suite and
`swift test --package-path ios` for the platform-neutral Swift protocol tests.
The physical iOS app must additionally be built with the Xcode 27 beta SDK.

## Remaining architectural limit

The browser path is now close to its useful optimization boundary. Decode p95
is only a few milliseconds and the USB transport is stable; the dominant costs
are the 60 Hz source cadence, capture/arrival timing, the render queue, and an
unmeasured Chromium compositor/presentation tail. A hidden Chromium tab also
cannot be treated as a real-time surface because browser scheduling is
intentionally throttled.

For a materially lower and background-independent visible latency target, the
next step is a native macOS receiver: `NWConnection` for the existing raw H.264
stream, VideoToolbox hardware decode to `CVPixelBuffer`, zero-copy
`CVMetalTexture`/IOSurface presentation through `CAMetalLayer`, and
`CADisplayLink`-aligned pose/render scheduling. Add signposts from frame arrival
through drawable presentation so the endpoint becomes present time rather than
R3F submission time. This is the credible path toward a sub-30–35 ms visible
p95; more browser tuning is expected to produce only small, workload-dependent
gains.

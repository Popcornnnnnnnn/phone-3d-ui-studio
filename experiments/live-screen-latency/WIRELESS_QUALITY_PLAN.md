# Wireless quality acceptance

## Goal

Deliver a wireless screen with readable text, intact icon edges, and smooth
gradients at the actual preview size, then minimize latency within that quality
constraint. USB is a development/control route only. High-speed photography is
out of scope. Software timing ends at R3F submission, not visible presentation.

## Gates and evidence

Current implementation checkpoint (2026-09-05): the default raw video route is
`wifi-only`, enforced on the iPhone's NWConnection even with USB connected.
The alternative `wired-preferred` remains available for explicit controls.
The app displays the actual video route and separately reports control/pose
connection state. Pose remains a system-routed WebSocket; its actual Mac socket
endpoint must also belong to Wi-Fi for a wireless experiment to qualify.

The raw transport supports 1/2/3 outstanding frames. Following user acceptance
and physical comparisons, the cold-start default is now **2** (2026-09-06).
Admission stops at 512 KiB outstanding
or 100 ms oldest-frame age. One oversized recovery frame may occupy the window
alone, with an absolute 2 MiB record limit. ACK deadlines remain separate;
packets already encoded are not selectively discarded to free slots. Rejected
encoder outputs retain the existing next-IDR recovery rule. Encoder admission
now remains held until the output callback completes transport admission.

Each frame has independent ACK accounting, so delayed/duplicate feedback from
the pose and raw sockets cannot free a different outstanding frame. Timeout
callbacks additionally check connection generation and frame token. Route or
window reconfiguration advances the encoder epoch, reconnects the raw stream,
and resumes at a keyframe. A loopback-only, custom-header-gated endpoint
`POST /transport/config?route=wifi-only&window=2` dispatches the configuration;
the runner requires the matching command ID in fresh phone telemetry before
measurement. No settings are changed during a benchmark or snapshot.

A static SCK screen no longer triggers the bridge's five-second raw-socket
timeout while the exact identified producer has a fresh streaming heartbeat.
Unknown, inactive, mismatched, or stale producers retain the timeout.

Verification: 36 Swift tests, 319 Web/Bridge tests, full web checks, and the
signed iOS build passed. The real NWConnection loopback harness verified all
three window sizes with delayed, reordered, and duplicate length-prefixed ACKs.
This demonstrates transport accounting, not wireless performance. Its initial
harness error read NWListener's port before ready; waiting for `.ready` fixed
the harness. No results from those failed invocations are performance evidence.

Current confirmation command, once the phone is sharing with the app and a
single regular Chrome receiver visible in FRONT view:

```sh
node scripts/wireless-window-sweep.mjs captures/wireless-window-new 2
```

The runner fixes 60 FPS target, 960 × 2088, 15 Mbps, legacy/speed-priority,
Annex-B/software decoding and records route/configuration telemetry throughout
each measured period (10 seconds by default, `WIRELESS_DURATION_MS=60000` for
a bounded 60-second short stability check). Each run has a 2-second warmup.
It refuses USB-contaminated, thermal, configuration, or decoder-invalid results;
the first invalid run stops the sweep, without automatically retrying. Accepted
reports and diagnostics are saved in a fresh ignored directory. Repeated
confirmation, actual rolling/text picture acceptance, and 30-minute stability
are still pending. The tentative next-stage gates are at least 50 fresh rendered
FPS with verified 60 Hz input and capture-to-render-submission P95 below 80 ms.
These are proposed thresholds, not measured achievements or visible latency.

### Physical preflight checkpoint, 2026-09-06

The signed app was installed and sharing resumed with one regular Chrome
receiver. Both sockets were verified on Mac Wi-Fi after USB was unplugged.
The first window sweep (`captures/wireless-window-20260905-a`) failed **before
measurement**: reconfiguration replaced the raw socket, but the static SCK
screen emitted no new frame, leaving raw producer identity unproven and the
receiver stale. No FPS or latency result was accepted. Readiness gates remain
unchanged. The startup patch displays a bounded six-second preparation
animation on the phone after the explicit transport command, stopping it when
the benchmark begins (before the separate two-second warmup). This generates
real source frames without asking the user to scroll for every configuration;
it does not manufacture frames or timestamps in the measured pipeline.

### Wireless window result checkpoint, 2026-09-06

Physical SCK output was approximately 59.99 fresh FPS, 960 × 2088, 15 Mbps
requested, legacy/speed-priority H.264 with source timestamps. USB was removed;
both video and pose local endpoints were verified on Mac Wi-Fi (`en0`) in
rolling telemetry. There was one visible regular Chrome receiver, software
Annex-B decoding, and nominal phone thermal state. Each accepted run measured
10 seconds after its own two-second warmup. No screenshot capture or build
was run inside those measured intervals.

| Candidate | Accepted runs | Fresh submitted FPS | Capture-to-submission P95 |
| --- | --- | --- | --- |
| Window 1, receiver capacity 2 | 3 | 22.98–23.36 | 95.48–102.02 ms |
| Window 2, receiver capacity 2 | 4 | 42.30–43.39 | 95.67–101.53 ms |
| Window 3, receiver capacity 3 | 1 | 41.42 | 95.88 ms |

Window 2 reproducibly improved throughput by about 85%, without changing the
requested image configuration. Tail latency did not materially improve. The
tentative 50 FPS / P95 <80 ms gate remains unmet. All accepted runs in this
table had zero run-local decoder resets/errors, but these short runs do not
establish sustained stability, scrolling quality, or visible latency.

The original window-3 trial with receiver capacity 2 reset the decoder ten
times for pending-frame overflow; its misleadingly low 41.84 ms P95 is excluded.
The receiver now recognizes only validated 1/2/3 transport windows. Window 3
allows three pending/queued frames, retaining the 75 ms age limit; windows 1/2
retain capacity 2, and hardware-AVCC's separate startup policy is unchanged.
The next window-3 run was clean but had no throughput benefit: more frames were
coalesced before rendering (36 versus 18 in the adjacent window-2 control).
This is bounded burst accommodation, not an unlimited receive queue.

Two further attempts were interrupted by real raw-frame ACK timeouts/reconnects,
including the reverse window-3 confirmation. No failed attempt was ranked or
automatically retried. ACK delays reached approximately 650–742 ms; their
origin (phone scheduling, wireless delivery, bridge scheduling, or feedback)
is not yet isolated. Do not attribute them to the router without evidence.
Further window expansion stopped. The current session was returned to Wi-Fi
window 2 for user scrolling/quality acceptance; the app's cold-start default
remains window 1 pending acceptance and a separately verified default update.

Evidence directories (local ignored data): `captures/wireless-window-20260906-b`
and `-c` contain the repeat controls; `-d` and `-f` preserve interrupted attempts;
`-e` contains the clean receiver-capacity comparison. Earlier report strings
hardcoded `w1`; use their matching configuration IDs and sampled phone window
telemetry, not that label. New reports record the actual window and receiver
capacity in both parameters and fingerprint, and cancel on a mid-run change.

Next gate: user inspects fast scrolling and stop-to-sharpness in the active
window-2 session. Then instrument send, bridge receive/ACK, and phone ACK arrival
with run-local timing to isolate the long stalls before any protocol expansion.
Pose optimization and the 30-minute sustained run remain pending.

Post-run visual check: the previous CALIBRATION view was nearly edge-on. The
table therefore describes pipeline/CPU render-submission throughput, not proof
of a full-face visible screen at that FPS. Chrome was switched to FRONT for
manual image/scrolling acceptance; the actual full-face rendering case still
needs its own controlled comparison. The current front view displays the live
screen, but one static screenshot is not motion-quality acceptance. Source
cadence and routing are instrumented; app-foreground/stimulus identity was
user-coordinated, not independently recorded as a telemetry gate. Add that
gate before treating a later unattended run as identical-content benchmarking.

Final code verification at this checkpoint: `npm run check` passed all 321
tests, lint, typecheck, and production build. The preparation-animation iOS
build succeeded and was installed; the subsequent receiver-only change needed
no further phone installation. No default-window release decision was made at
that checkpoint without user visual acceptance.

### Default and phase-timing checkpoint, 2026-09-06 01:10

The user reported that window 2 was substantially better, and authorized making
it the default and continuing optimization. `BoundedFrameWindow.productionCapacity`
is now 2. The signed app was installed and launched; fresh telemetry confirmed
window 2 **before** sending another transport-configuration command. Resolution,
target rate, encoder tuning, and decoder policy were unchanged. Exactly one
bridge service and one regular Chrome receiver were retained. The browser
routing skill kept verification in the existing Chrome tab, not Codex's panel.

Physical FRONT-view results (each has a 2-second warmup):

| Run | Window | Measured duration | Fresh submitted FPS | Capture-to-submission P95 |
| --- | --- | --- | --- | --- |
| trace-a / 1 | 2 | 10 s | 43.59 | 98.29 ms |
| trace-b / 1 | 1 | 10 s | 22.71 | 105.72 ms |
| trace-b / 2 | 2 | 10 s | 44.50 | 43.68 ms |
| trace-d / 1 | 2 | 59.94 s | 42.34 | 92.80 ms |

All four accepted runs had Wi-Fi endpoints for both video and pose, visible
Chrome, nominal phone thermal state, verified foreground benchmark stimulus,
and zero run-local decoder errors/resets. The two short window-2 controls vary
greatly in P95; do not describe the best 43.68 ms sample as a stable latency win.
Source cadence settled near 59.99 Hz; the first rolling cadence sample can
still include preparation. FPS measures fresh CPU-side render submission, not
displayed photons. User motion-quality acceptance and these software numbers
are separate evidence grades.

The 60-second trace contains 2,746 acknowledged frames and no failed-frame
records or ring gaps (trace scope includes preparation and drain). ACK RTT
P50/P95/max was 12.68/94.78/248.15 ms. Phone send completion P95 was 0.89 ms;
Mac processing after record assembly P95 was 0.128 ms; the phone ACK callback
handoff P95 was 0.283 ms. Clock-quality-gated forward/return P95 estimates were
78.70/14.52 ms. These include scheduling and network-stack effects, and do not
isolate radio airtime or prove that the router is responsible. Independent Mac
ACK-issued records can be joined to failed phone records; issued is not delivered.
Browser decode/render-queue P95 was 4.5/8.4 ms in this run. Percentiles from
different phases must not be summed or subtracted to derive a causal budget.

The interval-weighted software interaction-response model, which includes the
wait for the next fresh frame, remained materially worse than capture-only
latency: P50/P95 45.53/164.68 ms with 99.95% coverage in the 60-second run.
Remaining responsiveness work should prioritize delivery gaps/tails, not just
the latency of frames that made it through.

`trace-c` is an invalid attempt: the app was not foreground before dispatch,
so the phone did not start its benchmark and the bridge eventually timed out.
No measured samples/report existed. The runner now rejects missing foreground
telemetry **before any device command**, checks it during preparation, and
retains all-phase telemetry rather than only running samples. A specific
foreground-restored condition justified the one retry (`trace-d`); no automatic
retry loop ran. Sharing itself continues when the app is backgrounded.

Evidence lives in ignored `captures/wireless-default-trace-20260906-{a,b,c,d}`.
`FrameTransportTrace` keeps only a bounded metadata ring, forwarded once per
heartbeat and stripped from ordinary status history; the separate loopback-only
trace endpoint supports incremental cursors. Trace data contains timings and
frame metadata, not screen pixels. Final full web checks passed 326 tests,
lint, typecheck, and build after the foreground-preflight regression was added;
the focused transport suite passed 9 tests. Swift tests passed 40, actual NWConnection loopback accounting
passed windows 1/2/3, and signed iOS build/install succeeded. The runner's final
duration-boundary checks rejected all six invalid inputs before device access.

The user plugged the phone into power and authorized unattended testing and
scoped phone operation while asleep. Both observed sockets remained Wi-Fi after
charging. Next work: retain this known-good candidate; investigate wireless
delivery/feedback stalls one variable at a time, then pose separately. Do not
increase the frame window blindly, lower image quality to inflate FPS, or turn
off unrelated macOS networking/security features. A genuine uninterrupted
30-minute acceptance run remains outstanding: short segmented runs do not
substitute for it. Stop if sharing consent/lock prevents continuation, if the
phone overheats, or if a condition cannot be changed without the user.

Night continuation is installed as the current-thread heartbeat automation
`iphone` (iPhone 无线延迟夜间优化), every 15 minutes, with a written stop-and-report
cutoff at 2026-09-06 08:00 Asia/Shanghai. It must pause on completion, user stop,
or a user-only prerequisite, rather than repeatedly polling. OpenAI Docs routing
led to a same-task continuation instead of separate recurring checkouts.
The current known-good app and source archive are saved under
`captures/wireless-known-good-20260906`; source archive SHA-256 is
`edbad6fbecbf72ab7f268b890437dc7ab0a6803683f6511edef0caa9bbe5a638`;
main app executable SHA-256 is
`bdca5c54f6f2fb8987c7db0cf9cf7941d7ebdd22fdd14f8e023ee9c198aa4308`.
These are rollback artifacts, not a clean Git snapshot; preserve unrelated work.
A temporary `/usr/bin/caffeinate -di -t 24042` process (PID 63784 at launch,
parent exec session 88110) prevents Mac idle/display sleep until approximately
08:00. On early completion/block, verify its exact live process identity and
stop only this task-owned assertion. It changes no persistent power setting.

### Incremental diagnostic candidate, 2026-09-06 01:45

Previous goal turn: **progress** (default installation and physical controls).
This turn: a new controlled baseline plus an implemented, uninstalled candidate.
No overlapping benchmark was running; bridge PID remained 48507. Both phone
sockets were Wi-Fi, foreground and nominal. Chrome was temporarily `hidden`
despite an unlocked Mac; clicking the existing FRONT control restored `visible`.
No additional browser/device hub was opened. `hasFocus` alone is insufficient.

Read-only `nettop` monitoring on the exact bridge PID showed about 132 KB/s
received on the control connection even with a static screen. Source inspection
confirmed each 1-second heartbeat re-encoded all 128 recent trace records,
indefinitely repeating old evidence. The byte rate also includes pose/status;
it does not prove diagnostics caused the pre-existing stalls.

The new FRONT baseline with low-rate system-counter collection passed: 42.98
fresh submitted FPS, capture-to-submission P95 53.50 ms, 10.03 seconds measured,
no exclusions. `captures/wireless-trace-overhead-20260906-a` contains the report,
telemetry, trace, raw CSV and `nettop-summary.json`. The separate network window
includes preparation/drain: control received 2,500,145 bytes across 19 seconds
(131,580 B/s); the new raw socket received 20,240,079 bytes across 18 seconds.
Raw duplicate-receive/retransmit counters and control retransmit counters grew.
These coarse host-side counters do not align individual latency outliers or
prove TCP retransmission caused all delay. No privileged packet capture or
system/network configuration change was made.

The v2 candidate sends bridge-confirmed **incremental trace batches**:

- Revisions follow record completion/update rather than frame ID, preserving
  reordered frame ACKs and late send-completion fields.
- Retry only unacknowledged records; an acknowledged idle batch is empty while
  the bounded local ring remains intact. Reconnect resets the export generation
  and replays retained history; stale/future delivery ACKs are rejected.
- Explicitly report bounded offline eviction as a trace gap. The bridge validates
  whole batches before ACKing, remains compatible with v1, and summarizes only
  the latest revision per frame. The collector detects phone and bridge gaps.
- The metadata ACK uses the existing control socket and exact producer/export
  generation. It does not alter video ACK pacing, picture settings, or pose mode.

Checks passed: 43 Swift tests; 330 web/bridge tests, lint, typecheck and build;
signed iOS build. `node scripts/transport-trace-selfcheck.mjs` passed real
loopback WebSocket/HTTP integration for exact delivery ACK, failed-frame
retention, trace retrieval and normal-history stripping. Its isolated temporary
server was stopped, and the new script passed focused lint. These results do
not establish a physical Wi-Fi speedup.

The app was **not installed**, and the running bridge was **not restarted**;
current sharing remains on the prior candidate. New app/source artifacts are in
`captures/wireless-incremental-trace-candidate-20260906`. Executable SHA-256:
`470811c2acdfba03f830645bad2209152ae14a2cdbb9b485d96a10b411e2147d`;
source archive SHA-256:
`d049d87d3bab4b12f6aace5771cd58fb7a91e0f34ab63dedd51f8fb7bef72f08`.
The mutable `/tmp/phone3d-quality-device` output now contains this new app;
use `captures/wireless-known-good-20260906` for rollback instead.

Next: compare v1/v2 control traffic and video/pose gaps under identical physical
motion/picture settings. Verify an in-scope way to resume system sharing before
interrupting the current capture; do not repeatedly install if consent cannot
be completed while the user sleeps. Existing image evidence is in
`QUALITY_FINDINGS.md`, to read before repeating those controls. Full three-stage
image acceptance, pose optimization and 30-minute continuous acceptance remain
subject to the original goal audit; no completion claim has been made.

### Remaining image-quality controls

Checkpoint 2026-09-06 02:20: saved physical IDRs now have actual Chrome decode
and production-shader 1:1 evidence; see the new opening section of
`QUALITY_FINDINGS.md` and `captures/browser-quality-20260906-a`. On those app samples the shader adds
no material blur (5 Mbps RGB identical; 15 Mbps max one byte level, all named
regions identical). Do not repeat this hypothesis without changed evidence.
Still missing: actual viewport scaling/view-angle isolation, native source
resolution comparison, current moving-frame quality, and user acceptance.
SPS/VUI color metadata is a bounded independent follow-up, not justification
for changing the live color matrix blindly. The incremental trace v2 candidate
remains built but uninstalled; installed device/bridge have not changed here.

Checkpoint 2026-09-06 02:45: the color lead was followed through exact input and
IDR-byte controls. Explicit source color tags fix a demonstrated interpretation
error: Chrome decode RGB RMSE 7.6602 → 0.5796, final 1:1 shader 8.0597 → 2.5402.
This is a Mac fixed-color experiment, not a physical-device benefit. Source and
signed iOS build now include the color repair plus trace v2; candidate is saved
at `captures/wireless-color-candidate-20260906`. Stable installed app remains v1,
window 2, Wi-Fi, 15 Mbps. See `QUALITY_FINDINGS.md` for evidence, hashes, schema-v2
ROI correction, and remaining chroma-edge sampling differences. Do not repeat
this successful offline control or install/restart blindly: next device gate
is ability to complete sharing consent, then physical same-frame validation.

For a clean physical A/B, prepare a **color-only** app from the 2.3 MiB
`captures/wireless-known-good-20260906/source.tar.gz` in a fresh temporary build
directory, replacing only the encoder with this reviewed color patch. Do not
overwrite the working tree or rebuild the stable backup. This keeps trace-v1
constant for the first device picture comparison; then test trace-v2 separately.
The combined candidate remains a saved integration build, not a single-variable
performance experiment. This is useful independent work while the user sleeps;
do not cross the physical image acceptance gate or repeatedly attempt consent.

End-of-turn browser handoff at 02:51: old temporary tab was no longer present,
so normal Chrome tab `129036982` was used for both color replays, then returned
to `/`, FRONT, and explicitly marked for handoff so it should remain available.
Same Wi-Fi/window-2 restoration config is
`1d02470f-faab-40b1-b58a-f188255e7af4`. Only one live receiver is intended; recheck
health before opening another. Phone remains nominal/foreground/streaming on
the stable installed app. No timed benchmark or consent/install attempt here.

Handoff state at 02:23: the former Chrome receiver tab had been closed before
this checkpoint (bridge reported zero browsers). The diagnostic's single new
normal-Chrome tab `129036978` was returned to `/` and FRONT; one receiver is now
connected, no duplicate. Restoring the **same** Wi-Fi/window-2 config
`63d07846-00c3-46ff-8345-dc9e386db8a4` briefly animated the phone's existing
preparation stimulus so the newly joined browser could obtain an IDR. Actual
live screenshot was inspected, 148 frames received, no decoder errors/resets;
phone foreground, nominal thermal, source SCK, raw route en0 Wi-Fi. This was a
restore/smoke check, not a timed benchmark. Static SCK content then stops emitting
fresh frames and the UI shows STALE despite a connected producer; this separate
status/first-frame UX issue must not be mistaken for measured moving-frame loss.

1. Establish aligned reference, pre-encode, and decoded image comparisons.
   Mac replay of the production encoder is a diagnostic/control experiment,
   never proof of iPhone capture, wireless performance, or browser output.
2. At fixed 960 short edge, compare 5 Mbps speed-priority with 5 Mbps default
   tuning. Test 10 and 15 Mbps only if residual defects justify it; 20 Mbps is
   a ceiling experiment, not an automatic default. Keep all other settings fixed.
3. Validate the best candidate on the physical iPhone and compare native source
   resolution if scaling remains the limiting factor. User inspects the same
   text/icon/gradient crops. Do not declare perceptual acceptance from a score.
4. Validate wireless delivery and pose separately, then a 30-minute sustained
   run. A candidate may pass picture quality but fail wireless latency.

Use aligned, same-size RGB error/PSNR and luminance structural similarity for
codec loss. Report scaling loss separately. Keep first-frame and settled static
quality distinct; neither establishes scrolling/motion quality. Do not compare
perspective screenshots numerically without alignment. Save personal images
only under git-ignored local captures; commit neither images nor embedded reports.

## Stop and checkpoint rules

Checkpoint 2026-09-06 03:15: **progress**, not an acceptance result. The isolated
color-only signed device build is saved at
`captures/wireless-color-only-candidate-20260906`; recursive source comparison
against the known-good iOS tree found only the reviewed encoder change. Trace-v1
stays constant. No installation or restart was performed.

Native 1206 × 2622 device screenshots now work through Xcode's capture command.
Static app content was byte-identical before/after the paired 960 × 2088 SCK
snapshot. The inspected buffer has two padding rows; the first unaligned metric
run is excluded. The corrected control quantifies pre-encode size loss separately
from H.264 (body RMSE 4.9677 versus Lanczos size-only control 3.8918; these are
not additive contributions). See `QUALITY_FINDINGS.md` and the versioned local
evidence. Do not repeat this completed static-source experiment without a new
condition. Native-resolution streaming is still untested and is not a default.

The installed app only accepts benchmark short edges 960/720/640; increasing
resolution therefore needs a new device build, not an unsupported live command.
The available Xcode device capture API is read-only; no exposed device-tap or
sharing-consent API has been verified. Stop install-dependent work at that gate
instead of replacing the app and losing the working session. Physical color
validation, user picture acceptance, moving-frame/pose optimization and the
30-minute uninterrupted acceptance run remain outstanding. This checkpoint did
not rerun the already-completed offline color or web shader controls.

03:17 stop checkpoint: useful independent work is saved; the next discriminating
device experiment needs app replacement plus system sharing confirmation. The
`iphone` heartbeat was changed to **PAUSED**, preserving its prompt/schedule, and
the automation tool plus TOML readback confirmed it. The task-owned caffeinate
PID 63784 was verified, terminated, and confirmed absent; no persistent power
settings changed. This is not a completed goal or a three-turn blocked audit.
On the user's return, install the isolated color-only candidate, then ask once
for unlocking/opening Phone 3D Studio and confirming sharing. Do not wake/retry
automatically while that prerequisite remains unavailable. Last live check:
one browser/phone, nominal temperature, foreground SCK, 960 × 2088, 15 Mbps,
trace-v1, both phone sockets over en0 Wi-Fi, no active benchmark. Chrome was
hidden in telemetry; no rendered-FPS claim applies to this static interval.

Subsequent goal continuation audit: the same install/sharing-confirmation
prerequisite remained across three consecutive goal turns, including the
03:17 checkpoint. The following turn only revalidated unchanged live state
(no progress, not a wait on an active experiment); the third again confirmed
the same producer session, streaming/foreground/nominal phone, one receiver,
no active benchmark, and the paused heartbeat. All useful independent controls
and the isolated candidate are already saved. Goal status is now **blocked**,
not complete. Do not automatically repeat checks or tests without a user reply
or a relevant capability/state change. Remaining acceptance requirements are
unchanged; resume with the saved color-only candidate and one sharing restart.

### User resumed — 2026-09-06 12:57 Asia/Shanghai

The user returned and requested continuation. Fresh checks found one existing
bridge/receiver and a nominal, unlocked phone; no active benchmark. Both phone
sockets used en0 Wi-Fi. The saved color-only archive and debug-dylib hashes
matched provenance; strict codesign verification passed. The exact saved app
was installed successfully with devicectl (existing `com.phone3dui.studio`,
container `BEA1DC44-D2C4-4FEA-A15F-76A6D4D01EAB`, database sequence 4572) and
launched successfully. The bridge was not restarted and trace-v2 was not mixed
into this test. Now request one system-sharing confirmation, then collect a
physical paired snapshot and verify actual SPS/VUI and Chrome output. Installation
is progress, not physical quality acceptance. The old overnight heartbeat stays
paused; the 08:00 cutoff is past. A resumed blocked audit starts afresh.

13:05 checkpoint: **progress**. Sharing was already active on the new producer
session `76cc5ea1-fcd3-45a1-92ca-c8495929e79b`, so no redundant sharing request
was sent. The color-only repair passed actual device SPS/VUI and Chrome color
interpretation validation. The new paired frame 247 has complete input/native/
Chrome/production-shader evidence; see the latest `QUALITY_FINDINGS.md` section.
The first static no-frame timeout was followed by one changed-condition success,
not an unchanged retry. No wireless latency claim or user picture acceptance yet.
Next gate is the user's static text/icon/gradient judgment; if still soft,
implement a separate higher-resolution capture control rather than repeating
color/shader diagnostics. Moving-frame and pose performance follow the original
quality gate, with 30-minute continuous acceptance still outstanding.

User workflow requirement: after each browser test, archive needed evidence
under ignored project `captures`, verify the copy, then remove this project's
test downloads from Downloads (prefer recoverable Trash). Never delete unrelated
downloads or archived evidence. The 13 existing project downloads were processed
this way on 2026-09-06 at 13:05; the original live Chrome tab is preserved and
the temporary non-receiver diagnostic tab is closed after use.

### Static picture accepted; wireless preflight held — 2026-09-06 13:09

The user explicitly confirmed the current static picture: “不发糊，没问题”.
This passes the static text/icon/gradient judgment gate for the installed
color-only 960 × 2088 / 15 Mbps candidate. Do not generalize it to fast scrolling
or 30-minute stability. Move next to controlled wireless video/pose performance;
do not raise resolution or bitrate merely to continue generating experiments.

Before starting load, current telemetry reported thermal state `fair`, with
video on en0 Wi-Fi but the phone-pose/control socket on the en8 link. The existing
`wirelessSampleErrors` already requires **both** sockets to match the Mac Wi-Fi
addresses and requires nominal thermal state. No benchmark was started, no
extra app installed, and no guard was relaxed. Ask the user once to disconnect
the Mac USB data cable (a separate charger is fine) and let the phone cool, then
verify nominal + both Wi-Fi paths before the trace-v1 baseline / trace-v2 A/B.
The original overnight heartbeat remains paused. This turn records new user
acceptance, not a valid wireless performance result.

- One primary hypothesis and at most four initial configurations per checkpoint.
- No more than two retries after an initial invalid run. Retry only after a
  specific condition changes; do not poll for user action or reconnect forever.
- Two successive valid A/B rounds with no repeatable visual or metric benefit
  end that hypothesis. A small isolated score change is not a quality win.
- Stop dependent device work immediately for missing sharing consent, missing
  reference, or absent device. Finish useful independent code/report work, then
  ask for one bundled user action.
- Pause expansion at each evidence gate: state what was measured, what changed,
  what remains unverified, and the next discriminating experiment.
- Each 30 minutes of active work must yield a runnable tool, interpretable
  experiment result, verified patch, or explicit blocker. If none appears, stop
  and reassess rather than extending the same loop.
- Run focused checks during edits and one full relevant suite after stabilization.
  Keep raw output in local files; inspect compact summaries. No automatic agent
  fan-out, exhaustive parameter matrix, repeated UI screenshots, or unrelated work.

## Completion

Complete only after physical wireless image acceptance by the user, selected
configuration with quality/performance evidence, sustained validation, and
documented limits. An offline test, code build, or lower latency alone is not
completion. No claim of an absolute hardware limit.

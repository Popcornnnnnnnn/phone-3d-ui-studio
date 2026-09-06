# Implementation plan

Spatial interaction is the primary development track. Live-screen latency, picture quality and stability remain supporting work.

## S1 delivery order

1. Capture the actual working-tree baseline in an isolated implementation worktree, including dependent uncommitted source. Keep the original supporting-track checkout intact.
2. Add native Spatial tracking mode, ARKit lifecycle and metadata-only transport.
3. Add isolated bridge roles, Web coordinate conversion, explicit origin calibration and failure freezing.
4. Verify contracts, lifecycle, deterministic browser trajectories and physical iPhone compilation.
5. Preserve a known-good rollback app, install the reviewed spatial build, and perform the guided physical session. The initial run required one corrective installation for transport buffering; two installs were made in total.
6. Record software evidence and physical evidence separately; keep S1 open until the physical gates pass.

## Acceptance

Steps 1–4 and the installation are complete. Basic live movement has been
observed; the manual session has ended and the remaining physical gates are
pending. The software delivery is ready for self-guided use. See the
[中文体验与验收说明](docs/S1_QUICKSTART.zh-CN.md) for startup, expected behavior,
state recovery and a single concentrated acceptance procedure.

Use the scenarios and explicit pending-state table in [S1 delivery](docs/SPATIAL_S1.md). The target for the controlled 20 cm trials is endpoint/return deviation at most 3 cm across three repetitions; this is a local experiment gate, not a device accuracy specification.

S2 and S3 are not bundled into S1. The previous estimate and full live-screen work breakdown remain in the [historical project plan](docs/legacy/live-twin-project-plan.md).

## S2 delivery

Explicitly authorized prototype development from committed S1 baseline `6efefab`, in the isolated `codex/spatial-s2` worktree. The original supporting-track checkout and the S1 checkout are preserved.

The bridge owns 120 Hz physics; Web and native Canvas render shared snapshots with a 50 ms buffer. One ball, one right exit, slow gravity, fixed-target Return and real collision catch are implemented. No five-ball expansion or wireless tuning is included.

Software tests and exact-worktree synthetic browser checks precede signed device installation. Physical acceptance is a separate concentrated session: five complete cycles, one miss, interruption recovery, numerical traces and external same-frame video. S1 outstanding checks remain pending rather than being inferred from synthetic evidence. See [S2 delivery](docs/SPATIAL_S2.md).

## S2.1 delivery

Implemented from committed S2 `47b63935324f41023a43c1469d55c24eb8c52e26` in isolated branch `codex/elastic-tray`. Preserve S2 signed app and bridge configuration before changing the live installation. The original main/supporting and S1/S2 checkouts remain untouched.

1. Fix finite-depth projection and complementary clipping on both displays.
2. Add dissipative elastic tray motion, one-active/five-retained lifecycle and reliable phone addition.
3. Upgrade Marble protocol to v2 and both renderers; preserve S1/mirroring contracts.
4. Complete software tests, exact-copy ordinary-window browser verification and signed iPhone build.
5. Install the reviewed bundle once, switch the existing bridge with rollback intact, then conduct one concentrated unplugged session.
6. Deliver evidence by grade. Leave wireless acceptance pending until five minutes, ten contacts, three misses/additions, one reconnect and external same-frame footage are verified. Full-screen/Esc interaction is user-tested only.

[Current experience and evidence](docs/ELASTIC_TRAY.md). Previous S2 Return rules remain historical and are not current product requirements.

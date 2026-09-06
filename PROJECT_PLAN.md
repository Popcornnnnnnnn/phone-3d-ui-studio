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

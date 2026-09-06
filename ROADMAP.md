# Roadmap

## Main track: spatial interaction

| Milestone | Outcome | Gate |
|---|---|---|
| S1 — 6DoF foundation | ARKit camera pose drives a gravity-aligned Web workspace; calibration and recovery are explicit | Software checks plus measured physical-device acceptance |
| S2 — One marble | One object crosses the screen boundary and can be caught back into the phone | Prototype development allowed; formal collision acceptance requires remaining S1 checks |
| S3 — Playable marble box | Five marbles, receiving trough, slow return launches, pour/catch/reset loop | S2 continuous two-screen crossing accepted |

S1 software is delivered and installed. Basic physical movement and about five
minutes of USB metadata continuity have been observed; formal physical acceptance
remains pending. Follow the [中文体验与验收说明](docs/S1_QUICKSTART.zh-CN.md) for
self-guided use and the remaining checks. Detailed evidence lives in
[SPATIAL_S1.md](docs/SPATIAL_S1.md). S2 prototype software is implemented; concentrated physical loop acceptance remains pending. See [S2 delivery](docs/SPATIAL_S2.md). New calendar promises are
not inferred from the old live-screen schedule.

## Supporting track: live-screen quality and performance

Preserve existing screen mirroring, latency instrumentation, picture-quality findings and stability work. Resume supporting optimization separately; only measured shared blockers take priority during S1.

The previous M0–M6 dates and completion history remain in the [historical roadmap](docs/legacy/live-twin-roadmap.md).

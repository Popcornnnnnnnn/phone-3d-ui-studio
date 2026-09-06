# Roadmap

## Main track: spatial interaction

| Milestone | Outcome | Gate |
|---|---|---|
| S1 — 6DoF foundation | ARKit camera pose drives a gravity-aligned Web workspace; calibration and recovery are explicit | Software checks plus measured physical-device acceptance |
| S2 — One marble | One object crosses the screen boundary and can be caught back into the phone | Prototype development allowed; formal collision acceptance requires remaining S1 checks |
| S2.1 — Wireless elastic tray | Real-motion toss/catch, phone Add ball, one active ball and at most five visible traces | Five minutes unplugged, ten contacts, three misses/additions and interruption recovery |
| S3 — Multiple marbles | Explore five active marbles and further physical interactions | Defer scope until S2.1 and remaining S1 collision prerequisites pass |

S1 software is delivered and installed. Basic physical movement and about five
minutes of USB metadata continuity have been observed; formal physical acceptance
remains pending. Follow the [中文体验与验收说明](docs/S1_QUICKSTART.zh-CN.md) for
self-guided use and the remaining checks. Detailed evidence lives in
[SPATIAL_S1.md](docs/SPATIAL_S1.md). S2 is retained as a historical rollback. S2.1 replaces Return with real-motion toss/catch and explicit phone addition; wireless physical acceptance remains pending. See [S2.1 delivery](docs/ELASTIC_TRAY.md). New calendar promises are
not inferred from the old live-screen schedule.

## Supporting track: live-screen quality and performance

Preserve existing screen mirroring, latency instrumentation, picture-quality findings and stability work. Resume supporting optimization separately; only measured shared blockers take priority during S1.

The previous M0–M6 dates and completion history remain in the [historical roadmap](docs/legacy/live-twin-roadmap.md).

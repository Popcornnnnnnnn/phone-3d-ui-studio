# Product goal

The main track is **spatial interaction between a physical iPhone and a Web 3D world**. The phone contributes its position, orientation, screen boundary and, in later milestones, interactive content and feedback.

## S1: spatial tracking foundation

One real iPhone drives the position and orientation of the matching model after a single explicit origin calibration. Gravity stays vertical, metric distances stay consistent, and loss of tracking freezes the last credible pose with a visible explanation. The user can deliberately re-establish the workspace after recovery.

The desktop remains Web-based. The existing native iPhone app contains mutually exclusive Spatial tracking and Screen mirroring modes. S1 uses a relative workspace, not measured alignment with a physical display or tabletop.

## Subsequent main-track milestones

- S2: one shared marble can cross the phone screen boundary in both directions.
- S3: five marbles, a receiving trough, slow return launches and a repeatable pour/catch loop.

S2 is gated by physical S1 acceptance. Neither milestone is implemented in S1.

## Supporting track

Existing screen mirroring, picture quality, latency and stability optimization continue as a separate, lower-priority track. Existing working behavior and evidence are retained. Supporting-track optimization is not a prerequisite for spatial work unless a measured shared dependency blocks it.

No generic model viewer, timeline editor, macOS native rewrite, cloud relay or multi-device platform is part of S1. See [S1 acceptance](SPATIAL_S1.md) and the [historical live-twin goal](legacy/live-twin-product-goal.md).

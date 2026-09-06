# Product demo gallery

Four looping GIFs for the repository README, rendered at **960 × 600**, with **108 frames** each. The motion is sampled at **15 fps**, with short holds at the start and end for readability. The manifest records exact durations, sizes, and checksums.

| Clip | What it shows |
| --- | --- |
| [Spatial movement](spatial-movement.gif) | Translation and yaw of the phone in the world |
| [Toss and catch](toss-and-catch.gif) | Two small upward tray motions and two subsequent collision contacts |
| [Land and add](land-and-add.gif) | Ball exits on the right, lands, then an explicit addition creates a new ball while preserving the ground trace |
| [Play settings](play-settings.gif) | Three separately initialized rounds with 25 / 50 / 100% movement, 10 / 15 / 20 mm ball diameter, and 0.10 / 0.20 / 0.50 bounce |

## Provenance

- Source: S2.1 implementation at commit `a4e466b`. This gallery contains no UDP candidate code and no unpublished freeze-recovery changes.
- Original procedural phone geometry from this repository. No privately licensed GLB or captured personal screen content is included.
- Motion inputs are scripted; world snapshots come from the existing `MarbleWorld` running Rapier **0.20.0** at **120 Hz**, with **1.5 m/s²** demonstration gravity.
- The phone inset uses the existing `drawMarbleScreen` projection of the same snapshot. It is a rendered explanatory inset, not an iPhone camera or screen recording.
- Render-only presentation uses a studio environment, a fixed camera, descriptive captions, and a slight screen-surface offset to keep the procedural front glass from occluding its display. These presentation choices do not change collisions or ball trajectories.
- The settings clip starts a separate world for each preset. Those transitions are explicit resets, not continuous changes to a running simulation.

The GIFs explain the prototype. They do **not** establish ARKit tracking accuracy, real hand-motion latency, wireless continuity, or physical-device acceptance. Use the release notes and physical validation records for those claims.

The independent local capture workspace and uncompressed frames remain outside Git. `manifest.json` describes the distributable files.

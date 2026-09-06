# Spatial architecture — S1 and S2

## Runtime ownership

- iPhone SwiftUI owns the selected mode. A separate ARKit controller owns camera permission, ARSession, foreground lifecycle and a spatial LiveSocket instance. Screen capture is stopped before spatial mode becomes available; late capture-picker updates are gated when that mode is inactive.
- The Node bridge routes `phone-spatial` to `browser-spatial` independently of the existing video leases. One spatial producer owns a connection generation; replacement and reconnect invalidate browser calibration.
- The Web spatial workspace owns calibration, freshness and rendering. Pose updates go through refs and an imperative tracker. React status refresh is capped at 10 Hz.

## Spatial wire contract

`spatial-pose` and `spatial-status` carry source (`arkit` or explicitly marked `fixture`), sessionId, monotonically increasing sequence, sampledAtMs, trackingState, reason, and optional clockOffsetMs/clockRttMs. Pose packets additionally carry camera positionMeters and quaternion `[x,y,z,w]`. Status packets work without a pose, including denied permission and paused sessions.

The bridge announces `spatial-link` with sessionId and a new connectionId, binds messages to that producer, adds connectionId and bridgeReceivedAtMs, and drops malformed/out-of-order packets. Only the allow-listed metadata fields are relayed. The existing clock-sync exchange is available on the spatial socket. Spatial routes do not acquire video leases or request video keyframes.

Each accepted spatial packet receives a private spatial-ack. Native flow control allows one unacknowledged packet and one replaceable latest packet, because URLSession send completion alone only proves local buffering. A one-second missing receipt reconnects the transport. A 16 KiB browser send threshold bounds browser user-space queues. A congested lifecycle announcement closes the browser connection so it can reconnect with current identity instead of missing a generation change. Bridge shutdown closes spatial clients too.

## Coordinate contract

ARKit camera transforms are right-handed and use a fixed device basis: camera X points toward the phone bottom, Y toward its right and Z out of its screen. Camera-from-body rotation is a fixed +90 degrees about Z. Body position subtracts the camera lever arm rotated by body orientation.

The lever arm is an explicit geometric approximation of the existing model main-camera marker, not calibrated hardware extrinsics. Raw camera and estimated body data remain separate. All spatial calculations use meters. Existing three-unit model geometry is scaled by `0.14961 / 3`.

Origin calibration removes translation and yaw only. It projects the phone's top edge onto the horizontal plane and maps it toward workspace -Z, preserving roll and pitch. A near-vertical top edge cannot define heading and is rejected with a hold-screen-up instruction. The calibrated body starts at `[0,0.2,0]`; this is a display reference and does not measure the tabletop.

Spatial rendering has exclusive transform ownership. The reused phone model's grounded-height compensation, pose prediction, ambient animation and orientation presentation adjustments do not run. The observation camera never follows the phone.

## Failure handling and evidence

Non-normal tracking or 250 ms without a valid pose invalidates calibration and freezes the last rendered transform. Fresh tracking cannot move it until Set origin is used again. ARSession restarts, network reconnection, page reload and backgrounding require another calibration. Old-session and old-connection messages are ignored.

Numeric recording stores received camera samples and CPU render submissions separately, with bounded retention and explicit dropped-record counts. Cross-device sample age is shown only with available low-RTT clock synchronization. Software timing is not photon latency; numeric traces do not establish physical accuracy.

Camera imagery never enters the spatial transport. The previous media architecture is preserved as a [historical supporting-track reference](legacy/live-twin-architecture.md).


## S2 authoritative world

`shared/phoneGeometry.mjs` and `shared/spatialMath.mjs` hold the unchanged metric model constants, camera/body transform and yaw-only calibration used by S1 and Node. S1 owns its own origin; S2 origin belongs exclusively to the bridge world. Switching Tracking / Marble unmounts the previous Web client.

`MarbleService` lazily initializes pinned `@dimforge/rapier3d-compat@0.20.0`. `MarbleWorld` runs 120 Hz fixed steps with downward 1.5 m/s² gravity. The CCD-enabled dynamic sphere keeps its identity, transform and velocity across the phone boundary. The rounded shallow tray is a position-based kinematic body; next-step targets interpolate between received poses, without future prediction. Floor contact and damping settle the ball. Return applies an impulse toward the initial calibrated catch center with a 1.5 s ballistic flight, then detects sustained real tray-floor contact. A relocated phone cannot change the target. Catch never teleports the ball; explicit reset/recalibration may do so.

Native `world-hello` version 1 enables S2 while legacy phones retain S1. The first browser `start` command claims ownership. Commands contain world ID, epoch and unique command ID; duplicate results are cached. Other browsers observe. Owner disconnect/hide pauses; explicit takeover starts a newly calibrated round. Native pause/stop and snapshot receipts use reliable `sendControl`, never the coalescing pose sender.

Complete `world-snapshot` messages include world/epoch/sequence, bridge timestamp, owner and phone identities, source label, phase, phone and marble transforms, velocities, catch count/target and metric geometry. Each consumer has at most one unacknowledged and one replaceable latest snapshot. Missing necessary receipts/poses for 250 ms freezes the world; 1 s missing receipts closes the connection. There is no physics catch-up after interruption. Reconnect and backgrounding require a newly calibrated round.

Both consumers present phone and ball at the same bridge time minus 50 ms, interpolate only between received states and hold when no newer state exists. The native buffer applies the existing clock estimate; unavailable clock synchronization prevents running. Web uses the same Mac clock as the local bridge. High-frequency frames are not React/SwiftUI published application state.

The native portrait-only full-screen Canvas orthographically projects the ball into metric display coordinates and clips at the rounded screen boundary. Web uses the same projection in its screen texture, with complementary phone-local fragment clipping on the 3D sphere. This is an opaque marked sphere prototype; no refraction, camera imagery streaming or second physical simulation is used. `shared/fixtures/marble-frames.json` is consumed by Swift and Web mapping tests.

See [S2 verification](SPATIAL_S2.md) for evidence grades and remaining physical/display checks. The camera-to-body lever arm remains approximate and must be measured before formal collision acceptance.

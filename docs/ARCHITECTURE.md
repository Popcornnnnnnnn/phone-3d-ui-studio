# Spatial architecture — S1

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

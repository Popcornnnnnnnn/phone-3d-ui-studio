---
name: verify-webplay-room
description: Formally verify WebPlay room relay takeover, Durable Object close deduplication, P2P DataChannel teardown, stale WebRTC offer suppression, and 4001 reconnect-storm invariants with TLA+ and TLC. Run during any major update or when changing worker/src/index.ts, src/webplay/roomConnection.ts, scripts/webplay-room-relay.mjs, or shared/webPlayProtocol.mjs.
---

# Verify WebPlay Room Protocol State Machine

Checks `formal/WebPlayRoomProtocol.tla` covering the WebPlay room relay and client P2P takeover lifecycle across Cloudflare Durable Objects, the local Node dev relay, and browser clients.

## Coverage & Sync Record

- `sync_commit`: `c606012`
- **Covered files & symbols:**
  - `worker/src/index.ts`: `RoomRelay.fetch`, `RoomRelay.webSocketMessage`, `RoomRelay.webSocketClose`, `RoomRelay.webSocketError`, `RoomRelay.handleSocketClose`, `RoomRelay.getActiveSockets`
  - `src/webplay/roomConnection.ts`: `RoomConnection.openSocket`, `RoomConnection.handleRawPayload`, `RoomConnection.startPeerAsOfferer`, `RoomConnection.acceptOffer`, `RoomConnection.teardownPeer`
  - `scripts/webplay-room-relay.mjs`: `createWebPlayRoomRelay` (`handleUpgrade`, `releaseSocket`)
  - `shared/webPlayProtocol.mjs`: `ROOM_REPLACED_CLOSE_CODE`, `parseWebPlayMessage`
- **Check for code drift since last sync:**
  ```sh
  git diff c606012..HEAD -- \
    worker/src/index.ts \
    src/webplay/roomConnection.ts \
    scripts/webplay-room-relay.mjs \
    shared/webPlayProtocol.mjs
  ```

If any covered file changed after `sync_commit`, follow the installed `maintain-formal-verification-skill` before trusting a pass. Advance `sync_commit` only after confirming `formal/WebPlayRoomProtocol.tla` faithfully describes `HEAD` and passes a mutation check.

## Verified Properties (Invariants)

1. **`NoSplitBrainPeerLeft`:** Whenever an active desktop holds the room (`activeDesktop /= "none"`), the phone is never falsely dropped to `waiting-peer` and no `peer-left` notice is emitted.
2. **`NoStaleP2PRouting`:** Whenever the phone has an open WebRTC DataChannel, it points strictly to the current active desktop (`phoneDcTarget = activeDesktop`) and matches `paired-p2p` status.
3. **`No4001ReconnectStorm`:** A client evicted with close code `4001` (`Replaced by new connection`) never auto-reconnects to evict the active holder.
4. **`NoSupersededMessageRelayed`:** Late frames sent on a superseded socket before its close completes are never relayed to the room peer.
5. **`NoStaleOfferSent`:** An in-flight WebRTC `setLocalDescription` whose `RTCPeerConnection` was torn down never sends a stale `rtc-offer`.
6. **`AtMostOnePeerLeft`:** `webSocketError` followed by `webSocketClose` on the active socket emits at most one `peer-left` event (`peerLeftEvents <= 1`).
7. **`NoDeadlock`:** Every execution reaches the settled terminal state (`Done`) cleanly.

## Bounds, Assumptions & Out-of-Scope

- **Bounds:** Single room (`1` phone + `2` desktop generations: initial `d1` paired over P2P, takeover by `d2`, interleaved with `d1`'s delayed server close, `d1`'s late message, `d1`'s `4001` client close, `d2`'s async offer/P2P upgrade, and `d2`'s error+close or clean disconnect).
- **Out of scope:** Multi-room isolation, WebRTC ICE candidate buffering ordering (covered by Vitest in `src/webplay/roomConnection.test.ts`), Rapier physics state, and LAN/ARKit bridge (`scripts/live-bridge.mjs`).

## Verified Status at `c606012`

- **`WebPlayRoomProtocol`:** TLC explores **57 states / 169 steps** (7 chart states, 11 arrows). `TypeOK`, `NoSplitBrainPeerLeft`, `NoStaleP2PRouting`, `No4001ReconnectStorm`, `NoSupersededMessageRelayed`, `NoStaleOfferSent`, `AtMostOnePeerLeft`, and `NoDeadlock` all **hold** (`exit 0`).
- **Mutation proof:** Reverting `RelayClosesSupersededD1` to emit `peer-left` fails `NoSplitBrainPeerLeft` in 2 steps and `AtMostOnePeerLeft` in 3 steps (`exit 1`).
- **Vitest regression coverage:** `worker/src/index.test.ts`, `src/webplay/roomConnection.test.ts`, and `scripts/webplay-room-relay.test.mjs`.

Treat any failure in these invariants or `NoDeadlock` as a blocker before merging or deploying the Worker.

## How to Run

Run the spec with the installed `/statechart` skill, writing outputs to a fresh directory under `/tmp` (never inside the repository):

- Model: `formal/WebPlayRoomProtocol.tla`
- Config: `formal/WebPlayRoomProtocol.cfg`
- View: `formal/webplay-view.mjs`
- Output: `/tmp/phone3d-statechart-webplay-<run>`

*Contributor fallback (without the `/statechart` skill):* run standard TLC (`java -cp tla2tools.jar tlc2.TLC -config formal/WebPlayRoomProtocol.cfg formal/WebPlayRoomProtocol.tla`).

## Interpreting Results & Upkeep Rules

- **Never weaken an invariant** or shrink bounds solely to make TLC pass.
- **Replay every violation:** Map each TLC counterexample step directly to `worker/src/index.test.ts` or `src/webplay/roomConnection.test.ts`. If the step sequence cannot happen in real runtime execution, fix the model; if it can, fix product code and add a regression test.
- **Separate commits:** Keep formal model and verification skill updates (`formal/`, `.agents/skills/verify-webplay-room/`) in commits separate from product bug fixes.

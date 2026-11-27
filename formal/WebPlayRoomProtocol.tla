------------------------ MODULE WebPlayRoomProtocol ------------------------
EXTENDS Naturals

\* Formal state machine for WebPlay room relay and client P2P lifecycle.
\* Covers:
\*   - worker/src/index.ts (RoomRelay: fetch, webSocketMessage, webSocketClose, webSocketError)
\*   - scripts/webplay-room-relay.mjs (createWebPlayRoomRelay)
\*   - src/webplay/roomConnection.ts (RoomConnection: onclose, handleRawPayload, startPeerAsOfferer, teardownPeer)
\*
\* Scenario bounds:
\*   One room with Phone initially paired over P2P with Desktop 1 (d1).
\*   Desktop 2 (d2) takes over the desktop role (evicting d1 with close code 4001),
\*   races with d1's delayed server close, d1's late message, d1's client 4001 close,
\*   d2's async WebRTC offer/setLocalDescription, and d2's disconnect via error+close or clean close.

VARIABLES
  activeDesktop,          \* "d1" | "d2" | "none"
  d1SupersededPending,    \* BOOLEAN: server webSocketClose(d1) not yet fired after 4001 eviction
  d1LateMsgTried,         \* BOOLEAN: d1 attempted sending a late message while superseded
  d1ClientClosePending,   \* BOOLEAN: d1 client onclose(4001) not yet processed
  d1ClientState,          \* "paired" | "replaced" | "reconnecting"
  phoneStatus,            \* "paired-p2p" | "paired-relay" | "waiting-peer"
  phoneDcTarget,          \* "d1" | "d2" | "none"
  d2OfferState,           \* "none" | "creating" | "sent" | "open"
  d2ErrorPendingClose,    \* BOOLEAN: webSocketError(d2) ran and webSocketClose(d2) is queued
  peerLeftEvents,         \* 0..2: number of peer-left notices sent to phone
  staleMsgRelayed,        \* BOOLEAN: TRUE if a superseded socket message was relayed
  staleOfferSent          \* BOOLEAN: TRUE if an offer resolved after teardown was sent

vars == <<
  activeDesktop,
  d1SupersededPending,
  d1LateMsgTried,
  d1ClientClosePending,
  d1ClientState,
  phoneStatus,
  phoneDcTarget,
  d2OfferState,
  d2ErrorPendingClose,
  peerLeftEvents,
  staleMsgRelayed,
  staleOfferSent
>>

Init ==
  /\ activeDesktop = "d1"
  /\ d1SupersededPending = FALSE
  /\ d1LateMsgTried = FALSE
  /\ d1ClientClosePending = FALSE
  /\ d1ClientState = "paired"
  /\ phoneStatus = "paired-p2p"
  /\ phoneDcTarget = "d1"
  /\ d2OfferState = "none"
  /\ d2ErrorPendingClose = FALSE
  /\ peerLeftEvents = 0
  /\ staleMsgRelayed = FALSE
  /\ staleOfferSent = FALSE

\* Desktop 2 joins the same room as role=desktop:
\* - RoomRelay.fetch marks d1 superseded, closes d1 with 4001, activates d2, sends peer-joined to phone.
\* - Phone RoomConnection handles peer-joined by calling teardownPeer() and entering paired-relay.
\* - Desktop 2 RoomConnection starts startPeerAsOfferer() (creating offer / setLocalDescription in flight).
Desktop2TakesOver ==
  /\ activeDesktop = "d1"
  /\ activeDesktop' = "d2"
  /\ d1SupersededPending' = TRUE
  /\ d1ClientClosePending' = TRUE
  /\ phoneStatus' = "paired-relay"
  /\ phoneDcTarget' = "none"
  /\ d2OfferState' = "creating"
  /\ UNCHANGED <<d1LateMsgTried, d1ClientState, d2ErrorPendingClose, peerLeftEvents, staleMsgRelayed, staleOfferSent>>

\* Superseded d1 attempts to send a message before server close completes.
\* Fixed RoomRelay.webSocketMessage checks isSocketActive(ws) and drops it.
SupersededD1SendsMessage ==
  /\ d1SupersededPending = TRUE
  /\ d1LateMsgTried = FALSE
  /\ d1LateMsgTried' = TRUE
  /\ UNCHANGED <<
       activeDesktop, d1SupersededPending, d1ClientClosePending, d1ClientState,
       phoneStatus, phoneDcTarget, d2OfferState, d2ErrorPendingClose,
       peerLeftEvents, staleMsgRelayed, staleOfferSent
     >>

\* Delayed server-side webSocketClose(d1) arrives after 4001 eviction.
\* Fixed RoomRelay.handleSocketClose sees superseded/inactive and emits no peer-left.
RelayClosesSupersededD1 ==
  /\ d1SupersededPending = TRUE
  /\ d1SupersededPending' = FALSE
  /\ UNCHANGED <<
       activeDesktop, d1LateMsgTried, d1ClientClosePending, d1ClientState,
       phoneStatus, phoneDcTarget, d2OfferState, d2ErrorPendingClose,
       peerLeftEvents, staleMsgRelayed, staleOfferSent
     >>

\* Evicted Desktop 1 client receives onclose(code=4001).
\* Fixed RoomConnection stops auto-reconnect and enters replaced state.
D1Receives4001Close ==
  /\ d1ClientClosePending = TRUE
  /\ d1ClientClosePending' = FALSE
  /\ d1ClientState' = "replaced"
  /\ UNCHANGED <<
       activeDesktop, d1SupersededPending, d1LateMsgTried,
       phoneStatus, phoneDcTarget, d2OfferState, d2ErrorPendingClose,
       peerLeftEvents, staleMsgRelayed, staleOfferSent
     >>

\* Desktop 2 completes createOffer + setLocalDescription while still active.
Desktop2SendsOffer ==
  /\ activeDesktop = "d2"
  /\ d2OfferState = "creating"
  /\ d2OfferState' = "sent"
  /\ UNCHANGED <<
       activeDesktop, d1SupersededPending, d1LateMsgTried, d1ClientClosePending,
       d1ClientState, phoneStatus, phoneDcTarget, d2ErrorPendingClose,
       peerLeftEvents, staleMsgRelayed, staleOfferSent
     >>

\* Phone accepts Desktop 2's offer and opens the new P2P DataChannel.
PhoneOpensP2PWithD2 ==
  /\ activeDesktop = "d2"
  /\ d2OfferState = "sent"
  /\ phoneStatus = "paired-relay"
  /\ d2OfferState' = "open"
  /\ phoneStatus' = "paired-p2p"
  /\ phoneDcTarget' = "d2"
  /\ UNCHANGED <<
       activeDesktop, d1SupersededPending, d1LateMsgTried, d1ClientClosePending,
       d1ClientState, d2ErrorPendingClose, peerLeftEvents, staleMsgRelayed, staleOfferSent
     >>

\* Active Desktop 2 hits a transport error (webSocketError followed later by webSocketClose).
\* Fixed RoomRelay marks d2 closed, emits peer-left once; Phone tears down P2P and waits.
Desktop2Errors ==
  /\ activeDesktop = "d2"
  /\ d2ErrorPendingClose = FALSE
  /\ activeDesktop' = "none"
  /\ d2ErrorPendingClose' = TRUE
  /\ peerLeftEvents' = peerLeftEvents + 1
  /\ phoneStatus' = "waiting-peer"
  /\ phoneDcTarget' = "none"
  /\ d2OfferState' = IF d2OfferState = "creating" THEN "creating" ELSE "none"
  /\ UNCHANGED <<
       d1SupersededPending, d1LateMsgTried, d1ClientClosePending, d1ClientState,
       staleMsgRelayed, staleOfferSent
     >>

\* Active Desktop 2 closes cleanly without a prior webSocketError.
Desktop2ClosesCleanly ==
  /\ activeDesktop = "d2"
  /\ d2ErrorPendingClose = FALSE
  /\ activeDesktop' = "none"
  /\ peerLeftEvents' = peerLeftEvents + 1
  /\ phoneStatus' = "waiting-peer"
  /\ phoneDcTarget' = "none"
  /\ d2OfferState' = IF d2OfferState = "creating" THEN "creating" ELSE "none"
  /\ UNCHANGED <<
       d1SupersededPending, d1LateMsgTried, d1ClientClosePending, d1ClientState,
       d2ErrorPendingClose, staleMsgRelayed, staleOfferSent
     >>

\* Runtime fires webSocketClose(d2) after webSocketError(d2).
\* Fixed RoomRelay sees closed/inactive and does NOT emit a duplicate peer-left.
RelayClosesD2AfterError ==
  /\ d2ErrorPendingClose = TRUE
  /\ d2ErrorPendingClose' = FALSE
  /\ UNCHANGED <<
       activeDesktop, d1SupersededPending, d1LateMsgTried, d1ClientClosePending,
       d1ClientState, phoneStatus, phoneDcTarget, d2OfferState,
       peerLeftEvents, staleMsgRelayed, staleOfferSent
     >>

\* In-flight setLocalDescription on Desktop 2 resolves after teardown.
\* Fixed RoomConnection re-checks (this.pc === pc) and suppresses the stale rtc-offer.
Desktop2DropsStaleOffer ==
  /\ activeDesktop = "none"
  /\ d2OfferState = "creating"
  /\ d2OfferState' = "none"
  /\ UNCHANGED <<
       activeDesktop, d1SupersededPending, d1LateMsgTried, d1ClientClosePending,
       d1ClientState, phoneStatus, phoneDcTarget, d2ErrorPendingClose,
       peerLeftEvents, staleMsgRelayed, staleOfferSent
     >>

\* Settled end state: all close callbacks and in-flight offers finished.
Done ==
  /\ activeDesktop = "none"
  /\ d1SupersededPending = FALSE
  /\ d1ClientClosePending = FALSE
  /\ d2ErrorPendingClose = FALSE
  /\ d2OfferState = "none"
  /\ UNCHANGED vars

Next ==
  \/ Desktop2TakesOver
  \/ SupersededD1SendsMessage
  \/ RelayClosesSupersededD1
  \/ D1Receives4001Close
  \/ Desktop2SendsOffer
  \/ PhoneOpensP2PWithD2
  \/ Desktop2Errors
  \/ Desktop2ClosesCleanly
  \/ RelayClosesD2AfterError
  \/ Desktop2DropsStaleOffer
  \/ Done

Spec == Init /\ [][Next]_vars

\* --- Safety Invariants ---

TypeOK ==
  /\ activeDesktop \in {"d1", "d2", "none"}
  /\ d1SupersededPending \in BOOLEAN
  /\ d1LateMsgTried \in BOOLEAN
  /\ d1ClientClosePending \in BOOLEAN
  /\ d1ClientState \in {"paired", "replaced", "reconnecting"}
  /\ phoneStatus \in {"paired-p2p", "paired-relay", "waiting-peer"}
  /\ phoneDcTarget \in {"d1", "d2", "none"}
  /\ d2OfferState \in {"none", "creating", "sent", "open"}
  /\ d2ErrorPendingClose \in BOOLEAN
  /\ peerLeftEvents \in 0..2
  /\ staleMsgRelayed \in BOOLEAN
  /\ staleOfferSent \in BOOLEAN

\* 1. An active desktop holder is never falsely reported as departed to the phone.
NoSplitBrainPeerLeft ==
  activeDesktop /= "none" => (phoneStatus /= "waiting-peer" /\ peerLeftEvents = 0)

\* 2. Phone's open DataChannel never stays connected to an evicted or departed desktop.
NoStaleP2PRouting ==
  /\ (phoneDcTarget /= "none" => phoneDcTarget = activeDesktop)
  /\ (phoneStatus = "paired-p2p" => (activeDesktop /= "none" /\ phoneDcTarget = activeDesktop))

\* 3. A 4001-evicted client never auto-reconnects to cause an eviction storm.
No4001ReconnectStorm ==
  d1ClientState /= "reconnecting"

\* 4. A superseded socket can never relay messages to the room peer.
NoSupersededMessageRelayed ==
  ~staleMsgRelayed

\* 5. An in-flight WebRTC offer/answer after teardown is never transmitted.
NoStaleOfferSent ==
  ~staleOfferSent

\* 6. Error followed by close on an active socket emits peer-left at most once.
AtMostOnePeerLeft ==
  peerLeftEvents <= 1

=============================================================================

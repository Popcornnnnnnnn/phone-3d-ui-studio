export const title = "WebPlay Room Relay and P2P Takeover Lifecycle";

export const colors = {
  paired: "teal",
  takeover: "blue",
  waiting: "tan",
  broken: "pink",
};

const hasViolation = (v) => {
  const splitBrain =
    v.activeDesktop !== "none" &&
    (v.phoneStatus === "waiting-peer" || v.peerLeftEvents > 0);
  const staleP2P =
    (v.phoneDcTarget !== "none" && v.phoneDcTarget !== v.activeDesktop) ||
    (v.phoneStatus === "paired-p2p" &&
      (v.activeDesktop === "none" || v.phoneDcTarget !== v.activeDesktop));
  const reconnectStorm = v.d1ClientState === "reconnecting";
  const staleRelay = Boolean(v.staleMsgRelayed);
  const staleOffer = Boolean(v.staleOfferSent);
  const dupPeerLeft = v.peerLeftEvents > 1;
  return {
    splitBrain,
    staleP2P,
    reconnectStorm,
    staleRelay,
    staleOffer,
    dupPeerLeft,
  };
};

export const state = (v) => {
  const b = hasViolation(v);
  if (b.splitBrain) return "Split-brain peer-left while Desktop 2 active";
  if (b.staleP2P) return "Stale P2P DataChannel to evicted Desktop 1";
  if (b.reconnectStorm) return "Desktop 1 4001 reconnect storm";
  if (b.staleRelay) return "Superseded socket relayed late message";
  if (b.staleOffer) return "Stale WebRTC offer sent after teardown";
  if (b.dupPeerLeft) return "Duplicate peer-left emitted to Phone";

  if (v.activeDesktop === "d1") {
    return "Paired P2P with Desktop 1";
  }

  if (v.activeDesktop === "d2") {
    if (v.phoneStatus === "paired-p2p") {
      return "Paired P2P with Desktop 2";
    }
    if (v.d2OfferState === "sent") {
      return "Desktop 2 relay, offer sent";
    }
    return "Desktop 2 relay, offer pending";
  }

  if (v.d2OfferState === "creating") {
    return "Waiting for desktop, offer cancelling";
  }
  if (v.d2ErrorPendingClose) {
    return "Waiting for desktop, error close pending";
  }
  return "Waiting for desktop, settled";
};

export const group = (v) => {
  const b = hasViolation(v);
  if (
    b.splitBrain ||
    b.staleP2P ||
    b.reconnectStorm ||
    b.staleRelay ||
    b.staleOffer ||
    b.dupPeerLeft
  ) {
    return "broken";
  }
  if (v.activeDesktop === "d1" || v.phoneStatus === "paired-p2p") {
    return "paired";
  }
  if (v.activeDesktop === "d2") {
    return "takeover";
  }
  return "waiting";
};

export const step = (action, from, to) => {
  switch (action) {
    case "Desktop2TakesOver":
      return "Desktop 2 replaces Desktop 1 (4001)";
    case "SupersededD1SendsMessage":
      return to?.staleMsgRelayed
        ? "superseded Desktop 1 message relayed"
        : "superseded Desktop 1 message dropped";
    case "RelayClosesSupersededD1":
      return to && from && to.peerLeftEvents > from.peerLeftEvents
        ? "superseded Desktop 1 close emits peer-left"
        : "superseded Desktop 1 close ignored";
    case "D1Receives4001Close":
      return to?.d1ClientState === "reconnecting"
        ? "Desktop 1 starts 4001 reconnect"
        : "Desktop 1 enters replaced state";
    case "Desktop2SendsOffer":
      return "Desktop 2 sends WebRTC offer";
    case "PhoneOpensP2PWithD2":
      return "Phone opens P2P with Desktop 2";
    case "Desktop2Errors":
      return "Desktop 2 socket errors (peer-left once)";
    case "Desktop2ClosesCleanly":
      return "Desktop 2 closes cleanly (peer-left once)";
    case "RelayClosesD2AfterError":
      return to && from && to.peerLeftEvents > from.peerLeftEvents
        ? "post-error close emits duplicate peer-left"
        : "post-error close ignored";
    case "Desktop2DropsStaleOffer":
      return to?.staleOfferSent
        ? "stale offer sent after teardown"
        : "stale offer dropped after teardown";
    case "Done":
      return null;
    default:
      return action;
  }
};

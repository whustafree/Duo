// WebRTC STUN-only sin servidor de señalización.
// Intercambio de SDP fuera de banda por 2 QRs:
// A crea offer: "duo:webrtc:v1:offer:<pubA_b64url>:<sdp_b64url>"
// B crea answer: "duo:webrtc:v1:answer:<pubB_b64url>:<sdp_b64url>"
// Solo STUN, sin TURN. DataChannel fiable "duo-data".

import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
} from "react-native-webrtc";

const STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
];

const CONFIG = {
  iceServers: STUN_SERVERS,
  iceCandidatePoolSize: 10,
};

const DATA_CHANNEL_LABEL = "duo-data";

function log(...args) {
  if (global.__DUO_DEBUG) console.log("[duo-webrtc]", ...args);
}

// Espera a que ICE termine de recolectar candidatos (modo "vanilla ICE"):
// así el SDP que va dentro del QR ya incluye los candidatos srflx de STUN.
// Sin esto, el otro lado no tendría por dónde conectar.
// Normaliza un RTCSessionDescription a un objeto plano serializable
// (react-native-webrtc no garantiza que JSON.stringify vea sus campos).
function plainDescription(desc) {
  if (!desc) return null;
  return { type: desc.type, sdp: desc.sdp };
}

function waitForIceGathering(pc, timeoutMs = 5000) {
  if (!pc || pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        pc.onicegatheringstatechange = null;
      } catch {}
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") finish();
    };
    // Por si ya cambiara entre la comprobación y el registro.
    if (pc.iceGatheringState === "complete") finish();
  });
}

export class WebRTCService {
  constructor() {
    this.pc = null;
    this.dc = null;
    this.onDataCallback = null;
    this.onStateChangeCallback = null;
    this.onIceCandidateCallback = null;
    this.iceCandidates = [];
    this.connected = false;
  }

  onData(cb) {
    this.onDataCallback = cb;
  }

  onStateChange(cb) {
    this.onStateChangeCallback = cb;
  }

  onIceCandidate(cb) {
    this.onIceCandidateCallback = cb;
  }

  async createOffer() {
    this.cleanup();
    this.pc = new RTCPeerConnection(CONFIG);

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.iceCandidates.push(event.candidate);
        if (this.onIceCandidateCallback) {
          this.onIceCandidateCallback(event.candidate);
        }
      }
    };

    this.pc.onconnectionstatechange = () => {
      log("connectionState:", this.pc?.connectionState);
      if (this.onStateChangeCallback) {
        this.onStateChangeCallback(this.pc?.connectionState);
      }
      if (this.pc?.connectionState === "connected" || this.pc?.connectionState === "completed") {
        this.connected = true;
      } else if (
        this.pc?.connectionState === "failed" ||
        this.pc?.connectionState === "disconnected" ||
        this.pc?.connectionState === "closed"
      ) {
        this.connected = false;
      }
    };

    this.pc.ondatachannel = (event) => {
      this.dc = event.channel;
      this.setupDataChannel();
    };

    this.dc = this.pc.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true });
    this.setupDataChannel();

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await waitForIceGathering(this.pc);
    return plainDescription(this.pc.localDescription) || plainDescription(offer);
  }

  setupDataChannel() {
    if (!this.dc) return;
    this.dc.onopen = () => {
      // El DataChannel solo se abre cuando la conexión ICE ya está lista;
      // marcamos conectado aquí también por si connectionState no llega.
      this.connected = true;
      log("datachannel open");
    };
    this.dc.onclose = () => {
      log("datachannel close");
      this.connected = false;
    };
    this.dc.onerror = (e) => {
      log("datachannel error", e);
    };
    this.dc.onmessage = (event) => {
      if (this.onDataCallback) {
        this.onDataCallback(event.data);
      }
    };
  }

  async createAnswer(offer) {
    this.cleanup();
    this.pc = new RTCPeerConnection(CONFIG);

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.iceCandidates.push(event.candidate);
        if (this.onIceCandidateCallback) {
          this.onIceCandidateCallback(event.candidate);
        }
      }
    };

    this.pc.onconnectionstatechange = () => {
      log("connectionState:", this.pc?.connectionState);
      if (this.onStateChangeCallback) {
        this.onStateChangeCallback(this.pc?.connectionState);
      }
      if (this.pc?.connectionState === "connected" || this.pc?.connectionState === "completed") {
        this.connected = true;
      } else if (
        this.pc?.connectionState === "failed" ||
        this.pc?.connectionState === "disconnected" ||
        this.pc?.connectionState === "closed"
      ) {
        this.connected = false;
      }
    };

    this.pc.ondatachannel = (event) => {
      this.dc = event.channel;
      this.setupDataChannel();
    };

    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await waitForIceGathering(this.pc);
    return plainDescription(this.pc.localDescription) || plainDescription(answer);
  }

  async setAnswer(answer) {
    if (!this.pc) throw new Error("PeerConnection no inicializada");
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  async addIceCandidate(candidate) {
    if (!this.pc) return;
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      log("addIceCandidate error", e?.message);
    }
  }

  send(data) {
    if (!this.dc || this.dc.readyState !== "open") return false;
    try {
      if (data instanceof Uint8Array) {
        this.dc.send(data);
        return true;
      }
      if (typeof data === "string") {
        this.dc.send(data);
        return true;
      }
      this.dc.send(JSON.stringify(data));
      return true;
    } catch (e) {
      log("send error", e?.message);
      return false;
    }
  }

  isConnected() {
    // El DataChannel "open" ya implica conexión ICE establecida; nos basta con
    // eso para tolerar que connectionState tarde o no se reporte.
    return this.dc?.readyState === "open";
  }

  cleanup() {
    if (this.dc) {
      try {
        this.dc.close();
      } catch {}
      this.dc = null;
    }
    if (this.pc) {
      try {
        this.pc.close();
      } catch {}
      this.pc = null;
    }
    this.iceCandidates = [];
    this.connected = false;
  }
}

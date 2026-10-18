import * as TcpSocket from "react-native-tcp-socket";
import Zeroconf from "react-native-zeroconf";
import * as Network from "expo-network";
import {
  encodeFrame,
  FrameParser,
  buildAuth,
  verifyAuth,
  buildPairReq,
  verifyPairReq,
  buildPairOk,
  verifyPairOk,
  buildPing,
  buildPong,
  PROTOCOL_VERSION,
} from "./protocol";
import {
  deriveCoupleId,
  pubInstance,
  verificationCode,
  pairingSecret,
  bytesToB64url,
  b64ToBytes,
  bytesToB64,
  emojiForPub,
} from "./cryptocore";

// Transporte P2P de Duo: los DOS teléfonos se conectan directamente entre sí
// en la red local, SIN ningún servidor intermedio.
//
//  - Cada dispositivo levanta un servidor TCP (DUO_PORT) y se anuncia por mDNS
//    (Zeroconf/Bonjour) con el nombre derivado de su clave pública.
//  - El dispositivo con la clave pública "menor" marca la conexión saliente
//    (regla determinista, igual en ambos lados, que evita duplicados).
//  - Para vincular: el que crea el vínculo muestra un QR con su clave pública
//    + puerto + secreto de emparejamiento; el otro escanea y se conecta. Todo
//    el diálogo de vinculación va cifrado con ese secreto.
//  - Después de vincular, cada socket se autentica con E2E: solo el
//    dispositivo con la clave privada correcta completa el "handshake".

export const DUO_PORT = 47777;
const DIAL_INTERVAL = 8000;
const CONNECT_TIMEOUT = 3500;
const HEARTBEAT_INTERVAL = 20000;
const STALE_AFTER = 60000;
const PAIR_TIMEOUT = 60000;

function log(...args) {
  if (global.__DUO_DEBUG) console.log("[duo-p2p]", ...args);
}

export class P2P {
  constructor() {
    this.emitFn = null;
    this.cfg = null; // { keys, partnerPub, myName, myEmoji, getSavedAddr, saveAddr }
    this.server = null;
    this.zeroconf = null;
    this.session = null; // { socket, parser, remote, lastActivity }
    this.status = "offline";
    this.candidates = []; // [{host, port}] descubiertas por mDNS
    this.dialTimer = null;
    this.connecting = false;
    this.heartbeat = null;
    this.pairing = null; // { ps, myName, myEmoji } mientras se espera pareja
    this.pendingPair = null; // { socket, req } solicitud entrante por confirmar
    this.joining = null; // { ps, pub, timer } mientras se une desde el QR
    this.joinFrameHandler = null;
    this.joinAbort = null; // aborta una unión en curso (cancelación)
    this.publishedName = null;
    this.stopped = true;
  }

  // ------------------------------------------------------------- eventos --

  onEvent(fn) {
    this.emitFn = fn;
  }

  emit(type, data) {
    if (this.emitFn) this.emitFn(type, data);
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.emit("status", status);
  }

  // --------------------------------------------------------------- ciclo --

  configure(cfg) {
    const prev = this.cfg?.partnerPub;
    if (cfg.partnerPub !== prev) {
      this.candidates = []; // direcciones de una pareja anterior no sirven
      if (this.session) {
        // Cambió (o se quitó) la pareja: la sesión vieja ya no es válida.
        this.closeSession();
      }
      // El estado debe reflejar la nueva realidad (antes: "online" para siempre).
      if (!cfg.partnerPub) this.setStatus("offline");
      else if (this.status === "online") this.setStatus("connecting");
    }
    this.cfg = cfg;
  }

  start() {
    if (!this.cfg?.keys?.publicKeyB64) return;
    this.stopped = false;
    this.startServer();
    this.startMdns();
    this.scheduleDial(200);
  }

  stop() {
    this.stopped = true;
    if (this.dialTimer) {
      clearTimeout(this.dialTimer);
      this.dialTimer = null;
    }
    if (this.joinTimer) clearTimeout(this.joinTimer);
    this.joinTimer = null;
    this.joining = null;
    this.joinFrameHandler = null;
    if (this.joinAbort) this.joinAbort(new Error("Conexión detenida."));
    this.pairing = null;
    this.rejectPairing();
    this.closeSession();
    this.stopServer();
    this.stopMdns();
    this.setStatus("offline");
  }

  wake() {
    // Al volver a primer plano: reintentar de inmediato.
    if (this.stopped || !this.cfg?.partnerPub) return;
    if (!this.session) this.scheduleDial(100);
  }

  // ------------------------------------------------------------ servidor --

  startServer() {
    if (this.server) return;
    try {
      const server = TcpSocket.createServer();
      server.on("connection", (socket) => this.onIncoming(socket));
      server.on("error", (e) => log("server error", e?.message));
      server.listen({ port: DUO_PORT, host: "0.0.0.0" });
      this.server = server;
    } catch (e) {
      log("no se pudo abrir el servidor:", e?.message);
      this.server = null;
    }
  }

  stopServer() {
    if (!this.server) return;
    try {
      this.server.close();
    } catch {}
    this.server = null;
  }

  // ---------------------------------------------------------------- mDNS --

  startMdns() {
    if (this.zeroconf) return;
    try {
      const zc = new Zeroconf();
      // Al resolverse un servicio (evento `resolved` con direcciones), miramos
      // si es el de nuestra pareja (o del creador que estamos escaneando).
      const check = () => this.scanResolved(zc);
      zc.on("resolved", check);
      zc.on("update", check);
      zc.on("error", (e) => log("mdns error", e?.code || e?.message));
      this.zeroconf = zc;

      const instance = pubInstance(this.cfg.keys.publicKeyB64);
      this.publishedName = instance;
      zc.publishService({
        type: "duo",
        protocol: "tcp",
        domain: "local.",
        name: instance,
        port: DUO_PORT,
        txt: { v: PROTOCOL_VERSION },
      })
        .then((svc) => {
          if (svc?.name) this.publishedName = svc.name;
        })
        .catch((e) => log("publish error", e?.message || e?.code));
      zc.scan({ type: "duo", protocol: "tcp", domain: "local." });
    } catch (e) {
      log("mdns no disponible:", e?.message);
      this.zeroconf = null;
    }
  }

  scanResolved(zc) {
    const targets = [];
    if (this.cfg?.partnerPub) targets.push(pubInstance(this.cfg.partnerPub));
    if (this.joining?.pub) targets.push(pubInstance(this.joining.pub));
    if (!targets.length) return;
    let services = [];
    try {
      services = Object.values(zc.getServices());
    } catch {
      return;
    }
    for (const svc of services) {
      if (!svc || targets.indexOf(svc.name) < 0) continue;
      const addrs =
        (svc.ipv4 && svc.ipv4.length ? svc.ipv4 : null) || svc.addresses || [];
      const host =
        addrs.find((a) => a && String(a).indexOf(":") < 0) || addrs[0];
      if (host && svc.port) this.addCandidate({ host, port: svc.port });
    }
  }

  stopMdns() {
    if (!this.zeroconf) return;
    const zc = this.zeroconf;
    this.zeroconf = null;
    this.candidates = [];
    try {
      zc.stop();
    } catch {}
    if (this.publishedName) {
      try {
        const p = zc.unpublishService(this.publishedName);
        if (p && p.catch) p.catch(() => {});
      } catch {}
    }
    this.publishedName = null;
    try {
      zc.removeAllListeners();
      zc.removeDeviceListeners();
    } catch {}
  }

  addCandidate(addr) {
    const exists = this.candidates.some(
      (c) => c.host === addr.host && c.port === addr.port
    );
    if (exists) return;
    this.candidates.push(addr);
    log("candidata:", addr.host + ":" + addr.port);
    if (!this.session && !this.connecting && this.cfg?.partnerPub) {
      this.scheduleDial(100);
    }
  }

  // ------------------------------------------------------- rol y marcado --

  amDialer() {
    const mine = this.cfg.keys.publicKeyB64;
    const peer = this.cfg.partnerPub;
    return !!peer && mine < peer;
  }

  scheduleDial(delay = DIAL_INTERVAL) {
    if (this.stopped || !this.cfg?.partnerPub || this.session) return;
    if (this.status !== "online") this.setStatus("connecting");
    if (!this.amDialer()) return; // el otro lado marca; nosotros escuchamos
    if (this.dialTimer) clearTimeout(this.dialTimer);
    this.dialTimer = setTimeout(() => {
      this.dialTimer = null;
      this.dial();
    }, delay);
  }

  async dial() {
    if (this.stopped || this.connecting || this.session) return;
    if (!this.cfg?.partnerPub || !this.amDialer()) return;
    this.connecting = true;
    try {
      const addrs = [];
      const saved = this.cfg.getSavedAddr ? await this.cfg.getSavedAddr() : null;
      if (saved?.host) addrs.push(saved);
      for (const c of this.candidates) addrs.push(c);

      for (const addr of addrs) {
        if (this.stopped || this.session) break;
        const socket = await this.tryConnect(addr.host, addr.port || DUO_PORT);
        if (!socket) continue;
        this.beginLinkedOutgoing(socket, addr);
        break;
      }
    } finally {
      this.connecting = false;
      if (!this.session && !this.stopped) this.scheduleDial();
    }
  }

  tryConnect(host, port) {
    return new Promise((resolve) => {
      let socket = null;
      let done = false;
      const finish = (val) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (!val && socket) {
          try {
            socket.destroy();
          } catch {}
        }
        resolve(val);
      };
      const timer = setTimeout(() => finish(null), CONNECT_TIMEOUT);
      try {
        socket = TcpSocket.connect({ host, port });
        socket.on("connect", () => finish(socket));
        socket.on("error", () => finish(null));
      } catch {
        finish(null);
      }
    });
  }

  // ------------------------------------------------------------- sesiones --

  attachSocket(socket, remote) {
    const parser = new FrameParser();
    const state = { socket, parser, remote, lastActivity: Date.now() };
    socket.on("data", (chunk) => {
      state.lastActivity = Date.now();
      let frames = [];
      try {
        frames = parser.feed(chunk);
      } catch (e) {
        log("trama inválida:", e?.message);
        try {
          socket.destroy();
        } catch {}
        return;
      }
      // Un tercero de la red puede conectarse y mandar basura: NUNCA dejar que
      // una trama malformada lance una excepción sin capturar (pantalla blanca
      // en release). Todo lo que llega por el socket pasa por aquí.
      for (const frame of frames) {
        try {
          this.onFrame(state, frame);
        } catch (e) {
          log("error al procesar trama:", e?.message);
        }
      }
    });
    socket.on("error", () => this.destroySocket(state));
    socket.on("close", () => this.onSocketClosed(state));
    try {
      socket.setNoDelay(true);
    } catch {}
    try {
      socket.setKeepAlive(true, 20000);
    } catch {}
    return state;
  }

  send(frame) {
    if (!this.session?.socket) return false;
    try {
      this.session.socket.write(encodeFrame(frame));
      return true;
    } catch {
      return false;
    }
  }

  adoptSession(state) {
    if (this.session === state) return;
    if (this.session) this.destroySocket(this.session);
    this.session = state;
    const remote = state.remote;
    if (remote?.host && this.cfg.saveAddr) {
      this.cfg.saveAddr({ host: remote.host, port: remote.port || DUO_PORT });
    }
    this.setStatus("online");
    this.startHeartbeat();
    this.emit("session", remote);
    log("sesión activa con", remote?.host || "?");
  }

  closeSession() {
    if (!this.session) return;
    const s = this.session;
    this.session = null;
    this.stopHeartbeat();
    try {
      s.socket.destroy();
    } catch {}
  }

  destroySocket(state) {
    try {
      state.socket.destroy();
    } catch {}
    this.onSocketClosed(state);
  }

  onSocketClosed(state) {
    if (this.session !== state) return;
    this.session = null;
    this.stopHeartbeat();
    if (this.stopped) return;
    this.setStatus(this.cfg?.partnerPub ? "connecting" : "offline");
    if (this.cfg?.partnerPub) this.scheduleDial(1500);
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (!this.session) return;
      if (Date.now() - this.session.lastActivity > STALE_AFTER) {
        log("sesión sin actividad; reconectando");
        this.destroySocket(this.session);
        return;
      }
      this.send(buildPing());
    }, HEARTBEAT_INTERVAL);
  }

  stopHeartbeat() {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  // ------------------------------------------------------- autenticación --

  beginLinkedOutgoing(socket, addr) {
    const state = this.attachSocket(socket, addr);
    try {
      const frame = buildAuth(
        this.cfg.keys.privateKeyB64,
        this.cfg.keys.publicKeyB64,
        this.cfg.partnerPub
      );
      if (!frame) {
        this.destroySocket(state);
        return;
      }
      socket.write(encodeFrame(frame));
    } catch (e) {
      log("no se pudo iniciar el handshake:", e?.message);
      this.destroySocket(state);
    }
  }

  onFrame(state, frame) {
    if (!frame || typeof frame !== "object") return;

    // Solicitud de vínculo (solo tiene sentido con el QR recién mostrado).
    if (frame.t === "pair-req") {
      if (this.pairing && this.session !== state) {
        const req = verifyPairReq(frame, this.pairing.ps);
        if (!req) {
          this.destroySocket(state);
          return;
        }
        this.pendingPair = { socket: state.socket, req };
        this.emit("pair-request", {
          name: req.name,
          emoji: req.emoji,
          sas: verificationCode(this.cfg.keys.publicKeyB64, req.pub),
        });
        return;
      }
      this.destroySocket(state);
      return;
    }

    // Estamos uniéndonos: el único frame que esperamos es la confirmación.
    if (this.joinFrameHandler) {
      if (this.joinFrameHandler(state, frame)) return;
    }

    // Dispositivos ya vinculados: handshake de identidad E2E.
    if (frame.t === "auth") {
      const ok = verifyAuth(
        frame,
        this.cfg.keys.privateKeyB64,
        this.cfg.partnerPub
      );
      if (!ok) {
        log("auth fallido; cerrando socket");
        this.destroySocket(state);
        return;
      }
      if (this.session === state) return;
      const reply = buildAuth(
        this.cfg.keys.privateKeyB64,
        this.cfg.keys.publicKeyB64,
        this.cfg.partnerPub
      );
      if (reply) {
        try {
          state.socket.write(encodeFrame(reply));
        } catch {}
      }
      this.adoptSession(state);
      return;
    }

    if (frame.t === "ping") {
      this.sendTo(state, buildPong());
      return;
    }
    if (frame.t === "pong") return;

    if (this.session === state) this.emit("frame", frame);
  }

  sendTo(state, frame) {
    try {
      state.socket.write(encodeFrame(frame));
    } catch {}
  }

  // --------------------------------------------------------- emparejamiento --
  // Creador del vínculo: genera el secreto que viaja en el QR y espera la
  // solicitud del que escanea. La clave pública propia viaja en b64url.

  async startPairing({ name, emoji } = {}) {
    const ps = pairingSecret();
    const myEmoji = emoji || emojiForPub(this.cfg.keys.publicKeyB64);
    this.pairing = { ps, myName: name || "Yo", myEmoji };
    this.startServer();
    let host = null;
    try {
      const info = await Network.getIpAddressAsync();
      host = info?.ipAddress || null;
    } catch {}
    const pubUrl = bytesToB64url(b64ToBytes(this.cfg.keys.publicKeyB64));
    return { qr: `duo:pair:v1:${pubUrl}:${host || "-"}:${DUO_PORT}:${ps}` };
  }

  cancelPairing() {
    this.pairing = null;
    this.rejectPairing();
    // Si había una unión en curso (lado escáner), cancelarla de verdad: si no,
    // la promesa queda colgada y el temporizador posterior reviva la pantalla.
    if (this.joinAbort) this.joinAbort(new Error("Vinculación cancelada."));
  }

  acceptPairing() {
    const pending = this.pendingPair;
    if (!pending || !this.pairing) return false;
    const { socket, req } = pending;
    this.pendingPair = null;
    const coupleId = deriveCoupleId(this.cfg.keys.publicKeyB64, req.pub);
    const ok = buildPairOk(
      this.pairing.ps,
      this.cfg.keys.publicKeyB64,
      this.pairing.myName,
      this.pairing.myEmoji,
      coupleId
    );
    this.sendTo({ socket }, ok);
    setTimeout(() => {
      try {
        socket.destroy();
      } catch {}
    }, 300);
    this.pairing = null;
    this.emit("paired", {
      partnerPub: req.pub,
      partnerName: req.name,
      partnerEmoji: req.emoji,
      coupleId,
    });
    return true;
  }

  rejectPairing() {
    const pending = this.pendingPair;
    this.pendingPair = null;
    if (pending) {
      try {
        pending.socket.destroy();
      } catch {}
    }
  }

  // Une el dispositivo que escanea el QR: se conecta al creador y espera el
  // "pair-ok". Devuelve los datos de la pareja o lanza error.
  async joinPairing(qrText) {
    // QR: duo:pair:v1:<pub b64url>:<host|->:<port>:<ps b64url>  (7 campos)
    const parts = String(qrText || "").split(":");
    if (
      parts.length !== 7 ||
      parts[0] !== "duo" ||
      parts[1] !== "pair" ||
      parts[2] !== "v1"
    ) {
      throw new Error("El código QR no es un vínculo de Duo válido.");
    }
    const creatorPub = bytesToB64(b64ToBytes(parts[3]));
    const host = parts[4] === "-" ? null : parts[4];
    const port = parseInt(parts[5], 10) || DUO_PORT;
    const ps = parts[6];

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err, data) => {
        if (settled) return;
        settled = true;
        if (this.joinTimer) clearTimeout(this.joinTimer);
        this.joining = null;
        this.joinFrameHandler = null;
        this.joinAbort = null;
        if (err) reject(err);
        else resolve(data);
      };
      this.joinAbort = (err) => finish(err || new Error("Cancelado."));

      this.joining = { pub: creatorPub };

      this.joinFrameHandler = (state, frame) => {
        if (frame.t !== "pair-ok") return false;
        const ok = verifyPairOk(frame, ps, creatorPub);
        if (!ok) {
          finish(new Error("Respuesta de vinculación inválida."));
          return true;
        }
        try {
          state.socket.destroy();
        } catch {}
        finish(null, {
          partnerPub: creatorPub,
          partnerName: ok.name,
          partnerEmoji: ok.emoji,
          coupleId: deriveCoupleId(this.cfg.keys.publicKeyB64, creatorPub),
        });
        return true;
      };

      const attempt = async () => {
        if (settled) return;
        const addrs = [];
        if (host) addrs.push({ host, port });
        for (const c of this.candidates) addrs.push(c);

        for (const addr of addrs) {
          const socket = await this.tryConnect(addr.host, addr.port || DUO_PORT);
          if (!socket) continue;
          const state = this.attachSocket(socket, addr);
          this.sendTo(
            state,
            buildPairReq(
              ps,
              this.cfg.keys.publicKeyB64,
              this.cfg.myName || "Yo",
              this.cfg.myEmoji || emojiForPub(this.cfg.keys.publicKeyB64)
            )
          );
          return;
        }
        if (!settled) this.joinTimer = setTimeout(attempt, 2500);
      };

      this.joinTimer = setTimeout(() => {
        finish(
          new Error(
            "No se pudo contactar a tu pareja. Ambos deben estar en la misma WiFi y con la app abierta."
          )
        );
      }, PAIR_TIMEOUT);

      attempt().catch((e) => finish(e));
    });
  }

  onIncoming(socket) {
    this.attachSocket(socket, {
      host: socket.remoteAddress,
      port: socket.remotePort,
    });
  }
}

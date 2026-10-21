// Transporte "relay": los dos teléfonos se hablan a través de un broker MQTT
// que actúa solo como cartero. TODO el contenido va cifrado de extremo a
// extremo (cryptocore), así que el broker no puede leer nada; los temas son
// hashes que nadie puede adivinar sin las claves.
//
// v0.8.0 — blindaje de conexión:
//   - clientId ÚNICO por teléfono (si los dos usan el mismo, el broker expulsa
//     a uno cada vez que el otro se conecta: bucle de patines y mensajes
//     perdidos; era la principal causa de las desconexiones).
//   - Relay propio (EMQX Serverless, relayconfig.js) como canal principal y
//     brokers públicos como respaldo; con conmutación automática si el canal
//     activo se cae tres veces seguidas.
//   - Sesión persistente + QoS 1: el broker encola los mensajes de la pareja
//     mientras este teléfono está desconectado y los entrega al reconectar.
//   - Presencia: cada teléfono mantiene una baliza retenida (cada 90 s). Si
//     la pareja está desconectada, el emisor envía además un push genérico
//     (Expo Push) para despertar la app: "aviso como WhatsApp".
//
// La API imita a la del transporte directo (P2P) para que la app no cambie:
//   onEvent, configure, start, stop, wake, send
//   startPairing, joinPairing, acceptPairing, rejectPairing, cancelPairing
// Eventos: "status", "session", "frame", "pair-request", "paired", "presence".

import { MqttWsClient, MQTT_BROKERS } from "./mqttws";
import { PRIVATE_BROKERS } from "./relayconfig";
import { buildPairReq, verifyPairReq, buildPairOk, verifyPairOk } from "./protocol";
import {
  deriveCoupleId,
  verificationCode,
  pairingSecret,
  emojiForPub,
} from "./cryptocore";
import {
  pairTopic,
  chatTopic,
  presenceTopic,
  buildPresence,
  parsePresence,
  isPresenceStale,
  selfIdFor,
  buildPairQr,
  parsePairQr,
  buildEnvelope,
  parseEnvelope,
} from "./relayproto";

const PAIR_TIMEOUT = 90000;
const PAIR_REPUBLISH = 3000;
const BROKER_TIMEOUT = 12000;
const CONNECT_WAIT = 15000;
const PRESENCE_HEARTBEAT = 90000; // baliza propia cada 90 s (caduca a los 3 min)
const DROPS_FOR_FAILOVER = 3; // caídas seguidas -> probamos otro broker

// Lista de candidatos: relay propio primero, brokers públicos de respaldo.
const BROKERS = [
  ...PRIVATE_BROKERS.map((b) => ({ url: b.url, auth: b.user ? { user: b.user, pass: b.pass } : null })),
  ...MQTT_BROKERS.map((url) => ({ url, auth: null })),
];

function log(...args) {
  if (global.__DUO_DEBUG) console.log("[duo-relay]", ...args);
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms)
    ),
  ]);
}

export class Relay {
  constructor() {
    this.emitFn = null;
    this.cfg = null;
    this.client = null;
    this.status = "offline";
    this.stopped = true;
    this.selfId = null;
    this.chatTopicValue = null;
    this.pairTopicValue = null;
    this.pairing = null; // { ps, myName, myEmoji }
    this.pendingPair = null; // { req }
    this.joining = null; // { ps, pub, finish }
    this.joinAbort = null;
    this.sessionAnnounced = false;
    this.brokerIndex = 0;
    this.probing = false;
    this.drops = 0; // caídas desde la última sesión sana (conmutación)
    this.partnerOnline = false;
    this.presenceSelf = null; // tema retenido con NUESTRA baliza
    this.presencePartner = null; // tema retenido con la baliza de la pareja
    this.presenceTs = 0; // ts de la última baliza recibida de la pareja
    this.lastSeenAt = 0; // última vez que vimos a la pareja online
    this.presenceTimer = null;
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
    this.cfg = cfg;
    if (cfg?.keys?.publicKeyB64) this.selfId = selfIdFor(cfg.keys.publicKeyB64);
    if (cfg.partnerPub !== prev) {
      this.sessionAnnounced = false;
      this.stopPresence();
      this.presenceSelf = null;
      this.presencePartner = null;
      this.presenceTs = 0;
      this.lastSeenAt = 0;
      this.setPartnerOnline(false);
      if (this.chatTopicValue) {
        try {
          this.client?.unsubscribe(this.chatTopicValue);
        } catch {}
        this.chatTopicValue = null;
      }
      if (!cfg.partnerPub) this.setStatus("offline");
      else this.subscribeChat();
    }
  }

  start() {
    if (!this.cfg?.keys?.publicKeyB64) return;
    this.stopped = false;
    this.selfId = selfIdFor(this.cfg.keys.publicKeyB64);
    this.ensureClient();
    if (this.cfg.partnerPub) this.subscribeChat();
    else if (!this.pairing) this.setStatus("connecting");
  }

  stop() {
    this.stopped = true;
    if (this.joining?.finish) {
      try {
        this.joining.finish(new Error("Conexión detenida."));
      } catch {}
    }
    this.joining = null;
    this.joinAbort = null;
    this.pairing = null;
    this.pendingPair = null;
    this.chatTopicValue = null;
    this.pairTopicValue = null;
    this.sessionAnnounced = false;
    this.stopPresence();
    this.publishPresence(false); // aviso retenido "me voy" (best effort)
    if (this.client) {
      try {
        this.client.close();
      } catch {}
      this.client = null;
    }
    this.setStatus("offline");
  }

  wake() {
    if (this.stopped) return;
    if (!this.client) {
      this.ensureClient();
      return;
    }
    if (!this.client.connected) {
      if (this.client.url) this.client.reconnectNow();
      else this.probeBrokers(this.client);
    }
  }

  // ------------------------------------------------------------ conexión --
  ensureClient() {
    if (this.client) return this.client;
    const client = new MqttWsClient({
      clientId: this.cfg?.clientId, // ÚNICO por teléfono: evita la expulsión
      onMessage: (topic, payload) => this.onMessage(topic, payload),
      onStatus: () => this.onClientStatus(),
    });
    client.setAutoReconnect(false);
    this.client = client;
    this.probeBrokers(client);
    return client;
  }

  // Prueba los brokers (propio primero) hasta encontrar uno que responda; si
  // el activo se cae tres veces seguidas, volvemos a sondear rotando al
  // siguiente de la lista en lugar de quedarnos pegados a uno malo.
  async probeBrokers(client) {
    if (this.probing) return;
    this.probing = true;
    try {
      for (let i = 0; i < BROKERS.length; i++) {
        if (this.stopped) return;
        const cand = BROKERS[(this.brokerIndex + i) % BROKERS.length];
        try {
          client.setAuth(cand.auth);
          await withTimeout(client.connect(cand.url), BROKER_TIMEOUT);
          this.brokerIndex = (this.brokerIndex + i) % BROKERS.length;
          client.setAutoReconnect(true);
          log("conectado al broker", cand.url);
          return;
        } catch (e) {
          log("broker no disponible:", cand.url);
        }
      }
      // Ninguno respondió: probamos de nuevo en unos segundos.
      setTimeout(() => {
        this.probing = false;
        if (!this.stopped && !client.connected) this.probeBrokers(client);
      }, 8000);
    } finally {
      this.probing = false;
    }
  }

  // Conmutación: tiramos el cliente y creamos otro empezando por el SIGUIENTE
  // broker de la lista (con la sonda inicial).
  reprobeBroker() {
    log("varias caídas seguidas: probamos otro broker");
    this.brokerIndex = (this.brokerIndex + 1) % BROKERS.length;
    const old = this.client;
    this.client = null;
    if (old) {
      try {
        old.close();
      } catch {}
    }
    if (!this.stopped) this.ensureClient();
  }

  onClientStatus() {
    const connected = !!this.client?.connected;
    if (connected) {
      if (this.pairTopicValue) this.client.subscribe(this.pairTopicValue);
      if (this.chatTopicValue) this.client.subscribe(this.chatTopicValue);
      if (this.chatTopicValue) {
        this.setStatus("online");
        this.drops = 0; // sesión sana: contador de caídas a cero
        this.publishPresence(true); // baliza retenida al reconectar
        if (!this.sessionAnnounced) {
          this.sessionAnnounced = true;
          this.emit("session", { relay: true });
        }
      } else {
        this.setStatus("connecting");
      }
    } else {
      const hadSession = !!this.chatTopicValue;
      this.sessionAnnounced = false;
      this.setStatus(this.cfg?.partnerPub ? "connecting" : "offline");
      if (hadSession && !this.stopped) {
        this.drops++;
        if (this.drops >= DROPS_FOR_FAILOVER) {
          this.drops = 0;
          this.reprobeBroker();
        }
      }
    }
  }

  waitConnected(ms) {
    return new Promise((resolve, reject) => {
      if (this.client?.connected) return resolve();
      const started = Date.now();
      const iv = setInterval(() => {
        if (this.client?.connected) {
          clearInterval(iv);
          resolve();
        } else if (Date.now() - started > ms) {
          clearInterval(iv);
          reject(
            new Error(
              "No se pudo conectar al servicio. Comprueba que tienes Internet e inténtalo de nuevo."
            )
          );
        }
      }, 250);
    });
  }

  // --------------------------------------------------------------- chat --
  subscribeChat() {
    if (!this.cfg?.partnerPub || !this.cfg?.keys) return;
    const coupleId = deriveCoupleId(
      this.cfg.keys.publicKeyB64,
      this.cfg.partnerPub
    );
    this.chatTopicValue = chatTopic(coupleId);
    // Presencia: nuestro tema propio retenido + el de la pareja. Son temas
    // distintos por teléfono (derivados del selfId de cada uno).
    this.presenceSelf = presenceTopic(coupleId, this.selfId);
    this.presencePartner = presenceTopic(coupleId, selfIdFor(this.cfg.partnerPub));
    this.startPresence();
    if (this.client) {
      this.client.subscribe(this.chatTopicValue);
      this.client.subscribe(this.presencePartner);
      this.publishPresence(true);
      if (this.client.connected && !this.sessionAnnounced) {
        this.sessionAnnounced = true;
        this.setStatus("online");
        this.emit("session", { relay: true });
      }
    }
  }

  // ----------------------------------------------------------- presencia --
  startPresence() {
    this.stopPresence();
    this.presenceTimer = setInterval(() => {
      this.publishPresence(true);
      // Caducidad: si la baliza de la pareja lleva demasiado sin renovarse,
      // la damos por caída (y dejamos de enviar push a su teléfono).
      if (this.presenceTs && isPresenceStale(this.presenceTs)) {
        if (this.partnerOnline) {
          this.lastSeenAt = this.presenceTs || Date.now();
        }
        this.presenceTs = 0;
        this.setPartnerOnline(false);
      }
    }, PRESENCE_HEARTBEAT);
  }

  stopPresence() {
    if (this.presenceTimer) {
      clearInterval(this.presenceTimer);
      this.presenceTimer = null;
    }
  }

  publishPresence(on) {
    if (!this.client?.connected || !this.presenceSelf) return;
    // Retenida: el broker guarda el último estado y lo entrega a quien se
    // suscriba después (así sabemos al conectar si la pareja está en línea).
    this.client.publish(this.presenceSelf, buildPresence(on), 0, true);
  }

  setPartnerOnline(v) {
    if (!v && this.presenceTs) {
      // Al pasar a desconectada recordamos la última baliza conocida.
      this.lastSeenAt = this.presenceTs;
    }
    if (this.partnerOnline === v) {
      // Aunque no cambie el estado, la UI necesita la hora de la última vez.
      this.emit("presence", { online: v, lastSeenAt: this.lastSeenAt });
      return;
    }
    this.partnerOnline = v;
    this.emit("presence", { online: v, lastSeenAt: this.lastSeenAt });
  }

  // Envía por el relay con QoS 1: el broker encola para la sesión de la
  // pareja (sesión persistente) y no se pierde si su socket cae un instante.
  send(frame) {
    if (!this.client?.connected || !this.chatTopicValue) return false;
    return this.client.publish(
      this.chatTopicValue,
      buildEnvelope(this.selfId, frame),
      1
    );
  }

  onMessage(topic, payload) {
    // Baliza de presencia de la pareja: NO lleva sobre cifrado (solo marca
    // "estoy aquí" con un sello temporal; no hay contenido que proteger).
    if (topic === this.presencePartner) {
      const p = parsePresence(payload);
      if (p) {
        this.presenceTs = p.ts;
        this.setPartnerOnline(p.on === 1 && !isPresenceStale(p.ts));
      }
      return;
    }
    const env = parseEnvelope(payload);
    if (!env) return;
    if (env.s === this.selfId) return; // eco de lo que publicamos nosotros
    const frame = env.f;

    if (topic === this.pairTopicValue) {
      if (this.pairing && frame.t === "pair-req") {
        const req = verifyPairReq(frame, this.pairing.ps);
        if (!req) return;
        this.pendingPair = { req };
        this.emit("pair-request", {
          name: req.name,
          emoji: req.emoji,
          sas: verificationCode(this.cfg.keys.publicKeyB64, req.pub),
        });
        return;
      }
      if (this.joining && frame.t === "pair-ok") {
        const joining = this.joining;
        const ok = verifyPairOk(frame, joining.ps, joining.pub);
        if (!ok) return;
        joining.finish(null, {
          partnerPub: joining.pub,
          partnerName: ok.name,
          partnerEmoji: ok.emoji,
          coupleId: deriveCoupleId(this.cfg.keys.publicKeyB64, joining.pub),
        });
        return;
      }
      return;
    }

    if (topic === this.chatTopicValue) {
      if (frame.t === "ping" || frame.t === "pong" || frame.t === "auth") return;
      this.emit("frame", frame);
    }
  }

  // --------------------------------------------------------- emparejado --
  async startPairing({ name, emoji } = {}) {
    if (!this.cfg?.keys) throw new Error("La app aún no está lista.");
    const ps = pairingSecret();
    this.pairing = {
      ps,
      myName: name || "Yo",
      myEmoji: emoji || emojiForPub(this.cfg.keys.publicKeyB64),
    };
    this.pairTopicValue = pairTopic(ps);
    const client = this.ensureClient();
    await this.waitConnected(CONNECT_WAIT);
    client.subscribe(this.pairTopicValue);
    return {
      qr: buildPairQr(this.cfg.keys.publicKeyB64, ps),
      code: ps,
    };
  }

  async joinPairing(qrText) {
    if (!this.cfg?.keys) throw new Error("La app aún no está lista.");
    const parsed = parsePairQr(qrText);
    if (!parsed) throw new Error("El código no es un vínculo de Duo válido.");
    const { pub: creatorPub, ps } = parsed;

    const client = this.ensureClient();
    await this.waitConnected(CONNECT_WAIT);

    const topic = pairTopic(ps);
    this.pairTopicValue = topic;
    client.subscribe(topic);

    return new Promise((resolve, reject) => {
      let settled = false;
      let repub = null;
      let timer = null;
      const finish = (err, data) => {
        if (settled) return;
        settled = true;
        if (repub) clearInterval(repub);
        if (timer) clearTimeout(timer);
        this.joining = null;
        this.joinAbort = null;
        if (err) reject(err);
        else resolve(data);
      };
      this.joinAbort = (err) => finish(err || new Error("Cancelado."));
      this.joining = { ps, pub: creatorPub, finish };

      const publishReq = () => {
        if (settled) return;
        const req = buildPairReq(
          ps,
          this.cfg.keys.publicKeyB64,
          this.cfg.myName || "Yo",
          this.cfg.myEmoji || emojiForPub(this.cfg.keys.publicKeyB64)
        );
        client.publish(topic, buildEnvelope(this.selfId, req));
      };
      publishReq();
      repub = setInterval(publishReq, PAIR_REPUBLISH);
      timer = setTimeout(
        () =>
          finish(
            new Error(
              "No se pudo contactar a tu pareja. Comprobad que los dos tenéis Internet y la app abierta."
            )
          ),
        PAIR_TIMEOUT
      );
    });
  }

  acceptPairing() {
    const pending = this.pendingPair;
    if (!pending || !this.pairing) return false;
    this.pendingPair = null;
    const req = pending.req;
    const coupleId = deriveCoupleId(this.cfg.keys.publicKeyB64, req.pub);
    const ok = buildPairOk(
      this.pairing.ps,
      this.cfg.keys.publicKeyB64,
      this.pairing.myName,
      this.pairing.myEmoji,
      coupleId
    );
    if (this.client?.connected && this.pairTopicValue) {
      this.client.publish(this.pairTopicValue, buildEnvelope(this.selfId, ok));
    }
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
    this.pendingPair = null;
  }

  cancelPairing() {
    this.pairing = null;
    this.pendingPair = null;
    if (this.joinAbort) this.joinAbort(new Error("Vinculación cancelada."));
  }
}

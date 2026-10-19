// Cliente MQTT 3.1.1 mínimo sobre WebSocket, sin dependencias externas.
// Sirve para publicar/suscribirse con QoS 0 en un broker público gratuito.
// Funciona igual en React Native (Hermes) que en Node: solo usa el WebSocket
// global (que ambos traen) y no necesita Buffer, process ni TextEncoder.
//
// No implementa QoS 1/2, autenticación ni sesiones persistentes: para Duo
// basta con QoS 0 y el cifrado de extremo a extremo que ya llevan las tramas.

const TYPE_CONNECT = 1;
const TYPE_CONNACK = 2;
const TYPE_PUBLISH = 3;
const TYPE_SUBSCRIBE = 8;
const TYPE_SUBACK = 9;
const TYPE_PINGREQ = 12;
const TYPE_PINGRESP = 13;
const TYPE_DISCONNECT = 14;

// ------------------------------------------------------------ UTF-8 puro --

function utf8Encode(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const c2 = str.charCodeAt(++i);
      const cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      );
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return out;
}

function utf8Decode(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++];
    if (b < 0x80) {
      out += String.fromCharCode(b);
    } else if (b >= 0xc0 && b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
    } else if (b >= 0xe0 && b < 0xf0) {
      out += String.fromCharCode(
        ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)
      );
    } else {
      const cp =
        ((b & 0x07) << 18) |
        ((bytes[i++] & 0x3f) << 12) |
        ((bytes[i++] & 0x3f) << 6) |
        (bytes[i++] & 0x3f);
      const v = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    }
  }
  return out;
}

// ------------------------------------------------------------- codificadores --

function encodeRemainingLength(n) {
  const out = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return out;
}

function encodeString(str) {
  const b = utf8Encode(str);
  return [(b.length >> 8) & 0xff, b.length & 0xff, ...b];
}

function concat(chunks) {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function packet(type, flags, body) {
  const header = [(type << 4) | flags];
  return concat([new Uint8Array(header), new Uint8Array(encodeRemainingLength(body.length)), new Uint8Array(body)]);
}

const randomClientId = () => {
  let s = "duo-";
  for (let i = 0; i < 12; i++) s += Math.floor(Math.random() * 36).toString(36);
  return s;
};

// ------------------------------------------------------------------ cliente --

export class MqttWsClient {
  constructor({ clientId, keepAlive = 45, onMessage, onStatus } = {}) {
    this.clientId = clientId || randomClientId();
    this.keepAlive = keepAlive;
    this.onMessage = onMessage || null;
    this.onStatus = onStatus || null;
    this.ws = null;
    this.buffer = new Uint8Array(0);
    this.connected = false;
    this.closedByUser = false;
    this.packetId = 0;
    this.pingTimer = null;
    this.subs = new Map(); // topic -> true
    this.pendingSubs = new Map(); // packetId -> {topic, resolve}
    this.url = null;
    this.reconnectDelay = 1000;
    this.reconnectTimer = null;
    this.autoReconnect = true;
  }

  setAutoReconnect(v) {
    this.autoReconnect = !!v;
  }

  status(s) {
    if (this.onStatus) this.onStatus(s);
  }

  // Conecta; resuelve cuando llega el CONNACK (código 0).
  connect(url) {
    this.url = url;
    this.closedByUser = false;
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(url, ["mqtt"]);
        ws.binaryType = "arraybuffer";
      } catch (e) {
        reject(e);
        return;
      }
      this.ws = ws;
      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      };
      this._onConnack = () => {
        if (settled) return;
        settled = true;
        this.connected = true;
        this.reconnectDelay = 1000;
        this.status("online");
        this.startPing();
        // Re-suscribir tras reconectar.
        for (const topic of this.subs.keys()) this.subscribe(topic);
        resolve();
      };

      ws.onopen = () => {
        try {
          ws.send(this.buildConnect());
        } catch (e) {
          fail(e);
        }
      };
      ws.onmessage = (ev) => this.onData(ev.data);
      ws.onerror = (e) => {
        this.status("error");
        fail(new Error("WebSocket error"));
      };
      ws.onclose = () => {
        if (this.ws !== ws) return; // conexión obsoleta (ya reemplazada)
        this.connected = false;
        this.stopPing();
        this.status("offline");
        fail(new Error("WebSocket cerrado"));
        if (!this.closedByUser) this.scheduleReconnect();
      };
    });
  }

  buildConnect() {
    const body = [
      ...encodeString("MQTT"),
      0x04, // nivel 3.1.1
      0x02, // clean session
      (this.keepAlive >> 8) & 0xff,
      this.keepAlive & 0xff,
      ...encodeString(this.clientId),
    ];
    return packet(TYPE_CONNECT, 0, body);
  }

  scheduleReconnect() {
    if (this.closedByUser || !this.autoReconnect || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.closedByUser || !this.url) return;
      this.connect(this.url).catch(() => {});
    }, delay);
  }

  // Fuerza un intento inmediato (p. ej. al volver la app a primer plano).
  reconnectNow() {
    if (this.closedByUser || !this.url) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const old = this.ws;
    this.ws = null; // así el onclose del socket viejo se ignora
    this.connected = false;
    try {
      if (old) old.close();
    } catch {}
    this.reconnectDelay = 1000;
    this.connect(this.url).catch(() => {});
  }

  subscribe(topic) {
    this.subs.set(topic, true);
    if (!this.connected || !this.ws) return;
    const id = ++this.packetId;
    const body = [
      (id >> 8) & 0xff,
      id & 0xff,
      ...encodeString(topic),
      0x00, // QoS 0
    ];
    try {
      this.ws.send(packet(TYPE_SUBSCRIBE, 0x02, body));
    } catch {}
  }

  unsubscribe(topic) {
    this.subs.delete(topic);
  }

  publish(topic, payload) {
    if (!this.connected || !this.ws) return false;
    const data = typeof payload === "string" ? utf8Encode(payload) : Array.from(payload);
    const body = [...encodeString(topic), ...data];
    try {
      this.ws.send(packet(TYPE_PUBLISH, 0x00, body));
      return true;
    } catch {
      return false;
    }
  }

  onData(data) {
    let bytes;
    if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    else if (typeof data === "string") bytes = new Uint8Array(utf8Encode(data));
    else return;

    const merged = new Uint8Array(this.buffer.length + bytes.length);
    merged.set(this.buffer, 0);
    merged.set(bytes, this.buffer.length);
    this.buffer = merged;
    this.parse();
  }

  parse() {
    let buf = this.buffer;
    for (;;) {
      if (buf.length < 2) break;
      const type = buf[0] >> 4;
      // decodificar remaining length (varint)
      let multiplier = 1;
      let value = 0;
      let i = 1;
      let lenBytes = 0;
      for (;;) {
        if (i >= buf.length) return; // faltan bytes
        const b = buf[i++];
        value += (b & 0x7f) * multiplier;
        multiplier *= 128;
        lenBytes++;
        if ((b & 0x80) === 0) break;
        if (lenBytes > 3) return; // malformado
      }
      const headerLen = 1 + lenBytes;
      const total = headerLen + value;
      if (buf.length < total) break;
      const body = buf.subarray(headerLen, total);
      buf = buf.subarray(total);
      try {
        this.dispatch(type, buf && body);
      } catch {}
    }
    this.buffer = buf;
  }

  dispatch(type, body) {
    if (type === TYPE_CONNACK) {
      const code = body.length >= 2 ? body[1] : 0;
      if (code === 0 && this._onConnack) this._onConnack();
      return;
    }
    if (type === TYPE_PUBLISH) {
      let i = 0;
      const tlen = (body[i] << 8) | body[i + 1];
      i += 2;
      const topic = utf8Decode(body.subarray(i, i + tlen));
      i += tlen;
      const payload = utf8Decode(body.subarray(i));
      if (this.onMessage) this.onMessage(topic, payload);
      return;
    }
    if (type === TYPE_SUBACK || type === TYPE_PINGRESP) return;
  }

  startPing() {
    this.stopPing();
    const ms = Math.max(10, this.keepAlive - 10) * 1000;
    this.pingTimer = setInterval(() => {
      if (!this.connected || !this.ws) return;
      try {
        this.ws.send(packet(TYPE_PINGREQ, 0, []));
      } catch {}
    }, ms);
  }

  stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  close() {
    this.closedByUser = true;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.send(packet(TYPE_DISCONNECT, 0, []));
      } catch {}
      try {
        this.ws.close();
      } catch {}
    }
    this.ws = null;
    this.connected = false;
    this.buffer = new Uint8Array(0);
    this.subs.clear();
  }
}

export const MQTT_BROKERS = [
  "wss://broker.emqx.io:8084/mqtt",
  "wss://broker.hivemq.com:8884/mqtt",
  "wss://test.mosquitto.org:8081/mqtt",
];

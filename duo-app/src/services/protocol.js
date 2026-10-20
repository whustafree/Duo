import {
  bytesToB64,
  b64ToBytes,
  bytesToB64url,
  utf8ToBytes,
  bytesToUtf8,
  derivePairingKey,
  encryptWithKey,
  decryptWithKey,
  encryptText,
  decryptText,
} from "./cryptocore";

// Protocolo Duo P2P (duo-p2p-v1).
//
// Todo viaja por un socket TCP directo entre los dos teléfonos, encuadrado en
// tramas: [4 bytes de longitud big-endian][JSON en UTF-8]. El contenido de los
// mensajes va además cifrado con E2E (AES-256-GCM): el socket solo transporta
// bytes ilegibles para cualquiera que no tenga la clave privada.
//
// Este archivo es JavaScript PURO (sin React Native) para poder probarlo en
// Node con sockets reales (ver duo-app/test/p2p-test.mjs).

export const PROTOCOL_VERSION = "duo-p2p-v1";
export const MAX_FRAME = 8 * 1024 * 1024; // 8 MB (fotos en trozos de ~64 KB)

// ---------------------------------------------------------------- encuadre --

export function encodeFrame(obj) {
  const body = utf8ToBytes(JSON.stringify(obj));
  const out = new Uint8Array(4 + body.length);
  const len = body.length;
  out[0] = (len >>> 24) & 0xff;
  out[1] = (len >>> 16) & 0xff;
  out[2] = (len >>> 8) & 0xff;
  out[3] = len & 0xff;
  out.set(body, 4);
  return out;
}

// Acumula bytes que llegan trozados por el socket y entrega tramas completas.
export class FrameParser {
  constructor(maxFrame = MAX_FRAME) {
    this.buf = new Uint8Array(0);
    this.max = maxFrame;
  }

  feed(chunk) {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    const merged = new Uint8Array(this.buf.length + bytes.length);
    merged.set(this.buf, 0);
    merged.set(bytes, this.buf.length);
    this.buf = merged;

    const frames = [];
    let offset = 0;
    while (this.buf.length - offset >= 4) {
      const len =
        ((this.buf[offset] << 24) |
          (this.buf[offset + 1] << 16) |
          (this.buf[offset + 2] << 8) |
          this.buf[offset + 3]) >>>
        0;
      if (len > this.max) {
        // Trama sospechosa: cortamos la conexión en el nivel de transporte.
        this.buf = new Uint8Array(0);
        throw new Error(`Trama demasiado grande (${len} bytes)`);
      }
      if (this.buf.length - offset - 4 < len) break;
      const body = this.buf.slice(offset + 4, offset + 4 + len);
      offset += 4 + len;
      frames.push(JSON.parse(bytesToUtf8(body)));
    }
    this.buf = offset > 0 ? this.buf.slice(offset) : this.buf;
    return frames;
  }
}

// ------------------------------------------------------------------- auth --

// Autenticación entre dispositivos YA vinculados: el que conecta demuestra
// que conoce el secreto compartido (clave pública del otro + su privada).
export function buildAuth(myPrivB64, myPubB64, peerPubB64) {
  const enc = encryptText(
    JSON.stringify({ proof: PROTOCOL_VERSION, pub: myPubB64 }),
    myPrivB64,
    peerPubB64
  );
  if (enc.error) return null;
  return { t: "auth", v: PROTOCOL_VERSION, pub: myPubB64, nonceB64: enc.nonceB64, ctB64: enc.ciphertextB64 };
}

export function verifyAuth(frame, myPrivB64, peerPubB64) {
  if (!frame || frame.t !== "auth" || frame.v !== PROTOCOL_VERSION) return false;
  if (!peerPubB64 || frame.pub !== peerPubB64) return false;
  const plain = decryptText(
    { ciphertextB64: frame.ctB64, nonceB64: frame.nonceB64 },
    myPrivB64,
    peerPubB64
  );
  try {
    const obj = JSON.parse(plain);
    return obj.proof === PROTOCOL_VERSION && obj.pub === peerPubB64;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------- emparejamiento --
// El QR de vinculación contiene un secreto corto (ps) que solo ve quien está
// físicamente frente a la pantalla. Todo el diálogo de vinculación va cifrado
// con una clave derivada de ese secreto.

export function buildPairReq(psB64url, myPubB64, myName, myEmoji) {
  const key = derivePairingKey(psB64url);
  const enc = encryptWithKey(
    key,
    JSON.stringify({ proof: PROTOCOL_VERSION, pub: myPubB64, name: myName, emoji: myEmoji })
  );
  return {
    t: "pair-req",
    v: PROTOCOL_VERSION,
    pub: myPubB64,
    nonceB64: enc.nonceB64,
    ctB64: enc.ciphertextB64,
  };
}

export function verifyPairReq(frame, psB64url) {
  if (!frame || frame.t !== "pair-req" || frame.v !== PROTOCOL_VERSION) return null;
  const plain = decryptWithKey(
    derivePairingKey(psB64url),
    frame.ctB64,
    frame.nonceB64
  );
  if (!plain) return null;
  try {
    const obj = JSON.parse(plain);
    if (obj.proof !== PROTOCOL_VERSION || obj.pub !== frame.pub) return null;
    return { pub: obj.pub, name: String(obj.name || "").slice(0, 24), emoji: obj.emoji || "💞" };
  } catch {
    return null;
  }
}

export function buildPairOk(psB64url, myPubB64, myName, myEmoji, coupleId) {
  const key = derivePairingKey(psB64url);
  const enc = encryptWithKey(
    key,
    JSON.stringify({ proof: PROTOCOL_VERSION, pub: myPubB64, name: myName, emoji: myEmoji, coupleId })
  );
  return {
    t: "pair-ok",
    v: PROTOCOL_VERSION,
    pub: myPubB64,
    nonceB64: enc.nonceB64,
    ctB64: enc.ciphertextB64,
  };
}

export function verifyPairOk(frame, psB64url, expectedPubB64) {
  if (!frame || frame.t !== "pair-ok" || frame.v !== PROTOCOL_VERSION) return null;
  if (expectedPubB64 && frame.pub !== expectedPubB64) return null;
  const plain = decryptWithKey(
    derivePairingKey(psB64url),
    frame.ctB64,
    frame.nonceB64
  );
  if (!plain) return null;
  try {
    const obj = JSON.parse(plain);
    if (obj.proof !== PROTOCOL_VERSION || obj.pub !== frame.pub) return null;
    return {
      pub: obj.pub,
      name: String(obj.name || "").slice(0, 24),
      emoji: obj.emoji || "💞",
      coupleId: obj.coupleId,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- mensajes --

// El texto va cifrado con la clave de la pareja; la trama solo transporta
// ciphertext + nonce.
export function buildMsg(id, plaintext, myPrivB64, peerPubB64) {
  const enc = encryptText(JSON.stringify({ text: plaintext }), myPrivB64, peerPubB64);
  if (enc.error) return null;
  return {
    t: "msg",
    v: PROTOCOL_VERSION,
    id,
    ts: Date.now(),
    nonceB64: enc.nonceB64,
    ctB64: enc.ciphertextB64,
  };
}

export function readMsg(frame, myPrivB64, peerPubB64) {
  if (!frame || frame.t !== "msg" || frame.v !== PROTOCOL_VERSION) return null;
  const plain = decryptText(
    { ciphertextB64: frame.ctB64, nonceB64: frame.nonceB64 },
    myPrivB64,
    peerPubB64
  );
  if (!plain) return null;
  try {
    const obj = JSON.parse(plain);
    return { id: frame.id, ts: frame.ts, text: String(obj.text || "") };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ juegos --
// El estado del juego (qué juego, nivel y reto actual) viaja CIFRADO con la
// clave de la pareja, igual que el chat: el broker nunca sabe a qué juegan ni
// qué reto les ha tocado. Así el juego aparece en los dos teléfonos a la vez.

export function buildGame(payload, myPrivB64, peerPubB64) {
  const enc = encryptText(JSON.stringify(payload), myPrivB64, peerPubB64);
  if (enc.error) return null;
  return {
    t: "game",
    v: PROTOCOL_VERSION,
    ts: Date.now(),
    nonceB64: enc.nonceB64,
    ctB64: enc.ciphertextB64,
  };
}

export function readGame(frame, myPrivB64, peerPubB64) {
  if (!frame || frame.t !== "game" || frame.v !== PROTOCOL_VERSION) return null;
  const plain = decryptText(
    { ciphertextB64: frame.ctB64, nonceB64: frame.nonceB64 },
    myPrivB64,
    peerPubB64
  );
  if (!plain) return null;
  try {
    return JSON.parse(plain);
  } catch {
    return null;
  }
}

export function buildTyping(isTyping) {
  return { t: "typing", v: PROTOCOL_VERSION, typing: !!isTyping };
}

export function buildAck(id) {
  return { t: "ack", v: PROTOCOL_VERSION, id };
}

export function buildPing() {
  return { t: "ping", v: PROTOCOL_VERSION };
}

export function buildPong() {
  return { t: "pong", v: PROTOCOL_VERSION };
}

// ------------------------------------------------------------------- fotos --
// La foto se cifra entera y luego se trocea la cadena base64 del ciphertext en
// tramas manejables (el múltiplo de 4 mantiene el base64 válido).

export const PHOTO_CHUNK = 48000; // caracteres base64 por trama (~36 KB binarios)

// Tope de seguridad del receptor: ~6 MB en binario dejan margen de sobra para
// los archivos de la app (máx. 6 MB) y evitan que un emisor roto o malicioso
// anuncie miles de trozos y cuelgue el ensamblado.
export const MAX_FILE_CHUNKS = 400;

export function splitPhoto(id, nonceB64, cipherB64, chunkSize = PHOTO_CHUNK) {
  const total = Math.max(1, Math.ceil(cipherB64.length / chunkSize));
  const frames = [
    { t: "photo-meta", v: PROTOCOL_VERSION, id, ts: Date.now(), nonceB64, chunks: total },
  ];
  for (let i = 0, idx = 0; i < cipherB64.length; i += chunkSize, idx++) {
    frames.push({
      t: "photo-chunk",
      v: PROTOCOL_VERSION,
      id,
      i: idx,
      d: cipherB64.slice(i, i + chunkSize),
    });
  }
  return frames;
}

// Mismo troceado para AUDIO y VÍDEO (y también fotos): cada archivo lleva su
// tipo y su extensión para poder reproducirlo/reproducirlo en el otro teléfono.
// `iterFileFrames` es un generador para enviar trozo a trozo SIN copiar el
// cifrado entero en memoria (un vídeo congelaba la app al construir todas las
// tramas de una vez); `splitFile` sigue ofreciendo el array completo.
export function* iterFileFrames(
  id,
  kind,
  ext,
  nonceB64,
  cipherB64,
  chunkSize = PHOTO_CHUNK
) {
  const total = Math.max(1, Math.ceil(cipherB64.length / chunkSize));
  yield {
    t: "file-meta",
    v: PROTOCOL_VERSION,
    id,
    kind,
    ext,
    ts: Date.now(),
    nonceB64,
    chunks: total,
  };
  for (let i = 0, idx = 0; i < cipherB64.length; i += chunkSize, idx++) {
    yield {
      t: "file-chunk",
      v: PROTOCOL_VERSION,
      id,
      i: idx,
      d: cipherB64.slice(i, i + chunkSize),
    };
  }
}

export function splitFile(id, kind, ext, nonceB64, cipherB64, chunkSize = PHOTO_CHUNK) {
  return [...iterFileFrames(id, kind, ext, nonceB64, cipherB64, chunkSize)];
}

// Recolector del lado receptor: alimentado con las tramas que llegan,
// devuelve el ciphertext completo cuando la foto está entera.
export class PhotoAssembler {
  constructor() {
    this.pending = new Map(); // id → { nonceB64, total, parts: [] }
  }

  accept(frame) {
    const isMeta = frame.t === "photo-meta" || frame.t === "file-meta";
    const isChunk = frame.t === "photo-chunk" || frame.t === "file-chunk";
    if (isMeta) {
      const total = Number(frame.chunks) || 0;
      // Un emisor roto o malicioso no puede colgar el receptor: si el número
      // de trozos está fuera de rango, se descarta el archivo entero.
      if (total < 1 || total > MAX_FILE_CHUNKS) {
        this.pending.delete(frame.id);
        return null;
      }
      this.pending.set(frame.id, {
        nonceB64: frame.nonceB64,
        kind: frame.kind || "photo",
        ext: frame.ext || null,
        total,
        parts: [],
      });
      return null;
    }
    if (isChunk) {
      const state = this.pending.get(frame.id);
      if (!state) return null;
      const idx = Number(frame.i);
      // Índice inválido o fuera de rango: se ignora (también protege contra
      // trozos de dos envíos distintos intercalados).
      if (!Number.isInteger(idx) || idx < 0 || idx >= state.total) return null;
      if (typeof frame.d !== "string") return null;
      state.parts[idx] = frame.d;
      if (state.parts.length < state.total) return null;
      // Verificar que no falte ningún trozo.
      for (let i = 0; i < state.total; i++) {
        if (typeof state.parts[i] !== "string") return null;
      }
      this.pending.delete(frame.id);
      return {
        id: frame.id,
        kind: state.kind || "photo",
        ext:
          state.ext ||
          (state.kind === "audio" ? "m4a" : state.kind === "video" ? "mp4" : "jpg"),
        nonceB64: state.nonceB64,
        cipherB64: state.parts.join(""),
      };
    }
    return null;
  }

  reset() {
    this.pending.clear();
  }
}

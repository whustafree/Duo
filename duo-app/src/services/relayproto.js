// Lógica PURA del relay (sin WebSocket ni React Native) para poder probarla en
// Node. Define los "temas" (topics) del broker MQTT y el sobre de cada mensaje.
//
// Idea: dos teléfonos comparten un broker público gratuito solo como cartero.
// Todo el contenido va cifrado de extremo a extremo (cryptocore), así que el
// broker nunca puede leer nada. Los nombres de los temas son hashes: sin las
// claves no se pueden ni adivinar.

import { sha256 } from "@noble/hashes/sha256";
import {
  utf8ToBytes,
  toHex,
  bytesToB64,
  b64ToBytes,
  bytesToB64url,
} from "./cryptocore";

export const TOPIC_ROOT = "duo/v2";

function hashTag(prefix, input) {
  const h = sha256(utf8ToBytes(`duo-relay-v1|${prefix}|${input}`));
  return toHex(h.slice(0, 11)); // 22 caracteres hex: válidos en un tema MQTT
}

// Tema para el intercambio de vinculación (privado mientras dura el vínculo).
export function pairTopic(psB64url) {
  return `${TOPIC_ROOT}/pair/${hashTag("pair", String(psB64url))}`;
}

// Tema del chat de una pareja (derivado de su coupleId).
export function chatTopic(coupleId) {
  return `${TOPIC_ROOT}/chat/${hashTag("chat", String(coupleId))}`;
}

// Identificador con el que marcamos nuestros propios mensajes para ignorar el
// eco que el broker nos devuelve (estamos suscritos a nuestro propio tema).
export function selfIdFor(pubB64) {
  return hashTag("self", String(pubB64));
}

// QR de vinculación: corto y fácil de escanear (no lleva SDP ni direcciones).
//   duo:pair:v2:<pub b64url>:<ps b64url>
export function buildPairQr(pubB64, psB64url) {
  const pubUrl = bytesToB64url(b64ToBytes(pubB64));
  return `duo:pair:v2:${pubUrl}:${psB64url}`;
}

export function parsePairQr(qrText) {
  const parts = String(qrText || "").split(":");
  if (
    parts.length !== 5 ||
    parts[0] !== "duo" ||
    parts[1] !== "pair" ||
    parts[2] !== "v2" ||
    !parts[3] ||
    !parts[4]
  ) {
    return null;
  }
  try {
    const pub = bytesToB64(b64ToBytes(parts[3]));
    return { pub, ps: parts[4] };
  } catch {
    return null;
  }
}

// Sobre: { s: emisor, f: trama }. Así se descarta el eco propio.
export function buildEnvelope(selfId, frame) {
  return JSON.stringify({ s: selfId, f: frame });
}

export function parseEnvelope(text) {
  try {
    const o = JSON.parse(text);
    if (o && typeof o.s === "string" && o.f && typeof o.f === "object") {
      return o;
    }
  } catch {}
  return null;
}

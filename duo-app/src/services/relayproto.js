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

// Tema de presencia de UN dispositivo concreto de la pareja (uno por
// teléfono). El broker lo conserva "retenido": al suscribirnos recibimos
// siempre el último estado, aunque lleguemos tarde.
export function presenceTopic(coupleId, whoSelfId) {
  return `${TOPIC_ROOT}/pres/${hashTag("pres", `${coupleId}|${whoSelfId}`)}`;
}

// Baliza de presencia: si hace más de PRESENCE_STALE_MS que no se renueva,
// damos por perdido al dispositivo (red caída, móvil apagado…).
export const PRESENCE_STALE_MS = 180000; // 3 minutos

export function buildPresence(on, ts = Date.now()) {
  return JSON.stringify({ on: on ? 1 : 0, ts });
}

export function parsePresence(text) {
  try {
    const o = JSON.parse(String(text || ""));
    if (o && (o.on === 0 || o.on === 1) && typeof o.ts === "number") return o;
  } catch {}
  return null;
}

export function isPresenceStale(ts, now = Date.now(), maxAge = PRESENCE_STALE_MS) {
  return typeof ts !== "number" || now - ts > maxAge;
}

// clientId MQTT ÚNICO por instalación (se guarda una sola vez y no cambia).
// ¡NUNCA el mismo en dos teléfonos!: MQTT interpreta un clientId repetido
// como "toma de sesión" y el broker EXPULSA al otro teléfono, que se
// reconecta y expulsa al primero… un bucle de patines que perdía mensajes
// a mitad de camino (era la causa de las pérdidas "a cada rato").
export function deviceClientId(suffix) {
  const s = String(suffix || "")
    .replace(/[^0-9a-f]/gi, "")
    .slice(0, 24);
  return `duo-${s || "anon"}`;
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

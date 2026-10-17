import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { randomBytes } from "@noble/hashes/utils";
import { gcm } from "@noble/ciphers/aes";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Cifrado extremo a extremo (E2E):
//   X25519 (clave compartida) → HKDF-SHA256 (clave de sesión) → AES-256-GCM.
// La clave privada NUNCA sale del dispositivo.
//
// Nota: todo se implementa con Uint8Array puro (sin Buffer ni TextEncoder),
// porque Hermes (React Native) no los expone.

const KEY_STORAGE = "duo.e2e.keys";

const B64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToB64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out +=
      b1 === undefined
        ? "="
        : B64_ALPHABET[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? "=" : B64_ALPHABET[b2 & 63];
  }
  return out;
}

export function b64ToBytes(str) {
  const clean = String(str || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let p = 0;
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const c0 = B64_ALPHABET.indexOf(clean[i]);
    const c1 = B64_ALPHABET.indexOf(clean[i + 1]);
    const c2 = i + 2 < clean.length ? B64_ALPHABET.indexOf(clean[i + 2]) : -1;
    const c3 = i + 3 < clean.length ? B64_ALPHABET.indexOf(clean[i + 3]) : -1;
    if (c0 < 0 || c1 < 0) break;
    out[p++] = (c0 << 2) | (c1 >> 4);
    if (c2 >= 0) out[p++] = ((c1 & 15) << 4) | (c2 >> 2);
    if (c3 >= 0) out[p++] = ((c2 & 3) << 6) | c3;
  }
  return p === out.length ? out : out.slice(0, p);
}

export function utf8ToBytes(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const c2 = str.charCodeAt(++i);
      c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
      out.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f)
      );
    } else {
      out.push(
        0xe0 | (c >> 12),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f)
      );
    }
  }
  return new Uint8Array(out);
}

export function bytesToUtf8(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++];
    let c;
    if (b < 0x80) c = b;
    else if (b < 0xe0) c = ((b & 0x1f) << 6) | (bytes[i++] & 0x3f);
    else if (b < 0xf0)
      c = ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    else
      c =
        ((b & 0x07) << 18) |
        ((bytes[i++] & 0x3f) << 12) |
        ((bytes[i++] & 0x3f) << 6) |
        (bytes[i++] & 0x3f);
    if (c > 0xffff) {
      c -= 0x10000;
      out += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
    } else {
      out += String.fromCharCode(c);
    }
  }
  return out;
}

export async function loadOrGenerateKeys() {
  try {
    const raw = await AsyncStorage.getItem(KEY_STORAGE);
    if (raw) return JSON.parse(raw);
  } catch {}

  const priv = x25519.utils.randomPrivateKey();
  const pub = x25519.getPublicKey(priv);
  const keys = { privateKeyB64: bytesToB64(priv), publicKeyB64: bytesToB64(pub) };
  try {
    await AsyncStorage.setItem(KEY_STORAGE, JSON.stringify(keys));
  } catch {}
  return keys;
}

export function hasKeys(k) {
  return !!(k?.privateKeyB64 && k?.publicKeyB64);
}

// Ambos lados deben derivar la MISMA clave: por eso el salt y el info son
// fijos (no aleatorios por mensaje).
function deriveKey(myPrivB64, peerPubB64) {
  const shared = x25519.getSharedSecret(
    b64ToBytes(myPrivB64),
    b64ToBytes(peerPubB64)
  );
  return hkdf(sha256, shared, utf8ToBytes("duo-salt-v1"), utf8ToBytes("duo-e2e-v1"), 32);
}

export function encryptText(plaintext, myPrivB64, peerPubB64) {
  if (!myPrivB64 || !peerPubB64) return { error: "Falta la clave de la pareja" };
  const key = deriveKey(myPrivB64, peerPubB64);
  const nonce = randomBytes(12);
  const ct = gcm(key, nonce).encrypt(utf8ToBytes(plaintext));
  return { ciphertextB64: bytesToB64(ct), nonceB64: bytesToB64(nonce) };
}

export function decryptText(payload, myPrivB64, peerPubB64) {
  if (!payload) return "";
  if (payload.plaintext != null) return payload.plaintext;
  if (!payload.ciphertextB64 || !myPrivB64 || !peerPubB64) return "";
  try {
    const key = deriveKey(myPrivB64, peerPubB64);
    const nonce = b64ToBytes(payload.nonceB64 || "");
    const ct = b64ToBytes(payload.ciphertextB64);
    return bytesToUtf8(gcm(key, nonce).decrypt(ct));
  } catch {
    return "";
  }
}

// Fotos: mismo esquema, pero sobre bytes binarios.
export function encryptBytes(bytes, myPrivB64, peerPubB64) {
  if (!myPrivB64 || !peerPubB64) return null;
  const key = deriveKey(myPrivB64, peerPubB64);
  const nonce = randomBytes(12);
  const ct = gcm(key, nonce).encrypt(bytes);
  return { cipherB64: bytesToB64(ct), nonceB64: bytesToB64(nonce) };
}

export function decryptBytes(cipherB64, nonceB64, myPrivB64, peerPubB64) {
  if (!cipherB64 || !myPrivB64 || !peerPubB64) return null;
  try {
    const key = deriveKey(myPrivB64, peerPubB64);
    const nonce = b64ToBytes(nonceB64 || "");
    const ct = b64ToBytes(cipherB64);
    return gcm(key, nonce).decrypt(ct);
  } catch {
    return null;
  }
}

import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { randomBytes } from "@noble/hashes/utils";
import { aes256gcm } from "@noble/ciphers/aes";
import { utf8ToBytes, bytesToUtf8 } from "@noble/ciphers/utils";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_STORAGE = "duo.e2e.keys";

function b64url(buf) {
  const b = Buffer.from(buf).toString("base64");
  return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s) {
  let b = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  while (b.length % 4) b += "=";
  return Buffer.from(b, "base64");
}

export async function loadOrGenerateKeys() {
  try {
    const raw = await AsyncStorage.getItem(KEY_STORAGE);
    if (raw) return JSON.parse(raw);
  } catch {}

  const priv = x25519.utils.randomPrivateKey();
  const pub = x25519.getPublicKey(priv);
  const keys = {
    privateKeyB64: b64url(priv),
    publicKeyB64: b64url(pub),
  };
  try {
    await AsyncStorage.setItem(KEY_STORAGE, JSON.stringify(keys));
  } catch {}
  return keys;
}

export function hasKeys(k) {
  return !!(k?.privateKeyB64 && k?.publicKeyB64);
}

function deriveKey(myPrivB64, peerPubB64) {
  const shared = x25519.getSharedSecret(
    b64urlDecode(myPrivB64),
    b64urlDecode(peerPubB64)
  );
  const derived = hkdf(sha256, shared, randomBytes(8), "duo-e2e-v1", 32);
  return derived;
}

export function encryptText(plaintext, myPrivB64, peerPubB64) {
  if (!peerPubB64) return { plaintext };
  const key = deriveKey(myPrivB64, peerPubB64);
  const nonce = randomBytes(12);
  const cipher = aes256gcm(key, nonce);
  const ct = cipher.encrypt(utf8ToBytes(plaintext));
  return {
    ciphertextB64: b64url(ct),
    nonceB64: b64url(nonce),
    plaintext: null,
  };
}

export function decryptText(payload, myPrivB64, peerPubB64) {
  if (!payload) return "";
  if (payload.plaintext != null) return payload.plaintext;
  if (!payload.ciphertextB64 || !peerPubB64) return "";
  try {
    const key = deriveKey(myPrivB64, peerPubB64);
    const nonce = b64urlDecode(payload.nonceB64 || "");
    const ct = b64urlDecode(payload.ciphertextB64);
    const cipher = aes256gcm(key, nonce);
    const pt = cipher.decrypt(ct);
    return bytesToUtf8(pt);
  } catch {
    return "";
  }
}

export function encryptPhotoPayload(_dataB64, _myPrivB64, _peerPubB64) {
  return { dataB64: _dataB64 };
}

export function decryptPhotoPayload(payload) {
  return payload?.dataB64 || null;
}

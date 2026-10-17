import { randomBytes, createSecretKey } from "node:crypto";
import { subtle } from "node:crypto";
import { pbkdf2Sync } from "node:crypto";

const NONCE_LEN = 12;

function b64url(buf) {
  const b = Buffer.from(buf).toString("base64");
  return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s) {
  let b = String(s || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  while (b.length % 4) b += "=";
  return Buffer.from(b, "base64");
}

async function deriveSharedSecret(privateKeyB64, publicKeyB64) {
  const crypto = await import("node:crypto");
  const privateKeyRaw = b64urlDecode(privateKeyB64);
  const publicKeyRaw = b64urlDecode(publicKeyB64);
  const priv = crypto.createPrivateKey({
    key: privateKeyRaw,
    format: "der",
    type: "pkcs8",
  });
  const pub = crypto.createPublicKey({
    key: publicKeyRaw,
    format: "der",
    type: "spki",
  });
  return crypto.diffieHellman({ privateKey: priv, publicKey: pub });
}

export async function generateX25519() {
  const crypto = await import("node:crypto");
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
  return {
    publicKey: b64url(
      publicKey.export({ format: "der", type: "spki" })
    ),
    privateKey: b64url(
      privateKey.export({ format: "der", type: "pkcs8" })
    ),
  };
}

export async function encryptText(text, privateKeyB64, peerPubB64) {
  const shared = await deriveSharedSecret(privateKeyB64, peerPubB64);
  const nonce = randomBytes(NONCE_LEN);
  const key = createSecretKey(pbkdf2Sync(shared, nonce, 100000, 16, "sha256"));
  const cipher = await import("node:crypto");
  const c = cipher.createCipheriv("aes-128-gcm", key, nonce);
  const ct = Buffer.concat([c.update(text, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return {
    ciphertextB64: b64url(Buffer.concat([ct, tag])),
    nonceB64: b64url(nonce),
  };
}

export async function decryptText(payload, privateKeyB64, peerPubB64) {
  const { ciphertextB64, nonceB64 } = payload;
  const shared = await deriveSharedSecret(privateKeyB64, peerPubB64);
  const nonce = b64urlDecode(nonceB64);
  const data = b64urlDecode(ciphertextB64);
  if (data.length < 16) return null;
  const tag = data.subarray(data.length - 16);
  const ct = data.subarray(0, data.length - 16);
  const key = createSecretKey(pbkdf2Sync(shared, nonce, 100000, 16, "sha256"));
  const cipher = await import("node:crypto");
  const d = cipher.createDecipheriv("aes-128-gcm", key, nonce);
  d.setAuthTag(tag);
  const pt = Buffer.concat([d.update(ct), d.final()]);
  return pt.toString("utf8");
}

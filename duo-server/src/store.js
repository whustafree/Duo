import { customAlphabet } from "nanoid";
import db from "./db.js";

const nano = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 5);

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function randomEmoji() {
  const pool = ["🦊", "🐰", "🐼", "🦁", "🐧", "🐨", "🐯", "🦉", "🐸", "🐙"];
  return pool[Math.floor(Math.random() * pool.length)];
}

export function createUser({ name, emoji, pubKey } = {}) {
  const user = {
    id: newId("u"),
    name: name?.trim() || "Anónimo",
    emoji: emoji || randomEmoji(),
    pub_key: pubKey ?? null,
    created_at: Date.now(),
  };
  db.prepare(
    "INSERT INTO users (id, name, emoji, pub_key, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(user.id, user.name, user.emoji, user.pub_key, user.created_at);
  return user;
}

export function createCouple({ name, emoji, pubKey } = {}) {
  const user = createUser({ name, emoji, pubKey });
  let code;
  let coupleId;
  for (let i = 0; i < 10; i++) {
    code = `DUO-${nano()}`;
    const exists = db
      .prepare("SELECT 1 FROM couples WHERE code = ?")
      .get(code);
    if (!exists) break;
  }
  coupleId = newId("c");
  db.prepare(
    "INSERT INTO couples (id, code, created_at) VALUES (?, ?, ?)"
  ).run(coupleId, code, Date.now());
  db.prepare(
    "INSERT INTO couple_members (couple_id, user_id, slot) VALUES (?, ?, 1)"
  ).run(coupleId, user.id);
  return { user, coupleId, code };
}

export function normalizeCode(code) {
  const raw = String(code || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  return raw.startsWith("DUO-") ? raw : `DUO-${raw.replace(/^DUO-?/, "")}`;
}

export function joinCouple({ code, name, emoji, pubKey } = {}) {
  const normalized = normalizeCode(code);
  const couple = db
    .prepare("SELECT * FROM couples WHERE code = ?")
    .get(normalized);
  if (!couple) return { error: "CODIGO_INVALIDO" };

  const count = db
    .prepare("SELECT COUNT(*) AS n FROM couple_members WHERE couple_id = ?")
    .get(couple.id).n;
  if (count >= 2) return { error: "PAREJA_LLENA" };

  const user = createUser({ name, emoji, pubKey });
  db.prepare(
    "INSERT INTO couple_members (couple_id, user_id, slot) VALUES (?, ?, 2)"
  ).run(couple.id, user.id);
  return { user, coupleId: couple.id, code: couple.code };
}

export function getCoupleInfo(coupleId, userId) {
  const couple = db
    .prepare("SELECT * FROM couples WHERE id = ?")
    .get(coupleId);
  if (!couple) return null;
  const me = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(userId);
  const partner = db
    .prepare(
      `SELECT u.* FROM users u
       JOIN couple_members m ON m.user_id = u.id
       WHERE m.couple_id = ? AND u.id != ?`
    )
    .get(coupleId, userId);
  const count = db
    .prepare("SELECT COUNT(*) AS n FROM couple_members WHERE couple_id = ?")
    .get(coupleId).n;
  return { couple, me, partner: partner || null, linked: count >= 2 };
}

export function addMessage({ coupleId, senderId, type, text, url, nonce }) {
  const msg = {
    id: newId("m"),
    couple_id: coupleId,
    sender_id: senderId,
    type: type || "text",
    text: text ?? null,
    url: url ?? null,
    nonce: nonce ?? null,
    created_at: Date.now(),
  };
  db.prepare(
    `INSERT INTO messages (id, couple_id, sender_id, type, text, url, nonce, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    msg.id,
    msg.couple_id,
    msg.sender_id,
    msg.type,
    msg.text,
    msg.url,
    msg.nonce,
    msg.created_at
  );
  return msg;
}

export function getMessages(coupleId, limit = 100) {
  const rows = db
    .prepare(
      `SELECT * FROM messages WHERE couple_id = ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(coupleId, limit);
  return rows.reverse();
}

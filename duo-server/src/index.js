import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { writeFileSync } from "node:fs";
import { join as joinPath } from "node:path";

import { UPLOAD_DIR } from "./db.js";
import {
  createCouple,
  joinCouple,
  getCoupleInfo,
  addMessage,
  getMessages,
  isValidMember,
  newId,
} from "./store.js";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

app.use(cors());
// Límite generoso porque las fotos llegan en base64 (cifradas por el cliente).
app.use(express.json({ limit: "30mb" }));
// Las fotos se sirven cifradas (AES-256-GCM en el cliente); sin la clave de la
// pareja el archivo es inútil.
app.use("/uploads", express.static(UPLOAD_DIR));

const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

function tokenOf(req) {
  return req.get("x-duo-token") || req.query.token;
}

// Middleware: solo los miembros de la pareja (con su token) acceden a sus datos.
function requireMember(req, res, next) {
  const coupleId = req.params.coupleId;
  const userId = req.query.userId || req.body?.userId;
  if (!isValidMember(coupleId, userId, tokenOf(req)))
    return res.status(401).json({ error: "No autorizado" });
  next();
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/api/pair/create", (req, res) => {
  const { name, emoji, pubKey } = req.body || {};
  const { user, coupleId, code, token } = createCouple({ name, emoji, pubKey });
  res.json({ userId: user.id, coupleId, code, token, user, linked: false });
});

app.post("/api/pair/join", (req, res) => {
  const { code, name, emoji, pubKey } = req.body || {};
  const result = joinCouple({ code, name, emoji, pubKey });
  if (result.error === "CODIGO_INVALIDO")
    return res.status(404).json({ error: "Código inválido" });
  if (result.error === "PAREJA_LLENA")
    return res.status(409).json({ error: "Esa pareja ya está completa" });
  const info = getCoupleInfo(result.coupleId, result.user.id);
  io.to(result.coupleId).emit("partner_joined", { partner: result.user });
  res.json({
    userId: result.user.id,
    coupleId: result.coupleId,
    code: result.code,
    token: result.token,
    user: result.user,
    partner: info.partner,
    linked: info.linked,
  });
});

app.get("/api/couple/:coupleId", requireMember, (req, res) => {
  const info = getCoupleInfo(req.params.coupleId, req.query.userId);
  if (!info) return res.status(404).json({ error: "No encontrado" });
  res.json(info);
});

app.get("/api/messages/:coupleId", requireMember, (req, res) => {
  res.json(getMessages(req.params.coupleId));
});

// Recibe una foto YA CIFRADA por el cliente (base64 del ciphertext AES-256-GCM).
// El servidor nunca ve el contenido: solo guarda bytes cifrados en disco.
app.post("/api/photo", (req, res) => {
  const { coupleId, senderId, nonceB64, imageDataB64 } = req.body || {};
  if (!isValidMember(coupleId, senderId, tokenOf(req)))
    return res.status(401).json({ error: "No autorizado" });
  if (!imageDataB64) return res.status(400).json({ error: "Falta la foto" });

  const bytes = Buffer.from(String(imageDataB64), "base64");
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES)
    return res.status(400).json({ error: "Foto inválida o demasiado grande" });

  const filename = `${newId("img")}.bin`;
  writeFileSync(joinPath(UPLOAD_DIR, filename), bytes);

  const msg = addMessage({
    coupleId,
    senderId,
    type: "photo",
    url: `/uploads/${filename}`,
    nonce: nonceB64 ?? null,
  });
  io.to(coupleId).emit("message", msg);
  res.json(msg);
});

io.on("connection", (socket) => {
  // El cliente debe identificarse con su token de pareja; sin él no entra a la sala.
  socket.on("join", ({ coupleId, userId, token } = {}) => {
    if (!isValidMember(coupleId, userId, token)) {
      socket.emit("auth_error", { error: "No autorizado" });
      return;
    }
    socket.data.coupleId = coupleId;
    socket.data.userId = userId;
    socket.join(coupleId);
  });

  // El coupleId/userId NO se toman del cliente: se usa lo validado en el join.
  socket.on("message", ({ ciphertextB64, nonce } = {}) => {
    const { coupleId, userId } = socket.data;
    if (!coupleId || !ciphertextB64) return;
    const msg = addMessage({
      coupleId,
      senderId: userId,
      type: "text",
      ciphertext: ciphertextB64,
      nonce: nonce ?? null,
    });
    io.to(coupleId).emit("message", { ...msg, ciphertextB64: msg.ciphertext });
  });

  socket.on("typing", ({ isTyping } = {}) => {
    const { coupleId, userId } = socket.data;
    if (!coupleId) return;
    socket.to(coupleId).emit("typing", { userId, isTyping: !!isTyping });
  });
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`💞 Duo server escuchando en http://localhost:${PORT}`);
});

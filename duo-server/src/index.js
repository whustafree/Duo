import express from "express";
import cors from "cors";
import multer from "multer";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { extname } from "node:path";

import { UPLOAD_DIR } from "./db.js";
import {
  createCouple,
  joinCouple,
  getCoupleInfo,
  addMessage,
  getMessages,
  newId,
} from "./store.js";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(UPLOAD_DIR));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) =>
    cb(null, `${newId("img")}${extname(file.originalname) || ".jpg"}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Solo se permiten imágenes"));
  },
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/api/pair/create", (req, res) => {
  const { name, emoji, pubKey } = req.body || {};
  const { user, coupleId, code } = createCouple({ name, emoji, pubKey });
  res.json({ userId: user.id, coupleId, code, user, linked: false });
});

app.post("/api/pair/join", (req, res) => {
  const { code, name, emoji, pubKey } = req.body || {};
  const result = joinCouple({ code, name, emoji, pubKey });
  if (result.error === "CODIGO_INVALIDO")
    return res.status(404).json({ error: "Código inválido" });
  if (result.error === "PAREJA_LLENA")
    return res.status(409).json({ error: "Esa pareja ya está completa" });
  const info = getCoupleInfo(result.coupleId, result.user.id);
  io.to(result.coupleId).emit("partner_joined", {
    partner: result.user,
  });
  res.json({
    userId: result.user.id,
    coupleId: result.coupleId,
    code: result.code,
    user: result.user,
    partner: info.partner,
    linked: info.linked,
  });
});

app.get("/api/couple/:coupleId", (req, res) => {
  const { userId } = req.query;
  const info = getCoupleInfo(req.params.coupleId, userId);
  if (!info) return res.status(404).json({ error: "No encontrado" });
  res.json(info);
});

app.get("/api/messages/:coupleId", (req, res) => {
  res.json(getMessages(req.params.coupleId));
});

app.post("/api/upload", upload.single("photo"), (req, res) => {
  const { coupleId, senderId } = req.body || {};
  if (!req.file) return res.status(400).json({ error: "Falta la foto" });
  const url = `/uploads/${req.file.filename}`;
  const msg = addMessage({ coupleId, senderId, type: "photo", url });
  io.to(coupleId).emit("message", msg);
  res.json(msg);
});

io.on("connection", (socket) => {
  socket.on("join", ({ coupleId, userId }) => {
    if (!coupleId) return;
    socket.data.coupleId = coupleId;
    socket.data.userId = userId;
    socket.join(coupleId);
  });

  socket.on("message", ({ coupleId, senderId, text, nonce, ciphertextB64 } = {}) => {
    if (!coupleId || (text == null && ciphertextB64 == null)) return;
    const msg = addMessage({
      coupleId,
      senderId,
      type: "text",
      text: text ?? null,
      nonce: nonce ?? null,
    });
    // forward encrypted payloads as-is via extra fields
    const out = { ...msg, ciphertextB64 };
    io.to(coupleId).emit("message", out);
  });

  socket.on("typing", ({ coupleId, userId, isTyping } = {}) => {
    if (!coupleId) return;
    socket.to(coupleId).emit("typing", { userId, isTyping: !!isTyping });
  });

  socket.on("disconnect", () => {});
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`💞 Duo server escuchando en http://localhost:${PORT}`);
});

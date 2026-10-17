import { io } from "socket.io-client";
import { existsSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE || "http://localhost:4000";
const log = (...a) => console.log(...a);

let failures = 0;
function check(name, ok) {
  log(`${ok ? "  ✅" : "  ❌"} ${name}`);
  if (!ok) failures++;
}

async function post(path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["x-duo-token"] = token;
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
}

async function get(path, token) {
  const headers = {};
  if (token) headers["x-duo-token"] = token;
  const r = await fetch(`${BASE}${path}`, { headers });
  return { status: r.status, data: await r.json() };
}

function connect(coupleId, userId, token) {
  return new Promise((resolve) => {
    const socket = io(BASE, { forceNew: true });
    socket.on("connect", () => {
      socket.emit("join", { coupleId, userId, token });
      setTimeout(() => resolve(socket), 150);
    });
  });
}

const wait = (socket, event) =>
  new Promise((resolve) => socket.once(event, resolve));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  log("1) Crear pareja...");
  const a = (
    await post("/api/pair/create", { name: "Ana", emoji: "🦊", pubKey: "PUBKEY_A" })
  ).data;
  check("create devuelve código + token", !!a.code && !!a.token);

  const sockA = await connect(a.coupleId, a.userId, a.token);

  log("2) Unirse con el código...");
  const joined = wait(sockA, "partner_joined");
  const b = (
    await post("/api/pair/join", {
      code: a.code,
      name: "Luis",
      emoji: "🐰",
      pubKey: "PUBKEY_B",
    })
  ).data;
  const joinedPayload = await joined;
  check("partner_joined entrega a B", joinedPayload.partner.name === "Luis");
  check("ambos comparten el mismo token", b.token === a.token);

  const sockB = await connect(b.coupleId, b.userId, b.token);

  log("3) Un intruder sin token no entra a la sala...");
  const intruder = io(BASE, { forceNew: true });
  const authErr = await new Promise((resolve) => {
    intruder.on("connect", () => {
      intruder.emit("join", { coupleId: a.coupleId, userId: "u_intruso", token: "nope" });
    });
    intruder.on("auth_error", resolve);
    setTimeout(() => resolve(null), 2000);
  });
  check("socket sin token recibe auth_error", !!authErr);
  intruder.close();

  log("4) A envía mensaje cifrado, B debe recibirlo...");
  const received = wait(sockB, "message");
  sockA.emit("message", { ciphertextB64: "CIFRADO123", nonce: "NONCE_A" });
  const msg = await received;
  check("B recibe el ciphertext tal cual", msg.ciphertextB64 === "CIFRADO123");
  check("el sender es A (validado por el servidor)", msg.sender_id === a.userId);

  log("5) Inyección a otra sala ignorada...");
  const notReceived = wait(sockB, "message").then(() => false, () => false);
  sockA.emit("message", {
    coupleId: "c_otptra_sala",
    senderId: "u_intruso",
    ciphertextB64: "HACK",
  });
  const leaked = await Promise.race([notReceived, sleep(400)]);
  check("no se inyecta en otras salas", leaked === false);

  log("6) Typing...");
  const typing = wait(sockA, "typing");
  sockB.emit("typing", { isTyping: true });
  const t = await typing;
  check("A ve el typing de B", t.userId === b.userId && t.isTyping === true);

  log("7) Autorización en REST...");
  const noAuth = await get(`/api/messages/${a.coupleId}?userId=${a.userId}`);
  check("historial sin token → 401", noAuth.status === 401);
  const wrongUser = await get(
    `/api/messages/${a.coupleId}?userId=u_intruso`,
    a.token
  );
  check("historial con token pero userId ajeno → 401", wrongUser.status === 401);
  const hist = await get(`/api/messages/${a.coupleId}?userId=${a.userId}`, a.token);
  check(
    "historial con token → ciphertext persistido",
    hist.status === 200 &&
      hist.data.some((m) => m.ciphertext === "CIFRADO123")
  );
  const coupleNoAuth = await get(`/api/couple/${a.coupleId}`);
  check("info de pareja sin token → 401", coupleNoAuth.status === 401);

  log("8) Foto cifrada...");
  const photo = await post(
    "/api/photo",
    {
      coupleId: a.coupleId,
      senderId: a.userId,
      nonceB64: "NONCE_FOTO",
      imageDataB64: Buffer.from("bytes-cifrados-de-prueba").toString("base64"),
    },
    a.token
  );
  check("foto aceptada", photo.status === 200 && photo.data.type === "photo");
  check(
    "archivo .bin escrito en disco",
    photo.status === 200 &&
      existsSync(join(process.cwd(), "uploads", photo.data.url.split("/").pop()))
  );
  const photoNoAuth = await post("/api/photo", {
    coupleId: a.coupleId,
    senderId: a.userId,
    imageDataB64: "AAAA",
  });
  check("subir foto sin token → 401", photoNoAuth.status === 401);

  sockA.close();
  sockB.close();
  log(failures === 0 ? "\n✅ Todo OK" : `\n❌ ${failures} verificaciones fallaron`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});

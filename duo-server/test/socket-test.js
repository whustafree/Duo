import { io } from "socket.io-client";

const BASE = process.env.BASE || "http://localhost:4000";
const log = (...a) => console.log(...a);

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
}

function connect(coupleId, userId) {
  return new Promise((resolve) => {
    const socket = io(BASE, { forceNew: true });
    socket.on("connect", () => {
      socket.emit("join", { coupleId, userId });
      setTimeout(() => resolve(socket), 150);
    });
  });
}

const wait = (socket, event) =>
  new Promise((resolve) => socket.once(event, resolve));

(async () => {
  log("1) Crear pareja...");
  const a = (await post("/api/pair/create", { name: "Ana", emoji: "🦊" })).data;
  log("   código:", a.code);

  const sockA = await connect(a.coupleId, a.userId);

  const joined = wait(sockA, "partner_joined");
  log("2) Unirse con el código...");
  const b = (await post("/api/pair/join", {
    code: a.code,
    name: "Luis",
    emoji: "🐰",
  })).data;
  const joinedPayload = await joined;
  log("   partner_joined:", joinedPayload.partner.name);

  const sockB = await connect(b.coupleId, b.userId);

  log("3) A envía mensaje, B debe recibirlo...");
  const received = wait(sockB, "message");
  sockA.emit("message", {
    coupleId: a.coupleId,
    senderId: a.userId,
    text: "Hola mi amor 😍",
  });
  const msg = await received;
  log("   B recibió:", msg.text, `(${msg.type})`);

  log("4) B escribe (typing), A debe verlo...");
  const typing = wait(sockA, "typing");
  sockB.emit("typing", { coupleId: a.coupleId, userId: b.userId, isTyping: true });
  const t = await typing;
  log("   A ve typing de:", t.userId === b.userId ? "B ✅" : "???", t.isTyping);

  log("5) Historial persistido:");
  const hist = (await fetch(`${BASE}/api/messages/${a.coupleId}`)).json
    ? await (await fetch(`${BASE}/api/messages/${a.coupleId}`)).json()
    : [];
  log("   mensajes:", hist.length, "->", hist.map((m) => m.text));

  sockA.close();
  sockB.close();
  log("\n✅ Tiempo real OK");
  process.exit(0);
})().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});

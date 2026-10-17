// Prueba integral del flujo REAL de la app: usa el crypto de duo-app (con
// AsyncStorage simulado) para que A y B hagan lo mismo que en los dispositivos.
//
// Requiere el servidor corriendo:  npm start  (en otra terminal)
// Luego:  npm run test:e2e
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = join(__dirname, "..");
const APP_DIR = join(SERVER_DIR, "..", "duo-app");
const TMP = join(APP_DIR, ".e2e-tmp-crypto.mjs");

const require = createRequire(join(SERVER_DIR, "package.json"));
const { io } = require("socket.io-client");

// 1) Cargar el crypto REAL de la app (solo se stubkea AsyncStorage)
let src = readFileSync(join(APP_DIR, "src", "services", "crypto.js"), "utf8");
src = src.replace(
  /^import AsyncStorage[^\n]*\n/m,
  "const AsyncStorage = { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} };\n"
);
writeFileSync(TMP, src);
const C = await import(pathToFileURL(TMP).href);
try {
  unlinkSync(TMP);
} catch {}

const BASE = process.env.BASE || "http://localhost:4000";
let fails = 0;
const check = (n, ok) => {
  console.log(`${ok ? "  OK  " : "  FAIL"} ${n}`);
  if (!ok) fails++;
};
const post = async (p, body, token) => {
  const h = { "Content-Type": "application/json" };
  if (token) h["x-duo-token"] = token;
  const r = await fetch(BASE + p, {
    method: "POST",
    headers: h,
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
};
const get = async (p, token) => {
  const r = await fetch(BASE + p, {
    headers: token ? { "x-duo-token": token } : {},
  });
  return { status: r.status, data: await r.json() };
};
const connectSocket = (coupleId, userId, token) =>
  new Promise((resolve) => {
    const s = io(BASE, { forceNew: true });
    s.on("connect", () => {
      s.emit("join", { coupleId, userId, token });
      setTimeout(() => resolve(s), 150);
    });
  });
const wait = (s, ev) => new Promise((res) => s.once(ev, res));

// 2) Claves reales (como en cada dispositivo)
const keysA = await C.loadOrGenerateKeys();
const keysB = await C.loadOrGenerateKeys();
check(
  "cada dispositivo genera su par de claves",
  C.hasKeys(keysA) && C.hasKeys(keysB)
);

// 3) Vincular A y B
const a = (
  await post("/api/pair/create", { name: "A", pubKey: keysA.publicKeyB64 })
).data;
const b = (
  await post("/api/pair/join", {
    code: a.code,
    name: "B",
    pubKey: keysB.publicKeyB64,
  })
).data;
check("vinculados con el mismo token", !!a.token && b.token === a.token);

const sockA = await connectSocket(a.coupleId, a.userId, a.token);
const sockB = await connectSocket(b.coupleId, b.userId, b.token);

// 4) Como hace la app de A: obtener la pub de B desde el server
const infoA = (
  await get(`/api/couple/${a.coupleId}?userId=${a.userId}`, a.token)
).data;
const pubDeB = infoA.partner?.pub_key;
check(
  "A obtiene la pub de B desde /api/couple",
  !!pubDeB && pubDeB === keysB.publicKeyB64
);

// 5) Texto: A cifra → server → B descifra
const texto = "Te amo hasta la luna y de vuelta 💞🌙";
const enc = C.encryptText(texto, keysA.privateKeyB64, pubDeB);
check("A cifra con la pub de B", !!enc.ciphertextB64 && enc.plaintext === undefined);

const recB = wait(sockB, "message");
sockA.emit("message", { ciphertextB64: enc.ciphertextB64, nonce: enc.nonceB64 });
const msgB = await recB;
const decB = C.decryptText(
  { ciphertextB64: msgB.ciphertextB64, nonceB64: msgB.nonce },
  keysB.privateKeyB64,
  keysA.publicKeyB64
);
check("B descifra el mensaje de A", decB === texto);
check("el server solo tiene ciphertext", msgB.text == null && !!msgB.ciphertextB64);

// 6) Historial: A reabre el chat y descifra desde el REST
const hist = await get(
  `/api/messages/${a.coupleId}?userId=${a.userId}`,
  a.token
);
const row = hist.data.find((m) => m.ciphertext === enc.ciphertextB64);
const decHist = C.decryptText(
  { ciphertextB64: row?.ciphertext, nonceB64: row?.nonce },
  keysA.privateKeyB64,
  pubDeB
);
check("A descifra su historial desde el server", decHist === texto);

// 7) Foto: A cifra bytes → sube → server sirve .bin → B descifra
const foto = new Uint8Array(2048);
for (let i = 0; i < foto.length; i++) foto[i] = (i * 13 + 7) % 256;
const encFoto = C.encryptBytes(foto, keysA.privateKeyB64, pubDeB);
const recFoto = wait(sockB, "message"); // registrar ANTES de subir
const subida = await post(
  "/api/photo",
  {
    coupleId: a.coupleId,
    senderId: a.userId,
    nonceB64: encFoto.nonceB64,
    imageDataB64: encFoto.cipherB64,
  },
  a.token
);
check("foto cifrada aceptada", subida.status === 200 && !!subida.data.url);
const msgFoto = await recFoto;
const archivo = await fetch(BASE + msgFoto.url);
const cipherB64 = Buffer.from(await archivo.arrayBuffer()).toString("base64");
const bytes = C.decryptBytes(
  cipherB64,
  msgFoto.nonce,
  keysB.privateKeyB64,
  keysA.publicKeyB64
);
check(
  "B descarga el .bin y recupera la foto byte a byte",
  !!bytes && Buffer.from(bytes).equals(Buffer.from(foto))
);

// 8) Un tercero no puede leer nada
const privC = (await C.loadOrGenerateKeys()).privateKeyB64;
check(
  "un tercero con otra clave no descifra el texto",
  C.decryptText(
    { ciphertextB64: enc.ciphertextB64, nonceB64: enc.nonceB64 },
    privC,
    pubDeB
  ) === ""
);
check(
  "el historial sin token sigue prohibido",
  (await get(`/api/messages/${a.coupleId}?userId=${a.userId}`)).status === 401
);

sockA.close();
sockB.close();
console.log(fails === 0 ? "\n✅ E2E TODO OK" : `\n❌ ${fails} fallas`);
process.exit(fails === 0 ? 0 : 1);

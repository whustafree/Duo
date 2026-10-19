// Prueba integral de Duo (transporte "relay" + cifrado E2E).
//
// Copia los módulos PUROS (cryptocore.js / protocol.js / relayproto.js — sin
// React Native) a archivos .mjs temporales para importarlos con Node, y luego:
//   1. claves, coupleId y código SAS deterministas e idénticos en ambos lados,
//   2. encuadre de tramas (incluido llegada byte a byte),
//   3. autenticación E2E entre dispositivos (y rechazo de claves ajenas),
//   4. vínculo por secreto compartido + QR v2 + temas/sobre del relay,
//   5. mensajes de texto cifrados extremo a extremo,
//   6. fotos troceadas, reensambladas y descifradas byte a byte,
//   7. sesión COMPLETA sobre un "bus" en memoria que imita al broker MQTT
//      (vinculación → pareja vinculada → mensaje → ACK → foto), comprobando
//      además que cada dispositivo ignora el eco de sus propios mensajes.
//
// Ejecutar:  npm test   (en duo-app)

import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SVC = join(__dirname, "..", "src", "services");
const CORE = "cryptocore";
const PROTO = "protocol";
const RELAY = "relayproto";
const TMP = {
  [CORE]: join(SVC, `.tmp-test-${CORE}.mjs`),
  [PROTO]: join(SVC, `.tmp-test-${PROTO}.mjs`),
  [RELAY]: join(SVC, `.tmp-test-${RELAY}.mjs`),
};

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) {
    passed += 1;
    console.log(`  ok ${name}`);
  } else {
    failed += 1;
    console.error(`  FALLO ${name}`);
  }
}

function loadPureModules() {
  // El relativo sin extensión no lo entiende Node ESM: apuntamos a los temporales.
  const rewrite = (code) =>
    code
      .split(`from "./${CORE}"`)
      .join(`from "./.tmp-test-${CORE}.mjs"`);
  writeFileSync(TMP[CORE], readFileSync(join(SVC, `${CORE}.js`), "utf8"));
  writeFileSync(TMP[PROTO], rewrite(readFileSync(join(SVC, `${PROTO}.js`), "utf8")));
  writeFileSync(TMP[RELAY], rewrite(readFileSync(join(SVC, `${RELAY}.js`), "utf8")));
}

function cleanup() {
  for (const f of Object.values(TMP)) {
    try {
      unlinkSync(f);
    } catch {}
  }
}
// Los process.exit() no ejecutan finally: limpiamos siempre al salir.
process.on("exit", cleanup);

function randomBytesLike(n) {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (Math.random() * 256) | 0;
  return b;
}

// --- Broker MQTT en memoria (mismo contrato pub/sub que el real) -------------
function makeBus() {
  const subs = new Map(); // topic -> Set(handler)
  return {
    subscribe(topic, handler) {
      if (!subs.has(topic)) subs.set(topic, new Set());
      subs.get(topic).add(handler);
    },
    publish(topic, payload) {
      for (const handler of subs.get(topic) || []) handler(topic, payload);
    },
  };
}

// Un "dispositivo" conectado al bus: publica sobres y filtra el eco propio.
function makeDevice(label, name, emoji, keys, bus, R) {
  const selfId = R.selfIdFor(keys.publicKeyB64);
  const d = {
    label,
    name,
    emoji,
    keys,
    selfId,
    received: [],
    selfEchoes: 0,
    topics: new Set(),
    subscribe(topic) {
      if (d.topics.has(topic)) return;
      d.topics.add(topic);
      bus.subscribe(topic, (t, payload) => d.onMessage(t, payload));
    },
    publish(topic, frame) {
      bus.publish(topic, R.buildEnvelope(d.selfId, frame));
    },
    onMessage(topic, payload) {
      const env = R.parseEnvelope(payload);
      if (!env) return;
      if (env.s === d.selfId) {
        d.selfEchoes += 1;
        return; // eco propio: se ignora
      }
      d.received.push({ topic, frame: env.f });
    },
  };
  return d;
}

async function main() {
  loadPureModules();
  try {
    const C = await import(pathToFileURL(TMP[CORE]).href);
    const P = await import(pathToFileURL(TMP[PROTO]).href);
    const R = await import(pathToFileURL(TMP[RELAY]).href);

    console.log("\n1) Identidad y claves");
    const A = C.generateKeyPair();
    const B = C.generateKeyPair();
    const X = C.generateKeyPair(); // intruso
    ok(A.privateKeyB64 && A.publicKeyB64, "par de claves generado (A)");
    ok(B.publicKeyB64 !== A.publicKeyB64, "las claves públicas son distintas");

    const coupleAB = C.deriveCoupleId(A.publicKeyB64, B.publicKeyB64);
    const coupleBA = C.deriveCoupleId(B.publicKeyB64, A.publicKeyB64);
    const coupleAX = C.deriveCoupleId(A.publicKeyB64, X.publicKeyB64);
    ok(coupleAB === coupleBA, "coupleId idéntico sin importar el orden");
    ok(coupleAB !== coupleAX, "coupleId distinto con otra pareja");
    ok(/^duo-[0-9a-f]{16}$/.test(coupleAB), "coupleId con formato duo-<16 hex>");

    const sasAB = C.verificationCode(A.publicKeyB64, B.publicKeyB64);
    const sasBA = C.verificationCode(B.publicKeyB64, A.publicKeyB64);
    ok(sasAB === sasBA && /^[0-9]{6}$/.test(sasAB), "código SAS de 6 dígitos idéntico en ambos lados");
    ok(C.emojiForPub(A.publicKeyB64) === C.emojiForPub(A.publicKeyB64), "emoji determinista por clave");

    console.log("\n2) Encuadre de tramas");
    const frames = [
      { t: "msg", id: "1", texto: "hola 💌" },
      { t: "big", blob: "x".repeat(5000) },
      { t: "msg", id: "2", texto: "adiós" },
    ];
    const all = [];
    for (const f of frames) all.push(...P.encodeFrame(f));

    const whole = new P.FrameParser();
    const gotWhole = whole.feed(new Uint8Array(all));
    ok(gotWhole.length === 3 && gotWhole[0].texto === "hola 💌", "3 tramas completas de un solo golpe");

    const byteParser = new P.FrameParser();
    let gotByte = [];
    for (const b of all) gotByte = gotByte.concat(byteParser.feed(new Uint8Array([b])));
    ok(gotByte.length === 3 && gotByte[2].id === "2", "las mismas tramas llegando byte a byte");

    const randomParser = new P.FrameParser();
    let gotRandom = [];
    let rest = new Uint8Array(all);
    while (rest.length) {
      const n = 1 + Math.floor(Math.random() * Math.min(17, rest.length));
      gotRandom = gotRandom.concat(randomParser.feed(rest.slice(0, n)));
      rest = rest.slice(n);
    }
    ok(gotRandom.length === 3, "fragmentación aleatoria de tramas");

    let oversized = false;
    try {
      const evil = new P.FrameParser(64);
      evil.feed(new Uint8Array([0xff, 0xff, 0xff, 0xff]));
    } catch {
      oversized = true;
    }
    ok(oversized, "trama gigante rechazada");

    console.log("\n3) Autenticación E2E entre dispositivos");
    const authA = P.buildAuth(A.privateKeyB64, A.publicKeyB64, B.publicKeyB64);
    ok(!!authA && P.verifyAuth(authA, B.privateKeyB64, A.publicKeyB64), "A se autentica ante B");
    ok(!P.verifyAuth(authA, X.privateKeyB64, A.publicKeyB64), "X (clave ajena) no puede verificar a A");
    ok(!P.verifyAuth(authA, B.privateKeyB64, B.publicKeyB64), "la prueba no sirve con la clave pública equivocada");

    console.log("\n4) Vínculo: secreto compartido + QR v2 + relay");
    const ps = C.pairingSecret();
    const pairReq = P.buildPairReq(ps, B.publicKeyB64, "Lucía", "🦊");
    const reqOk = P.verifyPairReq(pairReq, ps);
    ok(reqOk && reqOk.name === "Lucía" && reqOk.pub === B.publicKeyB64, "solicitud de vínculo válida con el secreto correcto");
    ok(P.verifyPairReq(pairReq, C.pairingSecret()) === null, "secreto incorrecto rechazado");

    const pairOk = P.buildPairOk(ps, A.publicKeyB64, "Mateo", "🐰", coupleAB);
    const okOk = P.verifyPairOk(pairOk, ps, A.publicKeyB64);
    ok(okOk && okOk.coupleId === coupleAB, "confirmación de vínculo válida");
    ok(P.verifyPairOk(pairOk, ps, B.publicKeyB64) === null, "confirmación con clave pública que no coincide rechazada");

    console.log("\n4b) QR de vínculo v2 (corto, sin direcciones)");
    const qr = R.buildPairQr(A.publicKeyB64, ps);
    const qp = qr.split(":");
    ok(qp.length === 5, "el QR tiene 5 campos separados por ':'");
    ok(
      qp[0] === "duo" && qp[1] === "pair" && qp[2] === "v2",
      "prefijo duo:pair:v2 en su posición"
    );
    ok(
      C.bytesToB64(C.b64ToBytes(qp[3])) === A.publicKeyB64,
      "la clave pública viaja íntegra y se recupera igual"
    );
    const parsedQr = R.parsePairQr(qr);
    ok(
      parsedQr && parsedQr.pub === A.publicKeyB64 && parsedQr.ps === ps,
      "parsePairQr recupera pub y secreto exactos"
    );
    ok(
      R.parsePairQr(`duo:pair:v1:${qp[3]}:192.168.1.50:47777:${ps}`) === null,
      "el QR antiguo (7 campos con IP/puerto) ya no es válido"
    );
    ok(R.parsePairQr("basura") === null, "texto cualquiera no es un QR de Duo");
    ok(R.parsePairQr("duo:pair:v2:solo") === null, "QR incompleto rechazado sin lanzar");

    console.log("\n4c) Temas y sobre del relay");
    const t1 = R.pairTopic(ps);
    const t2 = R.pairTopic(ps);
    ok(t1 === t2, "el tema de vínculo es determinista");
    ok(R.pairTopic("otro") !== t1, "temas distintos con secretos distintos");
    ok(/^duo\/v2\/pair\/[0-9a-f]{22}$/.test(t1), "el tema tiene el formato esperado (hash, sin filtrar datos)");
    ok(!t1.includes(ps), "el secreto NO aparece en el tema");
    const ct = R.chatTopic(coupleAB);
    ok(/^duo\/v2\/chat\/[0-9a-f]{22}$/.test(ct), "el tema de chat tiene el formato esperado");
    ok(!ct.includes(coupleAB), "el coupleId NO aparece en el tema");
    const sid = R.selfIdFor(A.publicKeyB64);
    ok(sid === R.selfIdFor(A.publicKeyB64) && sid !== R.selfIdFor(B.publicKeyB64), "selfId estable y distinto por clave");
    const env = R.buildEnvelope(sid, pairReq);
    const envBack = R.parseEnvelope(env);
    ok(envBack && envBack.s === sid && envBack.f.t === "pair-req", "el sobre conserva emisor y trama");
    ok(R.parseEnvelope("no-json") === null, "sobre inválido rechazado sin lanzar");

    console.log("\n5) Mensajes cifrados");
    const texto = "Nos vemos en casa 💌 ñáéíóú";
    const msg = P.buildMsg("m_test", texto, A.privateKeyB64, B.publicKeyB64);
    const readOk = P.readMsg(msg, B.privateKeyB64, A.publicKeyB64);
    ok(readOk && readOk.text === texto, "texto descifrado idéntico por la pareja");
    ok(P.readMsg(msg, X.privateKeyB64, A.publicKeyB64) === null, "un tercero no descifra nada");
    ok(P.readMsg(msg, B.privateKeyB64, B.publicKeyB64) === null, "con claves mezcladas no se descifra");
    ok(!JSON.stringify(msg).includes("Nos vemos"), "el texto NUNCA aparece en claro en la trama");
    const wholeEnv = R.buildEnvelope(sid, msg);
    ok(!wholeEnv.includes("Nos vemos"), "el texto tampoco aparece en el sobre publicado al broker");

    console.log("\n6) Fotos troceadas");
    const original = randomBytesLike(140000);
    const encPhoto = C.encryptBytes(original, A.privateKeyB64, B.publicKeyB64);
    ok(!!encPhoto, "foto cifrada");
    const photoFrames = P.splitPhoto("m_photo", encPhoto.nonceB64, encPhoto.cipherB64, 48000);
    ok(photoFrames.length > 3, `foto partida en ${photoFrames.length - 1} trozos`);
    const assembler = new P.PhotoAssembler();
    let done = null;
    for (const f of photoFrames) {
      const r = assembler.accept(f);
      if (r) done = r;
    }
    ok(!!done, "foto reensamblada");
    const decrypted = C.decryptBytes(done.cipherB64, done.nonceB64, B.privateKeyB64, A.publicKeyB64);
    ok(decrypted && decrypted.length === original.length, "misma longitud tras descifrar");
    let same = true;
    for (let i = 0; i < original.length; i++) {
      if (original[i] !== decrypted[i]) {
        same = false;
        break;
      }
    }
    ok(same, "los bytes descifrados son idénticos al original");

    console.log("\n7) Sesión completa por el relay (bus en memoria)");
    const bus = makeBus();
    const devA = makeDevice("A", "Ana", "🐼", A, bus, R);
    const devB = makeDevice("B", "Beto", "🦊", B, bus, R);
    const devX = makeDevice("X", "Mallory", "😈", X, bus, R); // intruso escuchando

    // A crea el vínculo: publica su QR y escucha el tema de vínculo.
    const pairSecret = C.pairingSecret();
    const pairQr = R.buildPairQr(A.publicKeyB64, pairSecret);
    const pairT = R.pairTopic(pairSecret);
    devA.subscribe(pairT);

    // B escanea el QR: se suscribe al mismo tema y pide el vínculo.
    const scanned = R.parsePairQr(pairQr);
    ok(scanned && scanned.pub === A.publicKeyB64, "B interpreta el QR de A");
    devB.subscribe(R.pairTopic(scanned.ps));
    devB.publish(
      R.pairTopic(scanned.ps),
      P.buildPairReq(scanned.ps, B.publicKeyB64, "Beto", "🦊")
    );

    const aGotReq = devA.received.find((r) => r.frame.t === "pair-req");
    ok(!!aGotReq, "A recibe la solicitud de B por el relay");
    const vreq = aGotReq && P.verifyPairReq(aGotReq.frame, pairSecret);
    ok(vreq && vreq.pub === B.publicKeyB64, "A verifica y autentica la solicitud de B");
    ok(vreq && C.verificationCode(A.publicKeyB64, vreq.pub) === C.verificationCode(B.publicKeyB64, A.publicKeyB64), "ambos ven el mismo SAS");

    // A acepta: publica la confirmación. B la recibe y queda vinculado.
    devA.publish(pairT, P.buildPairOk(pairSecret, A.publicKeyB64, "Ana", "🐼", coupleAB));
    const bGotOk = devB.received.find((r) => r.frame.t === "pair-ok");
    const vok = bGotOk && P.verifyPairOk(bGotOk.frame, pairSecret, A.publicKeyB64);
    ok(vok && vok.coupleId === coupleAB, "B recibe la confirmación y obtiene el coupleId");
    ok(devB.selfEchoes >= 1, "B ignora el eco de su propia solicitud");
    ok(devA.selfEchoes >= 1, "A ignora el eco de su propia confirmación");

    // El intruso conoce el mismo secreto por casualidad: no puede descifrar nada.
    devX.subscribe(pairT);
    devX.subscribe(R.chatTopic(coupleAB));
    ok(devX.received.length === 0, "el intruso que se une tarde no recibe nada");

    // Ambos pasan al chat: se suscriben al tema de la pareja.
    const chatT = R.chatTopic(coupleAB);
    devA.subscribe(chatT);
    devB.subscribe(chatT);

    // A envía un mensaje; B lo descifra y responde con ACK.
    const liveText = "¿Cenamos juntos? 🍝";
    devA.publish(chatT, P.buildMsg("m_live", liveText, A.privateKeyB64, B.publicKeyB64));
    const bMsg = devB.received.find((r) => r.frame.t === "msg" && r.frame.id === "m_live");
    const bRead = bMsg && P.readMsg(bMsg.frame, B.privateKeyB64, A.publicKeyB64);
    ok(bRead && bRead.text === liveText, "B recibe y descifra el mensaje de A por el relay");
    ok(!JSON.stringify(devB.received).includes(liveText), "el texto no viaja en claro por el bus");
    devB.publish(chatT, P.buildAck("m_live"));
    const aAck = devA.received.find((r) => r.frame.t === "ack" && r.frame.id === "m_live");
    ok(!!aAck, "A recibe el ACK de B (mensaje entregado)");

    // A envía una foto entera; B la reensambla y descifra.
    const encLive = C.encryptBytes(original, A.privateKeyB64, B.publicKeyB64);
    const liveFrames = P.splitPhoto("m_live_photo", encLive.nonceB64, encLive.cipherB64, 48000);
    for (const f of liveFrames) devA.publish(chatT, f);
    const asmB = new P.PhotoAssembler();
    let liveDone = null;
    for (const r of devB.received) {
      if (r.frame.t === "photo-meta" || r.frame.t === "photo-chunk") {
        const res = asmB.accept(r.frame);
        if (res) liveDone = res;
      }
    }
    ok(!!liveDone, "B reensambla la foto recibida por el relay");
    const livePlain = liveDone && C.decryptBytes(liveDone.cipherB64, liveDone.nonceB64, B.privateKeyB64, A.publicKeyB64);
    let liveSame = !!livePlain && livePlain.length === original.length;
    if (liveSame) {
      for (let i = 0; i < original.length; i++) {
        if (original[i] !== livePlain[i]) {
          liveSame = false;
          break;
        }
      }
    }
    ok(liveSame, "B descifra la foto íntegra (idéntica al original)");
    const xMsg = devX.received.find((r) => r.frame.t === "msg");
    ok(xMsg, "el intruso que conoce el tema SÍ recibe el sobre (cifrado)");
    ok(
      !xMsg || P.readMsg(xMsg.frame, X.privateKeyB64, A.publicKeyB64) === null,
      "pero el intruso NO puede descifrar el chat"
    );

    console.log(`\nResultado: ${passed} ok, ${failed} fallos`);
    process.exit(failed ? 1 : 0);
  } finally {
    cleanup();
  }
}

main().catch((e) => {
  cleanup();
  console.error("Error en la prueba:", e);
  process.exit(1);
});

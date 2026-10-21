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
const VERSION = "version";
const CHATCODEC = "chatcodec";
const RETENTION = "retention";
const MQTT = "mqttws";
const PUSH = "pushproto";
const TMP = {
  [CORE]: join(SVC, `.tmp-test-${CORE}.mjs`),
  [PROTO]: join(SVC, `.tmp-test-${PROTO}.mjs`),
  [RELAY]: join(SVC, `.tmp-test-${RELAY}.mjs`),
  [VERSION]: join(SVC, `.tmp-test-${VERSION}.mjs`),
  [CHATCODEC]: join(SVC, `.tmp-test-${CHATCODEC}.mjs`),
  [RETENTION]: join(SVC, `.tmp-test-${RETENTION}.mjs`),
  [MQTT]: join(SVC, `.tmp-test-${MQTT}.mjs`),
  [PUSH]: join(SVC, `.tmp-test-${PUSH}.mjs`),
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
  writeFileSync(TMP[VERSION], readFileSync(join(SVC, `${VERSION}.js`), "utf8"));
  writeFileSync(TMP[CHATCODEC], readFileSync(join(SVC, `${CHATCODEC}.js`), "utf8"));
  writeFileSync(TMP[RETENTION], readFileSync(join(SVC, `${RETENTION}.js`), "utf8"));
  // mqttws.js y pushproto.js no importan nada: se copian tal cual.
  writeFileSync(TMP[MQTT], readFileSync(join(SVC, `${MQTT}.js`), "utf8"));
  writeFileSync(TMP[PUSH], readFileSync(join(SVC, `${PUSH}.js`), "utf8"));
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
    const V = await import(pathToFileURL(TMP[VERSION]).href);
    const CC = await import(pathToFileURL(TMP[CHATCODEC]).href);
    const RT = await import(pathToFileURL(TMP[RETENTION]).href);
    const M = await import(pathToFileURL(TMP[MQTT]).href);
    const PS = await import(pathToFileURL(TMP[PUSH]).href);

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

    console.log("\n5b) Juegos compartidos (cifrados)");
    const gamePayload = {
      k: "draw",
      gameId: "ruleta",
      level: 5,
      prompt: "Manda una foto íntima solo para mí",
      mode: null,
    };
    const gameFrame = P.buildGame(gamePayload, A.privateKeyB64, B.publicKeyB64);
    const gameRead = P.readGame(gameFrame, B.privateKeyB64, A.publicKeyB64);
    ok(
      gameRead && gameRead.prompt === gamePayload.prompt && gameRead.level === 5,
      "la pareja recibe el estado del juego (nivel y reto)"
    );
    ok(
      P.readGame(gameFrame, X.privateKeyB64, A.publicKeyB64) === null,
      "un tercero NO puede descifrar el juego"
    );
    ok(
      !JSON.stringify(gameFrame).includes("foto íntima"),
      "el reto NUNCA viaja en claro por el relay"
    );
    ok(
      P.readGame({ t: "msg", v: "duo-p2p-v1" }, B.privateKeyB64, A.publicKeyB64) ===
        null,
      "una trama que no es de juego se ignora"
    );

    const replyFrame = P.buildGame(
      {
        k: "reply",
        gameId: "ruleta",
        text: "acepto tu reto",
        ts: 1700000000000,
      },
      A.privateKeyB64,
      B.publicKeyB64
    );
    const replyRead = P.readGame(replyFrame, B.privateKeyB64, A.publicKeyB64);
    ok(
      replyRead && replyRead.k === "reply" && replyRead.text === "acepto tu reto",
      "la respuesta dentro del juego llega a la pareja"
    );
    ok(
      !JSON.stringify(replyFrame).includes("acepto tu reto"),
      "la respuesta NUNCA viaja en claro"
    );
    ok(
      P.readGame(replyFrame, X.privateKeyB64, A.publicKeyB64) === null,
      "un tercero NO puede leer la respuesta del juego"
    );
    const syncFrame = P.buildGame(
      {
        k: "sync",
        gameId: "ruleta",
        level: 3,
        prompt: "reto",
        mode: null,
        replies: [{ from: "me", text: "hola", ts: 1 }],
      },
      A.privateKeyB64,
      B.publicKeyB64
    );
    const syncRead = P.readGame(syncFrame, B.privateKeyB64, A.publicKeyB64);
    ok(
      syncRead &&
        Array.isArray(syncRead.replies) &&
        syncRead.replies.length === 1 &&
        syncRead.replies[0].text === "hola",
      "el estado sincronizado incluye el hilo de respuestas"
    );

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

    console.log("\n6b) Audio y vídeo troceados (file-*)");
    const avOriginal = randomBytesLike(120000);
    const encAV = C.encryptBytes(avOriginal, A.privateKeyB64, B.publicKeyB64);
    ok(!!encAV, "archivo de audio/vídeo cifrado");
    const audioFrames = P.splitFile(
      "m_audio",
      "audio",
      "m4a",
      encAV.nonceB64,
      encAV.cipherB64,
      48000
    );
    ok(
      audioFrames[0].t === "file-meta" &&
        audioFrames[0].kind === "audio" &&
        audioFrames[0].ext === "m4a",
      "meta del audio: lleva tipo y extensión"
    );
    ok(
      audioFrames.length > 2 &&
        audioFrames
          .slice(1)
          .every((f, i) => f.t === "file-chunk" && f.i === i),
      "trozos de audio ordenados"
    );
    const avAssembler = new P.PhotoAssembler();
    let avDone = null;
    for (const f of audioFrames) {
      const r = avAssembler.accept(f);
      if (r) avDone = r;
    }
    ok(
      avDone && avDone.kind === "audio" && avDone.ext === "m4a",
      "audio reensamblado conserva tipo y extensión"
    );
    const avDec = C.decryptBytes(
      avDone.cipherB64,
      avDone.nonceB64,
      B.privateKeyB64,
      A.publicKeyB64
    );
    let avSame = !!avDec && avDec.length === avOriginal.length;
    if (avSame) {
      for (let i = 0; i < avOriginal.length; i++) {
        if (avOriginal[i] !== avDec[i]) {
          avSame = false;
          break;
        }
      }
    }
    ok(avSame, "bytes de audio idénticos tras descifrar");
    const videoFrames = P.splitFile(
      "m_video",
      "video",
      "mp4",
      encAV.nonceB64,
      encAV.cipherB64,
      48000
    );
    const vAssembler = new P.PhotoAssembler();
    let vDone = null;
    for (const f of videoFrames) {
      const r = vAssembler.accept(f);
      if (r) vDone = r;
    }
    ok(
      vDone && vDone.kind === "video" && vDone.ext === "mp4",
      "vídeo reensamblado conserva tipo y extensión"
    );
    const defAssembler = new P.PhotoAssembler();
    const defFrames = [
      {
        t: "file-meta",
        id: "m_def",
        kind: "video",
        nonceB64: encAV.nonceB64,
        chunks: 1,
      },
      { t: "file-chunk", id: "m_def", i: 0, d: encAV.cipherB64 },
    ];
    let defDone = null;
    for (const f of defFrames) {
      const r = defAssembler.accept(f);
      if (r) defDone = r;
    }
    ok(
      defDone && defDone.ext === "mp4",
      "sin extensión en la meta se deduce del tipo"
    );
    ok(
      P.splitPhoto("m_legacy", encAV.nonceB64, encAV.cipherB64, 48000).length >
        2,
      "el troceado de fotos sigue funcionando igual"
    );

    // Envío paginado (v0.7.1): el generador produce EXACTAMENTE las mismas
    // tramas que el array completo, para enviar trozo a trozo sin congelar.
    const genFrames = [
      ...P.iterFileFrames(
        "m_gen",
        "video",
        "mp4",
        encAV.nonceB64,
        encAV.cipherB64,
        48000
      ),
    ];
    const arrFrames = P.splitFile(
      "m_gen",
      "video",
      "mp4",
      encAV.nonceB64,
      encAV.cipherB64,
      48000
    );
    ok(
      genFrames.length === arrFrames.length &&
        genFrames.every(
          (f, i) => f.t === arrFrames[i].t && f.d === arrFrames[i].d
        ),
      "iterFileFrames produce las mismas tramas que splitFile"
    );
    ok(
      P.MAX_FILE_CHUNKS * P.PHOTO_CHUNK >=
        Math.ceil((6 * 1024 * 1024 * 4) / 3),
      "el tope de trozos cubre el cifrado de un archivo de 6 MB"
    );
    const bombAssembler = new P.PhotoAssembler();
    ok(
      bombAssembler.accept({
        t: "file-meta",
        id: "m_bomb",
        kind: "video",
        nonceB64: encAV.nonceB64,
        chunks: 999999999,
      }) === null,
      "una meta con trozos absurdos se descarta (no cuelga el receptor)"
    );
    ok(
      bombAssembler.accept({ t: "file-chunk", id: "m_bomb", i: 0, d: "xxxx" }) ===
        null,
      "sin meta válida, los trozos sueltos se ignoran"
    );
    const idxAssembler = new P.PhotoAssembler();
    idxAssembler.accept({
      t: "file-meta",
      id: "m_idx",
      kind: "photo",
      nonceB64: encAV.nonceB64,
      chunks: 2,
    });
    ok(
      idxAssembler.accept({ t: "file-chunk", id: "m_idx", i: 5, d: "aaaa" }) ===
        null &&
        idxAssembler.accept({
          t: "file-chunk",
          id: "m_idx",
          i: -1,
          d: "bbbb",
        }) === null,
      "trozos con índice fuera de rango se ignoran"
    );

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

    // Juego compartido: A inicia "Ruleta de Retos" y B lo recibe para verlo.
    devA.publish(
      chatT,
      P.buildGame({ k: "start", gameId: "ruleta", level: 3 }, A.privateKeyB64, B.publicKeyB64)
    );
    const bGame = devB.received.find((r) => r.frame.t === "game");
    const bGameRead = bGame && P.readGame(bGame.frame, B.privateKeyB64, A.publicKeyB64);
    ok(
      bGameRead && bGameRead.gameId === "ruleta" && bGameRead.level === 3,
      "B recibe el juego que inició A (aparece en los dos)"
    );

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

    console.log("\n8) Aviso de actualizaciones (comparación de versiones)");
    ok(V.isNewer("v0.6.0", "0.5.0"), "detecta una versión más nueva");
    ok(!V.isNewer("v0.5.0", "0.5.0"), "la misma versión NO es actualización");
    ok(!V.isNewer("v0.4.9", "0.5.0"), "una versión antigua NO se avisa");
    ok(V.isNewer("v0.10.0", "0.9.9"), "compara bien 0.10 frente a 0.9");
    ok(V.isNewer("1.0.0", "0.99.99"), "compara bien el salto de mayor");
    const pv = V.parseVersion("v1.2.3-beta");
    ok(pv[0] === 1 && pv[1] === 2 && pv[2] === 3, "lee versiones con sufijo");

    console.log("\n9) Contenido de los juegos (≥20 por nivel)");
    const DATA = join(__dirname, "..", "src", "data");
    const loadPool = (file, names) => {
      const src = readFileSync(join(DATA, file), "utf8");
      const body = src.replace(/^export const /gm, "const ");
      return new Function(`${body}\nreturn { ${names.join(", ")} };`)();
    };
    const pools = [
      ["pool-retos.js", "challenges"],
      ["pool-truths.js", "truths"],
      ["pool-dares.js", "dares"],
      ["pool-dados.js", "diceChallenges"],
      ["pool-preguntas.js", "coupleQuestions"],
    ];
    for (const [file, name] of pools) {
      let obj = null;
      try {
        obj = loadPool(file, [name])[name];
      } catch (e) {
        ok(false, `${file} se puede cargar (${e.message})`);
        continue;
      }
      const keys = obj ? Object.keys(obj).sort() : [];
      ok(keys.join(",") === "1,2,3,4,5", `${file}: niveles 1..5`);
      const counts = keys.map((k) =>
        Array.isArray(obj[k]) ? obj[k].length : 0
      );
      ok(
        counts.length === 5 && counts.every((c) => c >= 20),
        `${file}: ≥20 por nivel (${counts.join("/")})`
      );
      const all = [].concat(...keys.map((k) => obj[k] || []));
      ok(
        all.length === new Set(all).size,
        `${file}: sin repetir (${all.length} ítems únicos)`
      );
      ok(
        all.every((s) => typeof s === "string" && s.trim().length > 0),
        `${file}: todos son textos`
      );
    }
    const mockSrc = readFileSync(join(DATA, "mock.js"), "utf8");
    ok(
      pools.every(([file]) =>
        mockSrc.includes(`"./${file.replace(/\.js$/, "")}"`)
      ),
      "mock.js reexporta los 5 pools"
    );

    console.log("\n10) Bloqueo local: PIN y cofre cifrado");
    const saltA = C.newPinSalt();
    const saltB = C.newPinSalt();
    ok(
      typeof saltA === "string" && saltA.length > 8,
      "la sal del PIN no está vacía"
    );
    ok(saltA !== saltB, "cada sal es distinta (aleatoria)");
    const pin = "1234";
    const h1 = C.pinHash(pin, saltA);
    ok(h1 === C.pinHash(pin, saltA), "el resumen del PIN es determinista");
    ok(C.pinHash("9999", saltA) !== h1, "otro PIN → otro resumen");
    ok(C.pinHash(pin, saltB) !== h1, "otra sal → otro resumen");
    ok(!h1.includes(pin), "el resumen NUNCA contiene el PIN");
    const key1 = C.deriveLocalKey(pin, saltA);
    const key2 = C.deriveLocalKey(pin, saltA);
    ok(
      key1 instanceof Uint8Array && key1.length === 32,
      "la clave local del cofre son 32 bytes"
    );
    ok(
      key1.every((b, i) => b === key2[i]),
      "misma clave al repetir PIN y sal"
    );
    ok(
      !C.deriveLocalKey(pin, saltB).every((b, i) => b === key1[i]),
      "otra sal deriva otra clave"
    );
    const vaultPlain = JSON.stringify([{ id: "m_1", text: "te quiero 💞" }]);
    const vaultEnv = C.encryptWithKey(key1, vaultPlain);
    const opened = C.decryptWithKey(
      key1,
      vaultEnv.ciphertextB64,
      vaultEnv.nonceB64
    );
    ok(
      opened === vaultPlain,
      "el cofre descifra la copia local con la clave derivada del PIN"
    );
    ok(
      C.decryptWithKey(
        C.deriveLocalKey("0000", saltA),
        vaultEnv.ciphertextB64,
        vaultEnv.nonceB64
      ) === null,
      "con otro PIN no se descifra nada"
    );
    const badNonce = vaultEnv.nonceB64.slice(0, -4) + "AAAA";
    ok(
      C.decryptWithKey(key1, vaultEnv.ciphertextB64, badNonce) === null,
      "un nonce alterado rompe el descifrado (GCM)"
    );

    console.log("\n11) Chat estructurado: citas y reacciones");
    ok(
      CC.encodeText("hola 💞", null) === "hola 💞",
      "el texto normal sale TAL CUAL (compatibilidad)"
    );
    const replyEnc = CC.encodeText("yo igual 🥰", {
      id: "m_1",
      from: "me",
      kind: "text",
      preview: "te quiero",
    });
    let replyObj = null;
    try {
      replyObj = JSON.parse(replyEnc);
    } catch {}
    ok(
      replyObj && replyObj.__duo === 1 && replyObj.type === "text",
      "la cita viaja como JSON con la marca __duo v1"
    );
    const plainDec = CC.decodeChat("buenas noches 🌙");
    ok(
      plainDec.type === "text" &&
        plainDec.text === "buenas noches 🌙" &&
        !plainDec.replyTo,
      "un texto normal se descodifica tal cual, sin cita"
    );
    const replyDec = CC.decodeChat(replyEnc);
    ok(
      replyDec.type === "text" && replyDec.text === "yo igual 🥰",
      "el texto de la cita llega completo"
    );
    ok(
      replyDec.replyTo &&
        replyDec.replyTo.id === "m_1" &&
        replyDec.replyTo.preview === "te quiero",
      "la cita conserva id y vista previa"
    );
    ok(
      replyDec.replyTo.from === "them",
      "la perspectiva del citado se invierte al recibir (me → them)"
    );
    ok(
      CC.decodeChat('{"otra":"cosa"}').text === '{"otra":"cosa"}',
      "un JSON viejo sin la marca se ve como texto normal"
    );
    ok(
      CC.decodeChat('{"__duo":99,"type":"text","text":"futuro"}').text ===
        '{"__duo":99,"type":"text","text":"futuro"}',
      "un formato más nuevo se muestra como texto (compat. hacia delante)"
    );
    let junk = null;
    try {
      junk = CC.decodeChat('{"roto');
    } catch {
      junk = { type: "lanzó" };
    }
    ok(
      junk && junk.type === "text" && junk.text === '{"roto',
      "un JSON cortado no lanza y se muestra como texto"
    );
    const reEnc = CC.encodeReaction("m_9", "🔥");
    const reDec = CC.decodeChat(reEnc);
    ok(
      reDec.type === "reaction" && reDec.target === "m_9" && reDec.emoji === "🔥",
      "la reacción llega con mensaje y emoji"
    );
    ok(
      CC.decodeChat(CC.encodeReaction("m_9", "")).emoji === "",
      "una reacción sin emoji no rompe nada"
    );
    ok(CC.REACTIONS.length === 6, "hay 6 reacciones para elegir");
    ok(
      CC.deliveryState({ from: "me", pending: true }) === "queued",
      "estado: en cola (reloj ⏳)"
    );
    ok(
      CC.deliveryState({ from: "me", pending: true, failed: true }) === "failed",
      "estado: falló (⭕ con reintento)"
    );
    ok(
      CC.deliveryState({ from: "me", pending: true, sent: true }) === "sent",
      "estado: enviado al relay (✓)"
    );
    ok(
      CC.deliveryState({ from: "me", pending: false }) === "delivered",
      "estado: la pareja confirmó (✓✓)"
    );
    ok(
      CC.deliveryState({ from: "them", pending: false }) === "received",
      "estado: recibido (de la pareja)"
    );
    ok(
      CC.STATE_MARK.sent.includes("✓") && CC.STATE_MARK.delivered.includes("✓✓"),
      "las marcas en la burbuja son ✓ y ✓✓"
    );

    console.log("\n12) Auto-destrucción (retención local)");
    ok(RT.parseTtlDays("7") === 7, "lee el plazo guardado");
    ok(
      RT.parseTtlDays("nada") === 0 &&
        RT.parseTtlDays("-5") === 0 &&
        RT.parseTtlDays(null) === 0,
      "plazos inválidos significan Nunca"
    );
    ok(
      RT.TTL_OPTIONS.map((o) => o.days).join(",") === "0,7,30,90",
      "las opciones son Nunca, 7, 30 y 90 días"
    );
    ok(!RT.isExpired({ ts: Date.now() }, 0), "con Nunca nada vence");
    ok(
      !RT.isExpired({ ts: Date.now() - 2 * 86400000 }, 7),
      "dentro del plazo se conserva"
    );
    ok(
      RT.isExpired({ ts: Date.now() - 8 * 86400000 }, 7),
      "pasado el plazo vence"
    );
    ok(!RT.isExpired({ id: "m_1" }, 7), "un mensaje sin marca de tiempo no vence");
    const sample = [
      { id: "a", ts: Date.now() },
      { id: "b", ts: Date.now() - 40 * 86400000 },
      { id: "c", ts: Date.now() - 10 * 86400000 },
    ];
    const { keep, gone } = RT.filterExpired(sample, 30);
    ok(
      keep.length === 2 && gone.length === 1 && gone[0].id === "b",
      "filterExpired separa vivos y vencidos"
    );

    console.log("\n13) Conexión blindada: clientId, presencia, QoS 1 y push");
    // clientId ÚNICO por instalación: con el clientId compartido (bug de
    // ≤0.7.x) el broker expulsaba a un teléfono cada vez que el otro se
    // conectaba: bucle de patines y mensajes perdidos a mitad de camino.
    ok(R.deviceClientId("a1b2c3d4e5f6a7b8") === "duo-a1b2c3d4e5f6a7b8", "clientId con prefijo duo-");
    ok(R.deviceClientId("ZZ-a1.b2_c3!") === "duo-a1b2c3", "clientId saneado (solo hex)");
    ok(
      R.deviceClientId("a1b2c3d4e5f6a7b8") !== R.deviceClientId("ffffffffffffffff"),
      "dos instalaciones -> dos clientIds distintos"
    );
    // Presencia: baliza retenida por teléfono (sabemos si toca push).
    const coupleP = C.deriveCoupleId(A.publicKeyB64, B.publicKeyB64);
    const presA = R.presenceTopic(coupleP, R.selfIdFor(A.publicKeyB64));
    const presB = R.presenceTopic(coupleP, R.selfIdFor(B.publicKeyB64));
    ok(presA.startsWith("duo/v2/pres/"), "tema de presencia bajo duo/v2/pres");
    ok(presA !== presB, "cada teléfono tiene su propio tema de presencia");
    ok(R.presenceTopic(coupleP, R.selfIdFor(A.publicKeyB64)) === presA, "tema de presencia determinista");
    const balOn = R.parsePresence(R.buildPresence(true, 1000));
    ok(balOn && balOn.on === 1 && balOn.ts === 1000, "baliza on/off con sello temporal");
    ok(R.parsePresence(R.buildPresence(false, 2000)).on === 0, "baliza de apagado");
    ok(
      R.parsePresence("basura") === null && R.parsePresence('{"on":2,"ts":1}') === null,
      "presencia malformada se descarta"
    );
    const nowP = 1000000;
    ok(!R.isPresenceStale(nowP - 60000, nowP), "baliza reciente no está caducada");
    ok(R.isPresenceStale(nowP - 180001, nowP), "baliza vieja se da por perdida");
    ok(R.isPresenceStale(undefined, nowP), "sin baliza = sin presencia");
    // MQTT QoS 1: publicar con acuse y detectar silencio del broker.
    ok(M.buildPublishPacket("t/x", "hola", 1, 7)[0] === 0x32, "PUBLISH QoS 1 con flags correctos");
    ok(M.buildPublishPacket("t/x", "hola", 0, 0)[0] === 0x30, "PUBLISH QoS 0 sigue igual");
    ok(M.buildPublishPacket("t/x", "hola", 1, 7, true, true)[0] === 0x37, "flags DUP y RETAIN combinados");
    ok(M.readPacketId([0x00, 0x07]) === 7, "readPacketId lee 2 bytes");
    ok(M.readPacketId([0xff, 0xff]) === 65535 && M.readPacketId([]) === 0, "readPacketId: máximo y vacío");
    ok(!M.shouldDropSilent(0, nowP, 45), "sin primer paquete no se corta");
    ok(!M.shouldDropSilent(nowP - 59000, nowP, 45), "con tráfico reciente el socket vive");
    ok(M.shouldDropSilent(nowP - 61000, nowP, 45), "60 s+ de silencio = socket muerto en silencio");
    // Push "despertador": genérico SIEMPRE (privacidad) y bien gobernado.
    const push = PS.buildWakePush("ExponentPushToken[abc]");
    ok(push.to === "ExponentPushToken[abc]", "push dirigido al token de la pareja");
    ok(push.channelId === "duo-mensajes" && push.priority === "high", "canal Duo con prioridad alta");
    ok(push.body.includes("🔒") && push.title.startsWith("Duo"), "aviso genérico: Duo + candado");
    ok(
      !JSON.stringify({ body: push.body, title: push.title }).includes("Mensaje"),
      "el aviso nunca arrastra el texto del mensaje"
    );
    ok(
      PS.isValidPushToken("ExponentPushToken[x]") && !PS.isValidPushToken("pepe") && !PS.isValidPushToken(null),
      "validación del token de push"
    );
    ok(!PS.shouldWakePush({ hasToken: false, online: false }), "sin token no se envía");
    ok(!PS.shouldWakePush({ hasToken: true, online: true }), "con la pareja en línea no se envía");
    ok(PS.shouldWakePush({ hasToken: true, online: false, lastSentAt: 0, now: 100000 }), "desconectada -> toca push");
    ok(!PS.shouldWakePush({ hasToken: true, online: false, lastSentAt: 99000, now: 100000 }), "hueco mínimo entre avisos");
    // El token de push viaja cifrado E2E como un mensaje más (chatcodec).
    const tokDec = CC.decodeChat(CC.encodePushToken("ExponentPushToken[zzz]"));
    ok(tokDec.type === "push-token" && tokDec.token === "ExponentPushToken[zzz]", "token de push ida y vuelta");
    ok(CC.decodeChat("ExponentPushToken[zzz]").type === "text", "token crudo se ve como texto (compat)");

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

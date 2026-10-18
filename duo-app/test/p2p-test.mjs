// Prueba integral del protocolo P2P de Duo.
//
// Copia los módulos PUROS (cryptocore.js / protocol.js — sin React Native) a
// archivos .mjs temporales para importarlos con Node, y luego:
//   1. claves, coupleId y código SAS deterministas e idénticos en ambos lados,
//   2. encuadre de tramas (incluido llegada byte a byte),
//   3. autenticación E2E entre dispositivos (y rechazo de claves ajenas),
//   4. emparejamiento por secreto del QR (acepta el correcto, rechaza otro),
//   5. mensajes de texto cifrados extremo a extremo,
//   6. fotos troceadas, reensambladas y descifradas byte a byte,
//   7. todo lo anterior de nuevo pero sobre un socket TCP real (127.0.0.1).
//
// Ejecutar:  npm test   (en duo-app)

import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import net from "node:net";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SVC = join(__dirname, "..", "src", "services");
const TMP_CORE = join(SVC, ".tmp-test-cryptocore.mjs");
const TMP_PROTO = join(SVC, ".tmp-test-protocol.mjs");

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
  const core = readFileSync(join(SVC, "cryptocore.js"), "utf8");
  let proto = readFileSync(join(SVC, "protocol.js"), "utf8");
  // El relativo sin extensión no lo entiende Node ESM: apuntamos al temporal.
  proto = proto.replace('from "./cryptocore"', 'from "./.tmp-test-cryptocore.mjs"');
  writeFileSync(TMP_CORE, core);
  writeFileSync(TMP_PROTO, proto);
}

function cleanup() {
  for (const f of [TMP_CORE, TMP_PROTO]) {
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

async function main() {
  loadPureModules();
  try {
    const C = await import(pathToFileURL(TMP_CORE).href);
    const P = await import(pathToFileURL(TMP_PROTO).href);

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
    const authX = P.buildAuth(A.privateKeyB64, A.publicKeyB64, X.publicKeyB64);
    ok(!P.verifyAuth(authX, B.privateKeyB64, A.publicKeyB64), "una prueba dirigida a otro no autentica");

    console.log("\n4) Emparejamiento por secreto del QR");
    const ps = C.pairingSecret();
    const pairReq = P.buildPairReq(ps, B.publicKeyB64, "Lucía", "🦊");
    const reqOk = P.verifyPairReq(pairReq, ps);
    ok(reqOk && reqOk.name === "Lucía" && reqOk.pub === B.publicKeyB64, "solicitud de vínculo válida con el secreto correcto");
    ok(P.verifyPairReq(pairReq, C.pairingSecret()) === null, "secreto incorrecto rechazado");

    const pairOk = P.buildPairOk(ps, A.publicKeyB64, "Mateo", "🐰", coupleAB);
    const okOk = P.verifyPairOk(pairOk, ps, A.publicKeyB64);
    ok(okOk && okOk.coupleId === coupleAB, "confirmación de vínculo válida");
    ok(P.verifyPairOk(pairOk, ps, B.publicKeyB64) === null, "confirmación con clave pública que no coincide rechazada");

    console.log("\n4b) Formato del QR (7 campos)");
    const qrPub = C.bytesToB64url(C.b64ToBytes(B.publicKeyB64));
    const qr = `duo:pair:v1:${qrPub}:192.168.1.50:47777:${ps}`;
    const qp = qr.split(":");
    ok(qp.length === 7, "el QR tiene exactamente 7 campos separados por ':'");
    ok(
      qp[0] === "duo" &&
        qp[1] === "pair" &&
        qp[2] === "v1" &&
        qp[4] === "192.168.1.50" &&
        parseInt(qp[5], 10) === 47777,
      "campos de versión, IP y puerto en su posición"
    );
    ok(
      C.bytesToB64(C.b64ToBytes(qp[3])) === B.publicKeyB64,
      "la clave pública viaja íntegra y se recupera igual"
    );
    ok(qp[6] === ps, "el secreto de emparejamiento es el campo 7 (no el puerto)");
    ok(!qp.some((f) => !f), "ningún campo vacío");
    const qrHostless = `duo:pair:v1:${qrPub}:-:47777:${ps}`;
    ok(qrHostless.split(":")[4] === "-", "host ausente viaja como '-'");
    const qrReq = P.buildPairReq(qp[6], A.publicKeyB64, "Ana", "🐼");
    ok(!!P.verifyPairReq(qrReq, qp[6]), "el ps extraído del QR abre el diálogo de vinculación");

    console.log("\n4c) Formato de los QRs WebRTC (Offer/Answer)");
    const fakeSdp = { type: "offer", sdp: "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n" };
    const offerQr = P.buildWebRTCOfferQr(A.publicKeyB64, fakeSdp);
    const offerParts = offerQr.split(":");
    ok(offerParts.length === 6, "el Offer QR tiene 6 campos separados por ':'");
    ok(
      offerParts[0] === "duo" &&
        offerParts[1] === "webrtc" &&
        offerParts[2] === "v1" &&
        offerParts[3] === "offer",
      "prefijo duo:webrtc:v1:offer en su posición"
    );
    ok(
      C.bytesToB64(C.b64ToBytes(offerParts[4])) === A.publicKeyB64,
      "la clave pública viaja en el Offer y se recupera igual"
    );
    const parsedOffer = P.parseWebRTCQr(offerQr);
    ok(
      parsedOffer &&
        parsedOffer.kind === "offer" &&
        parsedOffer.pub === A.publicKeyB64 &&
        parsedOffer.sdp.sdp === fakeSdp.sdp,
      "parseWebRTCQr recupera Offer, pub y SDP exactos"
    );
    const answerQr = P.buildWebRTCAnswerQr(B.publicKeyB64, { type: "answer", sdp: fakeSdp.sdp });
    const parsedAnswer = P.parseWebRTCQr(answerQr);
    ok(
      parsedAnswer && parsedAnswer.kind === "answer" && parsedAnswer.pub === B.publicKeyB64,
      "parseWebRTCQr recupera el Answer"
    );
    ok(
      P.parseWebRTCQr(`duo:pair:v1:${qrPub}:192.168.1.50:47777:${ps}`) === null,
      "el QR de vínculo LAN NO se confunde con un QR WebRTC"
    );
    ok(P.parseWebRTCQr("basura") === null, "texto cualquiera no es un QR WebRTC");
    ok(
      P.parseWebRTCQr("duo:webrtc:v1:offer:abc") === null,
      "Offer incompleto rechazado sin lanzar"
    );
    const sasW = C.verificationCode(A.publicKeyB64, B.publicKeyB64);
    const sasW2 = C.verificationCode(B.publicKeyB64, A.publicKeyB64);
    ok(sasW === sasW2 && /^[0-9]{6}$/.test(sasW), "SAS idéntico al comparar las claves del Offer/Answer");

    console.log("\n5) Mensajes cifrados");
    const texto = "Nos vemos en casa 💌 ñáéíóú";
    const msg = P.buildMsg("m_test", texto, A.privateKeyB64, B.publicKeyB64);
    const readOk = P.readMsg(msg, B.privateKeyB64, A.publicKeyB64);
    ok(readOk && readOk.text === texto, "texto descifrado idéntico por la pareja");
    ok(P.readMsg(msg, X.privateKeyB64, A.publicKeyB64) === null, "un tercero no descifra nada");
    ok(P.readMsg(msg, B.privateKeyB64, B.publicKeyB64) === null, "con claves mezcladas no se descifra");
    const frameBytes = P.encodeFrame(msg);
    const frameStr = Buffer.from(frameBytes).toString("latin1");
    ok(!frameStr.includes("Nos vemos"), "el texto NUNCA aparece en claro en la trama de red");

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

    console.log("\n7) Sesión completa sobre TCP real (127.0.0.1)");
    await new Promise((resolve) => {
      // El receptor del lado B va acumulando mensaje y foto.
      let photoDone = null;
      let msgFrame = null;
      const assemblerB = new P.PhotoAssembler();

      const timeout = setTimeout(() => {
        ok(false, "la sesión TCP terminó a tiempo");
        try {
          server.close();
        } catch {}
        resolve();
      }, 10000);

      const server = net.createServer((sock) => {
        const parser = new P.FrameParser();
        sock.on("data", (chunk) => {
          let fs = [];
          try {
            fs = parser.feed(new Uint8Array(chunk));
          } catch {
            sock.destroy();
            return;
          }
          for (const frame of fs) {
            if (frame.t === "auth") {
              const valid = P.verifyAuth(frame, B.privateKeyB64, A.publicKeyB64);
              ok(valid, "B autentica a A por TCP");
              if (!valid) {
                sock.destroy();
                continue;
              }
              const reply = P.buildAuth(B.privateKeyB64, B.publicKeyB64, A.publicKeyB64);
              const bytes = P.encodeFrame(reply);
              let i = 0;
              const sendChunked = () => {
                if (i >= bytes.length) return;
                sock.write(Buffer.from(bytes.slice(i, i + 5)));
                i += 5;
                setTimeout(sendChunked, 1);
              };
              sendChunked();
            } else if (frame.t === "msg") {
              msgFrame = frame;
              // Responder con ack (igual que la app).
              sock.write(P.encodeFrame(P.buildAck(frame.id)));
            } else if (frame.t === "photo-meta" || frame.t === "photo-chunk") {
              const r = assemblerB.accept(frame);
              if (r) photoDone = r;
            }
            if (msgFrame && photoDone && !sock.__done) {
              sock.__done = true;
              finishB(sock);
            }
          }
        });
      });

      function finishB(sock) {
        const got = P.readMsg(msgFrame, B.privateKeyB64, A.publicKeyB64);
        ok(got && got.text === texto, "mensaje de texto recibido y descifrado por TCP");
        const plain = C.decryptBytes(
          photoDone.cipherB64,
          photoDone.nonceB64,
          B.privateKeyB64,
          A.publicKeyB64
        );
        let identical = !!plain && plain.length === original.length;
        if (identical) {
          for (let i = 0; i < original.length; i++) {
            if (original[i] !== plain[i]) {
              identical = false;
              break;
            }
          }
        }
        ok(identical, "foto completa recibida y descifrada por TCP");
        clearTimeout(timeout);
        try {
          sock.destroy();
        } catch {}
        server.close();
        resolve();
      }

      server.listen(0, "127.0.0.1", () => {
        const port = server.address().port;
        const sock = net.connect({ host: "127.0.0.1", port });
        const parserA = new P.FrameParser();
        let authed = false;
        sock.on("connect", () => {
          const auth = P.buildAuth(A.privateKeyB64, A.publicKeyB64, B.publicKeyB64);
          const bytes = P.encodeFrame(auth);
          // Enviar el handshake en trozos de 7 bytes para probar el parser.
          let i = 0;
          const sendChunked = () => {
            if (i >= bytes.length) return;
            sock.write(Buffer.from(bytes.slice(i, i + 7)));
            i += 7;
            setTimeout(sendChunked, 1);
          };
          sendChunked();
        });
        sock.on("data", (chunk) => {
          let fs = [];
          try {
            fs = parserA.feed(new Uint8Array(chunk));
          } catch {
            sock.destroy();
            return;
          }
          for (const frame of fs) {
            if (frame.t === "auth" && !authed) {
              authed = P.verifyAuth(frame, A.privateKeyB64, B.publicKeyB64);
              ok(authed, "A verifica la respuesta de B por TCP");
              if (authed) {
                // Envía mensaje y foto.
                sock.write(P.encodeFrame(P.buildMsg("m_tcp", texto, A.privateKeyB64, B.publicKeyB64)));
                const e = C.encryptBytes(original, A.privateKeyB64, B.publicKeyB64);
                for (const f of P.splitPhoto("m_tcp_photo", e.nonceB64, e.cipherB64)) {
                  sock.write(P.encodeFrame(f));
                }
              }
            }
          }
        });
        sock.on("error", () => {
          ok(false, "socket TCP sin errores");
        });
      });
    });

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

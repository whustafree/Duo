# AGENTS.md — Duo app (duo-app/)

Documento de contexto para agentes/desarrolladores. Versión **P2P sin
servidor**. El informe completo del proyecto está en `../INFORME-OPENCODE.md`
y el resumen en `../MANIFIESTO.md`.

Última actualización: 18 de octubre de 2026

---

## Qué es

**Duo** es una app Expo (SDK 52) para parejas: chat de texto + fotos, juegos y
retos. **No hay backend ni servidor de señalización**: la ruta **preferente** es
**TCP directo** en la misma WiFi (descubrimiento mDNS, puerto `47777`); si no hay
ruta directa (redes distintas), hay un modo **WebRTC STUN-only** con intercambio
de SDP **fuera de banda por 2 QRs** (sin TURN, sin signaling server). Todo va
cifrado E2E (X25519 + HKDF-SHA256 + AES-256-GCM, libs `@noble/*`).

- Repo: https://github.com/whustafree/Duo (APKs en Releases; CI en Actions).
- Estado: `npm test` 48/48, `npx expo export` verde (bundle Metro Android).

## Comandos

```bash
npm install
npm test              # duo-app/test/p2p-test.mjs (Node puro, sin device)
npx expo start        # desarrollo JS
npx expo export --platform android --output-dir dist-p2p   # prueba de bundle
```

APK: **no compilar en local** (no hay JDK/SDK). La CI
(`.github/workflows/build-apk.yml`, en la raíz del repo) corre en cada push a
`main` que toque `duo-app/**`: `npm ci` → `npm test` → `expo prebuild` →
`gradlew assembleRelease` → artefacto `duo-apk`.

## Arquitectura (archivos clave)

```
index.js                  # importa polyfills.js PRIMERO (RNG de Hermes)
App.js                    # E2EProvider > P2PProvider > Root (navegación)
src/services/
  polyfills.js            # instala globalThis.crypto.getRandomValues (expo-crypto)
  cryptocore.js           # NÚCLEO PURO: claves, AES-GCM, coupleId SAS, QR
  crypto.js               # wrapper AsyncStorage del par de claves + re-export
  protocol.js             # PURO: tramas (4B + JSON, máx 8MB), auth/pair/msg/photo
                          #   + build/parse de QRs WebRTC (Offer/Answer)
  p2p.js                  # transporte nativo: TCP server/dial + zeroconf mDNS
  webrtc.js               # WebRTC STUN-only (react-native-webrtc): RTCPeerConnection,
                          #   RTCSessionDescription, RTCIceCandidate, datachannel "duo-data"
  notifications.js        # notificaciones locales
src/context/
  SessionContext.js       # sesión de la pareja (duo.session) / clear()
  E2EContext.js           # claves del dispositivo; peerPub = session.partnerPub
  P2PContext.js           # historial, bandeja, fotos, typing, pareo, eventos
src/screens/
  OnboardingScreen.js     # vínculo QR LAN (crear/escanear) + modo WebRTC 2 QRs
                          #   (Offer/Answer) + código SAS + fallback Hotspot
  ChatScreen.js           # chat sobre useP2P()
  ProfileScreen.js        # código de verificación, desvincular (clear())
  Games/TruthDare/Challenge/Dice/QuestionsScreen  # juegos (datos mock locales)
test/p2p-test.mjs         # copia cryptocore/protocol a .mjs temporales y los
                          # prueba en Node (incluye sesión TCP real en 127.0.0.1)
```

### Reglas del protocolo (no romper)

1. **Roles deterministas**: clave pública "menor" → dialer; creador del vínculo
   escucha, quien escanea marca. Evita sockets duplicados A↔B.
2. **E2E encima del transporte**: toda trama con contenido va cifrada con
   `derivePairingKey` (pareo) o `deriveShared` X25519 (sesión). El handshake
   `auth` exige la clave privada correcta.
3. **coupleId local en ambos lados**: `duo-` + hex(sha256(`duo-couple-v1|pubA|`
   pubB` ordenadas)). Nunca viaja por la red.
4. **Emoji por clave**: `emojiForPub(pub)` es la única fuente de emojis en
   sesiones/pareo (consistente entre los dos teléfonos).
5. **Bandeja**: todo mensaje/foto se persiste `pending` y se reenvía al
   reconectar; dirección recordada por pareja: `duo.partner.addr.<coupleId>`.
6. **Foto**: cifrar SIEMPRE en origen; trocear en chunks de 48000 chars de
   base64; el emsamblador deduplica por `id`.
7. **QR WebRTC sin romper el QR LAN**: los formatos son distintos y disjuntos.
   - Vínculo LAN (7 campos): `duo:pair:v1:<pub>:<host|->:<port>:<ps>`.
   - WebRTC Offer (6 campos): `duo:webrtc:v1:offer:<pubA>:<sdp_b64url>`.
   - WebRTC Answer (6 campos): `duo:webrtc:v1:answer:<pubB>:<sdp_b64url>`.
   `parseWebRTCQr()` (en `protocol.js`, puro) devuelve `null` con cualquier otra
   cosa. El SDP va en base64url (sin `:`), así que el split por `:` da 6 campos.
8. **WebRTC es SOLO STUN** (`stun.l.google.com`, `stun1.l.google.com`,
   `global.stun.twilio.com`): **nunca TURN ni relay**. Se espera a que ICE
   termine de recolectar (vanilla ICE) antes de meter el SDP en el QR, porque no
   hay canal para intercambiar candidatos. Requiere `react-native-webrtc` (módulo
   nativo, no incluido en Expo Go).

### Modo WebRTC (Internet, sin servidor de señalización)

Fallback cuando los dos no comparten WiFi. Ruta preferente sigue siendo LAN:
al guardarse la sesión, `p2p.js` intenta TCP+mDNS y, si conecta, `P2PContext`
apaga WebRTC y usa LAN.

1. **A** "Crear vínculo por Internet" → `startPairingWebRTC()` → `createOffer()`
   (espera ICE) → muestra **Offer QR**.
2. **B** escanea el Offer → `createAnswer()` → calcula el **SAS**
   (`verificationCode(pubA, pubB)`) → muestra **Answer QR**.
3. **A** escanea el Answer → `setAnswer()` → **DataChannel `duo-data`** abierto.
4. Ambas pantallas derivan el mismo `coupleId` y guardan sesión; el chat usa el
   datachannel (`sendFrame` enruta a WebRTC si está conectado; si no, a TCP).
5. **Sin ruta directa** (timeout/ICE failed ≈18 s): se muestra la instrucción de
   **fallback a Hotspot** (activar punto de acceso en uno y conectar el otro).

Payloads: los frames se envían por el datachannel como **JSON string**; el
receptor los procesa directo (los bytes siguen pasando por `FrameParser` por si
llegan como binario). El cifrado E2E es idéntico: solo viajan ciphertext+nonce,
nunca claves privadas.

### Dependencias nativas (cuidado)

- Instalar paquetes Expo con `npx expo install` (respeta SDK 52). Actuales:
  `expo-camera@~16.0.18`, `expo-crypto@~14.0.2`, `expo-image-manipulator@~13.0.6`,
  `expo-network@~7.0.5`, `react-native-svg@15.8.0`, además de
  `react-native-tcp-socket`, `react-native-zeroconf`, `react-native-qrcode-svg`,
  `react-native-webrtc@124.0.8` (compatible con RN 0.76 / SDK 52; **no** está en
  `bundledNativeModules.json`, así que no sale con `expo install`).
- **Autolinking solo mira un nivel** bajo `node_modules`: verificar que ninguna
  lib nativa quede anidada (`npm ls <pkg>`).
- `newArchEnabled: false` en `app.json` (tcp-socket/zeroconf = bridge clásico;
  `react-native-webrtc` 124.x también corre en arquitectura clásica).
- `@babel/register` debe ser **7.x** (devDependency, para `npm test`).
- socket.io-client, api.js, socket.js, config.js y `duo-server/` fueron
  eliminados: **no reintroducir servidor ni `fetch` a una API**.

### API de `react-native-zeroconf` (v0.17)

`publishService({ type: "duo", protocol: "tcp", domain: "local.", name, port,
txt })` (promise), `scan({ type: "duo" })` — tipo **sin guion bajo** —,
evento `resolved(service)` (`service.ipv4[]`, `service.port`), `getServices()`,
`unpublishService(name)`, `stop()`, `removeDeviceListeners()`.

## Pantallas y datos

- `src/data/mock.js` solo alimenta juegos/demo; el chat NO usa mocks.
- Tema: `src/theme.js` (fondo `#0E0B14`, acentos `#FF4D6D`/`#FF6B8B`).
- Errores a tiros largos: pantalla blanca en release = excepción JS sin
  redbox; hay detectores `check-imports.cjs` / `check-idents.cjs` en el temp
  de opencode.

## Verificación antes de dar por bueno un cambio

```bash
npm test                          # 48 ok
npx expo export --platform android --output-dir dist-p2p   # bundle ok
```

Y revisar `git status` (nada de temporales tipo `.tmp-test-*` ni `dist-p2p/`).

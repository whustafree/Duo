# Informe para opencode — Proyecto Duo 💞

> Documento de traspaso (handoff). Describe **qué se está haciendo**, el estado
> actual, y **paso a paso para correr todo desde una PC y generar los APK**.
>
> Este archivo está pensado para que un agente de opencode (u otro dev) retome el
> trabajo sin contexto previo.

Última actualización: 18 de octubre de 2026

---

## 0) Resumen ejecutivo

**Duo** es una app privada para parejas (solo 2 personas vinculadas) que incluye
chat directo entre los dos teléfonos, envío de fotos, juegos/retos por niveles y
cifrado extremo a extremo (E2E) de textos y fotos.

**Arquitectura 100% P2P: no existe servidor.** El backend histórico
(`duo-server/`: Express + Socket.io + SQLite) fue **eliminado**. La ruta
**preferente** es la red local (TCP + mDNS); para **redes distintas** hay un modo
**WebRTC solo STUN** con el SDP intercambiado **fuera de banda por 2 QRs** (sin
TURN y **sin servidor de señalización**). Todo va cifrado con E2E encima del
transporte.

| Carpeta | Stack | Rol |
| ------- | ----- | --- |
| `duo-app/` | React Native + Expo (SDK 52) | App móvil (Android/iOS) |

> Nota histórica: el trabajo original se hizo desde Termux (Android), donde el
> toolchain de Expo es frágil. En un **PC estándar (Windows/Linux/macOS)**
> todo funciona de forma normal. Este informe prioriza las instrucciones para PC.

---

## 1) Estado actual

### Hecho

- [x] Maqueta completa de UI (todas las pantallas, tema oscuro).
- [x] **Servidor eliminado**: chat/fotos/vinculación P2P directa entre teléfonos.
- [x] Vinculación por **QR** (`react-native-qrcode-svg` + `expo-camera`) con
      secreto de un solo uso y confirmación mediante **código SAS de 6 dígitos**.
- [x] **Modo WebRTC por Internet sin servidor**: `react-native-webrtc` (STUN
      only: Google/Twilio), datachannel fiable `duo-data`, SDP intercambiado
      **fuera de banda por 2 QRs** (Offer/Answer) y fallback a **Hotspot** si no
      hay ruta directa. La ruta LAN (TCP+mDNS) sigue siendo la preferente.
- [x] Transporte: **TCP directo** (puerto 47777) + descubrimiento **mDNS**
      (`react-native-zeroconf`, servicio `_duo._tcp`) + reconexión con la
      dirección IP guardada por pareja.
- [x] Regla determinista de conexión: el dispositivo con la clave pública
      "menor" marca la conexión (evita sockets duplicados A↔B).
- [x] Autenticación E2E del enlace + heartbeat ping/pong (20 s / corte a 60 s).
- [x] Chat en tiempo real + "escribiendo…" + acks, deduplicación y **bandeja de
      salida** (lo no entregado se envía solo al reconectar).
- [x] Fotos cifradas en origen, troceadas en base64 y reensambladas al recibir.
- [x] Persistencia de sesión + historial local cifrado en AsyncStorage (300
      últimos mensajes) + fotos descifradas en almacenamiento local.
- [x] Notificaciones locales en segundo plano.
- [x] Cifrado E2E: X25519 + HKDF-SHA256 + AES-256-GCM, módulos `@noble/*`.
- [x] Polyfill `crypto.getRandomValues` con RNG nativo (`expo-crypto`), cargado
      **antes** que cualquier otro módulo (`index.js`).
- [x] Pruebas del protocolo: `duo-app/test/p2p-test.mjs` → **`npm test`**,
      **48 verificaciones** (formato de los QRs WebRTC Offer/Answer + sesión TCP
      real sobre 127.0.0.1).
- [x] Bundle de Metro `expo export` verde (`--platform android`).
- [x] APK por GitHub Actions en cada push a `main` que toque `duo-app/**`
      (pruebas + `expo prebuild` + `gradlew assembleRelease`).
- [x] Releases publicados: **v0.1.2** (versión con servidor),
      **v0.2.0** (primera versión P2P) y **v0.3.0** (conexión por Internet
      vía WebRTC STUN-only + intercambio de SDP por 2 QRs, app 0.3.0 /
      versionCode 3).

### Pendiente

- [ ] Probar en **dos celulares reales** el flujo completo: crear vínculo por
      QR (LAN y WebRTC), mensajes entrantes/salientes, fotos, reconexión.
- [ ] Probar WebRTC entre redes móviles reales (NAT estricto → fallback a
      Hotspot; se descarta TURN/relay a propósito).
- [ ] Más juegos/retos, borrar historial desde la app, publicar en Play Store.

---

## 2) Cómo funciona la conexión P2P (detalle)

### Archivos clave

| Archivo | Rol |
| ------- | --- |
| `duo-app/index.js` | Importa `src/services/polyfills.js` **primero** (RNG para Hermes). |
| `duo-app/src/services/cryptocore.js` | Núcleo criptográfico **puro** (sin React Native): claves, cifrado, `deriveCoupleId`, código SAS, emoji por clave, secreto del QR. Testeable en Node. |
| `duo-app/src/services/protocol.js` | **Puro**: encuadre de tramas (prefijo de 4 bytes + JSON, máx. 8 MB), `auth`/`pair-req`/`pair-ok`/`msg`/`ack`/`ping`/`typing`, troceo de fotos (48000 chars). |
| `duo-app/src/services/p2p.js` | Transporte nativo (ruta preferente): `react-native-tcp-socket` (servidor/puerto 47777 + dialer) y `react-native-zeroconf` (publica/escanea `_duo._tcp`). Regla de roles, handshake, heartbeat, pareo, candidatos mDNS, dirección guardada. |
| `duo-app/src/services/webrtc.js` | Transporte alternativo: `WebRTCService` con `react-native-webrtc` (STUN only). `createOffer`/`createAnswer`/`setAnswer`, datachannel fiable `duo-data`, espera a ICE gathering (vanilla ICE) antes de serializar el SDP. |
| `duo-app/src/services/crypto.js` | Wrapper de almacenamiento: guarda/carga el par de claves en AsyncStorage y re-exporta `cryptocore`. |
| `duo-app/src/context/P2PContext.js` | Capa React: historial local (`duo.msgs.<coupleId>`), bandeja de salida, envío/recepción de fotos, acks/dedup, typing, notificaciones en 2.º plano, API de pareo, dirección guardada por pareja (`duo.partner.addr.<coupleId>`), despertar con AppState. |
| `duo-app/src/context/E2EContext.js` | Expone las claves del dispositivo; `peerPub` = `session.partnerPub`. |
| `duo-app/src/screens/OnboardingScreen.js` | Flujo de vínculo QR de dos vías: LAN (crear/escanear) y **WebRTC por Internet** (Offer → Answer → SAS → DataChannel) con fallback a Hotspot; guarda sesión → Main. |
| `duo-app/src/screens/ChatScreen.js` | Chat sobre `useP2P()` (sin api/socket). Fotos con `expo-image-manipulator` (1280 px, JPEG 0.7) antes de cifrar. |
| `duo-app/test/p2p-test.mjs` | Pruebas: copia `cryptocore.js`/`protocol.js` a temporales `.mjs` y los importa en Node (misma técnica que usaba `duo-server/test/e2e-test.mjs`). |

### Flujo de vínculo (QR)

```
QR de A:  duo:pair:v1:<pubA b64url>:<host|->:<port>:<ps b64url>
```

1. A llama `startPairing()` → levanta servidor + mDNS, devuelve el QR.
2. B escanea → `joinPairing()` → marca (regla: quien se une **marca**) →
   envía `pair-req` cifrado con `HKDF(ps)` por el socket TCP (IP del QR; si
   falla, candidatos mDNS).
3. A recibe → Alert con nombre + código SAS → acepta/rechaza.
4. A responde `pair-ok` con su nombre/emoji/coupleId → ambos guardan sesión
   (clave `duo.session`) y entran a Main. Cada lado guarda
   `myEmoji = emojiForPub(mía)` y `partnerEmoji = emojiForPub(de la pareja)`.

### Flujo WebRTC por Internet (2 QRs, sin servidor de señalización)

```
Offer  de A:  duo:webrtc:v1:offer:<pubA b64url>:<sdp b64url>
Answer de B:  duo:webrtc:v1:answer:<pubB b64url>:<sdp b64url>
```

1. A: *Crear vínculo por Internet* → `startPairingWebRTC()` → `createOffer()`
   (espera a que ICE recolecte candidatos STUN) → **Offer QR**.
2. B escanea el Offer → `createAnswer()` → calcula el **SAS** con
   `verificationCode(pubA, pubB)` → **Answer QR**.
3. A escanea el Answer → `setAnswer()` → se abre el **DataChannel `duo-data`**.
4. Ambas pantallas derivan el mismo `coupleId` y guardan `duo.session`. El chat
   enruta por WebRTC (`sendFrame`), y si luego aparece la LAN (misma WiFi), se
   prefiere TCP+mDNS.
5. Sin ruta directa (NAT estricto) tras ~18 s → mensaje de **fallback**: activar
   **Hotspot** en uno y conectar el otro.

> El parser de QRs (`parseWebRTCQr`) y el generador (`buildWebRTCOfferQr`/
> `buildWebRTCAnswerQr`) viven en `protocol.js` (PURO) y se prueban en `npm test`.
> No se rompe el QR LAN (`duo:pair:v1:...`, 7 campos): son formatos disjuntos.

### Cifrado de mensajes

- Mensaje: `encryptText(text, miPriv, pubPareja)` dentro de la trama `msg`.
- Foto: archivo → copia temporal → `encryptBytes` → `splitPhoto` (chunks de
  48000 chars) → tramas `photo-meta` + `photo-chunk[i]` → al completar,
  `PhotoAssembler` devuelve meta → descifra → escribe `duo_<id>.jpg` local.
- coupleId: `duo-` + hex(sha256(`duo-couple-v1|pubA|pubB` ordenadas)) →
  idéntico en ambos lados, se deriva localmente (nunca viaja).

### Desconexión / bandeja

- `sendText`/`sendPhoto` persisten la fila (`pending: true`) en el historial
  y en la **bandeja** (`duo.outbox`); al aparecer sesión se reenvían todo
  (foto → `photo-pending` en disco hasta poder rearmarse).
- Heartbeat `ping` cada 20 s; sin `pong` en 60 s se corta y corre el bucle de
  reconexión cada 8 s: dirección guardada → candidatos mDNS.

---

## 3) Paso a paso en PC (Windows/Linux/macOS)

### Requisitos

- Node.js 20+ (probado con 24) y npm.
- Git.
- Para APK: **NO hace falta Java/Android SDK local**: lo hace GitHub Actions.
  (Si se quiere local: JDK 17 + Android Studio + `ANDROID_HOME`.)

### Correr en desarrollo

```bash
cd duo-app
npm install
npm test              # 48 verificaciones del protocolo P2P
npx expo start
```

> Importante: `react-native-tcp-socket`, `react-native-zeroconf` y
> `react-native-webrtc` son módulos nativos que **Expo Go no incluye**. Para
> probar la conexión P2P real se necesita un development build
> (`npx expo run:android`) o el APK.

### Generar el APK (recomendado: GitHub Actions)

1. Push a `main` que toque `duo-app/**` (o pestaña *Actions → Build APK →
   Run workflow*).
2. El workflow (`.github/workflows/build-apk.yml`):
   `npm ci` → **`npm test`** → `npx expo prebuild -p android --no-install` →
   `gradlew assembleRelease` → artefacto `duo-apk`
   (`duo-v<versión>-apk<n>.apk`).
3. Descargar el artefacto y publicarlo como Release en
   https://github.com/whustafree/Duo/releases (tag `vX.Y.Z` = `expo.version`).

### Generar el APK (alternativa: EAS)

```bash
cd duo-app
npx eas login
npx eas build -p android --profile preview
```

`eas.json` ya tiene el perfil `preview` (APK, sin credenciales).

---

## 4) Decisiones de diseño (por qué es así)

- **TCP + mDNS como ruta preferente**: las parejas están en la misma WiFi de
  casa. Así hay reconexión automática sin repetir un intercambio QR en cada
  sesión. Contrapartida aceptada: los dos deben estar en la misma red con la app
  abierta para intercambiar; lo no entregado queda encolado localmente.
- **WebRTC solo STUN como alternativa para redes distintas**, con el SDP
  intercambiado fuera de banda por 2 QRs: así no hace falta **ningún** servidor
  de señalización. Se descarta **TURN/relay** a propósito (privacidad + coste):
  si el NAT lo impide, se ofrece el atajo por **Hotspot** en lugar de relear.
- **Regla determinista de roles** (clave pública menor = dialer; quien crea el
  vínculo escucha, quien se une marca): evita sockets duplicados A↔B y
  condiciones de carrera en el descubrimiento.
- **E2E encima del transporte**: el cifrado no depende de que la red sea
  confiable; el handshake de autenticación exige la clave privada correcta.
- **`newArchEnabled: false`** en `app.json`: `tcp-socket`/`zeroconf` son
  módulos de puente clásico; con la arquitectura nueva solo hay notas
  "untested on New Architecture" en doctor y se evitan riesgos.
- **Todo puro separado** (`cryptocore.js`/`protocol.js` sin imports de
  React Native): permite probar la lógica criptográfica y de tramas en Node
  puro, sin emulator ni build.

---

## 5) Lecciones aprendidas (no repetir)

1. **Pantalla blanca = excepción JS en release** (no hay redbox). El fondo de
   arranque es `#0E0B14`. Detectores útiles:
   `check-imports.cjs` / `check-idents.cjs` en el temp de opencode (imports
   faltantes / hooks declarados pero sin usar).
2. **Hermes no trae Web Crypto**: `crypto.getRandomValues` debe instalarse en
   `polyfills.js` **antes** de cualquier uso de `@noble/*` (se importa primero
   en `index.js`).
3. **Autolinking de Expo solo escanea un nivel**: `*/expo-module.config.json`
   bajo `node_modules`. Todas las deps nativas deben quedar **planas**
   (verificar con `npm ls` y que no haya `node_modules` anidados con módulos
   nativos).
4. **Versiones nativas = las de `expo/bundledNativeModules.json`** del SDK:
   instalar con `npx expo install <pkg>` para que respete SDK 52. Excepción:
   `react-native-webrtc` **no** está en ese mapa; se fija a mano
   (`124.0.8`, compatible con RN 0.76 / SDK 52 y arquitectura clásica).
5. **`@babel/register` debe ser 7.x** (Babel 8 rompe el setup de pruebas).
6. **`process.exit()` no ejecuta `finally`**: en pruebas Node, limpiar
   temporales con `process.on("exit", cleanup)`.
7. **API de `react-native-zeroconf` ≥0.17**: `publishService({type, protocol,
   domain, name, port, txt})` (NO `publish(...)`), `scan({type: "duo"})` con el
   tipo **sin guion bajo**, evento `resolved(service)` con `service.ipv4[]`,
   `getServices()`, `unpublishService(name)` (no existe `unpublishAll`) y
   `removeDeviceListeners()` al terminar.
8. **PowerShell 5.1 no acepta `&&`**: usar `;` en los comandos.
9. La ruta de trabajo opencode era `C:\Windows\System32`: trabajar siempre
   con rutas absolutas a `C:\Users\whustaf\Desktop\DuoProyecto`.

---

## 6) Comandos de verificación rápida

```bash
cd C:\Users\whustaf\Desktop\DuoProyecto\duo-app
npm test                          # protocolo P2P (48 ok)
npx expo export --platform android --output-dir dist-p2p   # bundle Metro
```

Parseo de sintaxis de todos los `.js` (Babel, detecta JSX roto):

```bash
node -e "const b=require('@babel/core'),fs=require('fs'),p=require('path');const F=[];(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(['node_modules','dist','.expo'].includes(e.name))continue;const f=p.join(d,e.name);e.isDirectory()?w(f):/\.(js|jsx|mjs)$/.test(e.name)&&F.push(f);}})(process.cwd());let n=0;for(const f of F){try{b.transformSync(fs.readFileSync(f,'utf8'),{presets:[require.resolve('babel-preset-expo')],filename:f,babelrc:false,configFile:false});}catch(e){n++;console.error('ERROR',p.relative(process.cwd(),f),e.message.split('\n')[0]);}}console.log(n?n+' con error':'SINTAXIS OK ('+F.length+')');"
```

---

## 7) Repo y releases

- Repo: https://github.com/whustafree/Duo (público, usuario `whustafree`).
- Releases: https://github.com/whustafree/Duo/releases
  - `v0.1.2` — última versión con servidor (histórica).
  - `v0.2.0` — primera versión **P2P** (app `0.2.0`, versionCode `2`).
  - `v0.3.0` — **P2P + Internet** sin servidor: WebRTC con STUN gratuitos e
    intercambio de SDP por 2 QRs (app `0.3.0`, versionCode `3`). Fallback a
    Hotspot si no hay ruta directa.
- Tras cambiar dependencias: commit + push y la CI (Actions → Build APK)
  compila y sube el artefacto; descargarlo y publicarlo en el Release.

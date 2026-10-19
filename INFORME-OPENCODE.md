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
chat privado entre los dos teléfonos, envío de fotos, **juegos/retos compartidos
sincronizados entre los dos** (por niveles) y cifrado extremo a extremo (E2E) de
textos, fotos y estado del juego.

**Arquitectura por relay: no existe servidor propio.** El backend histórico
(`duo-server/`: Express + Socket.io + SQLite) fue **eliminado**. Los dos teléfonos
se hablan a través de un **broker MQTT público y gratuito** (p. ej.
`wss://broker.emqx.io:8084/mqtt`, con respaldo `wss://broker.hivemq.com:8884/mqtt`
y `wss://test.mosquitto.org:8081/mqtt`) que actúa **solo como cartero**: no hay
servidor propio, de señalización ni de pago. Todo el contenido va **cifrado de
extremo a extremo** (X25519 + HKDF-SHA256 + AES-256-GCM), así que el broker nunca
puede leerlo. Ventaja: funciona **siempre y desde cualquier red** (misma WiFi o
datos móviles, NAT estricto incluido), sin estar juntos ni abrir puertos.

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
- [x] **Servidor propio eliminado**: chat/fotos/vinculación a través de un
      **broker MQTT público y gratuito** (solo cartero); el contenido va cifrado
      E2E.
- [x] Vinculación con **código corto** (`react-native-qrcode-svg` +
      `expo-camera`): se puede **escanear (QR)** o **pegar** (`duo:pair:v2:…`,
      5 campos). Secreto de un solo uso + confirmación mediante **código SAS de 6
      dígitos**. **No hace falta estar en la misma red.**
- [x] Transporte por relay: cliente **MQTT 3.1.1 sobre WebSocket** propio y sin
      dependencias; **3 brokers** públicos probados en orden y reconexión
      automática con backoff + `wake()` al volver a primer plano.
- [x] Temas hasheados: `duo/v2/pair/<hash>` (vinculación) y
      `duo/v2/chat/<hash>` (chat), con sobre `{s, f}` para **ignorar el eco
      propio**.
- [x] Chat en tiempo real + "escribiendo…" + acks, deduplicación y **bandeja de
      salida** (reintento **cada 12 s** hasta recibir el ACK: entrega diferida
      fiable).
- [x] Fotos cifradas en origen, troceadas en base64 y reensambladas al recibir.
- [x] **Juegos compartidos** (v0.5.0): el estado del juego se sincroniza con la
      pareja por el relay cifrado (marco `game` en `protocol.js`); al iniciar un
      juego se envía un `start` y la app **abre sola** esa pantalla en el otro
      teléfono. Nivel y reto son comunes; el anfitrión **reenvía el estado cada
      6 s** (baliza) y «Terminar juego» acaba en los dos.
- [x] **5 niveles** de juegos/retos (🌸 Suave · 💞 Romántico · 🌶️ Picante ·
      🔥 Atrevido · 😈 Íntimo **+18**), elegidos antes de jugar y sincronizados;
      `challenges`/`diceChallenges`/`truths`/`dares` indexados por nivel y
      pensados para la distancia (chat, audio, foto o videollamada).
- [x] **Invitación con enlace de descarga** (`src/config.js`, `INVITE_MESSAGE`):
      botón para compartir el enlace del APK en el onboarding, en Juegos y en el
      Perfil, para invitar a la pareja aunque todavía no tenga la app.
- [x] **Borrado de contenido** local (con confirmación): `clearHistory()`,
      `deleteStoredPhotos()` y `wipeAllContent()`; «Desvincular» también confirma.
      Aviso de que solo borra la copia local (la de la pareja no se toca).
- [x] Persistencia de sesión + historial local cifrado en AsyncStorage (300
      últimos mensajes) + fotos descifradas en almacenamiento local.
- [x] Notificaciones locales en segundo plano.
- [x] Cifrado E2E: X25519 + HKDF-SHA256 + AES-256-GCM, módulos `@noble/*`.
- [x] Polyfill `crypto.getRandomValues` con RNG nativo (`expo-crypto`), cargado
      **antes** que cualquier otro módulo (`index.js`).
- [x] Pruebas: `duo-app/test/duo-test.mjs` → **`npm test`**, **64
      verificaciones** (identidad/SAS, encuadre, auth E2E, QR v2, temas/sobre del
      relay, mensajes, fotos, **cifrado del estado del juego** —un tercero no lo
      descifra y el reto no viaja en claro; la pareja recibe el juego iniciado— y
      una sesión completa sobre un "bus" en memoria que imita al broker). Además
      sigue habiendo una prueba real contra el broker MQTT (fuera de la suite).
- [x] Bundle de Metro `expo export` verde (`--platform android`).
- [x] APK por GitHub Actions en cada push a `main` que toque `duo-app/**`
      (`npm ci` → `npm test` → `expo prebuild` → `gradlew assembleRelease`).
- [x] Releases publicados: **v0.1.2** (versión con servidor),
      **v0.2.0** (primera versión P2P) y **v0.3.0** (conexión por Internet sin
      servidor propio; app 0.3.0 / versionCode 3). **v0.4.0** (relay MQTT, app
      0.4.0 / versionCode 4) y **v0.5.0** (juegos compartidos + borrado +
      invitación + nivel Íntimo; app 0.5.0 / versionCode 5) están **pendientes
      de compilar y publicar**.

### Pendiente

- [ ] Probar en **dos celulares reales** el flujo completo por relay: crear/
      compartir/escanear/pegar el código, mensajes entrantes/salientes, fotos y
      entrega diferida (reintentos + ACK).
- [ ] Probar en **dos teléfonos** los **juegos compartidos**: que la pantalla se
      abra sola en la pareja, que nivel y reto se sincronicen y que «Terminar
      juego» cierre en los dos.
- [ ] Probar en **dos teléfonos** el **borrado de contenido** y el **enlace de
      invitación** (descarga del APK `duo.apk`).
- [ ] Publicar la **Release v0.5.0** (pendiente de compilar el APK por la CI y
      subirlo a Releases).
- [ ] Más juegos/retos; publicar en Play Store.

---

## 2) Cómo funciona la conexión por relay (detalle)

### Archivos clave

| Archivo | Rol |
| ------- | --- |
| `duo-app/index.js` | Importa `src/services/polyfills.js` **primero** (RNG para Hermes). |
| `duo-app/App.js` | Navegación (stack + tabs) con un `navigationRef`: cuando llega un `start` de juego de la pareja (`incomingGame`), **navega solo** a la pantalla correspondiente (`GAME_ROUTES`), de modo que el juego aparece en los dos teléfonos. |
| `duo-app/src/config.js` | Datos **públicos**: `REPO_URL`, `RELEASES_URL`, `APP_DOWNLOAD_URL` (= `…/releases/latest/download/duo.apk`) e `INVITE_MESSAGE` (texto para invitar a la pareja). |
| `duo-app/src/services/cryptocore.js` | Núcleo criptográfico **puro** (sin React Native): claves, cifrado, `deriveCoupleId`, código SAS, emoji por clave, secreto del QR. Testeable en Node. |
| `duo-app/src/services/protocol.js` | **Puro**: encuadre de tramas (prefijo de 4 bytes + JSON, máx. 8 MB), `auth`/`pair-req`/`pair-ok`/`msg`/`ack`/`ping`/`typing`/**`game`**, troceo de fotos (48000 chars). `buildGame`/`readGame` cifran el estado del juego igual que el chat. |
| `duo-app/src/services/mqttws.js` | Cliente **MQTT 3.1.1 sobre WebSocket** mínimo y **sin dependencias** (no usa `Buffer`/`process`/`TextEncoder`). Publica/suscribe con QoS 0, ping keepalive y reconexión con backoff. `MQTT_BROKERS` con los 3 brokers. |
| `duo-app/src/services/relayproto.js` | Lógica **pura** del relay: temas (`duo/v2/pair/<hash>`, `duo/v2/chat/<hash>`), QR v2 (`duo:pair:v2:<pub>:<ps>`) y sobre `{s, f}`. |
| `duo-app/src/services/relay.js` | Transporte `Relay` por el broker público. **Misma API** que el antiguo P2P (`onEvent`/`configure`/`start`/`stop`/`wake`/`send`/`startPairing`/`joinPairing`/`acceptPairing`/`rejectPairing`/`cancelPairing`; eventos `status`/`session`/`frame`/`pair-request`/`paired`). Elige broker probando los 3 en orden. |
| `duo-app/src/services/crypto.js` | Wrapper de almacenamiento: guarda/carga el par de claves en AsyncStorage y re-exporta `cryptocore`. |
| `duo-app/src/context/P2PContext.js` | Capa React: historial local (`duo.msgs.<coupleId>`), bandeja de salida, envío/recepción de fotos, acks/dedup, typing, notificaciones en 2.º plano, API de pareo, **estado del juego compartido** (`gameSession`, `startGame`, `setGameLevel`, `drawGame`, `endGame`, `incomingGame`, `clearIncomingGame`; baliza cada 6 s) y **borrado** (`clearHistory`, `deleteStoredPhotos`, `wipeAllContent`). Reintento periódico cada 12 s (`flushOutbox` en `flushRef`). |
| `duo-app/src/context/E2EContext.js` | Expone las claves del dispositivo; `peerPub` = `session.partnerPub`. |
| `duo-app/src/screens/OnboardingScreen.js` | Un solo flujo de vínculo: `welcome` (crear / escanear / pegar + **«📲 Enviar el enlace de descarga a mi pareja»**), `create` (QR de 240 px + «📤 Compartir el código» vía `Share`), `paste`, `scan` y `joining` (spinner + SAS). |
| `duo-app/src/screens/ChatScreen.js` | Chat sobre `useP2P()` (sin api/socket). Fotos con `expo-image-manipulator` (1280 px, JPEG 0.7) antes de cifrar. El botón del candado explica el cifrado. |
| `duo-app/src/components/ChallengeDeck.js` | Base común de los juegos con botones: lee/escribe el **estado compartido** (nivel y reto) en vez de sortear localmente; botón «Terminar juego». |
| `duo-app/src/screens/ProfileScreen.js` | Perfil con **datos reales** (nº de mensajes/fotos), invitación + enlace de descarga y **borrado** (historial, fotos, todo) + desvincular, todo con confirmación. |
| `duo-app/test/duo-test.mjs` | Pruebas (**64 verificaciones**): copia `cryptocore.js`/`protocol.js`/`relayproto.js` a temporales `.mjs` y los importa en Node; incluye cifrado del estado del juego y una sesión completa sobre un "bus" en memoria que imita al broker. |

### Flujo de vínculo (QR / código)

```
QR de A:  duo:pair:v2:<pubA b64url>:<ps b64url>   (5 campos)
```

1. A llama `startPairing()` → genera un secreto (`ps`), se suscribe al tema de
   vinculación `duo/v2/pair/<hash>` y devuelve un **QR corto** + el código para
   compartir (`Share`).
2. B **escanea** el QR o **pega** el código → `joinPairing()` → se suscribe al
   mismo tema y publica `pair-req` cifrado con una clave derivada del `ps`
   (`HKDF(ps)`), reintentando cada 3 s.
3. A recibe → Alert **«Solicitud de vínculo»** con nombre, emoji y **código SAS
   de 6 dígitos** → acepta/rechaza.
4. A publica `pair-ok` con su nombre/emoji/coupleId → ambos guardan sesión
   (clave `duo.session`) y entran a Main. Cada lado guarda
   `myEmoji = emojiForPub(mía)` y `partnerEmoji = emojiForPub(de la pareja)`.

### Flujo de chat por relay

```
Tema de chat:  duo/v2/chat/<hash del coupleId>   (hash = sha256 → 22 hex)
Sobre:         { s: selfId, f: trama }           (selfId = hash de mi clave pública)
```

1. Cada teléfono se conecta al broker (probando los 3 en orden hasta que uno
   responda) y se suscribe al tema de chat de la pareja.
2. `send(frame)` publica `buildEnvelope(selfId, frame)` cifrado E2E; el broker
   solo reenvía bytes ilegibles.
3. `parseEnvelope` + `if (env.s === this.selfId) return` **ignora el eco propio**
   (el broker devuelve a cada uno lo que publica).
4. `protocol.js` sigue aportando las tramas (`buildPairReq`/`verifyPairReq`/
   `buildPairOk`/`verifyPairOk`, `buildMsg`/`readMsg`, `buildAck`, `buildTyping`,
   `splitPhoto`/`PhotoAssembler`), sin cambios.

### Flujo de juegos compartidos

```
Trama de juego:  { t: "game", ts, nonceB64, ctB64 }   (cifrada E2E)
Payload:         { k: "start"|"level"|"draw"|"sync"|"end", gameId, level, prompt, mode }
```

1. Al abrir un juego, el host llama `startGame(gameId, level)`: guarda
   `gameSession` y publica `buildGame({ k: "start", gameId, level }, …)` en el
   tema de chat de la pareja (cifrado E2E, igual que `buildMsg`).
2. El otro teléfono recibe la trama `game`, la descifra con `readGame`, actualiza
   su `gameSession` y `setIncomingGame(...)`; `App.js` (con `navigationRef`) ve el
   `incomingGame` y **navega solo** a esa pantalla.
3. El nivel (`setGameLevel`) y el reto (`drawGame`, con `prompt` + `mode`) se
   publican como `level`/`draw`, así **los dos ven el mismo estado**.
4. Mientras el host esté en línea, una **baliza** reenvía `sync` cada
   `GAME_BEACON_INTERVAL` (6 s) para recuperar mensajes perdidos.
5. `endGame` publica `{ k: "end" }` y limpia la sesión en ambos lados.

### Cifrado de mensajes

- Mensaje: `encryptText(text, miPriv, pubPareja)` dentro de la trama `msg`.
- Juego: `buildGame(payload, miPriv, pubPareja)` cifra el estado del juego
  (nivel/reto) dentro de la trama `game`; `readGame` lo descifra en la pareja.
  El broker nunca ve a qué jugáis ni el reto.
- Foto: archivo → copia temporal → `encryptBytes` → `splitPhoto` (chunks de
  48000 chars) → tramas `photo-meta` + `photo-chunk[i]` → al completar,
  `PhotoAssembler` devuelve meta → descifra → escribe `duo_<id>.jpg` local.
- coupleId: `duo-` + hex(sha256(`duo-couple-v1|pubA|pubB` ordenadas)) →
  idéntico en ambos lados, se deriva localmente (nunca viaja).

### Desconexión / bandeja

- `sendText`/`sendPhoto` persisten la fila (`pending: true`) en el historial y la
  **bandeja**; mientras haya filas `pending` y estés en línea, `flushOutbox` las
  reenvía **cada 12 s** hasta recibir el **ACK** (`ack`) que las marca
  entregadas.
- Reconexión del broker: si el WebSocket cae, `mqttws.js` reintenta con backoff
  (1 s → máx. 15 s) y re-suscribe los temas; `Relay.wake()` fuerza un intento
  inmediato al volver la app a primer plano. Si ningún broker responde, se
  reintenta la lista a los 8 s.

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
npm test              # 64 verificaciones (protocolo + relay + cifrado E2E + juego)
npx expo start
```

> El transporte por relay usa el **WebSocket global** (presente en React Native
> / Hermes) y el cliente MQTT es propio y **sin dependencias nativas**, así que
> ya no hacen falta módulos nativos de red para el vínculo/chat. Para probar el
> flujo completo se recomienda igualmente un development build
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
   El APK se publica además con el nombre **estable `duo.apk`** (junto al nombre
   con número), de modo que el enlace
   `…/releases/latest/download/duo.apk` que usa la invitación de la app siempre
   apunta a la última versión.

### Generar el APK (alternativa: EAS)

```bash
cd duo-app
npx eas login
npx eas build -p android --profile preview
```

`eas.json` ya tiene el perfil `preview` (APK, sin credenciales).

---

## 4) Decisiones de diseño (por qué es así)

- **Broker MQTT público como cartero**: en lugar de conexión directa, los dos
  teléfonos publican/suscriben en un broker **público y gratuito**. Ventaja:
  funciona **siempre y desde cualquier red** (misma WiFi o datos móviles, NAT
  estricto incluido), sin estar juntos ni abrir puertos. No hay servidor propio ni
  de pago. El precio: el broker ve metadatos mínimos (temas hasheados, tamaño y
  horario); **nunca el contenido**, que va cifrado E2E.
- **Temas hasheados** (`duo/v2/pair/<hash>` y `duo/v2/chat/<hash>`, con
  `hash = sha256 → 22 hex`): sin las claves no se pueden ni adivinar; así el
  broker no aprende con quién hablas ni el `coupleId`.
- **Sobre `{s, f}` por mensaje**: marca el emisor (`selfId`) para **ignorar el
  eco propio** (el broker devuelve a cada uno lo que publica) sin depender del
  orden ni duplicar mensajes.
- **Elección de broker probando los 3 en orden** + reconexión con backoff: evita
  depender de un único servicio público y tolera caídas puntuales.
- **E2E encima del transporte**: el cifrado no depende de que la red (o el
  broker) sea confiable; el handshake de autenticación exige la clave privada
  correcta. **El estado del juego también va cifrado E2E** (trama `game`), así
  que ni el broker sabe a qué jugáis ni el reto.
- **Entrega diferida fiable**: los mensajes quedan `pending` y se reintentan
  **cada 12 s** mientras estás en línea, hasta recibir el ACK de la pareja.
- **`newArchEnabled: false`** en `app.json`: configuración **actual** del
  proyecto (ya no responde a ningún módulo nativo; los que la motivaban fueron
  retirados).
- **Juegos compartidos a distancia**: se sincronizan por el mismo canal cifrado
  y la app **navega sola** a la pantalla del juego que inicia la pareja
  (`navigationRef`). El anfitrión reenvía el estado cada 6 s (baliza) para mayor
  fiabilidad.
- **Todo puro separado** (`cryptocore.js`/`protocol.js`/`relayproto.js` sin
  imports de React Native): permite probar la lógica criptográfica, de tramas y
  del relay en Node puro, sin emulator ni build.

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
   instalar con `npx expo install <pkg>` para que respete SDK 52.
5. **`@babel/register` debe ser 7.x** (Babel 8 rompe el setup de pruebas).
6. **`process.exit()` no ejecuta `finally`**: en pruebas Node, limpiar
   temporales con `process.on("exit", cleanup)`.
7. **El cliente MQTT se escribe a mano sin dependencias**: `mqttws.js` solo usa
   el **WebSocket global** (presente en RN/Hermes y en Node) y no necesita
   `Buffer`/`process`/`TextEncoder`; así el transporte funciona igual en la app
   que en las pruebas.
8. **PowerShell 5.1 no acepta `&&`**: usar `;` en los comandos.
9. La ruta de trabajo opencode era `C:\Windows\System32`: trabajar siempre
   con rutas absolutas a `C:\Users\whustaf\Desktop\DuoProyecto`.

---

## 6) Comandos de verificación rápida

```bash
cd C:\Users\whustaf\Desktop\DuoProyecto\duo-app
npm test                          # protocolo + relay (64 ok)
npx expo export --platform android --output-dir dist   # bundle Metro
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
  - `v0.3.0` — versión anterior con conexión por Internet sin servidor propio
    (app `0.3.0`, versionCode `3`).
  - `v0.4.0` — **relay MQTT**: sin conexión directa; broker público gratuito
    solo como cartero, contenido cifrado E2E (app `0.4.0`, versionCode `4`).
  - `v0.5.0` — **juegos compartidos** (sincronizados, con apertura automática de
    pantalla, baliza 6 s y «Terminar juego»), **borrado de contenido** local
    (historial/fotos/todo) con confirmación, **enlace de invitación con descarga
    estable (`duo.apk`)**, **5 niveles** (incluido **Íntimo +18**) y tests a **64
    verificaciones** (app `0.5.0`, versionCode `5`). **Pendiente de compilar y
    publicar.**
- Tras cambiar dependencias: commit + push y la CI (Actions → Build APK)
  compila y sube el artefacto; descargarlo y publicarlo en el Release.

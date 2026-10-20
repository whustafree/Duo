# AGENTS.md — Duo app (duo-app/)

Documento de contexto para agentes/desarrolladores. Versión **relay por broker
MQTT público (sin servidor propio)**. El informe completo del proyecto está en
`../INFORME-OPENCODE.md` y el resumen en `../MANIFIESTO.md`.

Última actualización: 20 de octubre de 2026

---

## Qué es

**Duo** es una app Expo (SDK 52) para parejas: chat de texto, fotos, audio y
vídeo con **estados de entrega**, **citas y reacciones**, **juegos compartidos
entre los dos** (con respuestas dentro del juego), retos y **bloqueo de la app
con PIN/huella** (con cifrado opcional de la copia local). **No hay backend ni
servidor propio**: los
dos teléfonos se comunican a través de un **broker MQTT público y gratuito**
(p. ej. `wss://broker.emqx.io:8084/mqtt`) que actúa **solo como cartero**. Todo
va cifrado E2E (X25519 + HKDF-SHA256 + AES-256-GCM, libs `@noble/*`), incluidos
los mensajes, los archivos (audio/vídeo) y **el estado del juego**; el broker
nunca puede leer nada.
Funciona **desde cualquier red** (misma WiFi o datos móviles, NAT estricto
incluido).

- Repo: https://github.com/whustafree/Duo (APKs en Releases; CI en Actions).
- Estado: `npm test` 146/146, `npx expo export` verde (bundle Metro Android, Hermes 4.23 MB).
  Última release publicada: **v0.7.1** (20/10/2026).

## Comandos

```bash
npm install
npm test              # duo-app/test/duo-test.mjs (Node puro, sin device; 146 verificaciones)
npx expo start        # desarrollo JS
npx expo export --platform android --output-dir dist   # prueba de bundle
```

APK: **no compilar en local** (no hay JDK/SDK). La CI
(`.github/workflows/build-apk.yml`, en la raíz del repo) corre en cada push a
`main` que toque `duo-app/**`: `npm ci` → `npm test` → `expo prebuild` →
`gradlew assembleRelease` → artefacto `duo-apk`.

## Arquitectura (archivos clave)

```
index.js                  # importa polyfills.js PRIMERO (RNG de Hermes)
App.js                    # E2EProvider > P2PProvider > Root (navegación + navigationRef)
src/config.js             # Enlaces públicos (repo, releases, descarga) e invitación
src/data/
  mock.js                 # reexporta los pools de juegos
  pool-*.js               # pools: pool-retos/truths/dares/dados/preguntas (22×5=110)
src/services/
  polyfills.js            # instala globalThis.crypto.getRandomValues (expo-crypto)
  cryptocore.js           # NÚCLEO PURO: claves, AES-GCM, coupleId, SAS, emoji
                          #   + PIN (newPinSalt/pinHash/deriveLocalKey para el cofre)
  crypto.js               # wrapper AsyncStorage del par de claves + re-export
  protocol.js             # PURO: tramas, auth/pair/msg/archivos(file-*)/game + buildGame/readGame
  mqttws.js               # cliente MQTT 3.1.1 sobre WebSocket, SIN dependencias
                          #   + MQTT_BROKERS
  relayproto.js           # PURO: temas, QR v2 y sobre {s,f} del relay
  relay.js                # transporte Relay (broker público), API tipo P2P
  notifications.js        # notificaciones locales (canal duo-mensajes heads-up + ocultas)
  version.js              # versión instalada (app.json) + comparación semver
  updatecheck.js          # compara con el latest de GitHub Releases (aviso in-app)
  chatcodec.js            # PURO: citas/reacciones (JSON marca __duo) + estados ⏳/⭕/✓/✓✓
  retention.js            # PURO: auto-destrucción local (Nunca/7/30/90 días)
  applock.js              # bloqueo: PIN (resumen con sal), huella, avisos ocultos,
                          #   pantalla discreta, onLockStateChange
  localvault.js           # cofre: copia local cifrada (AES-GCM) + vaultReady/vaultIsReady
src/context/
  SessionContext.js       # sesión de la pareja (duo.session) / clear()
  E2EContext.js           # claves del dispositivo; peerPub = session.partnerPub
  P2PContext.js           # historial (por el cofre), bandeja (reintento 12s), archivos (fotos/audio/vídeo),
                          #   typing, pareo (Relay), juegos compartidos (gameSession +
                          #   sendGameReply/hilo GameThread + baliza 6s con el hilo),
                          #   estados markSent/markFailed/retryMessage, sendReaction,
                          #   borrado (clearHistory/deleteStoredPhotos/wipeAllContent),
                          #   notificaciones en 2.º plano + retención cada minuto
src/screens/
  OnboardingScreen.js     # vínculo + invitación (envía enlace de descarga)
  ChatScreen.js           # chat sobre useP2P(): texto, fotos, audio y vídeo,
                          #   estados ✓/✓✓/⭕, hoja de reacciones y citar (long-press)
  ProfileScreen.js        # datos reales + invitación + borrado + desvincular
                          #   + sección «Privacidad de la app» (PIN/huella/ocultos/
                          #   pantalla discreta/auto-destrucción)
  Games/TruthDare/Challenge/Dice/QuestionsScreen  # juegos (estado compartido)
src/components/ChallengeDeck.js  # base de juegos con estado compartido + «Terminar juego»
src/components/LockScreen.js     # pad numérico PIN (crear/desbloquear) + huella
src/components/StealthScreen.js  # pantalla discreta: falsa «Notas»
test/duo-test.mjs         # 146 verificaciones (incluye bloqueo/cofre, chat
                          #   estructurado, auto-destrucción, juego y versiones)
```

### Reglas del protocolo (no romper)

1. **Transporte relay**: los temas son hashes. `duo/v2/pair/<hash>` (vinculación,
   derivado del secreto `ps`) y `duo/v2/chat/<hash>` (chat, derivado del
   `coupleId`); `hash = sha256(duo-relay-v1|<prefix>|<input>)` → **22 hex**.
   Sin las claves no se pueden adivinar.
2. **E2E encima del transporte**: toda trama con contenido va cifrada con
   `derivePairingKey` (pareo) o `deriveShared` X25519 (sesión). El handshake
   `auth` exige la clave privada correcta; el broker solo ve bytes ilegibles.
   **El estado del juego** (`game`), sus **respuestas** (`reply` dentro del
   marco de juego) y los **archivos** (audio/vídeo, `file-*`) también van
   cifrados E2E.
3. **Sobre `{s, f}`**: cada publicación va envuelta con
   `buildEnvelope(selfId, frame)`; el receptor hace `parseEnvelope` y descarta el
   mensaje si `env.s === selfId` (**ignora el eco propio** que devuelve el
   broker). `selfId = selfIdFor(miClavePública)`.
4. **coupleId local en ambos lados**: `duo-` + hex(sha256(`duo-couple-v1|pubA|`
   pubB` ordenadas)). Nunca viaja por la red.
5. **Emoji por clave**: `emojiForPub(pub)` es la única fuente de emojis en
   sesiones/pareo (consistente entre los dos teléfonos).
6. **Bandeja y estados**: todo mensaje/foto se persiste `pending` y se
   **reintenta cada 12 s** mientras estás en línea, hasta recibir el ACK
   (`ack`). En la burbuja se marca ⏳ (en cola), ✓ (enviado al relay), ✓✓ (ACK
   de la pareja) o ⭕ (fallo con reintento manual). **Con el cofre cerrado no
   se envía ACK** (v0.7.0): así la pareja reintenta y nada se pierde por llegar
   con la app bloqueada.
7. **Citas y reacciones (`chatcodec.js`)**: el texto normal se envía **tal
   cual** (compatibilidad); las citas y reacciones viajan como JSON con la
   marca `__duo` v1 dentro del propio texto y `decodeChat` las interpreta
   (invirtiendo la perspectiva del citado). Un JSON sin marca o con versión
   desconocida se muestra como texto normal. Las reacciones se guardan por
   mensaje con su lado (mía / de la pareja).
8. **Archivos (foto/audio/vídeo)**: cifrar SIEMPRE en origen; **tope duro de
   6 MB** (`MAX_FILE_BYTES` en `P2PContext`, comprobado con el tamaño REAL
   antes de leer nada en memoria — si pesa más se avisa y no se envía);
   trocear en chunks de 48000 chars de base64 y enviar **con el generador
   `iterFileFrames` y ~20 ms de pausa entre tramas** (nunca construir el
   array entero ni publicar en bucle síncrono: congela la interfaz); tramas
   `file-meta`/`file-chunk` con `kind` (photo/audio/video) y `ext`; el
   ensamblador (`PhotoAssembler`) deduplica por `id`, **descarta metas con
   trozos fuera de rango** (`MAX_FILE_CHUNKS`) e índices inválidos; y una fila
   con envío en curso (`sendingRef`) **no se relanza** desde la cola de
   reintentos (duplicar la transmisión corrupta el ensamblado: dos nonces
   distintos mezclados).
9. **QR de vínculo v2** (5 campos, corto y sin direcciones):
   `duo:pair:v2:<pub_b64url>:<ps_b64url>`. `parsePairQr()` (en `relayproto.js`,
   puro) devuelve `null` con cualquier otra cosa, incluido el QR antiguo de 7
   campos.
10. **Broker**: se prueban los 3 de `MQTT_BROKERS` en orden hasta que uno
    responda; el cliente MQTT es QoS 0 (sin persistencia: la fiabilidad la da la
    bandeja + ACK) y se reconecta con backoff.
11. **Juegos compartidos**: se sincronizan por las tramas `game` (payload con
    `k: start|level|draw|reply|sync|end`, cifrado E2E). `App.js` usa un
    `navigationRef` para **abrir solo** la pantalla del juego cuando llega un
    `start`; el host reenvía `sync` cada 6 s (baliza, **con el hilo de
    respuestas**); «Terminar juego» envía `end` y limpia la sesión en ambos
    lados. **Cualquiera de los dos puede responder**: `sendGameReply` envía la
    respuesta como `reply` dentro del marco de juego (hilo `GameThread`), también
    cifrada E2E. Los juegos están pensados para la **distancia** (se cumplen por
    chat/audio/foto/videollamada).

### Flujo de vinculación por relay

Toda la vinculación viaja por el tema `duo/v2/pair/<hash>` y no requiere estar en
la misma red:

1. **A** «Crear vínculo» → `Relay.startPairing()` genera un secreto `ps`, se
   suscribe al tema y muestra el **QR corto** + «📤 Compartir el código».
2. **B** escanea el QR o **pega** el código → `joinPairing()` → se suscribe al
   mismo tema y publica `pair-req` cifrado con `HKDF(ps)` (reintenta cada 3 s).
3. **A** recibe un `Alert` «Solicitud de vínculo» con nombre, emoji y **SAS de 6
   dígitos** → acepta/rechaza.
4. **A** publica `pair-ok` con nombre/emoji/coupleId; **B** lo recibe y ambos
   guardan `duo.session`. `protocol.js` aporta las tramas
   (`buildPairReq`/`verifyPairReq`/`buildPairOk`/`verifyPairOk`).

### Dependencias (cuidado)

- Instalar paquetes Expo con `npx expo install` (respeta SDK 52). Actuales:
  `expo-camera@~16.0.18`, `expo-crypto@~14.0.2`, `expo-image-manipulator@~13.0.6`,
  `react-native-svg@15.8.0`, `react-native-qrcode-svg`, `expo-av` (notas de
  voz y vídeo del chat), `expo-notifications@~0.29.14` (avisos con la app
  cerrada, v0.7.0) y `expo-local-authentication@~15.0.2` (huella, v0.7.0).
- **Ya no hay módulos nativos de red**: el transporte usa el **WebSocket global**
  y `mqttws.js` implementa MQTT a mano sin dependencias. Se retiraron las
  dependencias nativas de red anteriores.
- **Autolinking solo mira un nivel** bajo `node_modules`: verificar que ninguna
  lib nativa quede anidada (`npm ls <pkg>`).
- `newArchEnabled: false` en `app.json` (configuración actual; ya no responde a
  módulos nativos).
- Permisos en `app.json`: `RECORD_AUDIO` y `READ_MEDIA_VIDEO` (notas de voz y
  vídeos del chat) y `USE_BIOMETRIC` + `POST_NOTIFICATIONS` (huella y avisos,
  v0.7.0).
- `@babel/register` debe ser **7.x** (devDependency, para `npm test`).
- socket.io-client, api.js, socket.js, `duo-server/` y el `config.js` viejo de la
  API fueron eliminados: **no reintroducir servidor propio ni `fetch` a una API**.
  (El `src/config.js` actual es solo de enlaces/invitación, sin claves ni API.)

### Brokers MQTT (públicos y gratuitos)

`MQTT_BROKERS` en `mqttws.js`, probados en orden con reintento:

```
wss://broker.emqx.io:8084/mqtt
wss://broker.hivemq.com:8884/mqtt
wss://test.mosquitto.org:8081/mqtt
```

QoS 0; ping keepalive cada `keepAlive - 10` s; reconexión con backoff
(1 s → máx. 15 s) re-suscribiendo los temas; `Relay.wake()` fuerza un intento
inmediato al volver la app a primer plano.

## Pantallas y datos

- `src/data/mock.js` reexporta los pools de juegos y solo alimenta juegos/demo
  (el chat NO usa mocks): `pool-retos.js`, `pool-truths.js`, `pool-dares.js`,
  `pool-dados.js` y `pool-preguntas.js`, cada uno con **22 opciones únicas por
  nivel × 5 niveles = 110 ítems** (los tests exigen ≥ 20 por nivel y por juego).
  Contiene **5 niveles** (`challengeLevels`: Suave · Romántico · Picante ·
  Atrevido · Íntimo **+18**, escalada 1→5) y `challenges`/`truths`/`dares`/
  `diceChallenges` **indexados por nivel** (claves 1..5); «Para Conocernos»
  ahora también tiene selector de nivel. Los juegos se comparten por el relay;
  el estado vivo vive en `P2PContext` (`gameSession`).
- `src/config.js` expone `APP_DOWNLOAD_URL` (`…/releases/latest/download/duo.apk`,
  nombre estable) e `INVITE_MESSAGE` para invitar a la pareja a instalar la app.
- `src/services/updatecheck.js` + `src/services/version.js` comparan la versión
  instalada (`app.json`) con el `latest` de GitHub Releases y muestran
  `UpdateModal` (cooldown de 6 h; no insisten con una versión ya descartada;
  botón que abre la descarga).
- Tema: `src/theme.js` (fondo `#0E0B14`, acentos `#FF4D6D`/`#FF6B8B`).
- Errores a tiros largos: pantalla blanca en release = excepción JS sin
  redbox; hay detectores `check-imports.cjs` / `check-idents.cjs` en el temp
  de opencode.

## Verificación antes de dar por bueno un cambio

```bash
npm test                          # 146 ok
npx expo export --platform android --output-dir dist   # bundle ok
```

Y revisar `git status` (nada de temporales tipo `.tmp-test-*` ni `dist/`).

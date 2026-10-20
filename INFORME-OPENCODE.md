# Informe para opencode — Proyecto Duo 💞

> Documento de traspaso (handoff). Describe **qué se está haciendo**, el estado
> actual, y **paso a paso para correr todo desde una PC y generar los APK**.
>
> Este archivo está pensado para que un agente de opencode (u otro dev) retome el
> trabajo sin contexto previo.

Última actualización: 20 de octubre de 2026

---

## 0) Resumen ejecutivo

**Duo** es una app privada para parejas (solo 2 personas vinculadas) que incluye
chat privado entre los dos teléfonos, envío de **fotos, audio y vídeo**,
**juegos/retos compartidos sincronizados entre los dos** (por niveles, con
**respuestas dentro del juego**) y cifrado extremo a extremo (E2E) de textos,
fotos, audio/vídeo y estado del juego.

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
- [x] **Audio, vídeo y cámara en el chat** (v0.6.0): fotos tomadas con la cámara
      del propio móvil (además de las de la galería), **notas de voz** grabadas
      y reproducidas dentro del chat (`expo-av`; permisos `RECORD_AUDIO` y
      `READ_MEDIA_VIDEO`) y **vídeos cortos** desde la cámara o la galería
      (aviso si pesan más de 6 MB). Todo cifrado en origen y troceado por el
      canal con tramas `file-meta`/`file-chunk` (con `kind` = photo/audio/video
      y `ext`), ensambladas con `PhotoAssembler` y descifradas en el otro
      teléfono. Burbujas reproductoras: audio con play/pausa, vídeo con visor a
      pantalla completa.
- [x] **Juegos compartidos** (v0.5.0): el estado del juego se sincroniza con la
      pareja por el relay cifrado (marco `game` en `protocol.js`); al iniciar un
      juego se envía un `start` y la app **abre sola** esa pantalla en el otro
      teléfono. Nivel y reto son comunes; el anfitrión **reenvía el estado cada
      6 s** (baliza) y «Terminar juego» acaba en los dos.
- [x] **Respuestas dentro de los juegos** (v0.6.0): cualquiera de los dos puede
      responder el reto/pregunta; las respuestas forman un **hilo
      (`GameThread`)** sincronizado en los dos teléfonos (trama `reply` cifrada
      dentro del marco de juego —`sendGameReply` en `P2PContext`—; la baliza de
      `sync` incluye el hilo).
- [x] **5 niveles** de juegos/retos (🌸 Suave · 💞 Romántico · 🌶️ Picante ·
      🔥 Atrevido · 😈 Íntimo **+18**), elegidos antes de jugar y sincronizados;
      `challenges`/`diceChallenges`/`truths`/`dares` indexados por nivel y
      pensados para la distancia (chat, audio, foto o videollamada).
- [x] **Contenido de juegos ampliado** (v0.6.0): 5 pools nuevos
      (`src/data/pool-retos.js`, `pool-truths.js`, `pool-dares.js`,
      `pool-dados.js`, `pool-preguntas.js`), cada uno con **22 opciones únicas
      por nivel × 5 niveles = 110 ítems** (los tests exigen ≥ 20 por nivel y por
      juego). «Para Conocernos» ahora también tiene selector de nivel;
      `mock.js` reexporta los pools.
- [x] **Invitación con enlace de descarga** (`src/config.js`, `INVITE_MESSAGE`):
      botón para compartir el enlace del APK en el onboarding, en Juegos y en el
      Perfil, para invitar a la pareja aunque todavía no tenga la app.
- [x] **Borrado de contenido** local (con confirmación): `clearHistory()`,
      `deleteStoredPhotos()` y `wipeAllContent()`; «Desvincular» también confirma.
      Aviso de que solo borra la copia local (la de la pareja no se toca).
- [x] **Aviso de actualizaciones in-app** (v0.6.0): `src/services/updatecheck.js`
      y `src/services/version.js` comparan la versión instalada (`app.json`) con
      el `latest` de GitHub Releases; `UpdateModal` al abrir la app o volver a
      primer plano, con **cooldown de 6 horas** y sin insistir con una versión ya
      descartada; botón que abre la descarga (`…/releases/latest/download/duo.apk`).
- [x] **Estabilidad del envío de archivos** (v0.7.1, auditoría tras el reporte
      de que enviar un vídeo congelaba la app y generaba errores): **tope duro
      de 6 MB** comprobado con el tamaño real (`FileSystem.getInfoAsync`, sin
      leer el archivo en memoria) y **rechazo con aviso claro** si pesa más;
      envío **paginado trozo a trozo** con `iterFileFrames` (generador con ~20
      ms de pausa entre tramas: la interfaz respira y el socket drena; antes
      los ~170 trozos se publicaban en bucle síncrono y bloqueaban la app);
      **guardia de envío en curso** (`sendingRef` en `dispatchRow`/
      `flushOutbox`/`retryMessage`: la cola de reintentos no relanza un
      archivo a medio enviar — antes duplicaba la transmisión y el receptor
      mezclaba trozos de dos cifrados distintos → vídeo corrupto que nunca
      aparecía); receptor con **topes** (`MAX_FILE_CHUNKS` e índices de trozo
      válidos); auto-destrucción que **borra también los archivos locales**
      caducados; tests **141 → 146**.
- [x] **Estados de entrega en el chat** (v0.7.0): ⏳ en cola, ✓ enviado al
      relay, ✓✓ confirmado por la pareja y ⭕ con **reintento manual**
      (`retryMessage`); la bandeja reintenta sola cada 12 s. Burbuja con la
      marca correspondiente (`deliveryState`/`STATE_MARK` en `chatcodec.js`).
- [x] **Citas y reacciones** (v0.7.0): mantener pulsado un mensaje abre una
      hoja con **6 reacciones** (😍😘🔥😂🥺❤️) y **«Responder»** (cita con
      vista previa). Codificación en `chatcodec.js`: el texto normal sale **tal
      cual** (compatibilidad con versiones antiguas) y las citas/reacciones
      viajan como JSON con la marca `__duo` v1 dentro del propio texto. Las
      reacciones se guardan por mensaje con su lado (mía / de la pareja).
- [x] **Bloqueo de la app** (v0.7.0): **PIN de 4-6 dígitos** (resumen con sal
      aleatoria, nunca el PIN) y/o **huella** (`expo-local-authentication`,
      `applock.js`). «Solo PIN» activa el **cifrado de la copia local**
      (`localvault.js`: clave derivada del PIN con HKDF + AES-GCM); la copia no
      se toca hasta desbloquear y los **ACK se suprimen** mientras el cofre
      esté cerrado (la pareja reintenta y no se pierde nada). «PIN + huella» =
      huella sin cifrado. «¿Olvidaste el PIN?» borra la copia local y permite
      crear uno nuevo. `LockScreen` (pad numérico) y `PrivacyGate` en `App.js`.
- [x] **Privacidad configurable** (v0.7.0): **avisos ocultos** (canal
      `duo-mensajes` de prioridad alta con contenido oculto: «Tienes un mensaje
      nuevo 🔒»; por defecto activos al crear el bloqueo), **pantalla
      discreta** (`StealthScreen`: vista falsa de «Notas» al ir a segundo
      plano), **auto-destrucción** local (Nunca/7/30/90 días, `retention.js`,
      comprobada cada minuto) y código de verificación con **marca «✓
      Comprobado»**. Todo en la sección «Privacidad de la app» del Perfil.
- [x] Persistencia de sesión + historial local cifrado en AsyncStorage (300
      últimos mensajes) + fotos descifradas en almacenamiento local.
- [x] Notificaciones locales en segundo plano (v0.7.0: también con la app
      cerrada, mediante `expo-notifications` y canal heads-up `duo-mensajes`).
- [x] Cifrado E2E: X25519 + HKDF-SHA256 + AES-256-GCM, módulos `@noble/*`.
- [x] Polyfill `crypto.getRandomValues` con RNG nativo (`expo-crypto`), cargado
      **antes** que cualquier otro módulo (`index.js`).
- [x] Pruebas: `duo-app/test/duo-test.mjs` → **`npm test`**, **146
      verificaciones, 0 fallos** (identidad/SAS, encuadre, auth E2E, QR v2,
      temas/sobre del relay, mensajes, fotos, **cifrado del estado del juego**
      —un tercero no lo descifra y el reto no viaja en claro; la pareja recibe el
      juego iniciado—, **respuestas de juego cifradas**, **troceado de audio/vídeo
      `file-*`** con **generador `iterFileFrames` y topes del ensamblador**,
      **comparación de versiones**, **contenido ≥ 20 por nivel y por
      juego**, **bloqueo y cofre** (sal/resumen del PIN, clave derivada, cofre
      ilegible con clave equivocada), **chat estructurado** (citas, reacciones,
      compatibilidad con texto plano), **auto-destrucción** (plazos y filtrado) y
      una sesión completa sobre un "bus" en memoria que imita al broker). Además
      sigue habiendo una prueba real contra el broker MQTT (fuera de la suite).
- [x] Bundle de Metro `expo export` verde (`--platform android`; Hermes, 4.23 MB).
- [x] APK por GitHub Actions en cada push a `main` que toque `duo-app/**`
      (`npm ci` → `npm test` → `expo prebuild` → `gradlew assembleRelease`).
- [x] Releases publicados: **v0.1.2** (versión con servidor), **v0.2.0**
      (primera versión P2P), **v0.3.0** (conexión por Internet sin servidor
      propio; app 0.3.0 / versionCode 3), **v0.4.0** (relay MQTT, app 0.4.0 /
      versionCode 4), **v0.5.0** (juegos compartidos + borrado + invitación +
      nivel Íntimo; app 0.5.0 / versionCode 5), **v0.6.0** (respuestas en juegos
      + audio/vídeo/cámara en el chat + contenido ampliado + aviso de
      actualizaciones; app 0.6.0 / versionCode 6) y **v0.7.0** (estados ✓/✓✓,
      citas y reacciones, bloqueo PIN/huella, cifrado local, avisos ocultos,
      pantalla discreta y auto-destrucción; app 0.7.0 / versionCode 7).

> Nota (20/10/2026): durante la sesión de v0.7.0 la carpeta `DuoProyecto`
> desapareció del escritorio con los cambios **sin commitear**; se **reclonó
> el repo desde GitHub** (base `676b9ac`, v0.6.0) y se **reaplicaron todos los
> cambios** desde el contexto de la sesión, verificados con tests (146/0) y
> bundle antes de commitear.

### Pendiente

- [ ] Probar en **dos celulares reales** el flujo completo por relay: crear/
      compartir/escanear/pegar el código, mensajes entrantes/salientes, fotos y
      entrega diferida (reintentos + ACK).
- [ ] Probar en **dos teléfonos** los **juegos compartidos**: que la pantalla se
      abra sola en la pareja, que nivel y reto se sincronicen y que «Terminar
      juego» cierre en los dos. Que el **hilo de respuestas** (`GameThread`) se
      sincronice en los dos.
- [ ] Probar en **dos teléfonos** el **borrado de contenido** y el **enlace de
      invitación** (descarga del APK `duo.apk`).
- [ ] Probar en **dos teléfonos** el **bloqueo** (PIN/huella, «¿Olvidaste el
      PIN?»), los **avisos ocultos**, la **pantalla discreta** y la
      **auto-destrucción** (solo borra lo vencido y no toca la copia de la
      pareja).
- [ ] Probar en **dos teléfonos** **citas, reacciones y estados ✓/✓✓/⭕**
      (incluida compatibilidad: una versión antigua debe ver el JSON como texto
      normal).
- [ ] v0.8.0: **llamadas WebRTC** (`react-native-webrtc` ya aprobado) con
      señalización por el mismo relay MQTT y STUN público.
- [ ] v0.9.0: **juegos y medios** (galería compartida, cuenta atrás
      sincronizada, progresión, selección múltiple de fotos, juegos nuevos).
- [ ] Más juegos/retos; publicar en Play Store.

---

## 2) Cómo funciona la conexión por relay (detalle)

### Archivos clave

| Archivo | Rol |
| ------- | --- |
| `duo-app/index.js` | Importa `src/services/polyfills.js` **primero** (RNG para Hermes). |
| `duo-app/App.js` | Navegación (stack + tabs) con un `navigationRef`: cuando llega un `start` de juego de la pareja (`incomingGame`), **navega solo** a la pantalla correspondiente (`GAME_ROUTES`), de modo que el juego aparece en los dos teléfonos. **v0.7.0**: `PrivacyGate` envuelve todo — pide PIN/huella al abrir (`LockScreen`) y monta `StealthScreen` (falsa «Notas») al ir a segundo plano si está activo. |
| `duo-app/src/config.js` | Datos **públicos**: `REPO_URL`, `RELEASES_URL`, `APP_DOWNLOAD_URL` (= `…/releases/latest/download/duo.apk`) e `INVITE_MESSAGE` (texto para invitar a la pareja). |
| `duo-app/src/data/pool-*.js` | Contenido de los juegos: `pool-retos.js`, `pool-truths.js`, `pool-dares.js`, `pool-dados.js` y `pool-preguntas.js`, cada uno con **22 opciones únicas por nivel × 5 niveles = 110 ítems** (los tests exigen ≥ 20 por nivel y por juego). `mock.js` los reexporta. |
| `duo-app/src/services/cryptocore.js` | Núcleo criptográfico **puro** (sin React Native): claves, cifrado, `deriveCoupleId`, código SAS, emoji por clave, secreto del QR. Testeable en Node. |
| `duo-app/src/services/protocol.js` | **Puro**: encuadre de tramas (prefijo de 4 bytes + JSON, máx. 8 MB), `auth`/`pair-req`/`pair-ok`/`msg`/`ack`/`ping`/`typing`/**`game`** (con `reply` dentro para el hilo de respuestas)/**`file-meta`**/**`file-chunk`**, troceo de archivos (48000 chars). `buildGame`/`readGame` cifran el estado del juego igual que el chat. |
| `duo-app/src/services/mqttws.js` | Cliente **MQTT 3.1.1 sobre WebSocket** mínimo y **sin dependencias** (no usa `Buffer`/`process`/`TextEncoder`). Publica/suscribe con QoS 0, ping keepalive y reconexión con backoff. `MQTT_BROKERS` con los 3 brokers. |
| `duo-app/src/services/relayproto.js` | Lógica **pura** del relay: temas (`duo/v2/pair/<hash>`, `duo/v2/chat/<hash>`), QR v2 (`duo:pair:v2:<pub>:<ps>`) y sobre `{s, f}`. |
| `duo-app/src/services/relay.js` | Transporte `Relay` por el broker público. **Misma API** que el antiguo P2P (`onEvent`/`configure`/`start`/`stop`/`wake`/`send`/`startPairing`/`joinPairing`/`acceptPairing`/`rejectPairing`/`cancelPairing`; eventos `status`/`session`/`frame`/`pair-request`/`paired`). Elige broker probando los 3 en orden. |
| `duo-app/src/services/crypto.js` | Wrapper de almacenamiento: guarda/carga el par de claves en AsyncStorage y re-exporta `cryptocore`. |
| `duo-app/src/services/version.js` | Lee la versión instalada (`app.json`) y compara versiones (semver). |
| `duo-app/src/services/updatecheck.js` | Comprueba el `latest` de GitHub Releases contra la versión instalada y propone el aviso `UpdateModal` (cooldown 6 h, sin insistir con una versión ya descartada; botón que abre la descarga). |
| `duo-app/src/services/chatcodec.js` | **Puro** (v0.7.0): citas y reacciones (`encodeText`/`encodeReaction`/`decodeChat`, marca `__duo` v1, inversión de perspectiva del citado) + estados de entrega (`deliveryState`/`STATE_MARK`: ⏳/⭕/✓/✓✓). |
| `duo-app/src/services/retention.js` | **Puro** (v0.7.0): auto-destrucción local — `TTL_OPTIONS` (Nunca/7/30/90), `parseTtlDays`, `isExpired`, `filterExpired`. |
| `duo-app/src/services/applock.js` | (v0.7.0) Bloqueo: `loadLockState`, `setupPin` (resumen con sal), `unlockWithPin`/`unlockWithBio`, huella (`setBioEnabled`/`enableBioOnly`), avisos ocultos, pantalla discreta, `onLockStateChange`. Con cifrado activo entrega la clave al cofre al desbloquear. |
| `duo-app/src/services/localvault.js` | (v0.7.0) Cofre de la copia local: `vaultGet`/`vaultSet`/`vaultRemove` cifrados con AES-GCM cuando hay clave; espera con `vaultReady()` y no escribe en claro si el modo aún no se conoce; `vaultIsReady()` para el gate de ACKs; `onVaultChange` para reescribir al cambiar de modo. |
| `duo-app/src/context/P2PContext.js` | Capa React: historial local (`duo.msgs.<coupleId>`), bandeja de salida, envío/recepción de **archivos** (fotos, audio y vídeo por `file-meta`/`file-chunk`, ensamblados con `PhotoAssembler`), acks/dedup, typing, notificaciones en 2.º plano, API de pareo, **estado del juego compartido** (`gameSession`, `startGame`, `setGameLevel`, `drawGame`, **`sendGameReply`** (hilo `GameThread`), `endGame`, `incomingGame`, `clearIncomingGame`; baliza cada 6 s **que incluye el hilo de respuestas**) y **borrado** (`clearHistory`, `deleteStoredPhotos`, `wipeAllContent`). Reintento periódico cada 12 s (`flushOutbox` en `flushRef`). **v0.7.0**: historial por el **cofre** (`vaultGet`/`vaultSet`), **estados ✓/✓✓/⭕** (`markSent`/`markFailed`/`retryMessage`), **`sendReaction`** y citas (`sendText(text, replyTo)` con `decodeChat` al recibir), **ACK suprimido con el cofre cerrado**, avisos ocultos y **limpieza por retención** cada minuto. **v0.7.1**: **tope de 6 MB por archivo** (aviso sin leer en memoria), envío **paginado con `iterFileFrames`** y guardia **`sendingRef`** (sin dobles envíos), borrado de archivos caducados. |
| `duo-app/src/context/E2EContext.js` | Expone las claves del dispositivo; `peerPub` = `session.partnerPub`. |
| `duo-app/src/screens/OnboardingScreen.js` | Un solo flujo de vínculo: `welcome` (crear / escanear / pegar + **«📲 Enviar el enlace de descarga a mi pareja»**), `create` (QR de 240 px + «📤 Compartir el código» vía `Share`), `paste`, `scan` y `joining` (spinner + SAS). |
| `duo-app/src/screens/ChatScreen.js` | Chat sobre `useP2P()` (sin api/socket). Texto, fotos (galería o cámara), notas de voz y vídeos cortos; fotos con `expo-image-manipulator` (1280 px, JPEG 0.7) antes de cifrar. Audio/vídeo van por `file-meta`/`file-chunk` y se reproducen en burbujas (audio play/pausa, vídeo con visor a pantalla completa). El botón del candado explica el cifrado. **v0.7.0**: marcas ⏳/⭕/✓/✓✓ (con reintento manual), **hoja de reacciones y responder** al mantener pulsado, barra de cita y vista previa del citado. |
| `duo-app/src/components/ChallengeDeck.js` | Base común de los juegos con botones: lee/escribe el **estado compartido** (nivel y reto) en vez de sortear localmente; botón «Terminar juego». |
| `duo-app/src/components/LockScreen.js` | (v0.7.0) Pad numérico PIN (4-6 dígitos): `mode="unlock"` (con huella si no hay PIN; «¿Olvidaste el PIN?» borra la copia local) y `mode="create"` (introduce + confirma) para el Perfil. |
| `duo-app/src/components/StealthScreen.js` | (v0.7.0) Vista falsa de «Notas» que tapa la app al ir a segundo plano (pantalla discreta). |
| `duo-app/src/screens/ProfileScreen.js` | Perfil con **datos reales** (nº de mensajes/fotos), invitación + enlace de descarga y **borrado** (historial, fotos, todo) + desvincular, todo con confirmación. **v0.7.0**: sección «Privacidad de la app» (PIN/huella/avisos ocultos/pantalla discreta/auto-destrucción), modal de creación de PIN (`LockScreen mode="create"`) y código de verificación con «✓ Comprobado». |
| `duo-app/test/duo-test.mjs` | Pruebas (**146 verificaciones, 0 fallos**): copia `cryptocore.js`/`protocol.js`/`relayproto.js`/`version.js`/`chatcodec.js`/`retention.js` a temporales `.mjs` y los importa en Node; incluye cifrado del estado del juego, respuestas de juego cifradas, troceado de audio/vídeo (`file-*`) con generador `iterFileFrames` y topes del ensamblador, comparación de versiones, contenido ≥ 20 por nivel y por juego, **bloqueo/cofre, chat estructurado y auto-destrucción**, y una sesión completa sobre un "bus" en memoria que imita al broker. |

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
Payload:         { k: "start"|"level"|"draw"|"reply"|"sync"|"end", gameId, level, prompt, mode }
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
6. **Respuestas dentro del juego** (v0.6.0): cualquiera de los dos puede
   responder con `sendGameReply`; la respuesta viaja como `k: "reply"` (trama
   `reply` cifrada dentro del marco `game`) y forma un **hilo (`GameThread`)**;
   la **baliza `sync` reenvía el hilo**, así los dos teléfonos ven las mismas
   respuestas.

### Cifrado de mensajes

- Mensaje: `encryptText(text, miPriv, pubPareja)` dentro de la trama `msg`.
- Juego: `buildGame(payload, miPriv, pubPareja)` cifra el estado del juego
  (nivel/reto **y las respuestas del hilo**) dentro de la trama `game`;
  `readGame` lo descifra en la pareja. El broker nunca ve a qué jugáis ni el
  reto.
- Archivos (foto/audio/vídeo): archivo → copia temporal → `encryptBytes` →
  troceado (chunks de 48000 chars) → tramas `file-meta` + `file-chunk[i]` (con
  `kind` = photo/audio/video y `ext`) → al completar, `PhotoAssembler` devuelve
  meta → descifra → foto como `duo_<id>.jpg` local; audio/vídeo como burbuja
  reproductora (play/pausa y visor a pantalla completa). Los vídeos avisan si
  superan 6 MB.
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
npm test              # 146 verificaciones (protocolo + relay + cifrado E2E + juego + archivos + versiones + bloqueo + chat estructurado + auto-destrucción)
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
  fiabilidad. Cualquiera de los dos puede responder dentro del juego: el hilo
  (`GameThread`) viaja cifrado dentro del mismo marco `game` y la baliza lo
  reenvía.
- **Aviso de actualizaciones sin servidor**: `updatecheck.js` + `version.js`
  comparan la versión instalada (`app.json`) con el `latest` de GitHub Releases
  y muestran `UpdateModal` (cooldown de 6 h; no insisten con una versión ya
  descartada), con botón a la descarga estable `duo.apk`.
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
npm test                          # protocolo + relay (146 ok)
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
    verificaciones** (app `0.5.0`, versionCode `5`). **Publicada.**
  - `v0.6.0` — **respuestas dentro de los juegos** (hilo `GameThread` cifrado y
    sincronizado en los dos teléfonos), **audio, vídeo y cámara en el chat**
    (notas de voz, fotos con la cámara y vídeos cortos, todo E2E por
    `file-meta`/`file-chunk`), **contenido de juegos ampliado** (5 pools con 110
    ítems por juego: 22 por nivel × 5 niveles), **aviso de actualizaciones
    in-app** (cooldown 6 h) y tests a **103 verificaciones, 0 fallos** (bundle
    Hermes Android 4.18 MB; app `0.6.0`, versionCode `6`). **Publicada.**
  - `v0.7.0` — **impacto inmediato + privacidad**: **estados de entrega**
    (⏳/✓/✓✓/⭕ con reintento manual), **citas y reacciones** (JSON `__duo` v1,
    compatible con versiones antiguas), **bloqueo con PIN/huella** (PIN con sal,
    huella solo sin cifrado, «¿Olvidaste el PIN?»), **cifrado de la copia
    local** (clave derivada del PIN; ACK suprimido con el cofre cerrado),
    **avisos ocultos**, **pantalla discreta** (falsa «Notas»),
    **auto-destrucción** (Nunca/7/30/90 días) y «✓ Comprobado» en el código
    SAS; permisos `USE_BIOMETRIC`/`POST_NOTIFICATIONS`, deps `expo-notifications`
    + `expo-local-authentication` y tests a **141 verificaciones, 0 fallos**
    (bundle Hermes Android 4.23 MB; app `0.7.0`, versionCode `7`).
    **Publicada.**
  - `v0.7.1` — **estabilidad del envío de archivos** (auditoría tras el reporte
    de vídeos que congelaban la app): **tope duro de 6 MB** con aviso (tamaño
    real vía `getInfoAsync`, sin leer en memoria), envío **trozo a trozo con
    pausa** (`iterFileFrames`, generador), **guardia de envío en curso**
    (sin duplicados que corrupten el ensamblado), receptor blindado contra
    metas/trozos fuera de rango y auto-destrucción que **borra también los
    archivos locales**; tests **146 verificaciones, 0 fallos** (bundle Hermes
    Android 4.23 MB; app `0.7.1`, versionCode `8`). **Publicada.**
- Tras cambiar dependencias: commit + push y la CI (Actions → Build APK)
  compila y sube el artefacto; descargarlo y publicarlo en el Release.

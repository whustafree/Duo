# Manifiesto del Proyecto — Duo 💞

Documento que describe **qué estamos haciendo**, cómo está armado y qué falta.

Fecha: 19 de octubre de 2026

---

## 1. Qué es

**Duo** es una app privada para **parejas** (solo 2 personas vinculadas). Permite:

- Chat privado entre los dos teléfonos a través de un **broker MQTT público y
  gratuito**: **no hay servidor propio ni de pago**; el broker solo hace de
  cartero.
- Envío de **fotos** (de la galería o con la cámara del propio móvil),
  **notas de voz** y **vídeos cortos**, todo cifrado y troceado por el mismo
  canal (aviso si un vídeo pesa más de 6 MB).
- Vinculación con un **código corto** que se puede **escanear (QR)** o **pegar**,
  con código de verificación de 6 dígitos.
- **Funciona siempre y desde cualquier red**: misma WiFi o datos móviles,
  incluido NAT estricto, sin estar juntos, sin abrir puertos y sin pagar nada.
- **Juegos y retos** para mejorar/acercar la relación, con 5 niveles de
  intensidad: 🌸 Suave · 💞 Romántico · 🌶️ Picante · 🔥 Atrevido · 😈 Íntimo
  (+18, el más hot). Los juegos están pensados **para la distancia**: los retos
  se cumplen por chat, audio, foto o videollamada. Cada juego tiene **110 ítems**
  (22 opciones por nivel × 5 niveles).
- **Juegos compartidos**: al abrir un juego se **sincroniza con la pareja** por
  el mismo canal cifrado, así que la partida (nivel y reto) aparece en los **dos
  teléfonos** a la vez. **Cualquiera de los dos puede responder** el reto o la
  pregunta: las respuestas forman un **hilo (`GameThread`)** sincronizado en los
  dos teléfonos.
- **Cifrado extremo a extremo (E2E)** de textos, fotos, audio, vídeo **y del
  estado del juego**: X25519 + HKDF-SHA256 + AES-256-GCM. Lo que viaja por la
  red son bytes ilegibles; **ni el broker puede leer nada** (tampoco a qué jugáis
  ni el reto).
- **Invitación con enlace de descarga**: se puede invitar a la pareja aunque
  todavía no tenga la app (botón en el onboarding, en Juegos y en el Perfil).
- **Aviso de actualizaciones in-app**: al abrir la app (o volver a primer
  plano) se compara la versión instalada con la última de GitHub Releases y, si
  hay una más nueva, aparece un aviso para descargarla (cooldown de 6 horas).
- **Borrado de contenido** local: historial de chat, fotos guardadas o todo, con
  confirmación (solo borra tu copia; la de tu pareja no se toca).
- Persistencia de sesión (no hay que revincular cada vez).
- Notificaciones locales al recibir mensajes en segundo plano.

> Los retos están pensados para **parejas adultas y consentidas**. La app no
> incluye contenido explícito; los niveles "Atrevido" e "Íntimo" (+18) son una
> invitación, no contenido gráfico.

---

## 2. Estructura del proyecto

```
duo-app/      → App móvil (React Native + Expo SDK 52)
                (antes había un duo-server/; fue eliminado: no hay servidor propio)
```

### duo-app (app móvil)

```
duo-app/
├── App.js                  # Navegación (stack + tabs), providers, splash
│                           #   + navigationRef: abre solo la pantalla del juego
│                           #     que inicia la pareja
├── index.js                # Instala el polyfill de Web Crypto antes que nada
├── app.json                # Config Expo (nombre, permisos, plugins, cámara y audio)
├── eas.json                # Perfiles de build (APK/AAB)
├── babel.config.js
├── package.json            # incluye "npm test" → pruebas del protocolo (relay)
├── test/
│   └── duo-test.mjs        # 103 verificaciones, 0 fallos (relay + cifrado E2E + juego + archivos + versiones + bus en memoria)
└── src/
    ├── theme.js            # Colores, espaciados, tipografía
    ├── config.js           # Enlaces públicos (repo, releases, descarga) e invitación
    ├── data/mock.js        # Datos de juegos/demo; reexporta los pools por nivel
    ├── data/pool-retos.js  # Pools de juegos: 22 opciones únicas por nivel
    ├── data/pool-truths.js #   × 5 niveles = 110 ítems por juego
    ├── data/pool-dares.js
    ├── data/pool-dados.js
    ├── data/pool-preguntas.js
    ├── context/
    │   ├── SessionContext.js   # Sesión de la pareja (AsyncStorage)
    │   ├── E2EContext.js       # Claves de cifrado del dispositivo
    │   └── P2PContext.js       # Transporte relay + historial local + bandeja
    │                           #   + estado del juego compartido + borrado
    ├── services/
    │   ├── polyfills.js        # crypto.getRandomValues para Hermes (nativo)
    │   ├── cryptocore.js       # Núcleo criptográfico PURO (X25519/AES/GCM,
    │   │                       #   coupleId, código SAS, emojis) — testeable en Node
    │   ├── crypto.js           # Guarda/carga el par de claves en AsyncStorage
    │   ├── protocol.js         # Tramas, auth, emparejamiento, msgs, fotos, game (PURO)
    │   ├── mqttws.js           # Cliente MQTT 3.1.1 sobre WebSocket (sin deps)
    │   ├── relayproto.js       # Lógica PURA del relay: temas, QR v2 y sobre
    │   ├── relay.js            # Transporte relay por broker público (API tipo P2P)
    │   ├── notifications.js    # Notificaciones locales
    │   ├── version.js          # Versión instalada (app.json) + comparación semver
    │   └── updatecheck.js      # Compara con el latest de GitHub Releases (cooldown 6 h)
    ├── components/{Avatar,PrimaryButton,ChallengeDeck}.js
    │                           #   ChallengeDeck: lee/escribe el estado compartido
    └── screens/
        ├── OnboardingScreen.js # Vincular por QR/código pegado + SAS + invitación
        ├── ChatScreen.js       # Chat + fotos/audio/vídeo + typing (todo por relay)
        ├── GamesScreen.js      # Lista de juegos + invitación con enlace
        ├── TruthDareScreen.js  # Verdad o Reto (estado compartido)
        ├── ChallengeScreen.js  # Ruleta de Retos (estado compartido)
        ├── DiceScreen.js       # Dados del Deseo (estado compartido)
        ├── QuestionsScreen.js  # Para Conocernos (estado compartido)
        └── ProfileScreen.js    # Perfil + datos reales + borrado + desvincular
```

---

## 3. Cómo funciona (flujo por relay)

### Vinculación (una sola vez)

1. **Teléfono A**: escribe su nombre → **Crear vínculo** → el creador genera un
   secreto (`ps`), se suscribe al tema de vinculación y muestra un **QR corto**
   junto a un botón «📤 Compartir el código» (para enviarlo p. ej. por WhatsApp).
2. **Teléfono B**: **Escanear el QR de mi pareja** o **Pegar un código** → se une
   al mismo tema y publica un `pair-req` cifrado con una clave derivada del
   secreto del QR.
3. A recibe una alerta **«Solicitud de vínculo»** con el nombre, el emoji y un
   **código de verificación de 6 dígitos** (SAS) que debe coincidir con el de la
   pantalla de B → **Aceptar**.
4. A responde `pair-ok`; ambos derivan el mismo `coupleId` a partir de sus dos
   claves públicas y quedan vinculados. Las claves privadas nunca salen de cada
   dispositivo.

### Mensajes (a diario)

1. Cada teléfono se conecta a un **broker MQTT público y gratuito** (se prueban
   los 3 de la lista en orden hasta encontrar uno que responda) y se suscribe al
   tema de chat de la pareja (`duo/v2/chat/<hash>`).
2. Cada mensaje se publica en ese tema envuelto en un sobre `{s, f}`
   (identificador del emisor + trama) y **cifrado E2E**; el broker solo reenvía
   bytes ilegibles. El sobre permite **ignorar el eco propio** (el broker devuelve
   a cada uno lo que publica).
3. Si la pareja está desconectada, el mensaje queda **pendiente en el
   dispositivo** y se **reintenta cada 12 s** mientras estás en línea, hasta
   recibir el **ACK** de entrega. Así la entrega diferida es fiable aunque el
   otro esté sin conexión un rato.
4. Además de texto, el chat admite **fotos** (de la galería o con la cámara),
   **notas de voz** y **vídeos cortos** (aviso si pesan más de 6 MB): se cifran
   en el dispositivo, se trocean (`file-meta`/`file-chunk`, con `kind` y `ext`)
   y el receptor los ensambla (`PhotoAssembler`), los descifra y muestra como
   burbuja reproductora (audio con play/pausa, vídeo a pantalla completa).

### Juegos compartidos (a distancia)

1. Cuando uno abre un juego (Verdad o Reto, Ruleta de Retos, Dados del Deseo o
   Para Conocernos), la app envía un `start` **cifrado** con el identificador del
   juego y el nivel; la pareja lo recibe y su teléfono **abre esa pantalla solo**
   (el juego aparece en los dos a la vez).
2. **El nivel se elige antes de jugar** (5 niveles: 🌸 Suave · 💞 Romántico ·
   🌶️ Picante · 🔥 Atrevido · 😈 Íntimo +18) y se **sincroniza** con la pareja
   (todos los juegos, incluido «Para Conocernos», que ahora también tiene
   selector de nivel).
3. Al pedir el siguiente reto, el estado del juego (`draw`: nivel + reto + modo)
   viaja cifrado igual que el chat, de modo que **los dos ven el mismo reto**.
4. El anfitrión **reenvía el estado cada 6 s** (una "baliza") para que la pareja
   lo vea aunque se pierda algún mensaje. El botón **«Terminar juego»** termina
   la partida para los dos y vuelve atrás.
5. Todo el estado del juego va **cifrado E2E**: el broker nunca sabe a qué jugáis
   ni qué reto os ha tocado.
6. **Respuestas dentro del juego**: cualquiera de los dos puede responder el
   reto o la pregunta; la respuesta viaja como trama `reply` cifrada **dentro
   del marco de juego** (`sendGameReply` en P2PContext) y forma un **hilo
   (`GameThread`)** que la baliza de `sync` reenvía, de modo que el hilo se ve
   sincronizado en los dos teléfonos.

### Requisitos de uso

- **Solo necesitas Internet** (misma WiFi o datos móviles, también con NAT
  estricto). No hace falta que los dos estén en la misma red, ni juntos, ni abrir
  puertos.
- Con la **app abierta** para recibir en vivo; lo acumulado se entrega al volver
  (bandeja de salida + reintentos + ACK).

> El broker es solo un intermediario: **no hay servidor propio ni de señalización
> ni de pago**. Como todo va cifrado de extremo a extremo, el broker no puede leer
> el contenido; solo ve metadatos mínimos (los temas —hashes—, el tamaño de los
> paquetes y los horarios), nunca los mensajes ni las fotos.

---

## 4. Cómo correrlo

### App (desarrollo)

```bash
cd duo-app
npm install
npm test           # pruebas del protocolo y del relay (103 verificaciones)
npx expo start     # escanea el QR con Expo Go
```

> El transporte por relay usa el **WebSocket global** (presente en React Native
> / Hermes) y el cliente MQTT es propio y **sin dependencias nativas**, así que
> ya no hacen falta módulos nativos de red. Para probar el flujo completo se
> recomienda igualmente un **development build** o el APK.

### Generar APK

```bash
# Opción A (recomendada): GitHub Actions — cada push a main que toque duo-app/
#   → Actions → Build APK → artefacto duo-apk
# Opción B: EAS
cd duo-app && eas build -p android --profile preview
```

> La **Release** en GitHub incluye el APK con un nombre **estable `duo.apk`**
> (además del nombre con número), de modo que el enlace
> `https://github.com/whustafree/Duo/releases/latest/download/duo.apk` (usado por
> la invitación dentro de la app) siempre apunta a la última versión.

---

## 5. Estado actual (qué ya está hecho)

Versión actual: **0.6.0** (versionCode 6). Los juegos son **compartidos** y van
cifrados (ahora con respuestas dentro de los juegos), el chat admite audio,
vídeo y fotos de cámara, hay aviso de actualizaciones, borrado de contenido y
enlace de invitación; la Release **v0.5.0** sigue pendiente de compilar y
publicar.

- [x] Maqueta completa de UI (todas las pantallas).
- [x] **Sin servidor propio ni de pago**: chat/fotos/vinculación a través de un
      **broker MQTT público gratuito** que solo hace de cartero; el contenido va
      cifrado E2E.
- [x] Vinculación por **QR o código pegado** (5 campos, `duo:pair:v2:…`) +
      confirmación con **código SAS de 6 dígitos**. No hace falta estar en la
      misma WiFi.
- [x] **Funciona desde cualquier red** (WiFi o datos móviles, NAT estricto
      incluido), sin abrir puertos ni estar juntos.
- [x] Elección de **broker probando 3 en orden** + reconexión automática con
      backoff y `wake()` al volver la app a primer plano.
- [x] Chat + "escribiendo…" + acks y **bandeja de salida**: lo no entregado se
      **reintenta cada 12 s** hasta recibir el ACK.
- [x] Fotos, audio y vídeo: cifrados en el dispositivo y troceados por el canal
      (fotos de galería o con la cámara; vídeos desde la cámara o la galería,
      con aviso si pesan más de 6 MB).
- [x] **Juegos compartidos** (v0.5.0): el estado del juego (`gameSession`) se
      sincroniza con la pareja por el relay cifrado (marco `game`); al iniciar un
      juego se envía `start` y la app **abre sola** esa pantalla en el otro
      teléfono. Nivel (`level`) y reto (`draw`) son comunes; el anfitrión
      **reenvía el estado cada 6 s** (baliza). Botón **«Terminar juego»** termina
      la partida para los dos.
- [x] **Respuestas dentro de los juegos** (v0.6.0): cualquiera de los dos puede
      responder el reto/pregunta; las respuestas forman un **hilo
      (`GameThread`)** sincronizado en los dos teléfonos (trama `reply` cifrada
      dentro del marco de juego —`sendGameReply` en P2PContext—; la baliza de
      `sync` incluye el hilo).
- [x] **5 niveles** de juegos/retos (🌸 Suave · 💞 Romántico · 🌶️ Picante ·
      🔥 Atrevido · 😈 Íntimo +18), elegidos **antes de jugar** y sincronizados;
      `challenges`/`diceChallenges`/`truths`/`dares` indexados por nivel. Retos
      **pensados para la distancia** (chat, audio, foto o videollamada).
- [x] **Contenido de juegos ampliado** (v0.6.0): 5 pools nuevos
      (`src/data/pool-retos.js`, `pool-truths.js`, `pool-dares.js`,
      `pool-dados.js`, `pool-preguntas.js`), cada uno con **22 opciones únicas
      por nivel × 5 niveles = 110 ítems** (los tests exigen ≥ 20 por nivel y por
      juego). «Para Conocernos» ahora también tiene selector de nivel;
      `mock.js` reexporta los pools.
- [x] **Invitación con enlace de descarga** (`src/config.js`): botón para
      compartir el enlace del APK en el onboarding, en Juegos y en el Perfil.
- [x] **Borrado de contenido** (con confirmación, solo copia local): historial de
      chat (`clearHistory`), fotos guardadas (`deleteStoredPhotos`) y todo
      (`wipeAllContent`); «Desvincular» también pide confirmación.
- [x] **Aviso de actualizaciones in-app** (v0.6.0): `src/services/updatecheck.js`
      y `src/services/version.js` comparan la versión instalada (`app.json`) con
      el `latest` de GitHub Releases; `UpdateModal` al abrir la app o volver a
      primer plano, con cooldown de 6 horas y sin insistir con una versión ya
      descartada; botón que abre la descarga (`…/releases/latest/download/duo.apk`).
- [x] Persistencia de sesión + **historial local cifrado en origen** (AsyncStorage).
- [x] Notificaciones locales.
- [x] Cifrado E2E **completo** de textos, fotos, audio/vídeo y estado del juego (X25519 + AES-256-GCM).
- [x] Polyfill de `crypto.getRandomValues` con RNG nativo (expo-crypto).
- [x] Tests del protocolo (`duo-app/test/duo-test.mjs`, **103 verificaciones, 0
      fallos**): identidad/SAS, encuadre, auth E2E, QR v2, temas/sobre del relay,
      mensajes, fotos, **cifrado del estado del juego** (un tercero no lo
      descifra y el reto no viaja en claro; la pareja recibe el juego iniciado),
      **respuestas de juego cifradas**, **troceado de audio/vídeo (`file-*`)**,
      **comparación de versiones**, **contenido ≥ 20 por nivel y por juego** y
      una sesión completa sobre un "bus" en memoria que imita al broker.
- [x] Repo en GitHub: https://github.com/whustafree/Duo
- [x] Build automático de APK con GitHub Actions (`.github/workflows/build-apk.yml`).

---

## 6. Pendientes / ideas

- [ ] Probar el flujo completo en **dos celulares reales** (crear/compartir/
      escanear/pegar código, mensajes, fotos, entrega diferida con reintentos)
      por el relay.
- [ ] Probar en **dos teléfonos** los **juegos compartidos** (que la pantalla se
      abra sola en la pareja, que el nivel y el reto se sincronicen y que
      «Terminar juego» cierre en los dos).
- [ ] Probar en **dos teléfonos** el **hilo de respuestas de juego**
      (`GameThread`) y el envío de **audio/vídeo** en el chat.
- [ ] Probar en **dos teléfonos** el **borrado de contenido** (historial, fotos y
      todo) y el **enlace de invitación** (descarga del APK `duo.apk`).
- [ ] Publicar la **Release v0.5.0** (juegos compartidos + borrado + invitación +
      nivel Íntimo; app 0.5.0 / versionCode 5; pendiente de compilar y subir el APK).
- [ ] Publicar la **Release v0.6.0** (respuestas en juegos + audio/vídeo/cámara
      en el chat + contenido ampliado + aviso de actualizaciones; app 0.6.0 /
      versionCode 6; pendiente de compilar y subir el APK).
- [ ] Más juegos y retos; editar/crear retos propios.
- [ ] Notificaciones push reales (hoy solo locales).
- [ ] Publicar en Play Store (firma de release + AAB).

---

## 7. Notas técnicas

- El archivo `.tar.gz` **NO** incluye `node_modules`; hay que instalarlos.
- El paquete Android es `com.duo.app` (cambiar en `app.json` si se publica).
- Brokers MQTT públicos y gratuitos (QoS 0, los 3 en orden):
  `wss://broker.emqx.io:8084/mqtt`, `wss://broker.hivemq.com:8884/mqtt` y
  `wss://test.mosquitto.org:8081/mqtt`. El cliente MQTT 3.1.1 sobre WebSocket es
  propio y **sin dependencias** (no usa `Buffer`/`process`/`TextEncoder`).
- Temas: `duo/v2/pair/<hash>` (vinculación) y `duo/v2/chat/<hash>` (chat); el
  `hash` es sha256 → 22 hex, así que sin las claves no se adivinan.
- `newArchEnabled: false` en `app.json` (configuración actual del proyecto; ya
  **no** responde a módulos nativos, que fueron retirados).
- `src/config.js` centraliza los enlaces públicos (repo, releases y descarga) y el
  texto de invitación. El APK de cada Release se publica además con el nombre
  **estable `duo.apk`**, así el enlace
  `…/releases/latest/download/duo.apk` siempre es válido.
- `app.json` declara los permisos `RECORD_AUDIO` y `READ_MEDIA_VIDEO`
  (añadidos en v0.6.0) para las notas de voz y los vídeos del chat.
- Hermes no expone `crypto.getRandomValues`: `src/services/polyfills.js` lo
  instala con el RNG nativo **antes** de cualquier uso de `@noble/*`.

---

## 8. Privacidad

- **No existe ningún servidor propio** ni de señalización ni de pago: los
  mensajes solo pasan por un **broker MQTT público y gratuito** que actúa como
  cartero y **no puede leer el contenido** (va cifrado E2E). El broker **sí ve
  metadatos mínimos**: los temas (que son hashes y no revelan datos sin las
  claves), el tamaño de los paquetes y los horarios; **nunca** los mensajes, las
  fotos, el audio/vídeo **ni el estado del juego** (a qué jugáis o el reto).
- Los textos, **las fotos, el audio, el vídeo y el estado del juego** van
  cifrados E2E en el propio canal: aunque alguien capture el tráfico, solo ve
  bytes aleatorios.
- La clave privada **nunca sale** del dispositivo; el código de vinculación solo
  contiene la clave **pública** + un secreto de emparejamiento de un solo uso.
- Cada dispositivo guarda su **copia local** del historial y de las fotos,
  audios y vídeos descifrados (almacenamiento de la app). Se pueden **borrar**
  desde el Perfil (historial, fotos o todo); el borrado afecta **solo a tu
  copia**, nunca a la de
  tu pareja. Si se pierde el equipo, se pierden esas claves; la pareja conserva su
  propia copia.
- El código SAS de 6 dígitos protege contra emparejamientos equivocados.

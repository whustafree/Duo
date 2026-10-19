# Manifiesto del Proyecto — Duo 💞

Documento que describe **qué estamos haciendo**, cómo está armado y qué falta.

Fecha: 18 de octubre de 2026

---

## 1. Qué es

**Duo** es una app privada para **parejas** (solo 2 personas vinculadas). Permite:

- Chat privado entre los dos teléfonos a través de un **broker MQTT público y
  gratuito**: **no hay servidor propio ni de pago**; el broker solo hace de
  cartero.
- Envío de **fotos** (cifradas, por el mismo canal).
- Vinculación con un **código corto** que se puede **escanear (QR)** o **pegar**,
  con código de verificación de 6 dígitos.
- **Funciona siempre y desde cualquier red**: misma WiFi o datos móviles,
  incluido NAT estricto, sin estar juntos, sin abrir puertos y sin pagar nada.
- **Juegos y retos** para mejorar/acercar la relación, con 4 niveles de intensidad:
  🌸 Suave · 💞 Romántico · 🌶️ Picante · 🔥 Atrevido.
- **Cifrado extremo a extremo (E2E)** de textos y fotos: X25519 + HKDF-SHA256 +
  AES-256-GCM. Lo que viaja por la red son bytes ilegibles; **ni el broker puede
  leer nada**.
- Persistencia de sesión (no hay que revincular cada vez).
- Notificaciones locales al recibir mensajes en segundo plano.

> Los retos están pensados para **parejas adultas y consentidas**. La app no
> incluye contenido explícito; el nivel "Atrevido" es una invitación, no contenido
> gráfico.

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
├── index.js                # Instala el polyfill de Web Crypto antes que nada
├── app.json                # Config Expo (nombre, permisos, plugins, cámara)
├── eas.json                # Perfiles de build (APK/AAB)
├── babel.config.js
├── package.json            # incluye "npm test" → pruebas del protocolo (relay)
├── test/
│   └── duo-test.mjs        # 59 verificaciones (relay + cifrado E2E + bus en memoria)
└── src/
    ├── theme.js            # Colores, espaciados, tipografía
    ├── data/mock.js        # Datos simulados (solo juegos/demo)
    ├── context/
    │   ├── SessionContext.js   # Sesión de la pareja (AsyncStorage)
    │   ├── E2EContext.js       # Claves de cifrado del dispositivo
    │   └── P2PContext.js       # Transporte relay + historial local + bandeja
    ├── services/
    │   ├── polyfills.js        # crypto.getRandomValues para Hermes (nativo)
    │   ├── cryptocore.js       # Núcleo criptográfico PURO (X25519/AES/GCM,
    │   │                       #   coupleId, código SAS, emojis) — testeable en Node
    │   ├── crypto.js           # Guarda/carga el par de claves en AsyncStorage
    │   ├── protocol.js         # Tramas, auth, emparejamiento, msgs, fotos (PURO)
    │   ├── mqttws.js           # Cliente MQTT 3.1.1 sobre WebSocket (sin deps)
    │   ├── relayproto.js       # Lógica PURA del relay: temas, QR v2 y sobre
    │   ├── relay.js            # Transporte relay por broker público (API tipo P2P)
    │   └── notifications.js    # Notificaciones locales
    ├── components/{Avatar,PrimaryButton,ChallengeDeck}.js
    └── screens/
        ├── OnboardingScreen.js # Vincular por QR/código pegado + SAS
        ├── ChatScreen.js       # Chat + fotos + typing (todo por relay)
        ├── GamesScreen.js      # Lista de juegos
        ├── TruthDareScreen.js  # Verdad o Reto
        ├── ChallengeScreen.js  # Ruleta de Retos
        ├── DiceScreen.js       # Dados del Deseo
        ├── QuestionsScreen.js  # Para Conocernos
        └── ProfileScreen.js    # Perfil + código de verificación + desvincular
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
npm test           # pruebas del protocolo y del relay (59 verificaciones)
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

---

## 5. Estado actual (qué ya está hecho)

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
- [x] Fotos: cifradas en el dispositivo y troceadas por el canal.
- [x] Persistencia de sesión + **historial local cifrado en origen** (AsyncStorage).
- [x] Notificaciones locales.
- [x] Cifrado E2E **completo** de textos y fotos (X25519 + AES-256-GCM).
- [x] Polyfill de `crypto.getRandomValues` con RNG nativo (expo-crypto).
- [x] Tests del protocolo (`duo-app/test/duo-test.mjs`, **59 verificaciones**):
      identidad/SAS, encuadre, auth E2E, QR v2, temas/sobre del relay, mensajes,
      fotos y una sesión completa sobre un "bus" en memoria que imita al broker
      (comprueba que el eco propio se ignora y que un intruso no puede descifrar).
- [x] Repo en GitHub: https://github.com/whustafree/Duo
- [x] Build automático de APK con GitHub Actions (`.github/workflows/build-apk.yml`).

---

## 6. Pendientes / ideas

- [ ] Probar el flujo completo en **dos celulares reales** (crear/compartir/
      escanear/pegar código, mensajes, fotos, entrega diferida con reintentos)
      por el relay.
- [ ] Publicar la **Release v0.4.0** (app 0.4.0 / versionCode 4; pendiente de
      compilar y subir el APK).
- [ ] Más juegos y retos; editar/crear retos propios.
- [ ] Borrar historial / fotos desde la app.
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
- Hermes no expone `crypto.getRandomValues`: `src/services/polyfills.js` lo
  instala con el RNG nativo **antes** de cualquier uso de `@noble/*`.

---

## 8. Privacidad

- **No existe ningún servidor propio** ni de señalización ni de pago: los
  mensajes solo pasan por un **broker MQTT público y gratuito** que actúa como
  cartero y **no puede leer el contenido** (va cifrado E2E). El broker **sí ve
  metadatos mínimos**: los temas (que son hashes y no revelan datos sin las
  claves), el tamaño de los paquetes y los horarios; **nunca** los mensajes ni
  las fotos.
- Los textos **y las fotos** van cifrados E2E en el propio canal: aunque alguien
  capture el tráfico, solo ve bytes aleatorios.
- La clave privada **nunca sale** del dispositivo; el código de vinculación solo
  contiene la clave **pública** + un secreto de emparejamiento de un solo uso.
- Cada dispositivo guarda su **copia local** del historial y de las fotos
  descifradas (almacenamiento de la app). Si se pierde el equipo, se pierden
  esas claves; la pareja conserva su propia copia.
- El código SAS de 6 dígitos protege contra emparejamientos equivocados.

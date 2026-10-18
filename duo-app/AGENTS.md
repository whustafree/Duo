# AGENTS.md — Duo app (duo-app/)

Documento de contexto para agentes/desarrolladores. Versión **P2P sin
servidor**. El informe completo del proyecto está en `../INFORME-OPENCODE.md`
y el resumen en `../MANIFIESTO.md`.

Última actualización: 18 de octubre de 2026

---

## Qué es

**Duo** es una app Expo (SDK 52) para parejas: chat de texto + fotos, juegos y
retos. **No hay backend**: los dos teléfonos se conectan **directamente** por
TCP en la misma WiFi (descubrimiento mDNS, puerto `47777`) y todo va cifrado
E2E (X25519 + HKDF-SHA256 + AES-256-GCM, libs `@noble/*`).

- Repo: https://github.com/whustafree/Duo (APKs en Releases; CI en Actions).
- Estado: `npm test` 32/32, `npx expo-doctor` verde, `npx expo export` verde.

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
  p2p.js                  # transporte nativo: TCP server/dial + zeroconf mDNS
  notifications.js        # notificaciones locales
src/context/
  SessionContext.js       # sesión de la pareja (duo.session) / clear()
  E2EContext.js           # claves del dispositivo; peerPub = session.partnerPub
  P2PContext.js           # historial, bandeja, fotos, typing, pareo, eventos
src/screens/
  OnboardingScreen.js     # vínculo QR (crear/escanear) + código SAS
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

### Dependencias nativas (cuidado)

- Instalar paquetes Expo con `npx expo install` (respeta SDK 52). Actuales:
  `expo-camera@~16.0.18`, `expo-crypto@~14.0.2`, `expo-image-manipulator@~13.0.6`,
  `expo-network@~7.0.5`, `react-native-svg@15.8.0`, además de
  `react-native-tcp-socket`, `react-native-zeroconf`, `react-native-qrcode-svg`.
- **Autolinking solo mira un nivel** bajo `node_modules`: verificar que ninguna
  lib nativa quede anidada (`npm ls <pkg>`).
- `newArchEnabled: false` en `app.json` (tcp-socket/zeroconf = bridge clásico).
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
npm test                          # 32 ok
npx expo-doctor                   # verde
npx expo export --platform android --output-dir dist-p2p   # bundle ok
```

Y revisar `git status` (nada de temporales tipo `.tmp-test-*` ni `dist-p2p/`).

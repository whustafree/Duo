# Manifiesto del Proyecto — Duo 💞

Documento que describe **qué estamos haciendo**, cómo está armado y qué falta.

Fecha: 18 de octubre de 2026

---

## 1. Qué es

**Duo** es una app privada para **parejas** (solo 2 personas vinculadas). Permite:

- Chat privado entre los dos teléfonos, **directo (P2P)**: **no hay servidor**
  ni servidor de señalización.
- Envío de **fotos** (cifradas, por el mismo enlace directo).
- Vinculación escaneando un **código QR** (con código de verificación de 6 dígitos).
- **Conectar por Internet sin servidor** (WebRTC solo STUN, SDP intercambiado
  fuera de banda por 2 QRs). Ruta preferente: WiFi/mDNS; si no hay ruta directa,
  fallback a **Hotspot**.
- **Juegos y retos** para mejorar/acercar la relación, con 4 niveles de intensidad:
  🌸 Suave · 💞 Romántico · 🌶️ Picante · 🔥 Atrevido.
- **Cifrado extremo a extremo (E2E)** de textos y fotos: X25519 + HKDF-SHA256 +
  AES-256-GCM. Lo que viaja por la red son bytes ilegibles.
- Persistencia de sesión (no hay que revincular cada vez).
- Notificaciones locales al recibir mensajes en segundo plano.

> Los retos están pensados para **parejas adultas y consentidas**. La app no
> incluye contenido explícito; el nivel "Atrevido" es una invitación, no contenido
> gráfico.

---

## 2. Estructura del proyecto

```
duo-app/      → App móvil (React Native + Expo SDK 52)
                (antes había un duo-server/; fue eliminado: ahora es 100% P2P)
```

### duo-app (app móvil)

```
duo-app/
├── App.js                  # Navegación (stack + tabs), providers, splash
├── index.js                # Instala el polyfill de Web Crypto antes que nada
├── app.json                # Config Expo (nombre, permisos, plugins, cámara)
├── eas.json                # Perfiles de build (APK/AAB)
├── babel.config.js
├── package.json            # incluye "npm test" → pruebas del protocolo P2P
├── test/
│   └── p2p-test.mjs        # 48 verificaciones (protocolo + QRs WebRTC + TCP real)
└── src/
    ├── theme.js            # Colores, espaciados, tipografía
    ├── data/mock.js        # Datos simulados (solo juegos/demo)
    ├── context/
    │   ├── SessionContext.js   # Sesión de la pareja (AsyncStorage)
    │   ├── E2EContext.js       # Claves de cifrado del dispositivo
    │   └── P2PContext.js       # Conexión directa + historial local + bandeja
    ├── services/
    │   ├── polyfills.js        # crypto.getRandomValues para Hermes (nativo)
    │   ├── cryptocore.js       # Núcleo criptográfico PURO (X25519/AES/GCM,
    │   │                       #   coupleId, código SAS, emojis) — testeable en Node
    │   ├── crypto.js           # Guarda/carga el par de claves en AsyncStorage
    │   ├── protocol.js         # Tramas, auth, emparejamiento, msgs, fotos (PURO)
    │   │                       #   + build/parse de QRs WebRTC (Offer/Answer)
    │   ├── p2p.js              # TCP directo + descubrimiento mDNS (zeroconf)
    │   ├── webrtc.js           # WebRTC STUN-only (datachannel "duo-data")
    │   └── notifications.js    # Notificaciones locales
    ├── components/{Avatar,PrimaryButton,ChallengeDeck}.js
    └── screens/
        ├── OnboardingScreen.js # Vincular por QR (LAN) + modo WebRTC 2 QRs + SAS
        ├── ChatScreen.js       # Chat + fotos + typing (todo por P2P)
        ├── GamesScreen.js      # Lista de juegos
        ├── TruthDareScreen.js  # Verdad o Reto
        ├── ChallengeScreen.js  # Ruleta de Retos
        ├── DiceScreen.js       # Dados del Deseo
        ├── QuestionsScreen.js  # Para Conocernos
        └── ProfileScreen.js    # Perfil + código de verificación + desvincular
```

---

## 3. Cómo funciona (flujo P2P)

### Vinculación (una sola vez)

1. **Teléfono A**: escribe su nombre → **Crear vínculo** → muestra un **QR** con
   su clave pública + IP + puerto + un secreto de emparejamiento.
2. **Teléfono B**: **Escanear el QR de mi pareja** → apunta la cámara al QR →
   se conecta directamente a A por TCP y le envía su clave pública (cifrada con
   el secreto del QR).
3. A muestra una alerta con el nombre de B y un **código de verificación de 6
   dígitos** (SAS) que debe coincidir con el de la pantalla de B → **Aceptar**.
4. Ambos derivan el mismo `coupleId` a partir de sus dos claves públicas y
   quedan vinculados. Las claves privadas nunca salen de cada dispositivo.

### Mensajes (a diario)

1. Cada teléfono levanta un **servidor TCP** propio (puerto `47777`) y se
   anuncia en la red local por **mDNS** (`_duo._tcp`).
2. El que tiene la clave pública "menor" es el que **marca** la conexión
   (regla determinista: ambos calculan lo mismo, nunca se duplica el enlace).
3. Al conectar, se autentican mutuamente con E2E: solo quien tiene la clave
   privada correcta completa el handshake.
4. Los mensajes van **cifrados** de teléfono a teléfono. Si la pareja está
   desconectada, el mensaje queda **pendiente en el dispositivo** y se envía
   solo en cuanto los dos vuelven a estar en línea.

### Conectar entre redes distintas (WebRTC sin servidor)

Cuando los dos no comparten WiFi, se usa **WebRTC solo STUN** con intercambio de
SDP **fuera de banda por 2 QRs** (no hay servidor de señalización):

1. **A**: *Crear vínculo por Internet* → muestra un **Offer QR**.
2. **B**: escanea el Offer (calcula y muestra el **código SAS**) → muestra un
   **Answer QR**.
3. **A**: escanea el Answer → se abre el **DataChannel cifrado** `duo-data`.
4. Si no hay ruta directa (NAT estricto) en ~18 s, se indica el **fallback**:
   activar **Hotspot** en uno y conectar el otro.

Sin **TURN** ni relay. Datos cifrados E2E igual que en LAN; solo viajan claves
públicas y SDP.

### Requisitos de uso

- **Misma WiFi** (ruta preferente, TCP+mDNS) **o** usar el modo **WebRTC por
  Internet** (2 QRs). En ambos casos, con la **app abierta** (o abrirla para
  recibir lo acumulado). Es el precio de no tener ningún servidor.

---

## 4. Cómo correrlo

### App (desarrollo)

```bash
cd duo-app
npm install
npm test           # pruebas del protocolo P2P (48 verificaciones)
npx expo start     # escanea el QR con Expo Go
```

> Para probar el flujo P2P completo se necesita un **development build** o el
> APK: `react-native-tcp-socket`, `react-native-zeroconf` y
> `react-native-webrtc` son módulos nativos que Expo Go no incluye.

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
- [x] **Sin servidor**: chat/fotos/vinculación P2P directa entre los dos teléfonos.
- [x] Vinculación por **QR** + confirmación con código SAS de 6 dígitos.
- [x] **Conectar por Internet sin servidor**: WebRTC **solo STUN** + intercambio
      de SDP fuera de banda por **2 QRs** (Offer/Answer) + fallback a Hotspot.
- [x] Descubrimiento automático por mDNS + reconexión con la dirección guardada.
- [x] Chat + "escribiendo…" + acks y **bandeja de salida** (lo no entregado se
      envía al reconectar).
- [x] Fotos: cifradas en el dispositivo y troceadas por el enlace directo.
- [x] Persistencia de sesión + **historial local cifrado en origen** (AsyncStorage).
- [x] Notificaciones locales.
- [x] Cifrado E2E **completo** de textos y fotos (X25519 + AES-256-GCM).
- [x] Polyfill de `crypto.getRandomValues` con RNG nativo (expo-crypto).
- [x] Tests del protocolo P2P (`duo-app/test/p2p-test.mjs`, 48 verificaciones,
      incluidos los QRs WebRTC Offer/Answer y una sesión TCP real en Node).
- [x] Repo en GitHub: https://github.com/whustafree/Duo
- [x] Build automático de APK con GitHub Actions (`.github/workflows/build-apk.yml`).

---

## 6. Pendientes / ideas

- [ ] Probar el flujo completo en **dos celulares reales** (crear vínculo,
      mensajes, fotos, reconexión), incluido el modo WebRTC por Internet.
- [ ] Probar WebRTC entre redes móviles reales (algunos NAT estrictos exigirán
      el fallback a Hotspot; se descarta TURN/relay a propósito).
- [ ] Más juegos y retos; editar/crear retos propios.
- [ ] Borrar historial / fotos desde la app.
- [ ] Notificaciones push reales (hoy solo locales).
- [ ] Publicar en Play Store (firma de release + AAB).

---

## 7. Notas técnicas

- El archivo `.tar.gz` **NO** incluye `node_modules`; hay que instalarlos.
- El paquete Android es `com.duo.app` (cambiar en `app.json` si se publica).
- Puerto P2P fijo: **47777/TCP** (+ mDNS `_duo._tcp`).
- WebRTC: `react-native-webrtc@124.0.8` (compatible RN 0.76 / SDK 52), solo
  servidores **STUN** (Google/Twilio); datachannel fiable `duo-data`. **Sin TURN.**
- `newArchEnabled: false` en `app.json` (módulos nativos `tcp-socket`/`zeroconf`
  están probados con la arquitectura clásica; webrtc 124.x también).
- Hermes no expone `crypto.getRandomValues`: `src/services/polyfills.js` lo
  instala con el RNG nativo **antes** de cualquier uso de `@noble/*`.

---

## 8. Privacidad

- **No existe ningún servidor** ni servidor de señalización: los mensajes solo
  viajan del teléfono A al B. En WebRTC solo se usan servidores **STUN** (para
  descubrir la dirección pública); no ven el contenido (va cifrado E2E) y **no
  hay relay/TURN**.
- Los textos **y las fotos** van cifrados E2E en el propio enlace: aunque alguien
  capture el tráfico de la WiFi, solo ve bytes aleatorios.
- La clave privada **nunca sale** del dispositivo; el QR solo contiene la clave
  **pública** + un secreto de emparejamiento de un solo uso.
- Cada dispositivo guarda su **copia local** del historial y de las fotos
  descifradas (almacenamiento de la app). Si se pierde el equipo, se pierden
  esas claves; la pareja conserva su propia copia.
- El código SAS de 6 dígitos protege contra emparejamientos equivocados.

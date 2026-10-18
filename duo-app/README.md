# Duo 💞

App privada para parejas: chat (texto + fotos), juegos y retos para acercarse.

**No hay ningún servidor.** Los dos teléfonos se conectan **directamente entre
sí** y todo lo que viaja va cifrado de extremo a extremo.

- **Ruta preferente**: misma **WiFi** → TCP directo + descubrimiento mDNS.
- **Sin WiFi común**: **WebRTC STUN-only** con intercambio de SDP **fuera de
  banda por 2 QRs** (Offer/Answer). Sin TURN, sin servidor de señalización.

## Privacidad (lo principal)

- **Sin backend**: los mensajes solo van del teléfono de uno al del otro.
  Nada pasa por internet ni por terceros.
- **WebRTC solo con STUN**: STUN únicamente ayuda a descubrir la dirección
  pública; no ve el contenido (va cifrado E2E) y no hay servidor de relevo.
- **Cifrado extremo a extremo (E2E)** de textos *y* fotos:
  X25519 + HKDF-SHA256 + AES-256-GCM. Si alguien captura el tráfico de la WiFi
  solo ve bytes ilegibles; la clave privada **nunca sale del dispositivo**.
- **Copia local en cada equipo**: el historial queda guardado en el dispositivo
  (AsyncStorage) y las fotos se descifran y se guardan en el almacenamiento
  local de la app. Cada uno conserva su propia copia.
- **Código de verificación SAS** de 6 dígitos (idéntico en las dos pantallas)
  al vincular, para asegurar que no te enlazaste con la persona equivocada.

## Cómo funciona la conexión

- Cada teléfono levanta un **servidor TCP propio** (puerto `47777`) y se
  anuncia en la red local por **mDNS** (`_duo._tcp`).
- El dispositivo con la clave pública "menor" marca la conexión saliente
  (regla determinista: ambos calculan lo mismo, nunca se duplica el enlace).
- Al conectar, se autentican mutuamente con E2E. Tras eso, todo va cifrado.
- Si la pareja está desconectada, los mensajes quedan **pendientes aquí** y se
  envían solos en cuanto los dos vuelven a estar en línea.

## Conectar por Internet (sin servidor)

Si no están en la misma WiFi, activa **«Conectar por Internet»** en la pantalla
de bienvenida. Es WebRTC **solo STUN**, con el SDP intercambiado fuera de banda
por dos QRs (no hay servidor de señalización):

1. **A**: *Crear vínculo por Internet* → muestra un **Offer QR**.
2. **B**: *Escanear el Offer* → apunta la cámara → muestra un **Answer QR** y el
   **código SAS**.
3. **A**: *Escanear el Answer* → se abre el DataChannel cifrado.
4. Si en ~18 s no hay ruta directa (NAT estricto), la app indica el **fallback**:
   activar un **punto de acceso (Hotspot)** en uno de los dos y conectar el otro.

> No se usa **TURN** ni relay: si el NAT lo impide, no hay conexión directa y se
> ofrece el atajo por Hotspot.

## Vinculación por WiFi (una sola vez)

1. En el primer arranque, cada uno escribe su nombre.
2. **Teléfono A**: toca *Crear vínculo* → aparece un **QR** con su clave
   pública + IP + puerto + un secreto de un solo uso.
3. **Teléfono B**: toca *Escanear el QR de mi pareja* → apunta la cámara.
4. Ambas pantallas muestran el **mismo código de 6 dígitos**: si coincide,
   A acepta la alerta y quedan vinculados. Las claves privadas nunca salen
   de cada dispositivo.

> Requisito de la ruta WiFi: ambos en la **misma red** y con la **app abierta**.

## Desarrollo

```bash
npm install
npm test           # 48 verificaciones del protocolo P2P (corren en Node)
npx expo start     # solo para desarrollo con módulos JS
```

> `react-native-tcp-socket`, `react-native-zeroconf` y `react-native-webrtc`
> son **módulos nativos**: para probar la conexión real se necesita un
> development build o el APK (Expo Go no los incluye).

### Generar el APK

- **GitHub Actions (recomendado)**: cada push a `main` que toque `duo-app/`
  ejecuta `.github/workflows/build-apk.yml` → pruebas + APK como artefacto
  (`duo-apk`) y en [Releases](https://github.com/whustafree/Duo/releases).
- **EAS local**: `eas build -p android --profile preview`

## Estructura relevante

```
src/services/
  polyfills.js   # crypto.getRandomValues para Hermes (se carga primero)
  cryptocore.js  # núcleo criptográfico puro (testeable en Node)
  crypto.js      # guarda/carga el par de claves del dispositivo
  protocol.js    # tramas, autenticación, emparejamiento, msgs, fotos
                 #   + QRs WebRTC Offer/Answer
  p2p.js         # transporte TCP directo + descubrimiento mDNS
  webrtc.js      # WebRTC STUN-only (datachannel "duo-data")
src/context/
  P2PContext.js  # conexión + historial local + bandeja de salida + fotos
test/
  p2p-test.mjs   # pruebas (npm test)
```

Repo: https://github.com/whustafree/Duo

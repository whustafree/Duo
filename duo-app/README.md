# Duo 💞

App privada para parejas: chat (texto + fotos) y **juegos/retos para dos** que se
juegan **a distancia** y se sincronizan entre los dos teléfonos.

**No hay ningún servidor propio.** Los dos teléfonos se comunican a través de un
**broker MQTT público y gratuito** que solo hace de cartero; todo lo que viaja va
cifrado de extremo a extremo.

- **Funciona siempre y desde cualquier red**: misma WiFi o datos móviles, NAT
  estricto incluido, sin estar juntos ni abrir puertos.
- **Sin servidor propio ni de pago**: el broker es público y gratuito, y como
  todo va cifrado E2E no puede leer nada.

## Privacidad (lo principal)

- **Sin servidor propio**: los mensajes pasan por un **broker MQTT público** que
  solo hace de cartero; nada depende de un backend ni de un servidor de pago.
- **El broker ve metadatos mínimos**: los temas (hashes que sin las claves no
  revelan nada), el tamaño de los paquetes y los horarios. **Nunca** ve los
  mensajes, las fotos ni el estado del juego, que van cifrados de extremo a
  extremo.
- **Cifrado extremo a extremo (E2E)** de textos, fotos *y* estado del juego:
  X25519 + HKDF-SHA256 + AES-256-GCM. Aunque alguien capture el tráfico, solo ve
  bytes ilegibles; la clave privada **nunca sale del dispositivo**.
- **Copia local en cada equipo**: el historial queda guardado en el dispositivo
  (AsyncStorage) y las fotos se descifran y se guardan en el almacenamiento
  local de la app. Cada uno conserva su propia copia, que puede **borrar** desde
  el Perfil (solo la suya).
- **Código de verificación SAS** de 6 dígitos (idéntico en las dos pantallas)
  al vincular, para asegurar que no te enlazaste con la persona equivocada.

## Cómo funciona la conexión

- Cada teléfono se conecta a un **broker MQTT público gratuito** (se prueban 3 en
  orden hasta que uno responde) y se suscribe al **tema de chat de la pareja**,
  que es un hash que nadie puede adivinar sin las claves.
- Cada mensaje se publica envuelto en un sobre `{s, f}` y **cifrado E2E**; el
  sobre permite **ignorar el eco propio** que devuelve el broker.
- Si la pareja está desconectada, los mensajes quedan **pendientes aquí** y se
  **reintentan cada 12 s** hasta recibir el ACK de entrega.

## Vinculación (una sola vez)

No hace falta estar en la misma red; uno crea el vínculo y el otro se une.

1. En el primer arranque, cada uno escribe su nombre.
2. **Teléfono A**: toca *Crear vínculo* → aparece un **QR corto** con su clave
   pública + un secreto de un solo uso, y un botón **«📤 Compartir el código»**
   (para enviarlo, p. ej., por WhatsApp).
3. **Teléfono B**: toca *Escanear el QR de mi pareja* **o** *Pegar un código* →
   apunta la cámara al QR o pega el código recibido.
4. Ambas pantallas muestran el **mismo código de 6 dígitos**: si coincide, A
   acepta la alerta de *Solicitud de vínculo* y quedan vinculados. Las claves
   privadas nunca salen de cada dispositivo.

> Solo necesitas Internet en los dos teléfonos (misma WiFi o datos móviles).

## Juegos para dos (a distancia)

- **Juegos compartidos**: cuando uno abre un juego, la pareja recibe la invitación
  y **la pantalla se abre sola en su teléfono**, así que jugáis a la vez.
- **Nivel elegido antes de jugar** (y sincronizado): 🌸 Suave · 💞 Romántico ·
  🌶️ Picante · 🔥 Atrevido · 😈 Íntimo (+18).
- **Nivel y reto son comunes**: lo que sale en un teléfono es lo mismo en el
  otro; el botón **«Terminar juego»** acaba la partida para los dos.
- Los retos están pensados **para la distancia**: se cumplen por chat, audio,
  foto o videollamada, aunque estéis en ciudades o países distintos.
- El estado del juego va **cifrado de extremo a extremo** igual que el chat: nadie
  (ni el broker) sabe a qué jugáis ni qué reto os ha tocado.

## Invitar a tu pareja (si todavía no tiene la app)

- Hay un enlace de descarga estable (`…/releases/latest/download/duo.apk`) que se
  comparte con un botón desde el onboarding, la pestaña **Juegos** y el **Perfil**
  («📲 Enviar el enlace de descarga a mi pareja»).

## Borrar contenido

- Desde el **Perfil** puedes **borrar el historial de chat**, **borrar las fotos
  guardadas** o **borrar todo** (con confirmación). Solo borra **tu copia local**;
  la de tu pareja no se toca. «Desvincular» también pide confirmación.

## Desarrollo

```bash
npm install
npm test           # 64 verificaciones del protocolo y del relay (corren en Node)
npx expo start     # desarrollo
```

> El transporte por relay usa el **WebSocket global** (presente en React Native /
> Hermes) y el cliente MQTT es propio y **sin dependencias nativas**, así que ya
> no hacen falta módulos nativos de red. Para probar el flujo completo se
> recomienda igualmente un development build o el APK.

### Generar el APK

- **GitHub Actions (recomendado)**: cada push a `main` que toque `duo-app/`
  ejecuta `.github/workflows/build-apk.yml` → pruebas + APK como artefacto
  (`duo-apk`, con nombre `duo-v<versión>-apk<n>.apk`). El artefacto se descarga
  y se publica a mano en
  [Releases](https://github.com/whustafree/Duo/releases), añadiendo también el
  nombre estable **`duo.apk`** para que el enlace de descarga de la invitación
  siempre sea válido.
- **EAS local**: `eas build -p android --profile preview`

## Estructura relevante

```
src/config.js    # enlaces de descarga/invitación (APP_DOWNLOAD_URL)
src/services/
  polyfills.js   # crypto.getRandomValues para Hermes (se carga primero)
  cryptocore.js  # núcleo criptográfico puro (testeable en Node)
  crypto.js      # guarda/carga el par de claves del dispositivo
  protocol.js    # tramas, autenticación, emparejamiento, msgs, fotos y juego
  mqttws.js      # cliente MQTT 3.1.1 sobre WebSocket (sin dependencias)
  relayproto.js  # lógica pura del relay: temas, QR v2 y sobre
  relay.js       # transporte relay por broker público
src/context/
  P2PContext.js  # transporte relay + historial + bandeja + fotos + juego compartido + borrado
test/
  duo-test.mjs   # pruebas (npm test)
```

Repo: https://github.com/whustafree/Duo

> El APK de cada Release se publica con un nombre **estable `duo.apk`** (junto al
> nombre con número), así que el enlace de descarga usado por la invitación
> siempre apunta a la última versión.

# Duo 💞

App privada para parejas: chat (texto + fotos), juegos y retos para acercarse.

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
  mensajes ni las fotos, que van cifrados de extremo a extremo.
- **Cifrado extremo a extremo (E2E)** de textos *y* fotos:
  X25519 + HKDF-SHA256 + AES-256-GCM. Aunque alguien capture el tráfico, solo ve
  bytes ilegibles; la clave privada **nunca sale del dispositivo**.
- **Copia local en cada equipo**: el historial queda guardado en el dispositivo
  (AsyncStorage) y las fotos se descifran y se guardan en el almacenamiento
  local de la app. Cada uno conserva su propia copia.
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

## Desarrollo

```bash
npm install
npm test           # 59 verificaciones del protocolo y del relay (corren en Node)
npx expo start     # desarrollo
```

> El transporte por relay usa el **WebSocket global** (presente en React Native /
> Hermes) y el cliente MQTT es propio y **sin dependencias nativas**, así que ya
> no hacen falta módulos nativos de red. Para probar el flujo completo se
> recomienda igualmente un development build o el APK.

### Generar el APK

- **GitHub Actions (recomendado)**: cada push a `main` que toque `duo-app/`
  ejecuta `.github/workflows/build-apk.yml` → pruebas + APK como artefacto
  (`duo-apk`). El artefacto se descarga y se publica a mano en
  [Releases](https://github.com/whustafree/Duo/releases).
- **EAS local**: `eas build -p android --profile preview`

## Estructura relevante

```
src/services/
  polyfills.js   # crypto.getRandomValues para Hermes (se carga primero)
  cryptocore.js  # núcleo criptográfico puro (testeable en Node)
  crypto.js      # guarda/carga el par de claves del dispositivo
  protocol.js    # tramas, autenticación, emparejamiento, msgs, fotos
  mqttws.js      # cliente MQTT 3.1.1 sobre WebSocket (sin dependencias)
  relayproto.js  # lógica pura del relay: temas, QR v2 y sobre
  relay.js       # transporte relay por broker público
src/context/
  P2PContext.js  # transporte relay + historial local + bandeja de salida + fotos
test/
  duo-test.mjs   # pruebas (npm test)
```

Repo: https://github.com/whustafree/Duo

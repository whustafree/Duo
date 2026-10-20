# Duo 💞

App privada para parejas: chat (texto, fotos, audio y vídeo) con **estados de
entrega**, **citas y reacciones**, **bloqueo con PIN/huella** y **juegos/retos
para dos** que se juegan **a distancia** y se sincronizan entre los dos
teléfonos.

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
  mensajes, las fotos, el audio/vídeo ni el estado del juego, que van cifrados
  de extremo a extremo.
- **Cifrado extremo a extremo (E2E)** de textos, fotos, audio, vídeo *y* estado
  del juego: X25519 + HKDF-SHA256 + AES-256-GCM. Aunque alguien capture el
  tráfico, solo ve bytes ilegibles; la clave privada **nunca sale del
  dispositivo**.
- **Copia local en cada equipo**: el historial queda guardado en el dispositivo
  (AsyncStorage) y las fotos, audios y vídeos se descifran y se guardan en el
  almacenamiento local de la app. Cada uno conserva su propia copia, que puede
  **borrar** desde el Perfil (solo la suya).
- **Bloqueo de la app**: puedes poner **PIN** (4-6 dígitos) y/o **huella**. El
  PIN **nunca se guarda** (solo su resumen con sal aleatoria) y, si eliges el
  modo «Solo PIN», la **copia local de mensajes va cifrada** en el dispositivo
  con una clave derivada del PIN: ni siquiera una copia de seguridad del
  almacenamiento enseña nada sin él.
- **Avisos ocultos**: el aviso de mensaje nuevo puede **no enseñar el
  contenido** (solo «Tienes un mensaje nuevo 🔒»).
- **Pantalla discreta**: al ir a segundo plano, la app se tapa con una vista
  falsa de «Notas» (así aparece en el selector de apps).
- **Auto-destrucción**: la copia local se borra sola a los 7, 30 o 90 días
  (o nunca, si lo dejas); solo afecta a **tu** teléfono.
- **Código de verificación SAS** de 6 dígitos (idéntico en las dos pantallas)
  al vincular, con la **marca «✓ Comprobado»** cuando coincide, para asegurar
  que no te enlazaste con la persona equivocada.

## Cómo funciona la conexión

- Cada teléfono se conecta a un **broker MQTT público gratuito** (se prueban 3 en
  orden hasta que uno responde) y se suscribe al **tema de chat de la pareja**,
  que es un hash que nadie puede adivinar sin las claves.
- Cada mensaje se publica envuelto en un sobre `{s, f}` y **cifrado E2E**; el
  sobre permite **ignorar el eco propio** que devuelve el broker.
- Si la pareja está desconectada, los mensajes quedan **pendientes aquí** y se
  **reintentan cada 12 s** hasta recibir el ACK de entrega.
- En cada burbuja se ve el **estado**: ⏳ en cola, ✓ enviado, ✓✓ confirmado por
  la pareja y ⭕ si falló (con **reintento manual** tocándolo).
- Manteniendo pulsado un mensaje puedes **responder citándolo** o mandar una de
  **6 reacciones** (😍😘🔥😂🥺❤️): van cifradas y sincronizadas en los dos
  teléfonos, y las versiones antiguas las ven como texto normal.
- Además de texto se pueden enviar **fotos** (de la galería o con la cámara),
  **notas de voz** y **vídeos cortos** (aviso si pesan más de 6 MB): todo se
  cifra en el dispositivo, se trocea (`file-meta`/`file-chunk`) y se reensambla
  y descifra en el otro teléfono.

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
  🌶️ Picante · 🔥 Atrevido · 😈 Íntimo (+18). Todos los juegos tienen niveles,
  incluido **«Para Conocernos»**.
- **Nivel y reto son comunes**: lo que sale en un teléfono es lo mismo en el
  otro; el botón **«Terminar juego»** acaba la partida para los dos.
- **Cualquiera puede responder**: dentro del reto o la pregunta, cualquiera de
  los dos puede mandar su respuesta; forma un **hilo de respuestas** que aparece
  sincronizado en los dos teléfonos.
- Los retos están pensados **para la distancia**: se cumplen por chat, audio,
  foto o videollamada, aunque estéis en ciudades o países distintos.
- **Contenido ampliado**: cada juego tiene **110 ítems** (22 opciones por nivel
  × 5 niveles).
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

## Nuevas versiones

- Al abrir la app (o volver a primer plano) se comprueba si hay una versión más
  nueva en GitHub Releases; si la hay aparece un aviso (**UpdateModal**) con un
  botón para descargarla. Hay un cooldown de 6 horas y no insiste si ya
  descartaste esa versión.

## Desarrollo

```bash
npm install
npm test           # 141 verificaciones (protocolo, relay, bloqueo, chat, juego, versiones; corren en Node)
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
src/data/
  mock.js        # reexporta los pools de juegos
  pool-*.js      # contenido: pool-retos/truths/dares/dados/preguntas (22×5=110)
src/services/
  polyfills.js   # crypto.getRandomValues para Hermes (se carga primero)
  cryptocore.js  # núcleo criptográfico puro (testeable en Node)
  crypto.js      # guarda/carga el par de claves del dispositivo
  protocol.js    # tramas, autenticación, emparejamiento, msgs, archivos y juego
  mqttws.js      # cliente MQTT 3.1.1 sobre WebSocket (sin dependencias)
  relayproto.js  # lógica pura del relay: temas, QR v2 y sobre
  relay.js       # transporte relay por broker público
  version.js     # versión instalada (app.json) + comparación
  updatecheck.js # comprueba el latest de GitHub Releases (aviso in-app)
  chatcodec.js   # citas y reacciones (JSON __duo) + estados ⏳/⭕/✓/✓✓
  retention.js   # auto-destrucción local (Nunca/7/30/90 días)
  applock.js     # bloqueo: PIN (resumen con sal), huella, avisos ocultos, pantalla discreta
  localvault.js  # cofre: copia local cifrada con la clave derivada del PIN
src/context/
  P2PContext.js  # transporte relay + historial (cofre) + bandeja + estados + archivos + juego compartido (con respuestas) + borrado
src/components/
  LockScreen.js    # pad numérico PIN (crear/desbloquear) + huella
  StealthScreen.js # pantalla discreta (falsa «Notas»)
test/
  duo-test.mjs   # pruebas (npm test)
```

Repo: https://github.com/whustafree/Duo

> El APK de cada Release se publica con un nombre **estable `duo.apk`** (junto al
> nombre con número), así que el enlace de descarga usado por la invitación
> siempre apunta a la última versión.

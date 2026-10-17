# Informe para opencode — Proyecto Duo 💞

> Documento de traspaso (handoff). Describe **qué se está haciendo**, el estado
> actual, y **paso a paso para correr todo desde una PC y generar los APK**.
>
> Este archivo está pensado para que un agente de opencode (u otro dev) retome el
> trabajo sin contexto previo.

Última actualización: 17 de octubre de 2026

---

## 0) Resumen ejecutivo

**Duo** es una app privada para parejas (solo 2 personas vinculadas) que incluye
chat en tiempo real, envío de fotos, juegos/retos por niveles y cifrado extremo a
extremo (E2E) de los mensajes de texto.

Está compuesta por dos proyectos:

| Carpeta | Stack | Rol |
| ------- | ----- | --- |
| `duo-app/` | React Native + Expo (SDK 52) | App móvil (Android/iOS) |
| `duo-server/` | Node.js + Express + Socket.io + SQLite (`node:sqlite`) | Backend |

El trabajo se hizo desde **Termux (Android)**, donde el toolchain de Expo es
frágil. En un **PC estándar (Windows/Linux/macOS)** todo funciona de forma normal.
Este informe prioriza las instrucciones para PC.

---

## 1. Qué estamos haciendo (objetivo)

App privada de pareja con:

1. **Vinculación por código** `DUO-XXXXX` (solo se unen 2 personas).
2. **Chat en tiempo real** (texto) por sala privada.
3. **Envío de fotos**.
4. **Juegos/retos** por niveles: 🌸 Suave · 💞 Romántico · 🌶️ Picante · 🔥 Atrevido.
5. **Cifrado E2E** de mensajes de texto (X25519 + AES-256-GCM).
6. **Persistencia de sesión** (no revincular cada vez).
7. **Notificaciones locales** al recibir mensajes en segundo plano.

> Los retos son para **adultos consentidos**. No hay contenido explícito; el nivel
> "Atrevido" es una invitación, no contenido gráfico.

---

## 2. Estado actual (checklist)

- [x] Maqueta completa de UI (todas las pantallas).
- [x] Backend Node + Express + Socket.io.
- [x] Base de datos SQLite con `node:sqlite` (sin dependencias nativas).
- [x] Vinculación por código (máx. 2 por pareja).
6. [x] Chat en tiempo real + "escribiendo…".
7. [x] Subida de fotos (Multer).
8. [x] Persistencia de sesión (AsyncStorage).
9. [x] Notificaciones locales (expo-notifications).
10. [x] Cifrado E2E de textos (noble-curves/ciphers/hashes).
11. [x] Configuración de build con EAS (`eas.json`).
12. [x] Test automático del backend (`duo-server/test/socket-test.js`).
10. [ ] **No verificado**: build real de APK (requiere PC/cuenta Expo/EAS).
11. [ ] Pendiente: E2E para fotos, push real en background, HTTPS en producción.

---

## 2.bis Estado de verificación

| Componente | Estado | Cómo se verificó |
| ---------- | ------ | ---------------- |
| Backend (REST + sockets) | ✅ Probado | `node duo-server/test/socket-test.js` (crea pareja, une, mensaje, typing, persistencia) |
| Sintaxis de la app | ✅ Validada | Parser Babel (23 archivos JS/JSX, 0 errores) |
| Ejecución de Metro/Expo | ⚠️ No en Termux | Falla por resolución de módulos de metro en Termux |
| Generación de APK | ⏳ Pendiente | Requiere PC o EAS |

---

## 3. Estructura del proyecto

```
DuoProyecto/
├── MANIFIESTO.md            # Resumen (este informe es la versión extendida)
├── INFORME-OPENCODE.md      # Este documento
├── duo-proyecto.tar.gz      # Todo comprimido (sin node_modules)
├── duo-app/                 # App móvil (Expo)
│   ├── App.js
│   ├── index.js
│   ├── app.json
│   ├── eas.json
│   ├── babel.config.js
│   ├── package.json
│   └── src/
│       ├── config.js        # ⚠️ URL del backend (AJUSTAR)
│       ├── theme.js
│       ├── data/mock.js
│       ├── context/{SessionContext,E2EContext}.js
│       ├── services/{api,socket,crypto,notifications}.js
│       ├── components/{Avatar,PrimaryButton,ChallengeDeck}.js
│       └── screens/*.js
└── duo-server/              # Backend (Node)
    ├── src/{index,db,store}.js
    ├── test/socket-test.js
    ├── uploads/
    └── package.json
```

---

## 4. Requisitos del PC

- **Node.js 20 LTS o superior** (recomendado 22+; el backend usa `node:sqlite`,
  disponible desde Node 22.5+ sin flags).
- **npm** (viene con Node).
- **Git** (opcional).
- **Expo Go** en el celular (para probar sin compilar).
- Para APK:
  - **Cuenta gratuita en expo.dev**.
  - `npm install -g eas-cli`.
  - (Alternativa sin EAS) Android Studio + JDK 17 para build local.

> ⚠️ El backend **no** funciona en Node < 22.5 porque `node:sqlite` no existe.

---

## 5. Correr TODO desde el PC

### 5.1 Backend

```bash
cd duo-server
npm install
npm start          # arranca en http://localhost:4000
# prueba rápida:
curl http://localhost:4000/health        # {"ok":true}
npm test           # test de sockets (en otra terminal, con el server corriendo)
```

Variables de entorno opcionales:

```bash
PORT=4000 npm start
```

### 5.2 Frontend (modo desarrollo con Expo Go)

```bash
cd duo-app
npm install
npx expo start
```

Luego escanea el QR con la app **Expo Go** en el celular (misma red WiFi).

> Si el celular y el PC no están en la misma red, usa túnel:
> `npx expo start --tunnel` (instalará `@expo/ngrok`).

### 5.3 ⚠️ Configurar la URL del backend

Editar `duo-app/src/config.js`:

```js
export const API_URL = "http://IP_DEL_PC:4000";
export const SOCKET_URL = API_URL;
```

- **Emulador Android**: `http://10.0.2.2:4000`
- **Celular físico (Expo Go)**: la **IP LAN del PC**, ej. `http://192.168.1.50:4000`
  (averíguala con `ipconfig` en Windows o `ip addr` en Linux/Mac).
- **Web / mismo equipo**: `http://localhost:4000`

El firewall del PC debe permitir el puerto **4000** (y **8081** para Metro).

---

## 6. Generar la APK

### Opción A — EAS Build (recomendada, en la nube)

```bash
cd duo-app
npm install -g eas-cli
eas login                      # crea/inicia sesión en expo.dev
eas build:configure            # solo la primera vez (ya hay eas.json)
eas build -p android --profile preview
```

- `preview` → **APK** instalable (distribución interna).
- `production` → **AAB** para Google Play, con autoincremento de versión.

Al terminar, EAS da un enlace para descargar la APK. Se instala en el Android
activando "Fuentes desconocidas".

`eas.json` ya está configurado:

```json
{
  "build": {
    "preview":    { "distribution": "internal", "android": { "buildType": "apk" } },
    "production": { "autoIncrement": true, "android": { "buildType": "app-bundle" } }
  }
}
```

### Opción B — Build local (requiere Android SDK + JDK 17)

```bash
cd duo-app
npx expo prebuild -p android        # genera la carpeta android/
cd android
./gradlew assembleRelease            # APK en android/app/build/outputs/apk/release/
```

> Para build local con EAS: `eas build -p android --profile preview --local`.

---

## 7. Cómo funciona el sistema (para mantenerlo)

### 7.1 Flujo de vinculación

1. Usuario A: abre app → **Crear vínculo** → llama `POST /api/pair/create`
   → recibe `userId`, `coupleId`, `code`.
2. Usuario B: **Ya tengo un código** → `POST /api/pair/join` con el código.
3. El servidor agrega a B a la sala `coupleId` (máx. 2 miembros).
4. AMBOS generan un par de claves X25519 localmente y envían la **clave pública**
   (`pubKey`) al vincularse.
5. Con la pública del otro + su privada, cada uno deriva el **secreto compartido**
   → cifra/descifra los mensajes.

### 7.2 Mensajes (socket.io)

Cliente emite:
- `join` → `{ coupleId, userId }`
- `message` → `{ coupleId, senderId, text?, ciphertextB64 }`
- `typing` → `{ coupleId, userId, isTyping }`

Servidor emite:
- `message` (persistido; reenvía `ciphertextB64` + `nonce` tal cual)
- `typing` → `{ userId, isTyping }`
- `partner_joined` → `{ partner }`

### 7.3 Cifrado E2E

- Cliente: `@noble/curves` (X25519) + `@noble/hashes` (HKDF-SHA256) +
  `@noble/ciphers` (AES-256-GCM).
- Claves privadas: se guardan en el dispositivo (AsyncStorage), **nunca** al server.
- El servidor solo almacena y retransmite el texto cifrado (`ciphertextB64`, `nonce`).
- **Pendiente**: cifrar también las fotos (hoy se guardan en claro en el server).

### 7.4 Base de datos (SQLite)

Tablas: `users` (con `pub_key`), `couples`, `couple_members`, `messages`
(con `nonce` + `text`/`url`).

---

## 8. Endpoints del backend

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| GET  | `/health` | Estado |
| POST | `/api/pair/create` | Body `{ name, emoji, pubKey }` |
| POST | `/api/pair/join` | Body `{ code, name, emoji, pubKey }` |
| GET  | `/api/couple/:coupleId?userId=` | Info pareja |
| GET  | `/api/messages/:coupleId` | Historial |
| POST | `/api/upload` | Multipart `coupleId`, `senderId`, `photo` |
| GET  | `/uploads/:archivo` | Fotos |

---

## 9. Problemas conocidos y soluciones

| Problema | Causa | Solución |
| -------- | ----- | -------- |
| `npm: bad interpreter: /usr/bin/env` | shebang roto en Termux | usar `node "$(command -v npm)" install` |
| `Cannot find module 'metro/src/lib/TerminalReporter'` | instalación incompleta de metro en Termux | ejecutar en **PC** con `npm install` limpio |
| La app no conecta al backend | URL incorrecta en `config.js` | usar IP LAN del PC (`http://IP:4000`) |
| `node:sqlite` no existe | Node < 22.5 | actualizar Node a 22+ |
| Puerto ocupado | server/Metro previo | cerrar procesos o cambiar `PORT` |
| Warnings de versión Expo (`react-native@0.76.6` vs `0.76.9`) | desfase | `npx expo install --fix` en PC |

---

## 10. Checklist para OpenCode (hacer desde el PC)

1. [ ] `cd duo-server && npm install && npm start` (verificar `/health`).
2. [ ] `cd duo-app && npm install` (en red estable).
3. [ ] Editar `duo-app/src/config.js` con la IP del PC.
4. [ ] `npx expo start` y probar en **Expo Go**:
   - crear vínculo en un dispositivo, unirse desde otro,
   - enviar texto, foto, y ver "escribiendo…".
5. [ ] (Opcional) `npm test` en `duo-server` para validar sockets.
6. [ ] `eas login` + `eas build -p android --profile preview` → APK.
7. [ ] Instalar la APK en Android y repetir las pruebas.
8. [ ] (Pendiente) Implementar E2E para fotos.
9. [ ] (Pendiente) Push real en background (development build).

---

## 11. Roadmap sugerido

1. **E2E de fotos**: cifrar el blob antes de subir; descifrar al recibir.
2. **Push en background**: `expo-notifications` + development build + servidor de
   push (Expo Push o FCM).
3. **Deploy del backend** en VPS con HTTPS/WSS (ej. Railway, Fly.io, Render) y
   dominio; actualizar `config.js`.
4. **Badge de no leídos** y estado de entrega/lectura.
5. **Editor de retos propios** por pareja.
6. **Borrar historial/fotos** desde la app.
7. **Publicación en Play Store** (AAB, ficha, políticas de privacidad).

---

## 12. Aviso legal / privacidad

- App pensada para **adultos** en una relación consentida.
- Guardar/reenviar imágenes íntimas de terceros sin consentimiento es ilegal en
  muchos países; la app está diseñada para uso **privado entre dos personas**.
- El servidor no puede leer los textos (E2E), pero **sí almacena las fotos** hasta
  que se implemente su cifrado.

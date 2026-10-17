# Manifiesto del Proyecto — Duo 💞

Documento que describe **qué estamos haciendo**, cómo está armado y qué falta.

Fecha: 17 de octubre de 2026

---

## 1. Qué es

**Duo** es una app privada para **parejas** (solo 2 personas vinculadas). Permite:

- Chat privado en **tiempo real** (texto).
- Envío de **fotos**.
- Vinculación por **código** (`DUO-XXXXX`): solo se conectan entre ellas dos.
- **Juegos y retos** para mejorar/acercar la relación, con 4 niveles de intensidad:
  🌸 Suave · 💞 Romántico · 🌶️ Picante · 🔥 Atrevido.
- **Cifrado extremo a extremo (E2E)** de los mensajes de texto.
- Persistencia de sesión (no hay que revincular cada vez).
- Notificaciones locales al recibir mensajes en segundo plano.

> Los retos están pensados para **parejas adultas y consentidas**. La app no
> incluye contenido explícito; el nivel "Atrevido" es una invitación, no contenido
> gráfico.

---

## 2. Estructura del proyecto

```
duo-app/      → App móvil (React Native + Expo)
duo-server/   → Backend (Node.js + Express + Socket.io + SQLite)
```

### duo-app (frontend móvil)

```
duo-app/
├── App.js                  # Navegación (stack + tabs), providers, splash
├── index.js
├── app.json                # Config Expo (nombre, permisos, plugins)
├── eas.json                # Perfiles de build (APK/AAB)
├── babel.config.js
├── package.json
└── src/
    ├── config.js           # URL del backend (AJUSTAR)
    ├── theme.js            # Colores, espaciados, tipografía
    ├── data/mock.js        # Datos simulados (modo maqueta)
    ├── context/
    │   ├── SessionContext.js   # Sesión + persistencia (AsyncStorage)
    │   └── E2EContext.js       # Claves de cifrado
    ├── services/
    │   ├── api.js              # Llamadas REST
    │   ├── socket.js           # Tiempo real
    │   ├── crypto.js           # X25519 + AES-256-GCM
    │   └── notifications.js    # Notificaciones locales
    ├── components/
    │   ├── Avatar.js
    │   ├── PrimaryButton.js
    │   └── ChallengeDeck.js
    └── screens/
        ├── OnboardingScreen.js # Crear/unirse con código
        ├── ChatScreen.js       # Chat + fotos + typing + E2E
        ├── GamesScreen.js      # Lista de juegos
        ├── TruthDareScreen.js  # Verdad o Reto
        ├── ChallengeScreen.js  # Ruleta de Retos
        ├── DiceScreen.js       # Dados del Deseo
        ├── QuestionsScreen.js  # Para Conocernos
        └── ProfileScreen.js    # Perfil de la pareja
```

### duo-server (backend)

```
duo-server/
├── src/
│   ├── index.js    # Servidor Express + Socket.io + rutas
│   ├── db.js       # Esquema SQLite (node:sqlite)
│   ├── store.js    # Lógica de datos (usuarios, parejas, mensajes)
│   └── crypto.js   # Utilidades de cifrado (referencia)
├── test/
│   └── socket-test.js   # Prueba automática de tiempo real
├── uploads/        # Fotos subidas
└── package.json
```

---

## 3. Cómo funciona (flujo)

1. **Usuario A** abre la app → **Crear vínculo** → obtiene un código `DUO-XXXXX`.
2. **Usuario B** abre la app → **Ya tengo un código** → lo ingresa.
3. Quedan **vinculados** (sala privada `coupleId`, máximo 2 miembros).
4. Chatean en tiempo real, ven "escribiendo…", envían fotos.
5. Los mensajes de texto viajan **cifrados**; el servidor no los puede leer.
6. En **Juegos** practican retos por niveles.

---

## 3.bis Backend (API)

Todas las rutas privadas requieren el header `x-duo-token` (secreto de la
pareja) y que el `userId` sea miembro de la pareja.

| Método | Ruta | Auth | Descripción |
| ------ | ---- | ---- | ----------- |
| GET  | `/health` | — | Estado del servidor |
| POST | `/api/pair/create` | — | Crea pareja + código + token. Body `{ name, emoji, pubKey }` |
| POST | `/api/pair/join`   | — | Se une con el código |
| GET  | `/api/couple/:coupleId?userId=` | token | Info de la pareja |
| GET  | `/api/messages/:coupleId?userId=` | token | Historial (texto cifrado) |
| POST | `/api/photo` | token | Foto **ya cifrada** (base64 del ciphertext) |
| GET  | `/uploads/:archivo` | — | Archivos `.bin` cifrados (inútiles sin la clave) |

Socket.io: `join {coupleId,userId,token}` (validado), `message {ciphertextB64,
nonce}`, `typing {isTyping}` → `message`, `typing`, `partner_joined`,
`auth_error`.

---

## 4. Cómo correrlo

### Backend

```bash
cd duo-server
npm install        # en Termux: node "$(command -v npm)" install
npm start          # http://localhost:4000
```

### App (con un entorno estándar: PC con Node, o Expo Go)

```bash
cd duo-app
npx expo install   # instala dependencias
npx expo start     # escanea el QR con Expo Go
```

1. Ajusta `duo-app/src/config.js` con la IP del backend
   (`http://TU_IP:4000`). En emulador Android: `http://10.0.2.2:4000`.
2. Abre la app en **Expo Go** en el celular.

### Generar APK

```bash
cd duo-app
eas build -p android --profile preview   # APK instalable
```

---

## 5. Estado actual (qué ya está hecho)

- [x] Maqueta completa de UI (todas las pantallas).
- [x] Backend Node + Express + Socket.io.
- [x] Base de datos SQLite (`node:sqlite`, sin dependencias nativas).
- [x] Vinculación por código (máx. 2 personas) con **token secreto por pareja**.
- [x] Chat en tiempo real + indicador "escribiendo…".
- [x] Fotos: cifradas en el dispositivo, guardadas cifradas en el server.
- [x] Persistencia de sesión + **caché local del historial** (AsyncStorage) y
      fotos descifradas guardadas en el dispositivo.
- [x] Notificaciones locales.
- [x] Cifrado E2E **completo** de textos y fotos (X25519 + AES-256-GCM).
- [x] Autorización REST + sockets (sin token no hay acceso; sin inyección).
- [x] Tests del servidor (`duo-server/test/socket-test.js`, 15 verificaciones).
- [x] Repo en GitHub: https://github.com/whustafree/Duo
- [x] Build automático de APK con GitHub Actions (`.github/workflows/build-apk.yml`).

---

## 6. Pendientes / ideas

- [ ] Notificaciones **push reales** en segundo plano (requiere development build).
- [ ] Persistencia del servidor en un VPS/cloud con HTTPS (wss).
- [ ] Más juegos y retos; editar/crear retos propios.
- [ ] Borrar historial / fotos desde la app.
- [ ] Publicar en Play Store (firma de release + AAB).

---

## 7. Notas técnicas

- **Termux**: el `shebang` de `npm`/`npx` puede estar roto; usar
  `node "$(command -v npm)" install` o `node "$(command -v npx)" ...`.
- El archivo `.tar.gz` **NO** incluye `node_modules`; hay que instalarlos.
- La URL del backend está en `duo-app/src/config.js`.
- El paquete Android es `com.duo.app` (cambiar en `app.json` si se publica).

---

## 8. Privacidad

- Cada pareja tiene su propia sala y un **token secreto**: sin él no hay acceso
  a mensajes, fotos ni sockets.
- Los textos **y las fotos** van cifrados E2E: el servidor no puede leerlos.
- Cada dispositivo guarda su **copia local** del historial y de las fotos
  descifradas (almacenamiento de la app).
- Las claves privadas nunca salen del dispositivo; si se pierde el equipo se
  pierden esas claves (el partner puede re-descifrar lo guardado en el server
  porque también tiene su par de claves).

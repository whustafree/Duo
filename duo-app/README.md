# Duo 💞

App privada para parejas: chat (texto + fotos), juegos y retos para acercarse.

Incluye una **maqueta** (UI + datos simulados) y la **integración con el backend
real** (`../duo-server`): vinculación por código, chat en tiempo real y fotos.

## Cómo funciona la conexión

La app lee la URL del servidor desde `src/config.js`:

```js
export const API_URL = "http://TU_IP:4000";
```

- **Emulador Android**: `http://10.0.2.2:4000`
- **Celular físico** (Expo Go): la IP LAN de la PC donde corre el server,
  ej. `http://192.168.1.50:4000`
- **Web / mismo equipo**: `http://localhost:4000`

Sin sesión (si no te vinculas), el chat muestra la **maqueta** con datos simulados.

## Pantallas incluidas

- **Onboarding / Vinculación** — crear vínculo con código `DUO-XXXXX` o unirse con uno.
- **Chat** — burbujas de texto, mensajes con foto (placeholder), envío simulado.
- **Juegos** — Verdad o Reto, Ruleta de Retos, Dados del Deseo, Para Conocernos.
  - Niveles: 🌸 Suave · 💞 Romántico · 🌶️ Picante · 🔥 Atrevido.
- **Nosotros** — perfil de la pareja, días juntos, ajustes.

```
duo-app/
├── App.js                  # Navegación (stack + tabs) + SessionProvider
├── index.js
├── app.json
├── babel.config.js
├── package.json
└── src/
    ├── config.js           # URL del backend (¡edítala!)
    ├── theme.js            # Colores, espaciados, tipografía
    ├── data/mock.js        # Datos simulados (fallback sin sesión)
    ├── context/
    │   └── SessionContext.js   # userId / coupleId / código / partner
    ├── services/
    │   ├── api.js          # fetch al backend (pair, mensajes, upload)
    │   ├── socket.js       # Socket.io (mensajes y typing en vivo)
    │   └── notifications.js # Notificaciones locales
    ├── components/
    │   ├── Avatar.js
    │   ├── PrimaryButton.js
    │   └── ChallengeDeck.js
    └── screens/
        ├── OnboardingScreen.js   # Crear/unirse con código (API real)
        ├── ChatScreen.js         # Historial + socket + fotos
        ├── GamesScreen.js
        ├── TruthDareScreen.js
        ├── ChallengeScreen.js
        ├── DiceScreen.js
        ├── QuestionsScreen.js
        └── ProfileScreen.js
```

## Cómo correrla

**1. Levanta el backend** (en otra terminal):

```bash
cd ../duo-server
npm start   # escucha en :4000
```

**2. Ajusta `src/config.js`** con la IP correcta hacia el servidor.

**3. Arranca la app:**

```bash
cd duo-app
npx expo install
npx expo start
```

Luego escanea el QR con **Expo Go** (Android/iOS) para verla en tu celular.

> En Termux el shebang de `npm`/`npx` puede estar roto; si falla usa:
> `node "$(command -v npx)" expo start`

## Flujo completo

1. Usuario A abre la app → **Crear vínculo** → obtiene un código `DUO-XXXXX`.
2. Usuario B abre la app → **Ya tengo un código** → lo ingresa.
3. Quedan vinculados: chatean en tiempo real, ven "escribiendo…" y envían fotos.
4. En **Juegos** practican retos por niveles.

## Siguientes pasos

1. ~~Backend Node + Socket.io~~ ✅
2. ~~SQLite~~ ✅ (`node:sqlite`)
3. ~~Vinculación por código~~ ✅
4. ~~Fotos con `expo-image-picker` + servidor~~ ✅
5. ~~Persistir sesión (AsyncStorage)~~ ✅
6. ~~Notificaciones locales~~ ✅
7. ~~Build APK con EAS~~ ✅ (`eas build -p android --profile preview`)
8. **Cifrado extremo a extremo** (opcional, más privacidad).
9. **Push real en segundo plano** (development build + servicio de push).

## Generar el APK (EAS)

Requiere una cuenta Expo (`npm i -g eas-cli && eas login`).

```bash
cd duo-app
eas build -p android --profile preview   # genera un APK instalable
```

- `preview` → **APK** con `distribution: internal` (para instalar y probar).
- `production` → **AAB** (para Play Store), con incremento automático de versión.

El `eas.json` ya viene configurado. El paquete Android es `com.duo.app`
(cámbialo en `app.json` si publicas).

## Notas

- Los retos están pensados para **parejas adultas y consentidas**. La app no
  incluye contenido explícito; el nivel "Atrevido" es una invitación, no contenido
  gráfico.
- Sin sesión vinculada, la app corre en modo maqueta con datos simulados.
- Las notificaciones son **locales** (al recibir un mensaje con la app en segundo
  plano). Para push en segundo plano real con la app cerrada se necesita un
  *development build* con `expo-notifications` + servidor de push.

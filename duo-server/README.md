# Duo Server 💞

Backend de **Duo**: vinculación de parejas por código, chat en tiempo real y
fotos cifradas, con persistencia en SQLite (`node:sqlite`, sin dependencias
nativas).

## Requisitos

- Node.js 22.5+ (necesita `node:sqlite`).
- En Termux el shebang de `npm` puede estar roto; usa:
  `node "$(command -v npm)" install`

## Instalar y correr

```bash
cd duo-server
npm install
npm start          # o: node src/index.js
```

Escucha en `http://localhost:4000` (cambia el puerto con `PORT=xxxx npm start`).

## Privacidad (importante)

- Cada pareja tiene un **token secreto** (`token`, 32 caracteres) que se genera
  al crear el vínculo. Ambos miembros lo conocen; **sin él no hay acceso** a
  mensajes, fotos ni a la sala de sockets.
- Los mensajes de texto viajan y se guardan **cifrados** (E2E hecho en el
  cliente): el servidor solo almacena `ciphertext` + `nonce` y no puede leerlos.
- Las fotos llegan **cifradas** (bytes AES-256-GCM) y se guardan como `.bin`
  ilegibles en `uploads/`. El servidor nunca ve el contenido.
- Los endpoints privados validan `token` (header `x-duo-token`) **y** que el
  `userId` sea miembro de la pareja. El socket `join` hace lo mismo; sin token
  válido no se entra a la sala, y los mensajes usan el `coupleId` validado
  (no el que manda el cliente), así que no se puede inyectar en otras parejas.

## API REST

| Método | Ruta | Auth | Descripción |
| ------ | ---- | ---- | ----------- |
| GET  | `/health` | — | Estado del servidor |
| POST | `/api/pair/create` | — | Body `{ name, emoji, pubKey }` → devuelve `userId`, `coupleId`, `code`, `token` |
| POST | `/api/pair/join` | — | Body `{ code, name, emoji, pubKey }` |
| GET  | `/api/couple/:coupleId?userId=` | token | Info de la pareja (yo + partner) |
| GET  | `/api/messages/:coupleId?userId=` | token | Historial (con `ciphertext`) |
| POST | `/api/photo` | token | Body `{ coupleId, senderId, nonceB64, imageDataB64 }` (foto ya cifrada) |
| GET  | `/uploads/:archivo` | — | Archivos `.bin` cifrados (inútiles sin la clave de la pareja) |

La autenticación es con header `x-duo-token: <token de la pareja>`.

## Socket.io (tiempo real)

Cliente emite:

- `join` → `{ coupleId, userId, token }` (validado; sin token válido → `auth_error`)
- `message` → `{ ciphertextB64, nonce }` (el `coupleId`/`senderId` se toman de lo validado)
- `typing` → `{ isTyping }`

Servidor emite:

- `message` → mensaje persistido (con `ciphertextB64` para textos, `url` para fotos)
- `typing` → `{ userId, isTyping }`
- `partner_joined` → `{ partner }`
- `auth_error` → `{ error }` (token inválido)

## Modelo de datos (SQLite)

- `users(id, name, emoji, pub_key, created_at)`
- `couples(id, code, token, created_at)`
- `couple_members(couple_id, user_id, slot)` — máximo 2 por pareja
- `messages(id, couple_id, sender_id, type, text, ciphertext, url, nonce, created_at)`

## Tests

Con el servidor corriendo:

```bash
npm test         # sockets + auth + persistencia (15 verificaciones)
npm run test:e2e # flujo integral con el crypto REAL de la app:
                 # A y B se vinculan, texto y foto de extremo a extremo,
                 # historial descifrable, tercero excluido
```

## Notas

- Las tablas se migran solas al arrancar (las columnas `token` y `ciphertext`
  se agregan si faltan).
- `duo.db` y `uploads/` contienen datos de las parejas: **no los subas a git**
  (ya están en `.gitignore`).

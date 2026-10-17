# Duo Server 💞

Backend de **Duo**: vinculación de parejas por código, chat en tiempo real,
subida de fotos y persistencia en SQLite (usando `node:sqlite`, sin dependencias
nativas).

## Requisitos

- Node.js 22.5+ (probado en Node 26). Necesita `node:sqlite`.
- En Termux el shebang de `npm` puede estar roto; usa:
  `node "$(command -v npm)" install`

## Instalar y correr

```bash
cd duo-server
node "$(command -v npm)" install
npm start          # o: node src/index.js
```

Escucha en `http://localhost:4000`.

## API REST

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| GET  | `/health` | Estado del servidor |
| POST | `/api/pair/create` | Crea pareja + código. Body `{ name, emoji }` |
| POST | `/api/pair/join`   | Se une con `{ code, name, emoji }` |
| GET  | `/api/couple/:coupleId?userId=` | Info de la pareja (yo + partner) |
| GET  | `/api/messages/:coupleId` | Historial de mensajes |
| POST | `/api/upload` | Sube foto (multipart: `coupleId`, `senderId`, `photo`) |
| GET  | `/uploads/:archivo` | Sirve las fotos subidas |

## Socket.io (tiempo real)

Cliente emite:

- `join` → `{ coupleId, userId }` (entra a la sala de la pareja)
- `message` → `{ coupleId, senderId, text }`
- `typing` → `{ coupleId, userId, isTyping }`

Servidor emite:

- `message` → mensaje persistido (texto o foto)
- `typing` → `{ userId, isTyping }`
- `partner_joined` → `{ partner }`

## Modelo de datos (SQLite)

- `users(id, name, emoji, created_at)`
- `couples(id, code, created_at)`
- `couple_members(couple_id, user_id, slot)` — máximo 2 por pareja
- `messages(id, couple_id, sender_id, type, text, url, created_at)`

## Probar el tiempo real

Con el servidor corriendo:

```bash
node test/socket-test.js
```

Crea dos usuarios, los vincula, envía un mensaje por socket y verifica que el
otro lo reciba, el estado `typing` y la persistencia.

## Notas de privacidad

- Cada pareja tiene su propia sala (`coupleId`); solo los 2 miembros la ven.
- No incluye cifrado extremo a extremo todavía (ver README de la app → siguientes pasos).

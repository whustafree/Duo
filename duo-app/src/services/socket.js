import { io } from "socket.io-client";
import { SOCKET_URL } from "../config";

let socket = null;

export function connectSocket({ coupleId, userId, token }) {
  if (socket) socket.disconnect();
  socket = io(SOCKET_URL, { transports: ["websocket"], reconnection: true });
  socket.on("connect", () => {
    // El servidor valida coupleId + userId contra el token; sin token válido
    // no se entra a la sala.
    socket.emit("join", { coupleId, userId, token });
  });
  return socket;
}

export function getSocket() {
  return socket;
}

// El mensaje viaja cifrado: el servidor solo guarda y reenvía el ciphertext.
export function sendMessage({ ciphertextB64, nonce }) {
  socket?.emit("message", { ciphertextB64, nonce });
}

export function sendTyping({ isTyping }) {
  socket?.emit("typing", { isTyping: !!isTyping });
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

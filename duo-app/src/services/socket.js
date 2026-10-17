import { io } from "socket.io-client";
import { SOCKET_URL } from "../config";

let socket = null;

export function connectSocket({ coupleId, userId }) {
  if (socket) socket.disconnect();
  socket = io(SOCKET_URL, { transports: ["websocket"], reconnection: true });
  socket.on("connect", () => {
    socket.emit("join", { coupleId, userId });
  });
  return socket;
}

export function getSocket() {
  return socket;
}

export function sendMessage({ coupleId, senderId, text }) {
  socket?.emit("message", { coupleId, senderId, text });
}

export function sendTyping({ coupleId, userId, isTyping }) {
  socket?.emit("typing", { coupleId, userId, isTyping });
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

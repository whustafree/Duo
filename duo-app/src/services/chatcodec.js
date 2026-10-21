// Codificación de mensajes del chat con contenido estructurado:
//  - Texto normal: se envía TAL CUAL (compatibilidad con versiones antiguas).
//  - Con respuesta citada o reacción: JSON pequeño con marca `__duo`.
//    Los teléfonos con versión antigua lo verían como texto crudo, y al
//    revés: un JSON viejo que no entendamos se muestra como texto.

const MARK = "__duo";
const V = 1;

export const REACTIONS = ["😍", "😘", "🔥", "😂", "🥺", "❤️"];

export function encodeText(text, replyTo = null) {
  const clean = String(text ?? "");
  if (!replyTo || !replyTo.id) return clean;
  return JSON.stringify({
    [MARK]: V,
    type: "text",
    text: clean,
    replyTo: {
      id: String(replyTo.id),
      from: replyTo.from === "me" ? "me" : "them",
      kind: replyTo.kind || "text",
      preview: String(replyTo.preview ?? "").slice(0, 140),
    },
  });
}

export function encodeReaction(targetId, emoji) {
  return JSON.stringify({
    [MARK]: V,
    type: "reaction",
    target: String(targetId),
    emoji: String(emoji || "").slice(0, 8),
  });
}

// Token de push de ESTE teléfono (Expo Push). Viaja cifrado de extremo a
// extremo como cualquier mensaje, pero es señalización interna: la pareja lo
// guarda sin crear burbuja ni aviso (sirve para "despertar" la app cuando
// este teléfono está desconectado).
export function encodePushToken(token) {
  return JSON.stringify({
    [MARK]: V,
    type: "push-token",
    token: String(token || "").slice(0, 200),
  });
}

// Devuelve { type: "text" | "reaction" | "push-token", ... }
export function decodeChat(raw) {
  const fallback = { type: "text", text: String(raw ?? ""), replyTo: null };
  if (typeof raw !== "string" || !raw.startsWith("{")) return fallback;
  try {
    const obj = JSON.parse(raw);
    if (!obj || obj[MARK] !== V) return fallback;
    if (obj.type === "push-token" && obj.token) {
      return {
        type: "push-token",
        text: "",
        token: String(obj.token).slice(0, 200),
      };
    }
    if (obj.type === "reaction" && obj.target) {
      return {
        type: "reaction",
        text: "",
        target: String(obj.target),
        emoji: String(obj.emoji || "").slice(0, 8),
      };
    }
    if (obj.type === "text") {
      const rt = obj.replyTo;
      return {
        type: "text",
        text: typeof obj.text === "string" ? obj.text : "",
        replyTo:
          rt && rt.id
            ? {
                id: String(rt.id),
                // `from` se guarda visto desde el emisor; aquí lo damos
                // vuelta para que quien recibe lo vea con su propia perspectiva.
                from: rt.from === "me" ? "them" : "me",
                kind: rt.kind || "text",
                preview: String(rt.preview ?? "").slice(0, 140),
              }
            : null,
      };
    }
    return fallback;
  } catch {
    return fallback;
  }
}

// Vista de un mensaje para decidir la interfaz (una sola fuente de verdad):
//   queued   -> aún no ha salido de este teléfono (reloj)
//   failed   -> se intentó y falló (arro de reintento)
//   sent     -> publicado en el relay, esperando a la pareja (✓)
//   delivered-> la pareja lo recibió (✓✓)
//   read     -> la pareja lo leyó con la app abierta (✓✓ verde)
export function deliveryState(row) {
  if (!row || row.from !== "me") return "received";
  if (row.read) return "read";
  if (row.pending === false) return "delivered";
  if (row.failed) return "failed";
  if (row.sent) return "sent";
  return "queued";
}

export const STATE_MARK = {
  received: "",
  queued: " ⏳",
  failed: " ⭕",
  sent: " ✓",
  delivered: " ✓✓",
  read: " ✓✓",
};

// Lógica PURA del push "despertador" (sin React Native, para probarla en Node).
//
// Cómo funciona: cuando este teléfono envía un mensaje y la pareja está
// DESCONECTADA (su socket murió al minimizar, la app cerrada…), además de
// publicar en el relay se le envía un aviso genérico por Expo Push Service
// (gratis, sin límite de mensajes, sin servidor propio). El aviso despierta
// la app de la pareja en segundo plano: se conecta, el broker le entrega los
// mensajes encolados (sesión persistente + QoS 1) y ella muestra el aviso
// local con el contenido ya descifrado.
//
// PRIVACIDAD: el push NUNCA lleva el contenido del mensaje, ni el nombre de
// la pareja, ni nada vuestra conversación: solo "hay algo nuevo". Ni Expo ni
// Google ven más que eso (igual que el broker solo ve metadatos).

export const PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
export const WAKE_PUSH_GAP_MS = 45000; // como mucho un push cada 45 s

export function isValidPushToken(token) {
  return typeof token === "string" && token.startsWith("ExponentPushToken[");
}

// Cuerpo del aviso genérico (formato Expo Push API).
export function buildWakePush(token) {
  return {
    to: String(token),
    sound: "default",
    priority: "high",
    channelId: "duo-mensajes",
    ttl: 3600, // si la pareja no aparece en una hora, el aviso caduca solo
    title: "Duo 💞",
    body: "Tienes un mensaje nuevo 🔒",
    data: { duo: "wake" },
  };
}

// ¿Toca enviar el aviso "despertador"? Solo si la pareja está desconectada,
// tenemos su token y ha pasado el hueco mínimo (para no martillear a Expo ni
// a la pareja si manda varios mensajes seguidos).
export function shouldWakePush({
  hasToken,
  online,
  lastSentAt = 0,
  now = Date.now(),
  gapMs = WAKE_PUSH_GAP_MS,
}) {
  if (!hasToken || online) return false;
  return now - lastSentAt >= gapMs;
}

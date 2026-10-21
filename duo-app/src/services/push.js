// Push "despertador" vía Expo Push Service (gratis, sin límite de mensajes).
// La parte PURA (cuerpo del aviso y decisión de envío) vive en pushproto.js.
//
// - registerForPush(): obtiene el token de ESTE teléfono. Sin proyecto
//   configurado (falta google-services.json / projectId) devuelve null y la
//   app sigue funcionando igual, solo que sin avisos en segundo plano.
// - sendWakePush(token): envía el aviso genérico. El contenido real del
//   mensaje viaja por el relay cifrado; esto solo despierta a la pareja.

import * as Notifications from "expo-notifications";
import { PUSH_ENDPOINT, buildWakePush, isValidPushToken } from "./pushproto";

let cachedToken = null;

export async function registerForPush() {
  if (cachedToken) return cachedToken;
  try {
    const res = await Notifications.getExpoPushTokenAsync();
    if (isValidPushToken(res?.data)) {
      cachedToken = res.data;
      return cachedToken;
    }
  } catch (e) {
    console.warn("Sin push (token no disponible):", e?.message);
  }
  return null;
}

export async function sendWakePush(token) {
  if (!isValidPushToken(token)) return false;
  try {
    const res = await fetch(PUSH_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildWakePush(token)),
    });
    return !!(res && res.ok);
  } catch {
    return false;
  }
}

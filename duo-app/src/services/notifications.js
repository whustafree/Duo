import * as Notifications from "expo-notifications";

let configured = false;

export function configureNotifications() {
  if (configured) return;
  configured = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch (e) {
    console.warn("No se pudo configurar notificaciones:", e.message);
  }
}

export async function requestNotificationPermission() {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === "granted") return true;
    const req = await Notifications.requestPermissionsAsync();
    return req.granted || req.status === "granted";
  } catch {
    return false;
  }
}

export async function notifyNewMessage({ title, body }) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger: null,
    });
  } catch (e) {
    console.warn("No se pudo mostrar la notificación:", e.message);
  }
}

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
  // Canal con prioridad alta para que el aviso salga en forma de cartel
  // (heads-up) incluso con la app cerrada o en segundo plano.
  try {
    Notifications.setNotificationChannelAsync("duo-mensajes", {
      name: "Mensajes",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF4D6D",
      bypassDnd: false,
    });
  } catch (e) {
    console.warn("No se pudo crear el canal de avisos:", e.message);
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

// `hidden` llega desde quien llama: si el usuario pidió ocultar el contenido
// (o está con la app bloqueada), el aviso no cuenta nada, solo que hay algo.
export async function notifyNewMessage({ title, body, hidden = false }) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: hidden ? "Duo 💞" : title,
        body: hidden ? "Tienes un mensaje nuevo 🔒" : body,
        sound: true,
        channelId: "duo-mensajes",
      },
      trigger: null,
    });
  } catch (e) {
    console.warn("No se pudo mostrar la notificación:", e.message);
  }
}

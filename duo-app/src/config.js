// Datos públicos del proyecto: enlace de descarga para invitar a la pareja y
// textos listos para compartir. No contienen nada privado.
//
// El APK se publica en GitHub Releases con un nombre ESTABLE ("duo.apk") en cada
// versión, de modo que este enlace siempre apunta a la última descarga.

export const REPO_URL = "https://github.com/whustafree/Duo";
export const RELEASES_URL = `${REPO_URL}/releases/latest`;
export const APP_DOWNLOAD_URL = `${RELEASES_URL}/download/duo.apk`;

// Mensaje para invitar a la pareja (se comparte por WhatsApp, Telegram, etc.).
export const INVITE_MESSAGE =
  `💞 Te invito a Duo, nuestra app privada para los dos.\n\n` +
  `1) Descarga la app aquí: ${APP_DOWNLOAD_URL}\n` +
  `2) Ábrela, pon tu nombre y elige «Pegar un código» con el que yo te envíe.\n\n` +
  `Todo va cifrado de extremo a extremo: solo nosotros podemos leerlo. 🔒`;

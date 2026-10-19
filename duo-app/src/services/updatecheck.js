import AsyncStorage from "@react-native-async-storage/async-storage";
import appJson from "../../app.json";
import { APP_DOWNLOAD_URL } from "../config";
import { isNewer } from "./version";

// Aviso de nuevas versiones: mira GitHub Releases (público, sin backend propio)
// y solo avisa cuando hay una versión MÁS NUEVA que la instalada. Como mucho
// consulta una vez cada 6 horas y no insiste con la versión ya descartada.

const API_URL = "https://api.github.com/repos/whustafree/Duo/releases/latest";
const COOLDOWN_MS = 6 * 60 * 60 * 1000;
const KEY_LAST = "duo.update.lastCheck";
const KEY_SEEN = "duo.update.seen";

export function currentVersion() {
  return (appJson && appJson.expo && appJson.expo.version) || "0.0.0";
}

// Devuelve { version, tag, url } si hay actualización, o null.
export async function checkForUpdate(force = false) {
  try {
    if (!force) {
      const last = Number(await AsyncStorage.getItem(KEY_LAST)) || 0;
      if (Date.now() - last < COOLDOWN_MS) return null;
    }
    const res = await fetch(API_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    AsyncStorage.setItem(KEY_LAST, String(Date.now())).catch(() => {});
    if (!res || !res.ok) return null;
    const data = await res.json();
    const tag = data.tag_name || "";
    if (!isNewer(tag, currentVersion())) return null;
    const seen = await AsyncStorage.getItem(KEY_SEEN);
    if (seen === tag) return null;
    return {
      tag,
      version: String(tag).replace(/^v/, ""),
      url: APP_DOWNLOAD_URL,
    };
  } catch {
    return null;
  }
}

// El usuario ya descartó esta versión: no volver a avisar hasta la siguiente.
export async function dismissUpdate(tag) {
  try {
    await AsyncStorage.setItem(KEY_SEEN, String(tag));
  } catch {}
}

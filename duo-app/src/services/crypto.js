import AsyncStorage from "@react-native-async-storage/async-storage";
import { generateKeyPair as generate, hasKeys as hasKeysRaw } from "./cryptocore";

// Capa de almacenamiento de la identidad criptográfica del dispositivo.
// El núcleo puro (X25519 + HKDF + AES-GCM, y todo lo P2P) vive en
// ./cryptocore.js y ./protocol.js; aquí solo guardamos/cargamos el par de
// claves en el AsyncStorage. La clave privada NUNCA sale del dispositivo.

const KEY_STORAGE = "duo.e2e.keys";

export async function loadOrGenerateKeys() {
  try {
    const raw = await AsyncStorage.getItem(KEY_STORAGE);
    if (raw) return JSON.parse(raw);
  } catch {}

  const keys = generate();
  try {
    await AsyncStorage.setItem(KEY_STORAGE, JSON.stringify(keys));
  } catch {}
  return keys;
}

export function hasKeys(k) {
  return hasKeysRaw(k);
}

export * from "./cryptocore";

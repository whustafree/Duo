import AsyncStorage from "@react-native-async-storage/async-storage";
import { encryptWithKey, decryptWithKey } from "./cryptocore";

// Cofre local: guarda la copia de mensajes (AsyncStorage) cifrada con la clave
// del bloqueo cuando está activa, y en claro cuando no.
//
//  - Sin modo conocido todavía (arrancando): NO escribe nada en claro.
//  - Modo cifrado sin desbloquear: tampoco escribe (mejor perder un guardado
//    transitorio que filtrar texto).
//  - Dato de versiones antiguas (en claro) con la clave puesta: se lee igual
//    y la siguiente escritura ya sale cifrada (migración automática).

let key = null;
let ready = false;
const waiters = [];
const listeners = [];

function release() {
  ready = true;
  waiters.splice(0).forEach((w) => w());
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}

// La clave de cifrado está puesta (o no hay cifrado: modo claro).
export function setVaultKey(newKey) {
  key = newKey || null;
  release();
}

// El usuario no ha activado el cifrado: se guarda en claro.
export function markVaultPlain() {
  key = null;
  release();
}

// ¿Ya sabemos el modo (y está la clave si la necesita)?
export function vaultIsReady() {
  return ready;
}

// Resuelve cuando ya sabemos el modo (y está la clave si la necesita).
export function vaultReady() {
  if (ready) return Promise.resolve();
  return new Promise((res) => waiters.push(res));
}

// Avisos para que quien guarda datos reescriba al cambiar de modo.
export function onVaultChange(fn) {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export async function vaultGet(storageKey) {
  try {
    await vaultReady();
    const raw = await AsyncStorage.getItem(storageKey);
    if (raw == null) return null;
    if (key) {
      try {
        const env = JSON.parse(raw);
        if (env && env.v === 1 && env.ct) {
          return decryptWithKey(key, env.ct, env.nonce);
        }
      } catch {}
      return raw; // dato en claro de antes de activar el cifrado
    }
    return raw;
  } catch {
    return null;
  }
}

export async function vaultSet(storageKey, value) {
  try {
    if (!ready) return; // aún no sabemos si debe ir en claro o cifrado
    if (key) {
      const env = encryptWithKey(key, value);
      await AsyncStorage.setItem(
        storageKey,
        JSON.stringify({ v: 1, ct: env.ciphertextB64, nonce: env.nonceB64 })
      );
    } else {
      await AsyncStorage.setItem(storageKey, value);
    }
  } catch {}
}

// Borrado: la clave de almacenamiento da igual (es removeItem igualmente).
export async function vaultRemove(storageKey) {
  try {
    await AsyncStorage.removeItem(storageKey);
  } catch {}
}

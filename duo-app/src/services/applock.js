import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import { newPinSalt, pinHash, deriveLocalKey } from "./cryptocore";
import { setVaultKey, markVaultPlain, vaultReady } from "./localvault";

// Bloqueo de la app: PIN (con sal, nunca se guarda el PIN) y/o huella.
// El PIN además deriva la clave que cifra la copia local de mensajes.
//
// Reglas:
//  - Cifrado activo ⇒ hay PIN y se pide PIN para abrir (la huella sola no
//    puede descifrar la copia, porque no existe clave sin el PIN).
//  - Sin cifrado ⇒ la huella (si hay) abre directo; el PIN es el respaldo.

const K = {
  pin: "duo.lock.pin",
  salt: "duo.lock.salt",
  hash: "duo.lock.hash",
  bio: "duo.lock.bio",
  enc: "duo.lock.encrypt",
  hidden: "duo.notif.hidden",
  stealth: "duo.stealth.enabled",
};

let state = {
  loaded: false,
  pin: false,
  bio: false,
  encrypt: false,
  hidden: false,
  stealth: false,
};

// Quien muestre la interfaz (p. ej. la puerta de bloqueo) puede suscribirse
// para refrescar cuando cambien los ajustes desde Perfil.
const listeners = [];
export function onLockStateChange(fn) {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}
function emit() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {}
  }
}

export async function loadLockState() {
  try {
    const pairs = await AsyncStorage.multiGet(Object.values(K));
    const m = {};
    for (const [k, v] of pairs) m[k] = v;
    state = {
      loaded: true,
      pin: m[K.pin] === "1",
      bio: m[K.bio] === "1",
      encrypt: m[K.enc] === "1",
      hidden: m[K.hidden] === "1",
      stealth: m[K.stealth] === "1",
    };
  } catch {
    state = { ...state, loaded: true };
  }
  // Sin cifrado activo la copia va en claro y ya podemos operar; con cifrado
  // el cofre queda a la espera del PIN (vaultReady resuelve al desbloquear).
  if (!state.encrypt) markVaultPlain();
  return state;
}

export function lockState() {
  return state;
}

// ¿El contenido de los avisos debe ocultarse?
export function shouldHideContent() {
  return !!state.hidden;
}

export async function biometricsAvailable() {
  try {
    const hw = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    return !!(hw && enrolled);
  } catch {
    return false;
  }
}

// Crea (o sustituye) el PIN. `encrypt` cifra la copia local con ese PIN.
export async function setupPin(pin, { bio = false, encrypt = true } = {}) {
  const salt = newPinSalt();
  const hash = pinHash(pin, salt);
  await AsyncStorage.multiSet([
    [K.pin, "1"],
    [K.salt, salt],
    [K.hash, hash],
    [K.bio, bio ? "1" : "0"],
    [K.enc, encrypt ? "1" : "0"],
  ]);
  state = { ...state, pin: true, bio, encrypt };
  // Por defecto, los avisos no enseñan el contenido mientras la app esté
  // bloqueada (el usuario puede volver a activarlo en Perfil).
  state.hidden = true;
  await AsyncStorage.setItem(K.hidden, "1");
  if (encrypt) setVaultKey(deriveLocalKey(pin, salt));
  else markVaultPlain();
  emit();
}

// Solo huella, sin PIN (sin cifrado de la copia).
export async function enableBioOnly() {
  await AsyncStorage.multiSet([
    [K.pin, "0"],
    [K.bio, "1"],
    [K.enc, "0"],
    [K.salt, ""],
    [K.hash, ""],
  ]);
  state = { ...state, pin: false, bio: true, encrypt: false };
  state.hidden = true;
  await AsyncStorage.setItem(K.hidden, "1");
  markVaultPlain();
  emit();
}

// Activa o desactiva la huella cuando ya hay PIN (sin tocar la clave). Con el
// cifrado activo la huella NO puede abrir la copia (no hay clave sin el PIN),
// así que aporta algo solo si la copia local no va cifrada.
export async function setBioEnabled(v) {
  state = { ...state, bio: !!v };
  await AsyncStorage.setItem(K.bio, v ? "1" : "0");
  emit();
}

export async function disableLock() {
  await AsyncStorage.multiRemove([K.pin, K.salt, K.hash, K.bio, K.enc]);
  state = { ...state, pin: false, bio: false, encrypt: false };
  markVaultPlain(); // quien guardaba reescribirá en claro
  emit();
}

export async function verifyPin(pin) {
  try {
    const salt = await AsyncStorage.getItem(K.salt);
    const hash = await AsyncStorage.getItem(K.hash);
    if (!salt || !hash) return false;
    return pinHash(pin, salt) === hash;
  } catch {
    return false;
  }
}

// Desbloqueo con PIN: si el cifrado está activo, además entrega la clave al
// cofre local (vaultReady resuelve y el chat puede cargar la copia).
export async function unlockWithPin(pin) {
  const good = await verifyPin(pin);
  if (!good) return false;
  if (state.encrypt) {
    try {
      const salt = await AsyncStorage.getItem(K.salt);
      setVaultKey(deriveLocalKey(pin, salt || ""));
      return true;
    } catch {
      return false;
    }
  }
  return true;
}

// Desbloqueo con huella: solo sirve cuando NO está activo el cifrado local.
export async function unlockWithBio() {
  if (!state.bio || state.encrypt) return false;
  try {
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage: "Desbloquear Duo",
      cancelLabel: "Cancelar",
    });
    return !!(r && r.success);
  } catch {
    return false;
  }
}

export async function setHiddenNotifications(v) {
  state = { ...state, hidden: !!v };
  await AsyncStorage.setItem(K.hidden, v ? "1" : "0");
  emit();
}

export async function setStealth(v) {
  state = { ...state, stealth: !!v };
  await AsyncStorage.setItem(K.stealth, v ? "1" : "0");
  emit();
}

// ¿Esperamos al cofre? (para no leer la copia sin la clave)
export { vaultReady };

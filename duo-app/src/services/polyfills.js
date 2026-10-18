import * as Crypto from "expo-crypto";

// Hermes (React Native) NO expone Web Crypto, y los módulos @noble/* necesitan
// globalThis.crypto.getRandomValues para generar claves, nonces y secretos.
// Este polyfill usa el RNG nativo del sistema (SecureRandom en Android /
// SecRandomCopyBytes en iOS). Se importa ANTES que todo lo demás (ver index.js).
if (
  typeof globalThis.crypto === "undefined" ||
  typeof globalThis.crypto.getRandomValues !== "function"
) {
  globalThis.crypto = {
    getRandomValues(arr) {
      const rnd = Crypto.getRandomBytes(arr.length);
      arr.set(rnd);
      return arr;
    },
  };
}

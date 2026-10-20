import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme";
import {
  unlockWithPin,
  unlockWithBio,
  disableLock,
} from "../services/applock";

// Pantalla de bloqueo: PIN (4 a 6 dígitos) o huella, según cómo lo haya
// configurado la pareja en "Nosotros › Privacidad".
//
//   mode="unlock" → pide PIN o huella para entrar.
//   mode="create" → flujo de creación (introduce + confirma) para el ajuste.

export default function LockScreen({
  mode = "unlock",
  lockState = null,
  onUnlock,
  onDone,
  onCancel,
}) {
  const creating = mode === "create";
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState(null); // en creación, 1ª vuelta guardada
  const [error, setError] = useState("");
  const [bioMsg, setBioMsg] = useState("Desbloqueando con la huella…");
  const needBio = !creating && lockState && !lockState.pin && lockState.bio;

  const fail = useCallback((msg) => {
    setError(msg);
    setPin("");
    if (navigator?.vibrate) navigator.vibrate(120);
  }, []);

  // Modo solo huella: intentamos al abrir; si el dedo ya no está registrado,
  // desactivamos el bloqueo (la copia local no va cifrada en este modo).
  useEffect(() => {
    if (!needBio) return;
    let alive = true;
    (async () => {
      const ok = await unlockWithBio();
      if (!alive) return;
      if (ok) {
        onUnlock && onUnlock();
      } else {
        setBioMsg("Toca el sensor de huella para entrar");
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needBio]);

  const tryBio = async () => {
    setBioMsg("Desbloqueando con la huella…");
    const ok = await unlockWithBio();
    if (ok) onUnlock && onUnlock();
    else setBioMsg("No se reconoció la huella. Inténtalo otra vez.");
  };

  const press = async (d) => {
    if (error) setError("");
    const next = (pin + d).slice(0, 6);
    setPin(next);
    if (creating) return; // la comparación de vueltas está en el useEffect
    if (next.length < 4) return;

    const ok = await unlockWithPin(next);
    if (ok) {
      onUnlock && onUnlock();
    } else {
      fail("PIN incorrecto");
    }
  };

  // Creación: al llegar a 4-6 dígitos comparamos con la primera vuelta.
  useEffect(() => {
    if (!creating || pin.length < 4) return;
    if (confirm === null) {
      setConfirm(pin);
      setPin("");
      return;
    }
    if (pin === confirm) {
      onDone && onDone(pin);
    } else {
      fail("Los PIN no coinciden. Empieza otra vez.");
      setConfirm(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, confirm, creating]);

  const back = () => {
    if (pin.length > 0) setPin(pin.slice(0, -1));
    else if (creating && onCancel) onCancel();
  };

  const forgot = () => {
    Alert.alert(
      "¿Olvidaste el PIN?",
      "Se borrará la copia local de mensajes de ESTE teléfono (en el teléfono de " +
        "tu pareja se conserva todo). Después podrás crear un PIN nuevo.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Borrar y restablecer",
          style: "destructive",
          onPress: async () => {
            await disableLock();
            onUnlock && onUnlock();
          },
        },
      ]
    );
  };

  return (
    <View style={styles.wrap}>
      <StatusBar style="light" />
      <Text style={styles.emoji}>💞</Text>
      <Text style={styles.title}>
        {creating
          ? confirm === null
            ? "Crea tu PIN"
            : "Repite tu PIN"
          : needBio
          ? "Duo está bloqueado"
          : "Introduce tu PIN"}
      </Text>
      <Text style={styles.hint}>
        {creating
          ? "De 4 a 6 dígitos. Sirve para abrir la app y para cifrar tu copia de mensajes."
          : needBio
          ? bioMsg
          : "Tu PIN nunca sale de este teléfono; solo se guarda su resumen."}
      </Text>

      {needBio ? (
        <Pressable style={styles.bioBtn} onPress={tryBio}>
          <Ionicons name="finger-print" size={40} color={colors.primary} />
          <Text style={styles.bioText}>Usar huella</Text>
        </Pressable>
      ) : (
        <>
          <View style={styles.dots}>
            {Array.from({ length: Math.max(confirm !== null ? confirm.length : 4, 4) }).map(
              (_, i) => (
                <View
                  key={i}
                  style={[styles.dot, i < pin.length && styles.dotOn]}
                />
              )
            )}
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.pad}>
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map(
              (k, i) => (
                <Pressable
                  key={i}
                  style={[styles.key, k === "" && styles.keyEmpty]}
                  disabled={k === ""}
                  onPress={() => k && press(k)}
                >
                  <Text style={styles.keyText}>{k}</Text>
                </Pressable>
              )
            )}
          </View>
          {!creating && lockState?.pin ? (
            <Pressable onPress={forgot} hitSlop={8}>
              <Text style={styles.forgot}>¿Olvidaste el PIN?</Text>
            </Pressable>
          ) : null}
          {creating && onCancel ? (
            <Pressable onPress={onCancel} hitSlop={8}>
              <Text style={styles.forgot}>Cancelar</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  emoji: { fontSize: 54, marginBottom: spacing.md },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    marginBottom: spacing.xs,
    textAlign: "center",
  },
  hint: {
    color: colors.muted,
    fontSize: 13,
    textAlign: "center",
    marginBottom: spacing.lg,
    lineHeight: 19,
    paddingHorizontal: spacing.md,
  },
  dots: {
    flexDirection: "row",
    gap: 14,
    marginBottom: spacing.lg,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.muted,
  },
  dotOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  error: { color: "#FF7A8A", marginBottom: spacing.sm, fontSize: 13 },
  pad: {
    flexDirection: "row",
    flexWrap: "wrap",
    width: 264,
    justifyContent: "center",
  },
  key: {
    width: 88,
    height: 66,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
  },
  keyEmpty: { opacity: 0 },
  keyText: { color: colors.text, fontSize: 26, fontWeight: "600" },
  bioBtn: { alignItems: "center", padding: spacing.lg },
  bioText: { color: colors.primary, fontSize: 16, fontWeight: "700", marginTop: 8 },
  forgot: { color: colors.muted, marginTop: spacing.lg, fontSize: 13 },
});

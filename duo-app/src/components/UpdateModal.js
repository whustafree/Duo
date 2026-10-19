import { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  Linking,
  AppState,
} from "react-native";
import { colors, radius, spacing } from "../theme";
import {
  checkForUpdate,
  dismissUpdate,
  currentVersion,
} from "../services/updatecheck";
import { APP_DOWNLOAD_URL } from "../config";

// Aviso de actualización: se muestra al abrir la app (y al volver a primer
// plano) cuando GitHub Releases tiene una versión más nueva. Una vez descartada
// esa versión, no vuelve a molestar hasta que salga otra nueva.
export default function UpdateModal() {
  const [info, setInfo] = useState(null);

  const run = async () => {
    if (info) return;
    const found = await checkForUpdate(false);
    if (found) setInfo(found);
  };

  useEffect(() => {
    run();
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") run();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!info) return null;

  const close = async () => {
    await dismissUpdate(info.tag);
    setInfo(null);
  };

  const open = async () => {
    await dismissUpdate(info.tag);
    try {
      await Linking.openURL(APP_DOWNLOAD_URL);
    } catch {}
    setInfo(null);
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={close}>
      <View style={styles.back}>
        <View style={styles.card}>
          <Text style={styles.emoji}>✨</Text>
          <Text style={styles.title}>Nueva versión de Duo</Text>
          <Text style={styles.text}>
            Tienes la {currentVersion()} y ya está la {info.version}. Instálala
            para tener lo último: tus mensajes siguen igual de privados (todo va
            cifrado solo para ustedes dos). 🔒
          </Text>
          <Pressable style={styles.primary} onPress={open}>
            <Text style={styles.primaryText}>Descargar e instalar</Text>
          </Pressable>
          <Pressable style={styles.ghost} onPress={close}>
            <Text style={styles.ghostText}>Más tarde</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  back: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: "center",
  },
  emoji: { fontSize: 40 },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    marginTop: spacing.sm,
    textAlign: "center",
  },
  text: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginTop: spacing.sm,
  },
  primary: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    height: 50,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.lg,
  },
  primaryText: { color: colors.white, fontSize: 16, fontWeight: "800" },
  ghost: { marginTop: spacing.sm, padding: spacing.sm },
  ghostText: { color: colors.muted, fontSize: 14, fontWeight: "600" },
});

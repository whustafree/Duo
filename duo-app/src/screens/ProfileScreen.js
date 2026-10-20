import { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Share,
  Linking,
  Modal,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme";
import Avatar from "../components/Avatar";
import LockScreen from "../components/LockScreen";
import { useSession } from "../context/SessionContext";
import { useE2E } from "../context/E2EContext";
import { useP2P } from "../context/P2PContext";
import { verificationCode } from "../services/cryptocore";
import {
  lockState,
  onLockStateChange,
  setupPin,
  enableBioOnly,
  setBioEnabled,
  disableLock,
  setHiddenNotifications,
  setStealth,
} from "../services/applock";
import { TTL_OPTIONS, parseTtlDays } from "../services/retention";
import { INVITE_MESSAGE, APP_DOWNLOAD_URL } from "../config";

function Stat({ value, label }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Row({ icon, label, value, onPress, danger }) {
  const content = (
    <>
      <Ionicons
        name={icon}
        size={20}
        color={danger ? colors.primary : colors.accent}
      />
      <Text style={[styles.rowLabel, danger && { color: colors.primary }]}>
        {label}
      </Text>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {onPress ? (
        <Ionicons name="chevron-forward" size={18} color={colors.muted} />
      ) : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
    >
      {content}
    </Pressable>
  );
}

const STATUS_TEXT = {
  online: "en línea 💞",
  connecting: "conectando…",
  offline: "sin conexión",
};

export default function ProfileScreen({ navigation }) {
  const { session, clear } = useSession();
  const { keys } = useE2E();
  const {
    status,
    messages,
    clearHistory,
    deleteStoredPhotos,
    wipeAllContent,
  } = useP2P();

  const me = { emoji: session?.myEmoji || "🦊", avatarColor: "#FF6B8B" };
  const partner = {
    emoji: session?.partnerEmoji || "🐰",
    avatarColor: "#7C6BFF",
  };
  const partnerName = session?.partnerName || "tu pareja";
  const linked = !!session?.linked;
  // Mismo código en los dos teléfonos: confirmación visual de que son la pareja
  // correcta (SAS derivado de las claves públicas de ambos).
  const code =
    linked && keys?.publicKeyB64 && session?.partnerPub
      ? verificationCode(keys.publicKeyB64, session.partnerPub)
      : "—";

  // Ajustes de bloqueo y retención de ESTE teléfono.
  const [lock, setLock] = useState(() => ({ ...lockState() }));
  const [ttlDays, setTtlDays] = useState(0);
  const [pinModal, setPinModal] = useState(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem("duo.retention.days").then((raw) => {
      if (alive) setTtlDays(parseTtlDays(raw));
    });
    setLock({ ...lockState() });
    const off = onLockStateChange(() => setLock({ ...lockState() }));
    return () => {
      alive = false;
      off();
    };
  }, []);

  const photos = messages.filter((m) => m.kind === "photo").length;

  const shareInvite = async () => {
    try {
      await Share.share({ message: INVITE_MESSAGE });
    } catch {}
  };

  const openDownload = async () => {
    try {
      const can = await Linking.canOpenURL(APP_DOWNLOAD_URL);
      if (can) await Linking.openURL(APP_DOWNLOAD_URL);
      else Alert.alert("Enlace de descarga", APP_DOWNLOAD_URL);
    } catch {
      Alert.alert("Enlace de descarga", APP_DOWNLOAD_URL);
    }
  };

  const confirmClearHistory = () => {
    Alert.alert(
      "Borrar historial",
      "Se borrarán TODOS los mensajes de este teléfono. La copia de tu pareja no se toca. ¿Continuar?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Borrar",
          style: "destructive",
          onPress: async () => {
            await clearHistory();
            Alert.alert("Listo", "Se borró tu historial de chat.");
          },
        },
      ]
    );
  };

  const confirmDeletePhotos = () => {
    Alert.alert(
      "Borrar fotos",
      "Se borrarán las fotos guardadas por Duo en este teléfono. ¿Continuar?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Borrar",
          style: "destructive",
          onPress: async () => {
            await deleteStoredPhotos();
            Alert.alert(
              "Listo",
              "Se borraron las fotos. Cierra y abre el chat para refrescar."
            );
          },
        },
      ]
    );
  };

  const confirmWipe = () => {
    Alert.alert(
      "Borrar todo el contenido",
      "Se borrarán TODOS los mensajes y las fotos de este teléfono. Esta acción no se puede deshacer. ¿Continuar?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Borrar todo",
          style: "destructive",
          onPress: async () => {
            await wipeAllContent();
            Alert.alert("Listo", "Se borró todo el contenido local.");
          },
        },
      ]
    );
  };

  const confirmUnlink = () => {
    Alert.alert(
      "Desvincular",
      "Se cerrará la sesión y volverás a la pantalla de vinculación. El historial de este teléfono no se borra. ¿Continuar?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Desvincular",
          style: "destructive",
          onPress: () => {
            clear();
            navigation.replace("Onboarding");
          },
        },
      ]
    );
  };

  // ------------------------------------------------- privacidad de la app --
  const disablePinFlow = () => {
    Alert.alert(
      "Desactivar el bloqueo",
      lock.encrypt
        ? "Se quitará el PIN y la huella. Tu copia local de mensajes quedará sin cifrar en este teléfono."
        : "Se quitará el PIN y la huella.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Desactivar",
          style: "destructive",
          onPress: async () => {
            await disableLock();
          },
        },
      ]
    );
  };

  const toggleBio = async () => {
    if (lock.encrypt) {
      Alert.alert(
        "Huella y cifrado",
        "Mientras tu copia local esté cifrada con el PIN, la huella no puede abrirla " +
          "(sin el PIN no existe la clave). Si quieres usar la huella, desactiva el " +
          "bloqueo y créalo otra vez eligiendo «PIN + huella»."
      );
      return;
    }
    if (!lock.pin && !lock.bio) {
      await enableBioOnly();
      return;
    }
    await setBioEnabled(!lock.bio);
  };

  const pickTtl = () => {
    Alert.alert(
      "Auto-destrucción",
      "Los mensajes de ESTE teléfono se borran solos al cumplir el plazo. " +
        "La copia de tu pareja no se toca.",
      [
        { text: "Cancelar", style: "cancel" },
        ...TTL_OPTIONS.map((o) => ({
          text: o.label,
          onPress: async () => {
            await AsyncStorage.setItem("duo.retention.days", String(o.days));
            setTtlDays(o.days);
          },
        })),
      ]
    );
  };

  // Tras crear el PIN: elegir si la huella también abre (sin cifrado) o si la
  // copia local queda cifrada con el PIN.
  const onPinCreated = (pin) => {
    setPinModal(false);
    const hadEncrypt = !!lock.encrypt;
    Alert.alert(
      "¿Usar también la huella?",
      "Con «Solo PIN» tu copia de mensajes queda cifrada en este teléfono. " +
        "Con «PIN + huella» abrirás con el dedo, pero la copia no podrá ir cifrada " +
        "(sin el PIN no hay clave).",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Solo PIN (cifrar)",
          onPress: async () => {
            await setupPin(pin, { bio: false, encrypt: true });
            if (hadEncrypt) await clearHistory();
            Alert.alert(
              "Listo 🔒",
              "Tu PIN está activo y la copia local va cifrada."
            );
          },
        },
        {
          text: "PIN + huella",
          onPress: async () => {
            await setupPin(pin, { bio: true, encrypt: false });
            if (hadEncrypt) await clearHistory();
            Alert.alert("Listo 👆", "Podrás abrir Duo con tu huella.");
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xl }}>
        <View style={styles.header}>
          <View style={styles.avatars}>
            <Avatar emoji={me.emoji} color={me.avatarColor} size={72} />
            <Text style={styles.heart}>❤️</Text>
            <Avatar
              emoji={partner.emoji}
              color={partner.avatarColor}
              size={72}
              online={status === "online"}
            />
          </View>
          <Text style={styles.names}>Tú & {partnerName}</Text>
          <Text style={styles.since}>
            {linked
              ? LEVEL_TEXT(status)
              : "Esperando a tu pareja… crea un vínculo con su QR"}
          </Text>
        </View>

        <View style={styles.statsRow}>
          <Stat value={messages.length} label="Mensajes" />
          <Stat value={photos} label="Fotos" />
          <Stat value="🔒" label="Cifrado E2E" />
        </View>

        <Text style={styles.section}>Nuestro vínculo</Text>
        <View style={styles.card}>
          <Row
            icon="key"
            label="Código de verificación"
            value={linked ? `${code} ✓` : code}
            onPress={() =>
              Alert.alert(
                "Código de verificación",
                `Debe ser el mismo en los dos teléfonos: ${code}\n\n` +
                  (linked
                    ? "✓ Comprobado: si los dos teléfonos enseñan el mismo código con la marca ✓, " +
                      "sois la pareja correcta."
                    : "Si no coinciden, no estáis vinculados con la persona correcta.")
              )
            }
          />
          <Row
            icon="lock-closed"
            label="Privacidad"
            value="Solo ustedes"
            onPress={() =>
              Alert.alert(
                "Privacidad",
                "Los mensajes, fotos y juegos van cifrados de extremo a extremo. " +
                  "Nadie más —ni el servicio que hace de cartero— puede leerlos."
              )
            }
          />
          <Row
            icon="swap-horizontal"
            label="Conexión"
            value={STATUS_TEXT[status] || STATUS_TEXT.offline}
            onPress={() =>
              Alert.alert(
                "Conexión",
                "Duo se conecta a través de Internet (broker cifrado), " +
                  "así que funciona desde cualquier red, aunque estéis lejos."
              )
            }
          />
        </View>

        <Text style={styles.section}>Privacidad de la app</Text>
        <View style={styles.card}>
          <Row
            icon="key"
            label="Bloqueo con PIN"
            value={lock.pin ? "Activado" : "Desactivado"}
            onPress={() => (lock.pin ? disablePinFlow() : setPinModal(true))}
          />
          <Row
            icon="finger-print"
            label="Abrir con huella"
            value={lock.bio ? "Sí" : "No"}
            onPress={toggleBio}
          />
          <Row
            icon="notifications-off"
            label="Avisos ocultos"
            value={lock.hidden ? "Sí" : "No"}
            onPress={() => setHiddenNotifications(!lock.hidden)}
          />
          <Row
            icon="eye-off"
            label="Pantalla discreta"
            value={lock.stealth ? "Sí" : "No"}
            onPress={() => setStealth(!lock.stealth)}
          />
          <Row
            icon="hourglass"
            label="Auto-destrucción"
            value={
              (TTL_OPTIONS.find((o) => o.days === ttlDays) || TTL_OPTIONS[0])
                .label
            }
            onPress={pickTtl}
          />
        </View>

        <Text style={styles.section}>Invita a tu pareja</Text>
        <View style={styles.card}>
          <Row
            icon="share-social"
            label="Compartir invitación"
            onPress={shareInvite}
          />
          <Row
            icon="download"
            label="Abrir enlace de descarga"
            onPress={openDownload}
          />
        </View>

        <Text style={styles.section}>Datos y privacidad</Text>
        <View style={styles.card}>
          <Row
            icon="trash"
            label="Borrar historial de chat"
            onPress={confirmClearHistory}
          />
          <Row
            icon="images"
            label="Borrar fotos guardadas"
            onPress={confirmDeletePhotos}
          />
          <Row
            icon="warning"
            label="Borrar todo el contenido"
            danger
            onPress={confirmWipe}
          />
        </View>

        <Pressable style={styles.logout} onPress={confirmUnlink}>
          <Ionicons name="log-out-outline" size={20} color={colors.primary} />
          <Text style={styles.logoutText}>Desvincular</Text>
        </Pressable>
      </ScrollView>

      {/* Crear o cambiar el PIN (teclado del propio componente de bloqueo) */}
      <Modal
        visible={pinModal}
        animationType="slide"
        transparent
        onRequestClose={() => setPinModal(false)}
      >
        <View style={styles.modalBack}>
          <View style={styles.modalCard}>
            <LockScreen
              mode="create"
              onCancel={() => setPinModal(false)}
              onDone={onPinCreated}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function LEVEL_TEXT(status) {
  if (status === "online") return "Vinculados 💞 en línea";
  if (status === "connecting") return "Vinculados 💞 · conectando…";
  return "Vinculados 💞 · sin conexión";
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { alignItems: "center", paddingVertical: spacing.xl },
  avatars: { flexDirection: "row", alignItems: "center" },
  heart: { fontSize: 26, marginHorizontal: spacing.sm },
  names: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    marginTop: spacing.md,
  },
  since: { color: colors.muted, fontSize: 14, marginTop: 4 },
  statsRow: {
    flexDirection: "row",
    marginHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
  },
  stat: { flex: 1, alignItems: "center" },
  statValue: { color: colors.primary, fontSize: 20, fontWeight: "800" },
  statLabel: { color: colors.muted, fontSize: 12, marginTop: 2 },
  section: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginHorizontal: spacing.md,
  },
  card: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLabel: { color: colors.text, fontSize: 15, marginLeft: spacing.md, flex: 1 },
  rowValue: { color: colors.muted, fontSize: 14, marginRight: spacing.sm },
  logout: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  logoutText: { color: colors.primary, fontSize: 16, fontWeight: "700" },
  modalBack: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
  },
  modalCard: {
    marginHorizontal: spacing.md,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.bg,
  },
});

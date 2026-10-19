import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Share,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme";
import Avatar from "../components/Avatar";
import { useSession } from "../context/SessionContext";
import { useE2E } from "../context/E2EContext";
import { useP2P } from "../context/P2PContext";
import { verificationCode } from "../services/cryptocore";
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
            value={code}
            onPress={() =>
              Alert.alert(
                "Código de verificación",
                `Debe ser el mismo en los dos teléfonos: ${code}\n\n` +
                  "Si no coinciden, no estáis vinculados con la persona correcta."
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
});

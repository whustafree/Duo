import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme";
import Avatar from "../components/Avatar";
import { mockUser, mockPartner, coupleMeta } from "../data/mock";
import { useSession } from "../context/SessionContext";

function Stat({ value, label }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Row({ icon, label, value }) {
  return (
    <Pressable style={styles.row}>
      <Ionicons name={icon} size={20} color={colors.accent} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

export default function ProfileScreen({ navigation }) {
  const { session, clear } = useSession();
  const me = session?.user
    ? { emoji: session.user.emoji || "🦊", avatarColor: mockUser.avatarColor }
    : mockUser;
  const partner = session?.partner
    ? { emoji: session.partner.emoji || "🐰", avatarColor: mockPartner.avatarColor }
    : mockPartner;
  const partnerName = session?.partner?.name || mockPartner.name;
  const code = session?.code || coupleMeta.code;
  const linked = session?.linked ?? true;

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
              online={linked}
            />
          </View>
          <Text style={styles.names}>Tú & {partnerName}</Text>
          <Text style={styles.since}>
            {linked ? "Vinculados 💞" : "Esperando a tu pareja… comparte el código"}
          </Text>
        </View>

        <View style={styles.statsRow}>
          <Stat value="610" label="Días juntos" />
          <Stat value="27" label="Retos logrados" />
          <Stat value="🔥 12" label="Racha" />
        </View>

        <Text style={styles.section}>Nuestro vínculo</Text>
        <View style={styles.card}>
          <Row icon="key" label="Código de pareja" value={code} />
          <Row icon="lock-closed" label="Privacidad" value="Solo ustedes" />
          <Row icon="notifications" label="Notificaciones" value="Activadas" />
        </View>

        <Text style={styles.section}>Apariencia y datos</Text>
        <View style={styles.card}>
          <Row icon="color-palette" label="Tema" value="Noche" />
          <Row icon="images" label="Fotos guardadas" value="Solo en dispositivos" />
          <Row icon="trash" label="Borrar historial" value="" />
        </View>

        <Pressable
          style={styles.logout}
          onPress={() => {
            clear();
            navigation.replace("Onboarding");
          }}
        >
          <Ionicons name="log-out-outline" size={20} color={colors.primary} />
          <Text style={styles.logoutText}>Desvincular</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { alignItems: "center", paddingVertical: spacing.xl },
  avatars: { flexDirection: "row", alignItems: "center" },
  heart: { fontSize: 26, marginHorizontal: spacing.sm },
  names: { color: colors.text, fontSize: 22, fontWeight: "800", marginTop: spacing.md },
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

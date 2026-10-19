import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Share,
  Linking,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme";
import { games, challengeLevels } from "../data/mock";
import { useP2P } from "../context/P2PContext";
import { INVITE_MESSAGE, APP_DOWNLOAD_URL } from "../config";

const ROUTES = {
  verdad: "TruthDare",
  ruleta: "Challenge",
  dados: "Dice",
  preguntas: "Questions",
};

// asignamos rutas a los juegos
games.forEach((g) => {
  g.route = ROUTES[g.id];
});

function GameCard({ game, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        pressed && { transform: [{ scale: 0.98 }] },
      ]}
    >
      <View style={[styles.emojiWrap, { backgroundColor: game.color + "22" }]}>
        <Text style={styles.emoji}>{game.emoji}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{game.name}</Text>
        <Text style={styles.cardDesc}>{game.desc}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.muted} />
    </Pressable>
  );
}

export default function GamesScreen({ navigation }) {
  const { gameSession } = useP2P();

  const activeGame = gameSession
    ? games.find((g) => g.id === gameSession.gameId)
    : null;

  const shareInvite = async () => {
    try {
      await Share.share({ message: INVITE_MESSAGE });
    } catch {}
  };

  const openDownload = async () => {
    try {
      const ok = await Linking.canOpenURL(APP_DOWNLOAD_URL);
      if (ok) await Linking.openURL(APP_DOWNLOAD_URL);
      else Alert.alert("Enlace de descarga", APP_DOWNLOAD_URL);
    } catch {
      Alert.alert("Enlace de descarga", APP_DOWNLOAD_URL);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.h1}>Juegos y Retos</Text>
        <Text style={styles.muted}>
          Juegos para dos pensados para la distancia 💞
        </Text>
      </View>
      <FlatList
        data={games}
        keyExtractor={(g) => g.id}
        renderItem={({ item }) => (
          <GameCard
            game={item}
            onPress={() => navigation.navigate(item.route)}
          />
        )}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          activeGame ? (
            <Pressable
              style={styles.activeBanner}
              onPress={() => navigation.navigate(activeGame.route)}
            >
              <Text style={styles.activeEmoji}>{activeGame.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.activeTitle}>Juego en curso</Text>
                <Text style={styles.activeDesc}>
                  {activeGame.name} · toca para seguir jugando
                </Text>
              </View>
              <Ionicons name="play-circle" size={26} color={colors.primary} />
            </Pressable>
          ) : null
        }
        ListFooterComponent={
          <View>
            <View style={styles.levelsBox}>
              <Text style={styles.levelsTitle}>Niveles de intensidad</Text>
              {challengeLevels.map((l) => (
                <View key={l.id} style={styles.levelRow}>
                  <Text style={styles.levelEmoji}>{l.emoji}</Text>
                  <Text style={[styles.levelName, { color: l.color }]}>
                    {l.name}
                  </Text>
                  {l.id === 5 ? (
                    <Text style={styles.levelTag}>+18</Text>
                  ) : null}
                </View>
              ))}
            </View>

            <View style={styles.inviteBox}>
              <Text style={styles.inviteTitle}>Invita a tu pareja</Text>
              <Text style={styles.inviteText}>
                ¿Todavía no tiene la app? Envíale el enlace de descarga para que
                se instale y se vinculen.
              </Text>
              <Pressable style={styles.inviteBtn} onPress={shareInvite}>
                <Ionicons name="share-social" size={18} color={colors.white} />
                <Text style={styles.inviteBtnText}>Compartir invitación</Text>
              </Pressable>
              <Pressable style={styles.downloadBtn} onPress={openDownload}>
                <Ionicons name="download" size={18} color={colors.primary} />
                <Text style={styles.downloadText}>Abrir enlace de descarga</Text>
              </Pressable>
            </View>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  h1: { color: colors.text, fontSize: 28, fontWeight: "800" },
  muted: { color: colors.muted, fontSize: 14, marginTop: 4 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  emojiWrap: {
    width: 54,
    height: 54,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  emoji: { fontSize: 28 },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: "700" },
  cardDesc: { color: colors.muted, fontSize: 13, marginTop: 2 },
  activeBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.primary + "18",
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  activeEmoji: { fontSize: 26, marginRight: spacing.md },
  activeTitle: { color: colors.primary, fontSize: 13, fontWeight: "800" },
  activeDesc: { color: colors.text, fontSize: 15, fontWeight: "600", marginTop: 2 },
  levelsBox: {
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  levelsTitle: {
    color: colors.text,
    fontWeight: "700",
    fontSize: 15,
    marginBottom: spacing.sm,
  },
  levelRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  levelEmoji: { fontSize: 18, marginRight: spacing.sm },
  levelName: { fontSize: 15, fontWeight: "700", flex: 1 },
  levelTag: {
    color: colors.white,
    backgroundColor: "#9F1239",
    fontSize: 11,
    fontWeight: "800",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  inviteBox: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  inviteTitle: { color: colors.text, fontSize: 16, fontWeight: "800" },
  inviteText: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 4,
    lineHeight: 19,
  },
  inviteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    height: 48,
    marginTop: spacing.md,
  },
  inviteBtnText: { color: colors.white, fontSize: 15, fontWeight: "800" },
  downloadBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.primary,
    height: 48,
    marginTop: spacing.sm,
  },
  downloadText: { color: colors.primary, fontSize: 15, fontWeight: "700" },
});

import { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme";
import { truths, dares, challengeLevels } from "../data/mock";
import { useP2P } from "../context/P2PContext";

const GAME_ID = "verdad";

export default function TruthDareScreen({ navigation }) {
  const { gameSession, startGame, setGameLevel, drawGame, endGame, endGameIf } =
    useP2P();

  const session =
    gameSession && gameSession.gameId === GAME_ID ? gameSession : null;
  const level = session?.level || 1;
  const current = session?.prompt || null;
  const mode = session?.mode || null;
  const levelMeta =
    challengeLevels.find((l) => l.id === level) || challengeLevels[0];

  // Si el juego se termina del todo (por nosotros o por la pareja), volvemos atrás.
  const hadSession = useRef(false);
  useEffect(() => {
    if (gameSession) hadSession.current = true;
    else if (hadSession.current) {
      hadSession.current = false;
      navigation.goBack();
    }
  }, [gameSession, navigation]);

  useEffect(() => {
    if (!session) startGame(GAME_ID, 1);
    return () => endGameIf(GAME_ID);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (type) => {
    const pool = (type === "truth" ? truths : dares)[level] || [];
    if (!pool.length) return;
    let next = pool[Math.floor(Math.random() * pool.length)];
    if (pool.length > 1 && next === current) {
      next = pool[(pool.indexOf(next) + 1) % pool.length];
    }
    drawGame(next, type);
  };

  const isTruth = mode === "truth";
  const accent = isTruth ? colors.accent : colors.primary;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.h1}>Verdad o Reto</Text>
        <Text style={styles.muted}>
          ¿Se atreven? Elijan el nivel y jueguen desde donde estén 😏
        </Text>

        <Text style={styles.label}>Elige la intensidad</Text>
        <View style={styles.levelsRow}>
          {challengeLevels.map((l) => {
            const active = l.id === level;
            return (
              <Pressable
                key={l.id}
                onPress={() => setGameLevel(l.id)}
                style={[
                  styles.levelChip,
                  active && {
                    backgroundColor: l.color + "22",
                    borderColor: l.color,
                  },
                ]}
              >
                <Text style={styles.levelChipEmoji}>{l.emoji}</Text>
                <Text
                  style={[
                    styles.levelChipText,
                    active && { color: l.color, fontWeight: "800" },
                  ]}
                >
                  {l.name}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View
          style={[styles.card, current && { borderColor: accent, borderWidth: 2 }]}
        >
          <View style={[styles.badge, { backgroundColor: accent + "22" }]}>
            <Ionicons
              name={isTruth ? "help-circle" : "flame"}
              size={26}
              color={accent}
            />
            <Text style={[styles.badgeText, { color: accent }]}>
              {mode ? (isTruth ? "VERDAD" : "RETO") : "…"}
            </Text>
          </View>
          <Text style={[styles.cardText, !current && { color: colors.muted }]}>
            {current || "Elige Verdad o Reto para comenzar."}
          </Text>
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={() => pick("truth")}
            style={({ pressed }) => [
              styles.bigBtn,
              { backgroundColor: colors.accent },
              pressed && { transform: [{ scale: 0.97 }] },
            ]}
          >
            <Ionicons name="help-circle" size={22} color={colors.white} />
            <Text style={styles.bigBtnText}>Verdad</Text>
          </Pressable>
          <Pressable
            onPress={() => pick("dare")}
            style={({ pressed }) => [
              styles.bigBtn,
              { backgroundColor: colors.primary },
              pressed && { transform: [{ scale: 0.97 }] },
            ]}
          >
            <Ionicons name="flame" size={22} color={colors.white} />
            <Text style={styles.bigBtnText}>Reto</Text>
          </Pressable>
        </View>

        <Pressable onPress={endGame} style={styles.endBtn}>
          <Text style={styles.endText}>Terminar juego</Text>
        </Pressable>
        <Text style={styles.tip}>
          {levelMeta.emoji} Nivel {levelMeta.name} · si no se atreven… doble reto
          la próxima 😜
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  h1: { color: colors.text, fontSize: 24, fontWeight: "800" },
  muted: { color: colors.muted, fontSize: 14, marginTop: 4 },
  label: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  levelsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  levelChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  levelChipEmoji: { fontSize: 16, marginRight: 6 },
  levelChipText: { color: colors.muted, fontSize: 14, fontWeight: "600" },
  card: {
    marginTop: spacing.lg,
    minHeight: 200,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    marginBottom: spacing.lg,
  },
  badgeText: {
    fontSize: 14,
    fontWeight: "800",
    marginLeft: spacing.sm,
    letterSpacing: 2,
  },
  cardText: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 30,
  },
  actions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
  bigBtn: {
    flex: 1,
    height: 62,
    borderRadius: radius.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  bigBtnText: { color: colors.white, fontSize: 17, fontWeight: "800" },
  endBtn: { alignSelf: "center", marginTop: spacing.md, padding: spacing.sm },
  endText: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  tip: {
    color: colors.muted,
    fontSize: 12,
    textAlign: "center",
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
});

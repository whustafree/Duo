import { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme";
import { challengeLevels } from "../data/mock";
import { useP2P } from "../context/P2PContext";
import PrimaryButton from "./PrimaryButton";
import GameThread from "./GameThread";

// Mazo de retos COMPARTIDO: el nivel y el reto se sincronizan con la pareja por
// el relay, así los dos ven lo mismo aunque estén en ciudades distintas.
export default function ChallengeDeck({
  gameId,
  title,
  subtitle,
  actionLabel = "Tirar",
  icon = "sparkles",
  getItems,
  showLevels = true,
}) {
  const { gameSession, startGame, setGameLevel, drawGame, endGame, endGameIf } =
    useP2P();
  const navigation = useNavigation();

  const session =
    gameSession && gameSession.gameId === gameId ? gameSession : null;
  const level = session?.level || 1;
  const current = session?.prompt || null;
  const levelMeta = challengeLevels.find((l) => l.id === level) || challengeLevels[0];

  // Si el juego se termina del todo (por nosotros o por la pareja), volvemos atrás.
  const hadSession = useRef(false);
  useEffect(() => {
    if (gameSession) hadSession.current = true;
    else if (hadSession.current) {
      hadSession.current = false;
      navigation.goBack();
    }
  }, [gameSession, navigation]);

  // Al abrir la pantalla, iniciamos el juego (esto avisa a la pareja). Si la
  // pareja ya lo había iniciado, la sesión existe y no la pisamos. Al salir de
  // la pantalla (atrás), el juego termina para los dos y no deja sesión huérfana.
  useEffect(() => {
    if (!session) startGame(gameId, 1);
    return () => endGameIf(gameId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draw = () => {
    const items = (getItems && getItems(level)) || [];
    if (!items.length) return;
    let next = items[Math.floor(Math.random() * items.length)];
    if (items.length > 1 && next === current) {
      next = items[(items.indexOf(next) + 1) % items.length];
    }
    drawGame(next);
  };

  return (
    <ScrollView style={styles.safe} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>{title}</Text>
      <Text style={styles.muted}>{subtitle}</Text>

      {session && session.host === "them" ? (
        <View style={styles.partnerBanner}>
          <Ionicons name="people" size={16} color={colors.primary} />
          <Text style={styles.partnerBannerText}>
            Juego compartido con tu pareja 💞
          </Text>
        </View>
      ) : null}

      {showLevels && <Text style={styles.label}>Elige la intensidad</Text>}
      {showLevels && (
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
      )}

      <View
        style={[
          styles.card,
          current && { borderColor: levelMeta.color, borderWidth: 2 },
        ]}
      >
        <Ionicons
          name={icon}
          size={34}
          color={current ? levelMeta.color : colors.muted}
        />
        <Text style={[styles.cardText, !current && { color: colors.muted }]}>
          {current || "Presiona el botón para empezar…"}
        </Text>
      </View>

      <GameThread />

      <PrimaryButton
        title={current ? `${actionLabel} de nuevo` : actionLabel}
        onPress={draw}
      />
      <Pressable onPress={endGame} style={styles.endBtn}>
        <Text style={styles.endText}>Terminar juego</Text>
      </Pressable>
      <Text style={styles.tip}>
        {showLevels ? `${levelMeta.emoji} Nivel ${levelMeta.name} · ` : ""}
        háganlo desde donde estén: audio, foto o video 💌
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  h1: { color: colors.text, fontSize: 24, fontWeight: "800" },
  muted: { color: colors.muted, fontSize: 14, marginTop: 4 },
  partnerBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primary,
    alignSelf: "flex-start",
  },
  partnerBannerText: { color: colors.primary, fontSize: 13, fontWeight: "700" },
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
    marginBottom: spacing.lg,
    minHeight: 220,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  cardText: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 28,
    marginTop: spacing.md,
  },
  endBtn: { alignSelf: "center", marginTop: spacing.md, padding: spacing.sm },
  endText: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  tip: {
    color: colors.muted,
    fontSize: 12,
    textAlign: "center",
    marginTop: spacing.lg,
  },
});

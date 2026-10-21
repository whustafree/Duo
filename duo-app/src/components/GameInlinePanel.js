import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme";
import { challengeLevels } from "../data/mock";
import { GAME_INFO, modeLabel } from "../services/gamecontent";
import { useP2P } from "../context/P2PContext";

// Panel compacto de juego DENTRO del chat. No tiene chat propio: los resultados
// y las respuestas van como mensajes normales en la conversación de siempre.
export default function GameInlinePanel() {
  const { gameSession, setGameLevel, drawGame, endGame } = useP2P();

  if (!gameSession || !gameSession.gameId) return null;

  const info = GAME_INFO[gameSession.gameId] || {
    name: gameSession.gameId,
    emoji: "🎮",
  };
  const level = gameSession.level || 1;
  const levelMeta =
    challengeLevels.find((l) => l.id === level) || challengeLevels[0];
  const gameId = gameSession.gameId;

  const play = (mode) => {
    drawGame(mode);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.emoji}>{info.emoji}</Text>
          <View>
            <Text style={styles.title}>{info.name}</Text>
            <Text style={styles.sub}>
              {levelMeta.emoji} Nivel {levelMeta.name}
              {gameSession.prompt ? ` · ${modeLabel(gameSession.mode)}` : ""}
            </Text>
          </View>
        </View>
        <Pressable
          onPress={() => {
            endGame();
          }}
          hitSlop={10}
        >
          <Ionicons name="close-circle" size={22} color={colors.muted} />
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.levels}
      >
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
              <Text style={styles.levelEmoji}>{l.emoji}</Text>
              <Text
                style={[
                  styles.levelText,
                  active && { color: l.color, fontWeight: "800" },
                ]}
              >
                {l.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.actions}>
        {gameId === "verdad" ? (
          <>
            <Pressable
              style={[styles.actionBtn, { backgroundColor: colors.accent }]}
              onPress={() => play("truth")}
            >
              <Text style={styles.actionText}>Verdad</Text>
            </Pressable>
            <Pressable
              style={[styles.actionBtn, { backgroundColor: colors.primary }]}
              onPress={() => play("dare")}
            >
              <Text style={styles.actionText}>Reto</Text>
            </Pressable>
          </>
        ) : gameId === "ruleta" ? (
          <Pressable
            style={[styles.actionBtn, { backgroundColor: colors.primary }]}
            onPress={() => play("spin")}
          >
            <Ionicons name="sync-circle" size={18} color={colors.white} />
            <Text style={styles.actionText}>Girar ruleta</Text>
          </Pressable>
        ) : gameId === "dados" ? (
          <Pressable
            style={[styles.actionBtn, { backgroundColor: colors.primary }]}
            onPress={() => play("roll")}
          >
            <Ionicons name="dice" size={18} color={colors.white} />
            <Text style={styles.actionText}>Tirar dados</Text>
          </Pressable>
        ) : gameId === "preguntas" ? (
          <Pressable
            style={[styles.actionBtn, { backgroundColor: colors.primary }]}
            onPress={() => play("question")}
          >
            <Ionicons name="help-circle" size={18} color={colors.white} />
            <Text style={styles.actionText}>Nueva pregunta</Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.hint}>
        El resultado aparece en el chat. Responde ahí mismo 💬
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  emoji: { fontSize: 22 },
  title: { color: colors.text, fontWeight: "700", fontSize: 15 },
  sub: { color: colors.muted, fontSize: 11, marginTop: 1 },
  levels: { gap: spacing.sm, paddingBottom: spacing.sm },
  levelChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  levelEmoji: { fontSize: 13, marginRight: 4 },
  levelText: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: radius.pill,
    paddingVertical: 9,
  },
  actionText: { color: colors.white, fontWeight: "800", fontSize: 14 },
  hint: {
    color: colors.muted,
    fontSize: 11,
    textAlign: "center",
    marginTop: spacing.sm,
  },
});

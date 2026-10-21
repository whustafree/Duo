import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme";
import { games } from "../data/mock";
import { useP2P } from "../context/P2PContext";

const GAME_META = {
  verdad: { name: "Verdad o Reto", emoji: "🎭" },
  ruleta: { name: "Ruleta de Retos", emoji: "🎡" },
  dados: { name: "Dados del Deseo", emoji: "🎲" },
  preguntas: { name: "Para Conocernos", emoji: "💬" },
};

export default function GameInlinePanel({ onClose }) {
  const {
    gameSession,
    startGame,
    setGameLevel,
    drawGame,
    sendGameReply,
    endGame,
  } = useP2P();
  const [reply, setReply] = useState("");

  if (!gameSession || !gameSession.gameId) return null;

  const meta = GAME_META[gameSession.gameId] || games.find((g) => g.id === gameSession.gameId) || { name: gameSession.gameId, emoji: "🎮" };
  const replies = gameSession.replies || [];

  const handleAction = (type) => {
    // Acciones rápidas según juego
    if (gameSession.gameId === "verdad") {
      drawGame(type === "truth" ? "Verdad" : "Reto", type);
      return;
    }
    if (gameSession.gameId === "ruleta") {
      drawGame("Gira la ruleta", "spin");
      return;
    }
    if (gameSession.gameId === "dados") {
      drawGame("Tira los dados", "roll");
      return;
    }
    if (gameSession.gameId === "preguntas") {
      drawGame("Pregunta", "question");
      return;
    }
  };

  const sendReply = () => {
    const t = reply.trim();
    if (!t) return;
    sendGameReply(t);
    setReply("");
  };

  const handleEnd = () => {
    endGame();
    onClose && onClose();
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.emoji}>{meta.emoji}</Text>
          <View>
            <Text style={styles.title}>{meta.name}</Text>
            {gameSession.level ? (
              <Text style={styles.sub}>Nivel {gameSession.level}</Text>
            ) : null}
          </View>
        </View>
        <Pressable onPress={handleEnd} hitSlop={8}>
          <Ionicons name="close-circle" size={22} color={colors.muted} />
        </Pressable>
      </View>

      {gameSession.prompt ? (
        <View style={styles.promptBox}>
          <Text style={styles.promptText}>{gameSession.prompt}</Text>
        </View>
      ) : (
        <View style={styles.promptBox}>
          <Text style={styles.promptText}>¡Listos para jugar! Pulsa una acción para empezar.</Text>
        </View>
      )}

      <View style={styles.actions}>
        {gameSession.gameId === "verdad" ? (
          <>
            <Pressable style={styles.actionBtn} onPress={() => handleAction("truth")}>
              <Text style={styles.actionText}>Verdad</Text>
            </Pressable>
            <Pressable style={styles.actionBtn} onPress={() => handleAction("dare")}>
              <Text style={styles.actionText}>Reto</Text>
            </Pressable>
          </>
        ) : gameSession.gameId === "ruleta" ? (
          <Pressable style={styles.actionBtnWide} onPress={() => handleAction("spin")}>
            <Text style={styles.actionText}>Girar ruleta</Text>
          </Pressable>
        ) : gameSession.gameId === "dados" ? (
          <Pressable style={styles.actionBtnWide} onPress={() => handleAction("roll")}>
            <Text style={styles.actionText}>Tirar dados</Text>
          </Pressable>
        ) : gameSession.gameId === "preguntas" ? (
          <Pressable style={styles.actionBtnWide} onPress={() => handleAction("question")}>
            <Text style={styles.actionText}>Nueva pregunta</Text>
          </Pressable>
        ) : null}
      </View>

      {replies.length > 0 ? (
        <ScrollView style={styles.replies} showsVerticalScrollIndicator={false}>
          {replies.slice(-6).map((r, idx) => (
            <View
              key={`${r.ts}-${idx}`}
              style={[styles.replyRow, r.from === "me" ? styles.replyMe : styles.replyThem]}
            >
              <Text style={styles.replyText}>{r.text}</Text>
            </View>
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.replyBar}>
        <TextInput
          value={reply}
          onChangeText={setReply}
          placeholder="Responder al reto/pregunta..."
          placeholderTextColor={colors.muted}
          style={styles.replyInput}
          onSubmitEditing={sendReply}
          returnKeyType="send"
        />
        <Pressable style={styles.replySend} onPress={sendReply}>
          <Ionicons name="send" size={16} color={colors.white} />
        </Pressable>
      </View>
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
  sub: { color: colors.muted, fontSize: 11 },
  promptBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  promptText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    alignItems: "center",
    paddingVertical: 8,
  },
  actionBtnWide: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    alignItems: "center",
    paddingVertical: 8,
  },
  actionText: { color: colors.white, fontWeight: "700", fontSize: 14 },
  replies: {
    maxHeight: 90,
    marginBottom: spacing.sm,
  },
  replyRow: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    marginBottom: 4,
    alignSelf: "flex-start",
    maxWidth: "90%",
  },
  replyMe: {
    alignSelf: "flex-end",
    backgroundColor: colors.primary + "22",
  },
  replyThem: {
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceAlt,
  },
  replyText: { color: colors.text, fontSize: 13 },
  replyBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  replyInput: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    color: colors.text,
    fontSize: 13,
  },
  replySend: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
});

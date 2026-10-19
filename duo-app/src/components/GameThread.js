import { useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme";
import { useSession } from "../context/SessionContext";
import { useP2P } from "../context/P2PContext";

// Hilo de respuestas del juego: cualquiera de los dos puede contestar el reto
// o la pregunta, y aparece en los dos teléfonos (va cifrado, igual que el chat).
export default function GameThread() {
  const { gameSession, sendGameReply } = useP2P();
  const { session } = useSession();
  const [text, setText] = useState("");
  const replies = (gameSession && gameSession.replies) || [];
  const partnerName = session?.partnerName || "Tu pareja";

  // Sin partida activa (alguien ya la terminó) no hay nada que responder.
  if (!gameSession) return null;

  const send = () => {
    if (!sendGameReply(text)) return;
    setText("");
  };

  return (
    <View style={styles.box}>
      <Text style={styles.title}>Respuestas 💬</Text>
      {replies.length === 0 ? (
        <Text style={styles.empty}>
          Escríbanse lo que sienten: la respuesta aparece en los dos teléfonos.
        </Text>
      ) : (
        replies.map((r, i) => (
          <View
            key={`${r.ts || i}-${i}`}
            style={[styles.msg, r.from === "me" ? styles.mine : styles.theirs]}
          >
            <Text style={styles.who}>{r.from === "me" ? "Tú" : partnerName}</Text>
            <Text style={styles.body}>{r.text}</Text>
          </View>
        ))
      )}
      <View style={styles.row}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Responder…"
          placeholderTextColor={colors.muted}
          style={styles.input}
          maxLength={300}
          multiline
        />
        <Pressable onPress={send} style={styles.send}>
          <Ionicons name="send" size={18} color={colors.white} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  title: { color: colors.text, fontWeight: "800", fontSize: 15 },
  empty: { color: colors.muted, fontSize: 13, marginTop: spacing.sm },
  msg: {
    marginTop: spacing.sm,
    borderRadius: radius.sm,
    padding: spacing.sm,
    borderWidth: 1,
  },
  mine: {
    backgroundColor: colors.primary + "22",
    borderColor: colors.primary + "66",
    alignSelf: "flex-end",
  },
  theirs: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    alignSelf: "flex-start",
  },
  who: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  body: { color: colors.text, fontSize: 15, marginTop: 2 },
  row: { flexDirection: "row", alignItems: "flex-end", marginTop: spacing.md },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    color: colors.text,
    backgroundColor: colors.bg,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 15,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: spacing.sm,
  },
});

import { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Image,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { colors, radius, spacing } from "../theme";
import Avatar from "../components/Avatar";
import { useSession } from "../context/SessionContext";
import { useP2P } from "../context/P2PContext";

// Chat P2P: los mensajes salen cifrados de este teléfono al otro, directamente.
// Si la pareja está desconectada, el mensaje queda guardado aquí (pendiente) y
// se envía solo en cuanto los dos vuelven a estar conectados.

function timeOf(ts) {
  const d = ts ? new Date(ts) : new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

function MessageBubble({ item }) {
  const mine = item.from === "me";
  return (
    <View style={[styles.row, mine ? styles.rowMe : styles.rowOther]}>
      <View style={[styles.bubble, mine ? styles.bubbleMe : styles.bubbleOther]}>
        {item.kind === "photo" ? (
          <Image source={{ uri: item.uri }} style={styles.photo} />
        ) : (
          <Text style={[styles.msgText, mine && styles.msgTextMe]}>
            {item.text}
          </Text>
        )}
        <Text style={[styles.time, mine ? styles.timeMe : styles.timeOther]}>
          {timeOf(item.ts)}
          {item.pending ? " ⏳" : ""}
        </Text>
      </View>
    </View>
  );
}

const STATUS_TEXT = {
  online: "en línea 💞",
  connecting: "conectando…",
  offline: "sin conexión",
};

export default function ChatScreen() {
  const { session } = useSession();
  const { status, messages, typing, sendText, sendPhoto, sendTyping } = useP2P();

  const [text, setText] = useState("");
  const listRef = useRef(null);

  const partnerName = session?.partnerName || "Mi Amor";
  const partnerEmoji = session?.partnerEmoji || "💞";

  const scrollDown = useCallback(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
  }, []);

  useEffect(() => {
    scrollDown();
  }, [messages.length, scrollDown]);

  const handleTyping = (value) => {
    setText(value);
    sendTyping(!!value);
  };

  const send = () => {
    const value = text.trim();
    if (!value) return;
    setText("");
    sendText(value);
    sendTyping(false);
    scrollDown();
  };

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permiso necesario", "Habilita el acceso a tus fotos.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });
    if (result.canceled) return;
    const src = result.assets[0].uri;
    try {
      // Reducir antes de enviar: viaja por la red local, pero así el teléfono
      // viejo también lo procesa rápido (y se cifra igual).
      const resized = await ImageManipulator.manipulateAsync(
        src,
        [{ resize: { width: 1280 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
      );
      await sendPhoto(resized.uri);
      scrollDown();
    } catch (e) {
      Alert.alert("No se pudo enviar la foto", e?.message || "");
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Avatar
          emoji={partnerEmoji}
          color={session?.partnerAvatarColor || "#FF6B8B"}
          online={status === "online"}
        />
        <View style={{ marginLeft: spacing.sm, flex: 1 }}>
          <Text style={styles.name}>{partnerName}</Text>
          <Text
            style={[
              styles.status,
              status !== "online" && styles.statusOffline,
            ]}
          >
            {typing ? "escribiendo…" : STATUS_TEXT[status] || STATUS_TEXT.offline}
          </Text>
        </View>
        <Pressable style={styles.iconBtn}>
          <Ionicons name="lock-closed" size={18} color={colors.muted} />
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <MessageBubble item={item} />}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.lg }}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() =>
          listRef.current?.scrollToEnd({ animated: false })
        }
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.empty}>
              Aún no hay mensajes. ¡Rompe el hielo! 💬
            </Text>
            {status !== "online" ? (
              <Text style={styles.emptyHint}>
                {status === "connecting"
                  ? "Buscando a tu pareja… se enviará todo en cuanto esté en línea."
                  : "Tus mensajes se enviarán solos cuando tu pareja abra la app en la misma WiFi."}
              </Text>
            ) : null}
          </View>
        }
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        <View style={styles.inputBar}>
          <Pressable style={styles.attachBtn} onPress={pickPhoto}>
            <Ionicons name="image" size={24} color={colors.muted} />
          </Pressable>
          <TextInput
            value={text}
            onChangeText={handleTyping}
            placeholder="Escribe algo..."
            placeholderTextColor={colors.muted}
            style={styles.input}
            multiline
          />
          <Pressable
            onPress={send}
            style={[styles.sendBtn, !text.trim() && { opacity: 0.5 }]}
          >
            <Ionicons name="send" size={18} color={colors.white} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  emptyBox: { marginTop: spacing.xl },
  empty: { color: colors.muted, textAlign: "center" },
  emptyHint: {
    color: colors.muted,
    textAlign: "center",
    marginTop: spacing.sm,
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: spacing.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  name: { color: colors.text, fontSize: 17, fontWeight: "700" },
  status: { color: colors.success, fontSize: 12, marginTop: 1 },
  statusOffline: { color: colors.muted },
  iconBtn: { padding: spacing.sm },
  row: { marginBottom: spacing.sm, flexDirection: "row" },
  rowMe: { justifyContent: "flex-end" },
  rowOther: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "80%",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
  },
  bubbleMe: { backgroundColor: colors.bubbleMe, borderBottomRightRadius: 6 },
  bubbleOther: { backgroundColor: colors.bubbleOther, borderBottomLeftRadius: 6 },
  msgText: { color: colors.text, fontSize: 15, lineHeight: 21 },
  msgTextMe: { color: colors.white },
  time: { fontSize: 10, marginTop: 4, alignSelf: "flex-end" },
  timeMe: { color: "#FFD9E0" },
  timeOther: { color: colors.muted },
  photo: {
    width: 200,
    height: 200,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  attachBtn: { padding: spacing.sm, marginBottom: 2 },
  input: {
    flex: 1,
    maxHeight: 110,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingTop: 10,
    paddingBottom: 10,
    color: colors.text,
    fontSize: 15,
    marginHorizontal: spacing.xs,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
});

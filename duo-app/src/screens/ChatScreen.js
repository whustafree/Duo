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
  ActivityIndicator,
  Alert,
  AppState,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { colors, radius, spacing } from "../theme";
import { mockMessages, mockPartner } from "../data/mock";
import Avatar from "../components/Avatar";
import { useSession } from "../context/SessionContext";
import { getMessages, getCouple, uploadPhoto, photoUrl } from "../services/api";
import { connectSocket, sendMessage, sendTyping, disconnectSocket } from "../services/socket";
import { useE2E } from "../context/E2EContext";
import { encryptText, decryptText } from "../services/crypto";

function timeOf(ts) {
  const d = ts ? new Date(ts) : new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

function MessageBubble({ item, userId }) {
  const mine = item.from === "me" || item.sender_id === userId;
  return (
    <View style={[styles.row, mine ? styles.rowMe : styles.rowOther]}>
      <View style={[styles.bubble, mine ? styles.bubbleMe : styles.bubbleOther]}>
        {item.type === "photo" ? (
          <Image
            source={{ uri: item.localUri || photoUrl(item.url) }}
            style={styles.photo}
          />
        ) : (
          <Text style={[styles.msgText, mine && styles.msgTextMe]}>{item.text}</Text>
        )}
        <Text style={[styles.time, mine ? styles.timeMe : styles.timeOther]}>
          {item.time || timeOf(item.created_at)}
        </Text>
      </View>
    </View>
  );
}

export default function ChatScreen() {
  const { session } = useSession();
  const { keys, peerPub } = useE2E();
  const live = !!session?.coupleId;

  const [messages, setMessages] = useState(live ? [] : mockMessages);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(live);
  const [typing, setTyping] = useState(false);
  const [partner, setPartner] = useState(session?.partner || mockPartner);
  const listRef = useRef(null);
  const typingTimer = useRef(null);
  const partnerNameRef = useRef(session?.partner?.name || mockPartner.name);

  const partnerName = partner?.name || mockPartner.name;
  const partnerEmoji = partner?.emoji || mockPartner.emoji;
  partnerNameRef.current = partnerName;

  const scrollDown = useCallback(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
  }, []);

  useEffect(() => {
    if (!live) return;
    configureNotifications();
    requestNotificationPermission();
  }, [live]);

  useEffect(() => {
    if (!live) return;
    let alive = true;

    (async () => {
      try {
        const [history, info] = await Promise.all([
          getMessages(session.coupleId),
          getCouple(session.coupleId, session.userId).catch(() => null),
        ]);
        if (!alive) return;
        setMessages(
          history.map((m) => ({
            ...m,
            text: m.ciphertextB64
              ? decryptText({ ciphertextB64: m.ciphertextB64, nonceB64: m.nonce }, keys?.privateKeyB64, session.partner?.pub_key || peerPub)
              : m.text,
          }))
        );
        if (info?.partner) setPartner(info.partner);
      } catch (e) {
        console.warn("No se pudo cargar el historial:", e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    const socket = connectSocket({
      coupleId: session.coupleId,
      userId: session.userId,
    });
    socket.on("message", (msg) => {
      const decrypted = {
        ...msg,
        text: msg.ciphertextB64
          ? decryptText(
              { ciphertextB64: msg.ciphertextB64, nonceB64: msg.nonce },
              keys?.privateKeyB64,
              (session.partner?.pub_key || peerPub)
            )
          : msg.text,
      };
      setMessages((prev) => [...prev, decrypted]);
      scrollDown();
      if (msg.sender_id !== session.userId && AppState.currentState !== "active") {
        notifyNewMessage({
          title: partnerNameRef.current || "Mi Amor 💞",
          body: msg.type === "photo" ? "📷 Te envió una foto" : decrypted.text,
        });
      }
    });
    socket.on("partner_joined", ({ partner }) => setPartner(partner));
    socket.on("typing", ({ isTyping }) => {
      setTyping(isTyping);
      clearTimeout(typingTimer.current);
      if (isTyping) {
        typingTimer.current = setTimeout(() => setTyping(false), 2500);
      }
    });

    return () => {
      alive = false;
      socket.off("message");
      socket.off("partner_joined");
      socket.off("typing");
      disconnectSocket();
      clearTimeout(typingTimer.current);
    };
  }, [live, session?.coupleId, session?.userId, scrollDown]);

  const handleTyping = (value) => {
    setText(value);
    if (live) {
      sendTyping({ coupleId: session.coupleId, userId: session.userId, isTyping: !!value });
    }
  };

  const send = () => {
    const value = text.trim();
    if (!value) return;
    if (live) {
      const enc = encryptText(value, keys?.privateKeyB64, session.partner?.pub_key || peerPub);
      sendMessage({
        coupleId: session.coupleId,
        senderId: session.userId,
        text: enc.plaintext ?? enc.ciphertextB64,
        nonce: enc.nonceB64,
        ciphertextB64: enc.ciphertextB64,
      });
    } else {
      setMessages((prev) => [
        ...prev,
        { id: String(Date.now()), from: "me", type: "text", text: value, time: timeOf() },
      ]);
    }
    setText("");
    scrollDown();
  };

  const pickPhoto = async () => {
    if (!live) {
      Alert.alert("Modo maqueta", "Vincula una pareja para enviar fotos reales.");
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permiso necesario", "Habilita el acceso a tus fotos.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (result.canceled) return;
    const uri = result.assets[0].uri;

    const localId = `local_${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: localId, from: "me", type: "photo", localUri: uri, time: timeOf() },
    ]);
    scrollDown();
    try {
      await uploadPhoto({
        coupleId: session.coupleId,
        senderId: session.userId,
        uri,
      });
    } catch (e) {
      Alert.alert("Error", e.message);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Avatar emoji={partnerEmoji} color={partner?.avatarColor || mockPartner.avatarColor} online />
        <View style={{ marginLeft: spacing.sm, flex: 1 }}>
          <Text style={styles.name}>{partnerName}</Text>
          <Text style={styles.status}>
            {typing ? "escribiendo…" : live ? "en línea" : "modo maqueta"}
          </Text>
        </View>
        <Pressable style={styles.iconBtn}>
          <Ionicons name="lock-closed" size={18} color={colors.muted} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => (
            <MessageBubble item={item} userId={session?.userId} />
          )}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.lg }}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <Text style={styles.empty}>
              Aún no hay mensajes. ¡Rompe el hielo! 💬
            </Text>
          }
        />
      )}

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
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { color: colors.muted, textAlign: "center", marginTop: spacing.xl },
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

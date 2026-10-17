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
import * as FileSystem from "expo-file-system";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors, radius, spacing } from "../theme";
import { mockMessages, mockPartner } from "../data/mock";
import Avatar from "../components/Avatar";
import { useSession } from "../context/SessionContext";
import { getMessages, getCouple, postPhoto, photoFileUrl } from "../services/api";
import {
  connectSocket,
  getSocket,
  sendMessage,
  sendTyping,
  disconnectSocket,
} from "../services/socket";
import { useE2E } from "../context/E2EContext";
import {
  encryptText,
  decryptText,
  encryptBytes,
  decryptBytes,
  b64ToBytes,
  bytesToB64,
} from "../services/crypto";
import {
  configureNotifications,
  requestNotificationPermission,
  notifyNewMessage,
} from "../services/notifications";

function timeOf(ts) {
  const d = ts ? new Date(ts) : new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

function MessageBubble({ item, userId }) {
  const mine = item.sender_id === userId;
  return (
    <View style={[styles.row, mine ? styles.rowMe : styles.rowOther]}>
      <View style={[styles.bubble, mine ? styles.bubbleMe : styles.bubbleOther]}>
        {item.type === "photo" ? (
          item.localUri ? (
            <Image source={{ uri: item.localUri }} style={styles.photo} />
          ) : (
            <View style={[styles.photo, styles.photoPending]}>
              <ActivityIndicator color={colors.primary} />
            </View>
          )
        ) : (
          <Text style={[styles.msgText, mine && styles.msgTextMe]}>
            {item.text || (mine ? "" : "🔒 Sin clave para descifrar")}
          </Text>
        )}
        <Text style={[styles.time, mine ? styles.timeMe : styles.timeOther]}>
          {item.time || timeOf(item.created_at)}
        </Text>
      </View>
    </View>
  );
}

export default function ChatScreen() {
  const { session, setPartner } = useSession();
  const { keys, peerPub } = useE2E();
  const live = !!session?.coupleId && !!session?.token;

  const [messages, setMessages] = useState(live ? [] : mockMessages);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(live);
  const [typing, setTyping] = useState(false);
  const [partner, setPartnerLocal] = useState(session?.partner || mockPartner);
  const listRef = useRef(null);
  const typingTimer = useRef(null);
  const partnerNameRef = useRef(session?.partner?.name || mockPartner.name);

  // Claves actuales accesibles desde callbacks estables (evita closures viejas).
  const e2eRef = useRef({});
  e2eRef.current = {
    priv: keys?.privateKeyB64,
    pub: session?.partner?.pub_key || peerPub,
  };
  // Filas "crudas" del servidor (con ciphertext) para re-descifrar y cachear.
  const rawRef = useRef([]);
  const photoBusyRef = useRef(new Set());

  const partnerName = partner?.name || mockPartner.name;
  const partnerEmoji = partner?.emoji || mockPartner.emoji;
  partnerNameRef.current = partnerName;

  const cacheKey = session?.coupleId ? `duo.msgs.${session.coupleId}` : null;

  const decodeRow = useCallback((m, priv, pub) => {
    if (m.type === "text" && m.ciphertext) {
      return {
        ...m,
        text: decryptText(
          { ciphertextB64: m.ciphertext, nonceB64: m.nonce },
          priv,
          pub
        ),
      };
    }
    return m;
  }, []);

  const persistCache = useCallback(
    (rows) => {
      if (!cacheKey) return;
      AsyncStorage.setItem(cacheKey, JSON.stringify(rows.slice(-200))).catch(
        () => {}
      );
    },
    [cacheKey]
  );

  const scrollDown = useCallback(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
  }, []);

  // Descarga la foto (cifrada) del servidor, la descifra y la guarda COPIA
  // LOCAL en el dispositivo. Después solo se lee de ahí.
  const decodePhoto = useCallback(
    async (msg) => {
      const { priv, pub } = e2eRef.current;
      if (!msg.url || !priv || !pub) return;
      if (photoBusyRef.current.has(msg.id)) return;
      photoBusyRef.current.add(msg.id);
      const dest = `${FileSystem.documentDirectory}duo_${msg.id}.jpg`;
      try {
        const info = await FileSystem.getInfoAsync(dest);
        if (!info.exists) {
          const tmp = await FileSystem.downloadAsync(
            photoFileUrl(msg.url),
            `${FileSystem.documentDirectory}tmp_${msg.id}.bin`
          );
          const cipherB64 = await FileSystem.readAsStringAsync(tmp.uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const plain = decryptBytes(cipherB64, msg.nonce, priv, pub);
          await FileSystem.deleteAsync(tmp.uri, { idempotent: true });
          if (!plain) return;
          await FileSystem.writeAsStringAsync(dest, bytesToB64(plain), {
            encoding: FileSystem.EncodingType.Base64,
          });
        }
        setMessages((prev) =>
          prev.map((m) => (m.id === msg.id ? { ...m, localUri: dest } : m))
        );
      } catch (e) {
        console.warn("No se pudo abrir la foto:", e.message);
      } finally {
        photoBusyRef.current.delete(msg.id);
      }
    },
    []
  );

  useEffect(() => {
    if (!live) return;
    configureNotifications();
    requestNotificationPermission();
  }, [live]);

  // Carga: primero la caché local, luego el historial del servidor.
  useEffect(() => {
    if (!live) return;
    let alive = true;

    (async () => {
      try {
        const cached = cacheKey ? await AsyncStorage.getItem(cacheKey) : null;
        if (alive && cached) {
          const rows = JSON.parse(cached);
          rawRef.current = rows;
          setMessages(
            rows.map((m) =>
              decodeRow(m, e2eRef.current.priv, e2eRef.current.pub)
            )
          );
        }

        const [history, info] = await Promise.all([
          getMessages(session.coupleId, session.userId, session.token),
          getCouple(session.coupleId, session.userId, session.token).catch(
            () => null
          ),
        ]);
        if (!alive) return;
        rawRef.current = history;
        setMessages(
          history.map((m) =>
            decodeRow(m, e2eRef.current.priv, e2eRef.current.pub)
          )
        );
        persistCache(history);
        if (info?.partner) {
          setPartner(info.partner);
          setPartnerLocal(info.partner);
        }
      } catch (e) {
        console.warn("No se pudo cargar el historial:", e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    const socket = connectSocket({
      coupleId: session.coupleId,
      userId: session.userId,
      token: session.token,
    });

    socket.on("message", (msg) => {
      // Los mensajes propios ya entran de forma optimista: ignorar el eco.
      if (msg.sender_id === session.userId) return;
      const decrypted = decodeRow(
        msg,
        e2eRef.current.priv,
        e2eRef.current.pub
      );
      setMessages((prev) => [...prev, decrypted]);
      rawRef.current = [...rawRef.current, msg];
      persistCache(rawRef.current);
      scrollDown();
      if (AppState.currentState !== "active") {
        notifyNewMessage({
          title: partnerNameRef.current || "Mi Amor 💞",
          body:
            msg.type === "photo"
              ? "📷 Te envió una foto"
              : decrypted.text || "💬 Nuevo mensaje",
        });
      }
    });

    socket.on("partner_joined", ({ partner: p }) => {
      setPartner(p);
      setPartnerLocal(p);
    });

    socket.on("typing", ({ isTyping }) => {
      setTyping(isTyping);
      clearTimeout(typingTimer.current);
      if (isTyping) {
        typingTimer.current = setTimeout(() => setTyping(false), 2500);
      }
    });

    socket.on("auth_error", () => {
      Alert.alert(
        "Vínculo inválido",
        "Tu sesión ya no tiene acceso a esta pareja. Ve a Perfil y elige «Desvincular» para volver a vincular."
      );
    });

    return () => {
      alive = false;
      socket.off("message");
      socket.off("partner_joined");
      socket.off("typing");
      socket.off("auth_error");
      disconnectSocket();
      clearTimeout(typingTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, session?.coupleId, session?.userId]);

  // Cuando llegan (o terminan de cargar) las claves, re-descifra el historial.
  useEffect(() => {
    if (!live || !rawRef.current.length) return;
    const { priv, pub } = e2eRef.current;
    setMessages(rawRef.current.map((m) => decodeRow(m, priv, pub)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys?.privateKeyB64, peerPub]);

  // Asegura que cada foto tenga su copia local descifrada.
  useEffect(() => {
    if (!live) return;
    messages.forEach((m) => {
      if (m.type === "photo" && m.url && !m.localUri) decodePhoto(m);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, live]);

  const handleTyping = (value) => {
    setText(value);
    if (live) sendTyping({ isTyping: !!value });
  };

  const send = () => {
    const value = text.trim();
    if (!value) return;
    setText("");
    if (live) {
      const { priv, pub } = e2eRef.current;
      if (!priv || !pub) {
        Alert.alert(
          "Aún no pueden cifrar",
          "Espera a que tu pareja se una al vínculo (o vuelve a vincular desde Perfil)."
        );
        return;
      }
      const enc = encryptText(value, priv, pub);
      if (enc.error) {
        Alert.alert("No se pudo cifrar", enc.error);
        return;
      }
      if (!getSocket()?.connected) {
        Alert.alert("Sin conexión", "El mensaje no se pudo enviar.");
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `local_${Date.now()}`,
          sender_id: session.userId,
          type: "text",
          text: value,
          created_at: Date.now(),
        },
      ]);
      sendMessage({ ciphertextB64: enc.ciphertextB64, nonce: enc.nonceB64 });
    } else {
      setMessages((prev) => [
        ...prev,
        {
          id: String(Date.now()),
          from: "me",
          type: "text",
          text: value,
          time: timeOf(),
        },
      ]);
    }
    scrollDown();
  };

  const pickPhoto = async () => {
    if (!live) {
      Alert.alert("Modo maqueta", "Vincula una pareja para enviar fotos reales.");
      return;
    }
    const { priv, pub } = e2eRef.current;
    if (!priv || !pub) {
      Alert.alert(
        "Aún no pueden cifrar",
        "Espera a que tu pareja se una al vínculo para enviar fotos."
      );
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
      {
        id: localId,
        sender_id: session.userId,
        type: "photo",
        localUri: uri,
        created_at: Date.now(),
      },
    ]);
    scrollDown();
    try {
      // Cifrar ANTES de subir: el servidor solo recibe bytes ilegibles.
      const b64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const enc = encryptBytes(b64ToBytes(b64), priv, pub);
      if (!enc) throw new Error("No se pudo cifrar la foto");
      await postPhoto({
        coupleId: session.coupleId,
        senderId: session.userId,
        token: session.token,
        nonceB64: enc.nonceB64,
        imageDataB64: enc.cipherB64,
      });
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== localId));
      Alert.alert("Error", e.message);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Avatar
          emoji={partnerEmoji}
          color={partner?.avatarColor || mockPartner.avatarColor}
          online
        />
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
  photoPending: { alignItems: "center", justifyContent: "center" },
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

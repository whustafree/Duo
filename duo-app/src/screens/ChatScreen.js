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
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { Audio, Video, ResizeMode } from "expo-av";
import { colors, radius, spacing } from "../theme";
import Avatar from "../components/Avatar";
import { useSession } from "../context/SessionContext";
import { useP2P } from "../context/P2PContext";
import {
  REACTIONS,
  deliveryState,
  STATE_MARK,
} from "../services/chatcodec";
import GameInlinePanel from "../components/GameInlinePanel";

// Chat cifrado de extremo a extremo: los mensajes salen cifrados de este
// teléfono y viajan por un relay (broker público) que solo hace de cartero.
// Si la pareja está desconectada, el mensaje queda guardado aquí (pendiente) y
// se envía solo en cuanto los dos vuelven a estar conectados.

function timeOf(ts) {
  const d = ts ? new Date(ts) : new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

// Fecha + hora legible para el detalle de entrega (doble toque).
function stampOf(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const hoy = new Date();
  const mismoDia =
    d.getFullYear() === hoy.getFullYear() &&
    d.getMonth() === hoy.getMonth() &&
    d.getDate() === hoy.getDate();
  const hora = timeOf(ts);
  if (mismoDia) return `hoy a las ${hora}`;
  return `${String(d.getDate()).padStart(2, "0")}/${String(
    d.getMonth() + 1
  ).padStart(2, "0")} a las ${hora}`;
}

// Texto del detalle de entrega de un mensaje propio.
function deliveryDetail(item) {
  if (!item || item.from !== "me") return "";
  const st = deliveryState(item);
  if (st === "read") return `Leído ${stampOf(item.readAt || item.ts)}`;
  if (st === "delivered")
    return `Entregado ${stampOf(item.deliveredAt || item.ts)}`;
  if (st === "sent") return "Enviado (esperando a tu pareja)";
  if (st === "failed") return "No se pudo enviar · toca Reintentar";
  return "En cola · se enviará solo";
}

function MessageBubble({ item, partnerName, onLongPress, onRetry }) {
  const mine = item.from === "me";
  const [sound, setSound] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const lastTapRef = useRef(0);

  // Doble toque: muestra el estado real de entrega con su hora.
  const handlePress = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 320) {
      lastTapRef.current = 0;
      Alert.alert(
        mine ? "Estado del mensaje" : "Mensaje recibido",
        mine
          ? deliveryDetail(item)
          : `Recibido ${stampOf(item.ts)}${
              item.read ? `\nLeído ${stampOf(item.readAt)}` : ""
            }`,
        [{ text: "Vale" }]
      );
      return;
    }
    lastTapRef.current = now;
  };

  useEffect(
    () => () => {
      if (sound) sound.unloadAsync().catch(() => {});
    },
    [sound]
  );

  // Nota de voz: reproducir / pausar.
  const toggleAudio = async () => {
    try {
      if (sound) {
        const st = await sound.getStatusAsync();
        if (st.isLoaded && st.isPlaying) {
          await sound.pauseAsync();
          setPlaying(false);
        } else if (st.isLoaded) {
          await sound.replayAsync();
          setPlaying(true);
        }
        return;
      }
      const s = new Audio.Sound();
      await s.loadAsync({ uri: item.uri });
      s.setOnPlaybackStatusUpdate((st) => {
        if (st.isLoaded && !st.isPlaying) setPlaying(false);
      });
      await s.playAsync();
      setSound(s);
      setPlaying(true);
    } catch {
      Alert.alert("No se pudo reproducir", "Inténtalo otra vez.");
    }
  };

  const state = deliveryState(item);
  const badges = Object.keys(item.reactions || {}).join(" ");

  return (
    <View style={[styles.row, mine ? styles.rowMe : styles.rowOther]}>
      <Pressable
        style={[styles.bubble, mine ? styles.bubbleMe : styles.bubbleOther]}
        onPress={handlePress}
        onLongPress={() => onLongPress && onLongPress(item)}
        delayLongPress={350}
      >
        {item.kind === "photo" ? (
          <Image source={{ uri: item.uri }} style={styles.photo} />
        ) : null}
        {item.kind === "audio" ? (
          <Pressable style={styles.mediaRow} onPress={toggleAudio}>
            <Ionicons
              name={playing ? "pause-circle" : "play-circle"}
              size={34}
              color={mine ? colors.white : colors.primary}
            />
            <View style={styles.wave} />
            <Text style={[styles.mediaText, mine && { color: colors.white }]}>
              Nota de voz
            </Text>
          </Pressable>
        ) : null}
        {item.kind === "video" ? (
          <Pressable
            style={styles.videoThumb}
            onPress={() => setVideoOpen(true)}
          >
            <Ionicons name="play-circle" size={44} color={colors.white} />
            <Text style={styles.videoText}>Vídeo · toca para ver</Text>
          </Pressable>
        ) : null}
        {item.replyTo ? (
          <View style={[styles.quote, mine && styles.quoteMe]}>
            <Text
              style={[styles.quoteWho, mine && styles.quoteWhoMe]}
              numberOfLines={2}
            >
              {item.replyTo.from === "me" ? "Tú" : partnerName}:{" "}
              {item.replyTo.preview}
            </Text>
          </View>
        ) : null}
        {!item.kind || item.kind === "text" ? (
          <Text style={[styles.msgText, mine && styles.msgTextMe]}>
            {item.text}
          </Text>
        ) : null}
        {badges ? <Text style={styles.badges}>{badges}</Text> : null}
        <View style={styles.metaRow}>
          <Text style={[styles.time, mine ? styles.timeMe : styles.timeOther]}>
            {timeOf(item.ts)}
          </Text>
          {mine ? (
            <Text
              style={[
                styles.tick,
                state === "read" && styles.tickRead,
                mine && state !== "read" && styles.timeMe,
              ]}
            >
              {STATE_MARK[state]}
            </Text>
          ) : null}
          {mine && state === "failed" ? (
            <Pressable onPress={() => onRetry && onRetry(item.id)} hitSlop={8}>
              <Text style={styles.retryText}>⭕ Reintentar</Text>
            </Pressable>
          ) : null}
        </View>
      </Pressable>
      {videoOpen ? (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setVideoOpen(false)}
        >
          <View style={styles.videoBack}>
            <Pressable
              style={styles.videoClose}
              onPress={() => setVideoOpen(false)}
            >
              <Ionicons name="close" size={30} color={colors.white} />
            </Pressable>
            <Video
              source={{ uri: item.uri }}
              useNativeControls
              shouldPlay
              resizeMode={ResizeMode.CONTAIN}
              style={styles.videoFull}
            />
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

export default function ChatScreen() {
  const { session } = useSession();
  const {
    status,
    partnerOnline,
    partnerLastSeen,
    messages,
    typing,
    sendText,
    sendPhoto,
    sendAudio,
    sendVideo,
    sendTyping,
    sendReaction,
    retryMessage,
    gameSession,
    startGame,
    endGame,
  } = useP2P();
  const [showGamesMenu, setShowGamesMenu] = useState(false);

  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [sheetTarget, setSheetTarget] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [recording, setRecording] = useState(null);
  const [recSecs, setRecSecs] = useState(0);
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

  // Vista de un mensaje para citarlo (lo que verá la pareja al responder).
  const previewOf = (row) => {
    if (!row) return null;
    const kind = row.kind || "text";
    const preview =
      kind === "photo"
        ? "📷 Foto"
        : kind === "audio"
        ? "🎙 Nota de voz"
        : kind === "video"
        ? "🎬 Vídeo"
        : String(row.text || "").slice(0, 140);
    return {
      id: row.id,
      from: row.from === "me" ? "me" : "them",
      kind,
      preview,
    };
  };

  const send = () => {
    const value = text.trim();
    if (!value) return;
    setText("");
    sendText(value, replyTo);
    setReplyTo(null);
    sendTyping(false);
    scrollDown();
  };

  // Hoja de acciones al mantener pulsado un mensaje: reaccionar o responder.
  const openSheet = (row) => setSheetTarget(row);
  const reactTo = (emoji) => {
    if (sheetTarget) sendReaction(sheetTarget.id, emoji);
    setSheetTarget(null);
  };
  const startReply = () => {
    setReplyTo(previewOf(sheetTarget));
    setSheetTarget(null);
  };

  // Reducir antes de enviar: así el teléfono viejo también lo procesa rápido
  // (y se cifra igual de bien antes de salir de aquí).
  const sendImage = async (src) => {
    const resized = await ImageManipulator.manipulateAsync(
      src,
      [{ resize: { width: 1280 } }],
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
    );
    await sendPhoto(resized.uri);
    scrollDown();
  };

  const pickPhoto = async () => {
    setMenuOpen(false);
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
    try {
      await sendImage(result.assets[0].uri);
    } catch (e) {
      Alert.alert("No se pudo enviar la foto", e?.message || "");
    }
  };

  // Foto con la cámara del propio móvil.
  const takePhoto = async () => {
    setMenuOpen(false);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permiso necesario", "Habilita la cámara para hacer fotos.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });
    if (result.canceled) return;
    try {
      await sendImage(result.assets[0].uri);
    } catch (e) {
      Alert.alert("No se pudo enviar la foto", e?.message || "");
    }
  };

  // Los vídeos van troceados como las fotos. El tope de 6 MB se comprueba
  // dentro de `sendMedia` con el tamaño REAL del archivo (sin leerlo en
  // memoria): si pesa más, se avisa y no se envía.
  const sendVideoUri = async (uri) => {
    await sendVideo(uri);
    scrollDown();
  };

  const takeVideo = async () => {
    setMenuOpen(false);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permiso necesario", "Habilita la cámara para grabar vídeo.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      videoMaxDuration: 20,
    });
    if (result.canceled) return;
    const a = result.assets[0];
    try {
      await sendVideoUri(a.uri);
    } catch (e) {
      Alert.alert("No se pudo enviar el vídeo", e?.message || "");
    }
  };

  const pickGalleryVideo = async () => {
    setMenuOpen(false);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
    });
    if (result.canceled) return;
    const a = result.assets[0];
    try {
      await sendVideoUri(a.uri);
    } catch (e) {
      Alert.alert("No se pudo enviar el vídeo", e?.message || "");
    }
  };

  const fmtSecs = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(
      2,
      "0"
    )}`;

  const startRecording = async () => {
    setMenuOpen(false);
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "Permiso necesario",
          "Habilita el micrófono para grabar notas de voz."
        );
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      rec.setProgressUpdateInterval(500);
      rec.setOnRecordingStatusUpdate((st) =>
        setRecSecs(Math.floor((st.durationMillis || 0) / 1000))
      );
      await rec.startRecording();
      setRecording(rec);
    } catch (e) {
      Alert.alert("No se pudo grabar", e?.message || "");
    }
  };

  const stopRecording = async (sendIt) => {
    const rec = recording;
    setRecording(null);
    if (!rec) return;
    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      setRecSecs(0);
      if (sendIt && uri) {
        await sendAudio(uri);
        scrollDown();
      }
    } catch (e) {
      Alert.alert("No se pudo guardar la nota de voz", e?.message || "");
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Avatar
          emoji={partnerEmoji}
          color={session?.partnerAvatarColor || "#FF6B8B"}
          online={partnerOnline}
        />
        <View style={{ marginLeft: spacing.sm, flex: 1 }}>
          <Text style={styles.name}>{partnerName}</Text>
          <Text
            style={[
              styles.status,
              partnerOnline && styles.statusOnline,
              !partnerOnline && styles.statusOffline,
            ]}
          >
            {typing
              ? "escribiendo…"
              : partnerOnline
              ? "en línea"
              : partnerLastSeen
              ? `última vez ${stampOf(partnerLastSeen)}`
              : status === "connecting"
              ? "conectando…"
              : status === "offline"
              ? "sin conexión"
              : "desconectada"}
          </Text>
        </View>
        <Pressable
          style={styles.iconBtn}
          onPress={() =>
            Alert.alert(
              "Chat privado 🔒",
              "Tus mensajes van cifrados de extremo a extremo: salen de este teléfono " +
                "y solo tu pareja puede leerlos. Nadie más puede verlos."
            )
          }
        >
          <Ionicons name="lock-closed" size={18} color={colors.muted} />
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => (
          <MessageBubble
            item={item}
            partnerName={partnerName}
            onLongPress={openSheet}
            onRetry={retryMessage}
          />
        )}
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
            {!partnerOnline ? (
              <Text style={styles.emptyHint}>
                {status === "connecting"
                  ? "Buscando a tu pareja… se enviará todo en cuanto esté en línea."
                  : "Tus mensajes se enviarán solos cuando tu pareja abra la app y tenga Internet."}
              </Text>
            ) : null}
          </View>
        }
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        {gameSession && gameSession.gameId ? <GameInlinePanel onClose={() => endGame()} /> : null}
        {showGamesMenu && !gameSession ? (
          <View style={styles.menu}>
            {[
              { icon: "sparkles", label: "Verdad o Reto", id: "verdad" },
              { icon: "sync-circle", label: "Ruleta de Retos", id: "ruleta" },
              { icon: "dice", label: "Dados del Deseo", id: "dados" },
              { icon: "chatbubbles", label: "Para Conocernos", id: "preguntas" },
            ].map((o) => (
              <Pressable
                key={o.id}
                style={styles.menuItem}
                onPress={() => {
                  setShowGamesMenu(false);
                  try {
                    startGame(o.id, 1);
                  } catch (e) {
                    Alert.alert("No se pudo iniciar el juego", e?.message || "");
                  }
                }}
              >
                <Ionicons name={o.icon} size={22} color={colors.primary} />
                <Text style={styles.menuText}>{o.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {menuOpen ? (
          <View style={styles.menu}>
            {[
              { icon: "camera", label: "Hacer una foto", fn: takePhoto },
              { icon: "images", label: "Foto de la galería", fn: pickPhoto },
              { icon: "videocam", label: "Grabar un vídeo (20 s)", fn: takeVideo },
              { icon: "film", label: "Vídeo de la galería", fn: pickGalleryVideo },
              { icon: "mic", label: "Grabar una nota de voz", fn: startRecording },
            ].map((o) => (
              <Pressable key={o.icon} style={styles.menuItem} onPress={o.fn}>
                <Ionicons name={o.icon} size={22} color={colors.primary} />
                <Text style={styles.menuText}>{o.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {replyTo ? (
          <View style={styles.replyBar}>
            <Ionicons name="return-up-forward" size={16} color={colors.primary} />
            <Text style={styles.replyBarText} numberOfLines={1}>
              {(replyTo.from === "me" ? "Tú: " : `${partnerName}: `) +
                replyTo.preview}
            </Text>
            <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          </View>
        ) : null}
        {recording ? (
          <View style={styles.inputBar}>
            <Text style={styles.recText}>🎙 Grabando… {fmtSecs(recSecs)}</Text>
            <Pressable
              style={styles.recCancel}
              onPress={() => stopRecording(false)}
            >
              <Text style={styles.recCancelText}>Cancelar</Text>
            </Pressable>
            <Pressable style={styles.sendBtn} onPress={() => stopRecording(true)}>
              <Ionicons name="send" size={18} color={colors.white} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.inputBar}>
            <Pressable
              style={styles.attachBtn}
              onPress={() => {
                setMenuOpen((v) => !v);
                if (showGamesMenu) setShowGamesMenu(false);
              }}
            >
              <Ionicons
                name={menuOpen ? "close" : "add-circle"}
                size={26}
                color={colors.muted}
              />
            </Pressable>
            <Pressable
              style={styles.attachBtn}
              onPress={() => {
                setShowGamesMenu((v) => !v);
                if (menuOpen) setMenuOpen(false);
              }}
            >
              <Ionicons
                name={showGamesMenu ? "game-controller" : "game-controller-outline"}
                size={24}
                color={colors.muted}
              />
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
        )}
      </KeyboardAvoidingView>

      {/* Hoja de reacciones y responder (mantener pulsado un mensaje) */}
      {sheetTarget ? (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setSheetTarget(null)}
        >
          <Pressable
            style={styles.sheetBack}
            onPress={() => setSheetTarget(null)}
          >
            <Pressable style={styles.sheet} onPress={() => {}}>
              <Text style={styles.sheetTitle} numberOfLines={1}>
                {sheetTarget.kind === "photo"
                  ? "📷 Foto"
                  : sheetTarget.kind === "audio"
                  ? "🎙 Nota de voz"
                  : sheetTarget.kind === "video"
                  ? "🎬 Vídeo"
                  : sheetTarget.text}
              </Text>
              <View style={styles.reactRow}>
                {REACTIONS.map((e) => (
                  <Pressable
                    key={e}
                    style={styles.reactBtn}
                    onPress={() => reactTo(e)}
                  >
                    <Text style={styles.reactEmoji}>{e}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable style={styles.sheetItem} onPress={startReply}>
                <Ionicons name="return-up-forward" size={20} color={colors.primary} />
                <Text style={styles.sheetItemText}>Responder</Text>
              </Pressable>
              <Pressable
                style={styles.sheetItem}
                onPress={() => setSheetTarget(null)}
              >
                <Ionicons name="close" size={20} color={colors.muted} />
                <Text style={[styles.sheetItemText, { color: colors.muted }]}>
                  Cancelar
                </Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
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
  statusOnline: { color: "#34D399", fontWeight: "700" },
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
  tick: { fontSize: 10, marginTop: 4, marginLeft: 3, fontWeight: "800" },
  tickRead: { color: "#34D399" },
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
  menu: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  menuText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
    marginLeft: spacing.md,
  },
  mediaRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
  },
  wave: {
    width: 64,
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.55)",
    marginHorizontal: spacing.sm,
  },
  mediaText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  videoThumb: {
    width: 200,
    height: 140,
    borderRadius: radius.md,
    backgroundColor: "#2A1F3B",
    alignItems: "center",
    justifyContent: "center",
  },
  videoText: {
    color: colors.white,
    fontSize: 13,
    marginTop: 6,
    fontWeight: "600",
  },
  videoBack: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.94)",
    justifyContent: "center",
  },
  videoFull: { width: "100%", height: "70%" },
  videoClose: {
    position: "absolute",
    top: 52,
    right: 18,
    zIndex: 2,
    padding: 8,
  },
  recText: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
    marginLeft: spacing.sm,
  },
  recCancel: { padding: spacing.sm, marginRight: spacing.sm },
  recCancelText: { color: colors.muted, fontSize: 14, fontWeight: "600" },
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
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: "rgba(255,255,255,0.45)",
    paddingLeft: spacing.sm,
    marginBottom: 6,
    backgroundColor: "rgba(0,0,0,0.15)",
    borderRadius: radius.sm,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
  },
  quoteMe: { borderLeftColor: "#FFD9E0" },
  quoteWho: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  quoteWhoMe: { color: "#FFD9E0" },
  badges: {
    marginTop: 4,
    fontSize: 16,
    alignSelf: "flex-start",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
    alignSelf: "flex-end",
  },
  retryText: { color: "#FFC25E", fontSize: 10, fontWeight: "700" },
  replyBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  replyBarText: { flex: 1, color: colors.muted, fontSize: 13 },
  sheetBack: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.md,
    paddingBottom: spacing.lg,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: spacing.sm,
  },
  reactRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  reactBtn: {
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  reactEmoji: { fontSize: 24 },
  sheetItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  sheetItemText: { color: colors.text, fontSize: 15, fontWeight: "600" },
});

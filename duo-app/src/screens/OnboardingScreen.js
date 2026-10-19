import { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ActivityIndicator,
  Alert,
  Share,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { CameraView, useCameraPermissions } from "expo-camera";
import QRCode from "react-native-qrcode-svg";
import { colors, radius, spacing } from "../theme";
import PrimaryButton from "../components/PrimaryButton";
import { useE2E } from "../context/E2EContext";
import { useSession } from "../context/SessionContext";
import { useP2P } from "../context/P2PContext";
import { emojiForPub, verificationCode } from "../services/cryptocore";
import { parsePairQr } from "../services/relayproto";

// Vinculación de la pareja: NO hay servidor propio. Cada dispositivo tiene su
// clave; el vínculo se hace intercambiando un código corto (QR o pegar texto)
// y confirmando un código de verificación (SAS). El chat viaja después cifrado
// de extremo a extremo a través de un broker público que solo hace de cartero.

export default function OnboardingScreen({ navigation }) {
  const { save } = useSession();
  const { keys } = useE2E();
  const p2p = useP2P();
  const [step, setStep] = useState("welcome"); // welcome | create | scan | paste | joining
  const [name, setName] = useState("");
  const [qr, setQr] = useState(null);
  const [pasteText, setPasteText] = useState("");
  const [scanSas, setScanSas] = useState(null);
  const [error, setError] = useState("");
  const [permission, requestPermission] = useCameraPermissions();
  const scannedRef = useRef(false);
  const pairTsRef = useRef(null);
  const cancelRef = useRef(false);

  const myPub = keys?.publicKeyB64;
  const myEmoji = myPub ? emojiForPub(myPub) : "💞";

  // Guarda la sesión e ir al chat.
  const enterApp = (partnerPub, coupleId, partnerName, partnerEmoji) => {
    save({
      coupleId,
      partnerPub,
      partnerName: partnerName || "",
      partnerEmoji: partnerEmoji || "💞",
      myName: name || "Yo",
      myEmoji,
      linked: true,
    });
    p2p.clearPairedResult();
    navigation.replace("Main");
  };

  // Resultado del vínculo en el lado que CREA (recibe "paired").
  useEffect(() => {
    const r = p2p.pairedResult;
    if (!r) return;
    enterApp(r.partnerPub, r.coupleId, r.partnerName, r.partnerEmoji);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p2p.pairedResult]);

  // Llegó alguien con nuestro código: confirmar con el código SAS.
  useEffect(() => {
    const req = p2p.pendingPair;
    if (!req || req.ts === pairTsRef.current) return;
    pairTsRef.current = req.ts;
    Alert.alert(
      "Solicitud de vínculo",
      `${req.emoji} ${req.name} quiere vincularse contigo.\n\n` +
        `Código de verificación: ${req.sas}\n` +
        `Debe coincidir con el que ve tu pareja en su teléfono.`,
      [
        { text: "Rechazar", style: "cancel", onPress: () => p2p.rejectPairing() },
        { text: "Aceptar", onPress: () => p2p.acceptPairing() },
      ]
    );
  }, [p2p.pendingPair, p2p]);

  const startCreate = async () => {
    setError("");
    if (!name.trim()) {
      setError("Escribe tu nombre para continuar.");
      return;
    }
    try {
      const res = await p2p.startPairing(name.trim());
      setQr(res.qr);
      setStep("create");
    } catch (e) {
      setError(e.message);
    }
  };

  const startScan = async () => {
    setError("");
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res?.granted) {
        setError("Necesitamos acceso a la cámara para escanear el QR de tu pareja.");
        return;
      }
    }
    scannedRef.current = false;
    setStep("scan");
  };

  // Une este dispositivo usando un código (QR escaneado o texto pegado).
  const link = async (code) => {
    if (!parsePairQr(code)) {
      setError("Ese código no es un vínculo de Duo válido.");
      return;
    }
    setError("");
    setStep("joining");
    try {
      const res = await p2p.joinPairing(code);
      if (cancelRef.current) return;
      setScanSas(verificationCode(myPub, res.partnerPub));
      enterApp(res.partnerPub, res.coupleId, res.partnerName, res.partnerEmoji);
    } catch (e) {
      if (cancelRef.current) return;
      setError(e.message);
      setStep("welcome");
    }
  };

  const onScanned = async ({ data }) => {
    if (scannedRef.current || !data) return;
    scannedRef.current = true;
    cancelRef.current = false;
    await link(data);
  };

  const onShare = async () => {
    try {
      await Share.share({
        message:
          `Únete a mí en Duo 💞\nAbre la app, elige «Pegar un código» y pega este código:\n\n${qr}`,
      });
    } catch {}
  };

  const goBack = () => {
    cancelRef.current = true;
    p2p.cancelPairing();
    setQr(null);
    setScanSas(null);
    setPasteText("");
    setError("");
    setStep("welcome");
  };

  const NameField = (
    <TextInput
      value={name}
      onChangeText={setName}
      placeholder="Tu nombre"
      placeholderTextColor={colors.muted}
      style={styles.nameInput}
      maxLength={20}
    />
  );

  const ErrorText = error ? <Text style={styles.error}>{error}</Text> : null;

  if (step === "welcome") {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.hero}>
            <Text style={styles.logoEmoji}>💞</Text>
            <Text style={styles.logo}>Duo</Text>
            <Text style={styles.tagline}>
              Su espacio privado para dos: chat, fotos y retos. Sin servidores
              propios: vuestros mensajes van cifrados de extremo a extremo, aunque
              estéis en redes distintas.
            </Text>
            {NameField}
          </View>
          <View style={styles.actions}>
            <PrimaryButton
              title="Crear vínculo"
              onPress={startCreate}
              loading={!p2p.ready}
            />
            <PrimaryButton
              title="Escanear el QR de mi pareja"
              variant="ghost"
              onPress={startScan}
              style={{ marginTop: spacing.md }}
            />
            <PrimaryButton
              title="Pegar un código"
              variant="ghost"
              onPress={() => {
                setError("");
                setPasteText("");
                setStep("paste");
              }}
              style={{ marginTop: spacing.sm }}
            />
            <Text style={styles.toggleHint}>
              Uno crea el vínculo y comparte el código; el otro lo escanea o lo
              pega. No hace falta estar en la misma WiFi.
            </Text>
            {ErrorText}
            <Text style={styles.note}>
              🔒 Todo se cifra con vuestras claves: nadie más puede leerlo, ni
              siquiera la app.
            </Text>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  if (step === "create") {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <Pressable onPress={goBack} style={styles.back}>
          <Text style={styles.backText}>‹ Atrás</Text>
        </Pressable>
        <View style={styles.body}>
          <Text style={styles.h2}>Muestra este código a tu pareja</Text>
          <Text style={styles.muted}>
            Que abra Duo y elija «Escanear el QR» o «Pegar un código». Si no estáis
            juntos, pulsa «Compartir» y envíale el código por WhatsApp.
          </Text>
          <View style={styles.qrBox}>
            {qr ? (
              <QRCode
                value={qr}
                size={240}
                ecl="L"
                backgroundColor="#FFFFFF"
                color="#0E0B14"
              />
            ) : (
              <ActivityIndicator color={colors.primary} />
            )}
          </View>
          {qr ? (
            <Pressable onPress={onShare} style={styles.shareBtn}>
              <Text style={styles.shareText}>📤 Compartir el código</Text>
            </Pressable>
          ) : null}
          <Text style={styles.waiting}>
            {p2p.pendingPair
              ? "⏳ Solicitud recibida… confirma en el diálogo"
              : "⏳ Esperando a que tu pareja se una…"}
          </Text>
          {ErrorText}
        </View>
      </SafeAreaView>
    );
  }

  if (step === "paste") {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <Pressable onPress={goBack} style={styles.back}>
          <Text style={styles.backText}>‹ Atrás</Text>
        </Pressable>
        <KeyboardAvoidingView
          style={styles.body}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Text style={styles.h2}>Pega el código de tu pareja</Text>
          <Text style={styles.muted}>
            Pega aquí el código que te ha enviado (empieza por «duo:pair:v2:»).
          </Text>
          <TextInput
            value={pasteText}
            onChangeText={setPasteText}
            placeholder="duo:pair:v2:…"
            placeholderTextColor={colors.muted}
            style={styles.pasteInput}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
          />
          <PrimaryButton
            title="Vincular"
            onPress={() => link(pasteText.trim())}
            style={{ marginTop: spacing.lg }}
          />
          {ErrorText}
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  if (step === "joining") {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <View style={styles.body}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.h2, styles.centered]}>Vinculando…</Text>
          <Text style={[styles.muted, styles.centered]}>
            Conectando con tu pareja a través de Internet y verificando la
            identidad.
          </Text>
          {scanSas ? (
            <View style={styles.sasBox}>
              <Text style={styles.sasLabel}>Código de verificación</Text>
              <Text style={styles.sas}>{scanSas}</Text>
              <Text style={styles.sasHint}>
                Debe coincidir con el que ve tu pareja.
              </Text>
            </View>
          ) : null}
          {ErrorText}
          <PrimaryButton
            title="Cancelar"
            variant="ghost"
            onPress={goBack}
            style={{ marginTop: spacing.xl }}
          />
        </View>
      </SafeAreaView>
    );
  }

  // step === "scan"
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar style="light" />
      <Pressable onPress={goBack} style={styles.back}>
        <Text style={styles.backText}>‹ Atrás</Text>
      </Pressable>
      <View style={styles.scanBody}>
        <Text style={styles.h2}>Escanea el QR de tu pareja</Text>
        <Text style={styles.muted}>
          Apunta la cámara al código que se muestra en el teléfono de tu pareja.
        </Text>
        <View style={styles.cameraBox}>
          <CameraView
            style={styles.camera}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={scannedRef.current ? undefined : onScanned}
          />
        </View>
        {ErrorText}
      </View>
    </SafeAreaView>
  );
}

const { width } = Dimensions.get("window");

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  flex: { flex: 1 },
  hero: { flex: 1, alignItems: "center", justifyContent: "center" },
  logoEmoji: { fontSize: 72, marginBottom: spacing.sm },
  logo: { fontSize: 44, fontWeight: "900", color: colors.text, letterSpacing: 1 },
  tagline: {
    color: colors.muted,
    textAlign: "center",
    marginTop: spacing.md,
    fontSize: 15,
    lineHeight: 22,
    paddingHorizontal: spacing.lg,
  },
  actions: { paddingBottom: spacing.lg },
  note: { color: colors.muted, textAlign: "center", marginTop: spacing.lg, fontSize: 13 },
  back: { paddingVertical: spacing.sm },
  backText: { color: colors.primary, fontSize: 16, fontWeight: "600" },
  body: { flex: 1, justifyContent: "center" },
  h2: { fontSize: 24, fontWeight: "800", color: colors.text, marginBottom: spacing.sm },
  centered: { textAlign: "center", marginTop: spacing.lg },
  muted: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  qrBox: {
    marginTop: spacing.xl,
    backgroundColor: "#FFFFFF",
    borderRadius: radius.md,
    padding: spacing.lg,
    alignSelf: "center",
  },
  shareBtn: {
    marginTop: spacing.lg,
    alignSelf: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  shareText: { color: colors.primary, fontSize: 15, fontWeight: "700" },
  waiting: {
    color: colors.muted,
    textAlign: "center",
    marginTop: spacing.lg,
    fontSize: 14,
  },
  pasteInput: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.text,
    fontSize: 14,
    minHeight: 110,
    textAlignVertical: "top",
  },
  sasBox: {
    marginTop: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
  },
  sasLabel: { color: colors.muted, fontSize: 13 },
  sas: {
    color: colors.primary,
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: 6,
    marginTop: spacing.xs,
  },
  sasHint: { color: colors.muted, fontSize: 12, marginTop: spacing.xs, textAlign: "center" },
  toggleHint: {
    color: colors.muted,
    fontSize: 12,
    textAlign: "center",
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  nameInput: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    height: 54,
    color: colors.text,
    fontSize: 16,
    width: "100%",
    textAlign: "center",
  },
  error: {
    color: colors.primary,
    textAlign: "center",
    marginTop: spacing.md,
    fontSize: 14,
  },
  scanBody: { flex: 1, justifyContent: "center" },
  cameraBox: {
    marginTop: spacing.xl,
    borderRadius: radius.md,
    overflow: "hidden",
    height: width * 0.8,
    backgroundColor: colors.surfaceAlt,
  },
  camera: { flex: 1 },
});

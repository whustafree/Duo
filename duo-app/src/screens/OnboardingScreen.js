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
import { emojiForPub, verificationCode, b64ToBytes, bytesToB64 } from "../services/cryptocore";

// Vinculación P2P: NO hay servidor. Uno crea el vínculo y muestra un QR con su
// clave pública + dirección; el otro escanea con la cámara. Ambos comparan un
// código corto de verificación (SAS) para confirmar que son la pareja correcta.
// Todo el diálogo va cifrado con un secreto que solo viaja dentro del QR.

export default function OnboardingScreen({ navigation }) {
  const { save } = useSession();
  const { keys } = useE2E();
  const p2p = useP2P();
  const [step, setStep] = useState("welcome"); // welcome | create | scan | joining
  const [name, setName] = useState("");
  const [qr, setQr] = useState(null);
  const [scannedQr, setScannedQr] = useState(null);
  const [scanSas, setScanSas] = useState(null);
  const [error, setError] = useState("");
  const [permission, requestPermission] = useCameraPermissions();
  const scannedRef = useRef(false);
  const pairTsRef = useRef(null);
  const cancelRef = useRef(false); // el usuario volvió atrás mientras unía

  const myPub = keys?.publicKeyB64;
  const myEmoji = myPub ? emojiForPub(myPub) : "💞";

  // Resultado del vínculo (lado creador o escáner): guardar sesión e ir al chat.
  useEffect(() => {
    const r = p2p.pairedResult;
    if (!r) return;
    save({
      coupleId: r.coupleId,
      partnerPub: r.partnerPub,
      partnerName: r.partnerName,
      partnerEmoji: r.partnerEmoji,
      myName: name || "Yo",
      myEmoji,
      linked: true,
    });
    p2p.clearPairedResult();
    navigation.replace("Main");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p2p.pairedResult]);

  // Llegó alguien escaneando NUESTRO QR: pedir confirmación con código SAS.
  useEffect(() => {
    const req = p2p.pendingPair;
    if (!req || req.ts === pairTsRef.current) return;
    pairTsRef.current = req.ts;
    Alert.alert(
      "Solicitud de vínculo",
      `${req.emoji} ${req.name} quiere vincularse contigo.\n\n` +
        `Código de verificación: ${req.sas}\n` +
        `Debe coincidir con el código que se muestra en su teléfono.`,
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
      const { qr: value } = await p2p.startPairing(name.trim());
      setQr(value);
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

  const onScanned = async ({ data }) => {
    if (scannedRef.current || !data) return;
    scannedRef.current = true;
    cancelRef.current = false;
    try {
      // Calcular el SAS apenas escaneamos (ambos teléfonos deben mostrar lo mismo).
      const parts = String(data).split(":");
      // duo:pair:v1:<pub b64url>:<host|->:<port>:<ps b64url> (7 campos)
      if (parts.length === 7 && parts[0] === "duo") {
        const creatorPub = bytesToB64(b64ToBytes(parts[3]));
        setScanSas(verificationCode(myPub, creatorPub));
      }
      setStep("joining");
      // El nombre escrito viaja en la solicitud para que la otra pantalla lo vea.
      await p2p.joinPairing(data, name.trim() || undefined);
      // pairedResult llega por evento → el useEffect guarda la sesión.
    } catch (e) {
      if (cancelRef.current) return; // volvió atrás a propósito: sin error
      setScanSas(null);
      setError(e.message);
      setStep("scan");
      scannedRef.current = false;
    }
  };

  const goBack = () => {
    cancelRef.current = true;
    p2p.cancelPairing();
    setQr(null);
    setScanSas(null);
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
        <View style={styles.hero}>
          <Text style={styles.logoEmoji}>💞</Text>
          <Text style={styles.logo}>Duo</Text>
          <Text style={styles.tagline}>
            Su espacio privado para dos: chat, fotos y retos que acercan. Sin
            servidores: solo ustedes dos, conectados directamente.
          </Text>
          {NameField}
        </View>
        <View style={styles.actions}>
          <PrimaryButton title="Crear vínculo" onPress={startCreate} loading={!p2p.ready} />
          <PrimaryButton
            title="Escanear el QR de mi pareja"
            variant="ghost"
            onPress={startScan}
            style={{ marginTop: spacing.md }}
          />
          {ErrorText}
          <Text style={styles.note}>
            🔒 Todo se cifra en tus claves: nadie más puede leerlo, ni siquiera
            la app.
          </Text>
        </View>
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
            Ella debe abrir Duo, elegir «Escanear el QR» y apuntar a esta
            pantalla. Ambos deben estar en la misma WiFi.
          </Text>
          <View style={styles.qrBox}>
            {qr ? (
              <QRCode value={qr} size={220} backgroundColor="#FFFFFF" color="#0E0B14" />
            ) : (
              <ActivityIndicator color={colors.primary} />
            )}
          </View>
          <Text style={styles.waiting}>
            {p2p.pendingPair
              ? "⏳ Solicitud recibida… confirma en el diálogo"
              : "⏳ Esperando a que tu pareja escanee…"}
          </Text>
          {ErrorText}
        </View>
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
            Pídele a tu pareja que acepte la solicitud en su teléfono.
          </Text>
          {scanSas ? (
            <View style={styles.sasBox}>
              <Text style={styles.sasLabel}>Código de verificación</Text>
              <Text style={styles.sas}>{scanSas}</Text>
              <Text style={styles.sasHint}>
                Debe coincidir con el código que ve tu pareja.
              </Text>
            </View>
          ) : null}
          {ErrorText}
          <PrimaryButton title="Cancelar" variant="ghost" onPress={goBack} style={{ marginTop: spacing.xl }} />
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
  waiting: {
    color: colors.muted,
    textAlign: "center",
    marginTop: spacing.lg,
    fontSize: 14,
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

import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { colors, radius, spacing } from "../theme";
import PrimaryButton from "../components/PrimaryButton";
import { createPair, joinPair } from "../services/api";
import { useE2E } from "../context/E2EContext";

export default function OnboardingScreen({ navigation }) {
  const { save } = useSession();
  const { keys } = useE2E();
  const [step, setStep] = useState("welcome"); // welcome | pair | join
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [myCode, setMyCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const doCreate = async () => {
    setError("");
    setLoading(true);
    try {
      const data = await createPair({ name, pubKey: keys?.publicKeyB64 });
      save(data);
      setMyCode(data.code);
      setStep("pair");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const doJoin = async () => {
    setError("");
    setLoading(true);
    try {
      const data = await joinPair({ code, name, pubKey: keys?.publicKeyB64 });
      save(data);
      navigation.replace("Main");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
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
            Su espacio privado para dos: chat, fotos y retos que acercan.
          </Text>
          {NameField}
        </View>
        <View style={styles.actions}>
          <PrimaryButton title="Crear vínculo" onPress={doCreate} loading={loading} />
          <PrimaryButton
            title="Ya tengo un código"
            variant="ghost"
            onPress={() => {
              setError("");
              setStep("join");
            }}
            style={{ marginTop: spacing.md }}
          />
          {ErrorText}
          <Text style={styles.note}>🔒 Solo tú y tu pareja. Nada de terceros.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (step === "pair") {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <Pressable onPress={() => setStep("welcome")} style={styles.back}>
          <Text style={styles.backText}>‹ Atrás</Text>
        </Pressable>
        <View style={styles.body}>
          <Text style={styles.h2}>Comparte este código</Text>
          <Text style={styles.muted}>
            Tu pareja debe escribirlo en su app para vincularse contigo.
          </Text>
          <View style={styles.codeBox}>
            {myCode ? (
              <Text style={styles.codeText}>{myCode}</Text>
            ) : (
              <ActivityIndicator color={colors.primary} />
            )}
          </View>
          <PrimaryButton
            title="Ir al chat"
            onPress={() => navigation.replace("Main")}
            style={{ marginTop: spacing.xl }}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <Pressable onPress={() => setStep("welcome")} style={styles.back}>
          <Text style={styles.backText}>‹ Atrás</Text>
        </Pressable>
        <View style={styles.body}>
          <Text style={styles.h2}>Ingresa el código</Text>
          <Text style={styles.muted}>
            Pídele a tu pareja el código que generó en su app.
          </Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="DUO-XXXXX"
            placeholderTextColor={colors.muted}
            autoCapitalize="characters"
            style={styles.input}
          />
          {NameField}
          {ErrorText}
          <PrimaryButton
            title="Vincularnos"
            onPress={doJoin}
            loading={loading}
            style={{ marginTop: spacing.lg }}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

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
  h2: { fontSize: 26, fontWeight: "800", color: colors.text, marginBottom: spacing.sm },
  muted: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  codeBox: {
    marginTop: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  codeText: {
    color: colors.primary,
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: 4,
  },
  input: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    height: 58,
    color: colors.text,
    fontSize: 20,
    letterSpacing: 3,
    textAlign: "center",
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
});

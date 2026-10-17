import { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme";
import { truths, dares } from "../data/mock";

export default function TruthDareScreen() {
  const [mode, setMode] = useState(null); // "truth" | "dare"
  const [current, setCurrent] = useState(null);

  const pick = (type) => {
    const pool = type === "truth" ? truths : dares;
    let next = pool[Math.floor(Math.random() * pool.length)];
    if (pool.length > 1 && next === current) {
      next = pool[(pool.indexOf(next) + 1) % pool.length];
    }
    setMode(type);
    setCurrent(next);
  };

  const isTruth = mode === "truth";
  const accent = isTruth ? colors.accent : colors.primary;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <Text style={styles.h1}>Verdad o Reto</Text>
      <Text style={styles.muted}>¿Se atreven? Elijan con valentía 😏</Text>

      <View style={[styles.card, current && { borderColor: accent, borderWidth: 2 }]}>
        <View style={[styles.badge, { backgroundColor: accent + "22" }]}>
          <Ionicons
            name={isTruth ? "help-circle" : "flame"}
            size={26}
            color={accent}
          />
          <Text style={[styles.badgeText, { color: accent }]}>
            {mode ? (isTruth ? "VERDAD" : "RETO") : "…"}
          </Text>
        </View>
        <Text style={[styles.cardText, !current && { color: colors.muted }]}>
          {current || "Elige Verdad o Reto para comenzar."}
        </Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={() => pick("truth")}
          style={({ pressed }) => [
            styles.bigBtn,
            { backgroundColor: colors.accent },
            pressed && { transform: [{ scale: 0.97 }] },
          ]}
        >
          <Ionicons name="help-circle" size={22} color={colors.white} />
          <Text style={styles.bigBtnText}>Verdad</Text>
        </Pressable>
        <Pressable
          onPress={() => pick("dare")}
          style={({ pressed }) => [
            styles.bigBtn,
            { backgroundColor: colors.primary },
            pressed && { transform: [{ scale: 0.97 }] },
          ]}
        >
          <Ionicons name="flame" size={22} color={colors.white} />
          <Text style={styles.bigBtnText}>Reto</Text>
        </Pressable>
      </View>
      <Text style={styles.tip}>Si no se atreven… doble reto la próxima 😜</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  h1: { color: colors.text, fontSize: 24, fontWeight: "800" },
  muted: { color: colors.muted, fontSize: 14, marginTop: 4 },
  card: {
    flex: 1,
    marginTop: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    marginBottom: spacing.lg,
  },
  badgeText: {
    fontSize: 14,
    fontWeight: "800",
    marginLeft: spacing.sm,
    letterSpacing: 2,
  },
  cardText: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 30,
  },
  actions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
  bigBtn: {
    flex: 1,
    height: 62,
    borderRadius: radius.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  bigBtnText: { color: colors.white, fontSize: 17, fontWeight: "800" },
  tip: {
    color: colors.muted,
    fontSize: 12,
    textAlign: "center",
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
});

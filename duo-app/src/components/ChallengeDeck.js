import { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme";
import { challengeLevels } from "../data/mock";
import PrimaryButton from "./PrimaryButton";

export default function ChallengeDeck({
  title,
  subtitle,
  actionLabel = "Tirar",
  icon = "sparkles",
  getItems,
  showLevels = true,
}) {
  const [level, setLevel] = useState(1);
  const [current, setCurrent] = useState(null);

  const draw = () => {
    const items = getItems(level);
    let next = items[Math.floor(Math.random() * items.length)];
    if (items.length > 1 && next === current) {
      next = items[(items.indexOf(next) + 1) % items.length];
    }
    setCurrent(next);
  };

  const levelMeta = challengeLevels.find((l) => l.id === level);

  return (
    <ScrollView style={styles.safe} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>{title}</Text>
      <Text style={styles.muted}>{subtitle}</Text>

      {showLevels && (
        <Text style={styles.label}>Elige la intensidad</Text>
      )}
      {showLevels && (
      <View style={styles.levelsRow}>
        {challengeLevels.map((l) => {
          const active = l.id === level;
          return (
            <Pressable
              key={l.id}
              onPress={() => {
                setLevel(l.id);
                setCurrent(null);
              }}
              style={[
                styles.levelChip,
                active && { backgroundColor: l.color + "22", borderColor: l.color },
              ]}
            >
              <Text style={styles.levelChipEmoji}>{l.emoji}</Text>
              <Text
                style={[
                  styles.levelChipText,
                  active && { color: l.color, fontWeight: "800" },
                ]}
              >
                {l.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
      )}

      <View
        style={[
          styles.card,
          current && { borderColor: levelMeta.color, borderWidth: 2 },
        ]}
      >
        <Ionicons
          name={icon}
          size={34}
          color={current ? levelMeta.color : colors.muted}
        />
        <Text style={[styles.cardText, !current && { color: colors.muted }]}>
          {current || "Presiona el botón para empezar…"}
        </Text>
      </View>

      <PrimaryButton
        title={current ? `${actionLabel} de nuevo` : actionLabel}
        onPress={draw}
      />
      <Text style={styles.tip}>
        {showLevels ? `${levelMeta.emoji} Nivel ${levelMeta.name} · ` : ""}
        consiente siempre y diviértanse.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  h1: { color: colors.text, fontSize: 24, fontWeight: "800" },
  muted: { color: colors.muted, fontSize: 14, marginTop: 4 },
  label: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  levelsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  levelChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  levelChipEmoji: { fontSize: 16, marginRight: 6 },
  levelChipText: { color: colors.muted, fontSize: 14, fontWeight: "600" },
  card: {
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
    minHeight: 220,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  cardText: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 28,
    marginTop: spacing.md,
  },
  tip: {
    color: colors.muted,
    fontSize: 12,
    textAlign: "center",
    marginTop: spacing.lg,
  },
});

import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme";
import { games, challengeLevels } from "../data/mock";

function GameCard({ game, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { transform: [{ scale: 0.98 }] }]}
    >
      <View style={[styles.emojiWrap, { backgroundColor: game.color + "22" }]}>
        <Text style={styles.emoji}>{game.emoji}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{game.name}</Text>
        <Text style={styles.cardDesc}>{game.desc}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.muted} />
    </Pressable>
  );
}

export default function GamesScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.h1}>Juegos y Retos</Text>
        <Text style={styles.muted}>Suban la temperatura juntos 🔥</Text>
      </View>
      <FlatList
        data={games}
        keyExtractor={(g) => g.id}
        renderItem={({ item }) => (
          <GameCard game={item} onPress={() => navigation.navigate(item.route)} />
        )}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl }}
        showsVerticalScrollIndicator={false}
        ListFooterComponent={
          <View style={styles.levelsBox}>
            <Text style={styles.levelsTitle}>Niveles de intensidad</Text>
            {challengeLevels.map((l) => (
              <View key={l.id} style={styles.levelRow}>
                <Text style={styles.levelEmoji}>{l.emoji}</Text>
                <Text style={[styles.levelName, { color: l.color }]}>{l.name}</Text>
              </View>
            ))}
          </View>
        }
      />
    </SafeAreaView>
  );
}

// asignamos rutas a los juegos
games[0].route = "TruthDare";
games[1].route = "Challenge";
games[2].route = "Dice";
games[3].route = "Questions";

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  h1: { color: colors.text, fontSize: 28, fontWeight: "800" },
  muted: { color: colors.muted, fontSize: 14, marginTop: 4 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  emojiWrap: {
    width: 54,
    height: 54,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  emoji: { fontSize: 28 },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: "700" },
  cardDesc: { color: colors.muted, fontSize: 13, marginTop: 2 },
  levelsBox: {
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  levelsTitle: {
    color: colors.text,
    fontWeight: "700",
    fontSize: 15,
    marginBottom: spacing.sm,
  },
  levelRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  levelEmoji: { fontSize: 18, marginRight: spacing.sm },
  levelName: { fontSize: 15, fontWeight: "700" },
});

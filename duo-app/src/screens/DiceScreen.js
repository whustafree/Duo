import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import ChallengeDeck from "../components/ChallengeDeck";
import { diceChallenges } from "../data/mock";
import { colors } from "../theme";

export default function DiceScreen() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      <ChallengeDeck
        title="Dados del Deseo"
        subtitle="Dejen que los dados decidan por ustedes."
        actionLabel="Tirar dados"
        icon="dice"
        getItems={(level) => diceChallenges[level]}
      />
    </SafeAreaView>
  );
}

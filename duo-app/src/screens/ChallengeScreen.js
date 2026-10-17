import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import ChallengeDeck from "../components/ChallengeDeck";
import { challenges } from "../data/mock";
import { colors } from "../theme";

export default function ChallengeScreen() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      <ChallengeDeck
        title="Ruleta de Retos"
        subtitle="Giren y cumplan el reto del nivel elegido."
        actionLabel="Girar ruleta"
        icon="aperture"
        getItems={(level) => challenges[level]}
      />
    </SafeAreaView>
  );
}

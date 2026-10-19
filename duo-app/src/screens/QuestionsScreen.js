import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import ChallengeDeck from "../components/ChallengeDeck";
import { coupleQuestions } from "../data/mock";
import { colors } from "../theme";

export default function QuestionsScreen() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      <ChallengeDeck
        gameId="preguntas"
        title="Para Conocernos"
        subtitle="Elijan nivel y respondan por turnos: escúchense de verdad."
        actionLabel="Nueva pregunta"
        icon="chatbubbles"
        getItems={(level) => coupleQuestions[level] || []}
        showLevels={true}
      />
    </SafeAreaView>
  );
}

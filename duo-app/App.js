import "react-native-gesture-handler";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { colors } from "./src/theme";
import { SessionProvider, useSession } from "./src/context/SessionContext";
import { E2EProvider } from "./src/context/E2EContext";
import OnboardingScreen from "./src/screens/OnboardingScreen";
import ChatScreen from "./src/screens/ChatScreen";
import GamesScreen from "./src/screens/GamesScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import TruthDareScreen from "./src/screens/TruthDareScreen";
import ChallengeScreen from "./src/screens/ChallengeScreen";
import DiceScreen from "./src/screens/DiceScreen";
import QuestionsScreen from "./src/screens/QuestionsScreen";

const navTheme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.primary,
    background: colors.bg,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    notification: colors.primary,
  },
};

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const TAB_ICONS = {
  Chat: "chatbubbles",
  Juegos: "game-controller",
  Nosotros: "heart",
};

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 62,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
        tabBarIcon: ({ color, size, focused }) => (
          <Ionicons
            name={focused ? TAB_ICONS[route.name] : `${TAB_ICONS[route.name]}-outline`}
            size={size}
            color={color}
          />
        ),
      })}
    >
      <Tab.Screen name="Chat" component={ChatScreen} />
      <Tab.Screen name="Juegos" component={GamesScreen} />
      <Tab.Screen name="Nosotros" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

function Root() {
  const { session, ready } = useSession();

  if (!ready) {
    return (
      <View style={styles.boot}>
        <Text style={styles.bootEmoji}>💞</Text>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        initialRouteName={session ? "Main" : "Onboarding"}
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          headerTitleStyle: { fontWeight: "700" },
        }}
      >
        <Stack.Screen
          name="Onboarding"
          component={OnboardingScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Main"
          component={MainTabs}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="TruthDare"
          component={TruthDareScreen}
          options={{ title: "Verdad o Reto" }}
        />
        <Stack.Screen
          name="Challenge"
          component={ChallengeScreen}
          options={{ title: "Ruleta de Retos" }}
        />
        <Stack.Screen
          name="Dice"
          component={DiceScreen}
          options={{ title: "Dados del Deseo" }}
        />
        <Stack.Screen
          name="Questions"
          component={QuestionsScreen}
          options={{ title: "Para Conocernos" }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <E2EProvider>
          <Root />
        </E2EProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  bootEmoji: { fontSize: 64 },
});

import "react-native-gesture-handler";
import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  AppState,
} from "react-native";
import {
  NavigationContainer,
  DefaultTheme,
  createNavigationContainerRef,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { colors } from "./src/theme";
import { SessionProvider, useSession } from "./src/context/SessionContext";
import { E2EProvider } from "./src/context/E2EContext";
import { P2PProvider } from "./src/context/P2PContext";
import UpdateModal from "./src/components/UpdateModal";
import LockScreen from "./src/components/LockScreen";
import StealthScreen from "./src/components/StealthScreen";
import {
  loadLockState,
  lockState as readLockState,
  onLockStateChange,
} from "./src/services/applock";
import OnboardingScreen from "./src/screens/OnboardingScreen";
import ChatScreen from "./src/screens/ChatScreen";
import ProfileScreen from "./src/screens/ProfileScreen";

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

const navigationRef = createNavigationContainerRef();

const TAB_ICONS = {
  Chat: "chatbubbles",
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
    <>
    <NavigationContainer theme={navTheme} ref={navigationRef}>
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
      </Stack.Navigator>
    </NavigationContainer>
      <UpdateModal />
    </>
  );
}

// Puerta de bloqueo: si la pareja activó PIN/huella en "Nosotros › Privacidad",
// la app se abre pidiéndolo. Con "pantalla discreta" activada, al ir a segundo
// plano todo se tapa con una vista falsa de notas (se ve en el selector de
// apps y en capturas del sistema).
function PrivacyGate({ children }) {
  const [lockLoaded, setLockLoaded] = useState(false);
  const [gate, setGate] = useState(null); // estado del bloqueo (para LockScreen)
  const [locked, setLocked] = useState(false);
  const [stealth, setStealth] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const st = await loadLockState();
      if (!alive) return;
      setGate(st);
      setLocked(!!(st.pin || st.bio));
      setLockLoaded(true);
    })();
    // Los ajustes se pueden cambiar desde Perfil estando dentro: se reflejan
    // al momento (deshabilitar el bloqueo desbloquea; habilitarlo se pide al
    // volver desde segundo plano, no en la cara).
    const off = onLockStateChange(() => {
      const st = readLockState();
      setGate(st);
      if (!(st.pin || st.bio)) {
        setLocked(false);
      } else if (AppState.currentState !== "active") {
        setLocked(true);
      }
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      const st = readLockState();
      setStealth(!!st.stealth && s !== "active");
      if (s !== "active" && (st.pin || st.bio)) setLocked(true);
    });
    return () => sub.remove();
  }, []);

  if (!lockLoaded) {
    return (
      <View style={styles.boot}>
        <Text style={styles.bootEmoji}>💞</Text>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
      </View>
    );
  }

  return (
    <>
      {locked ? (
        <LockScreen
          mode="unlock"
          lockState={gate}
          onUnlock={() => setLocked(false)}
        />
      ) : (
        children
      )}
      {stealth ? <StealthScreen /> : null}
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <E2EProvider>
          <P2PProvider>
            <PrivacyGate>
              <Root />
            </PrivacyGate>
          </P2PProvider>
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

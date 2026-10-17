import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "duo.session";
const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  // session = { userId, coupleId, code, user, partner, linked }

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) setSession(JSON.parse(raw));
      } catch (e) {
        console.warn("No se pudo restaurar la sesión:", e.message);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const persist = (data) => {
    if (data) AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data)).catch(() => {});
    else AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  };

  const save = useCallback((data) => {
    setSession(data);
    persist(data);
  }, []);

  const setPartner = useCallback((partner) => {
    setSession((s) => {
      if (!s) return s;
      const next = { ...s, partner, linked: true };
      persist(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSession(null);
    persist(null);
  }, []);

  return (
    <SessionContext.Provider value={{ session, ready, save, setPartner, clear }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession debe usarse dentro de SessionProvider");
  return ctx;
}

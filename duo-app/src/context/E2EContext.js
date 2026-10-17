import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { loadOrGenerateKeys, hasKeys } from "../services/crypto";
import { useSession } from "./SessionContext";

const E2EContext = createContext(null);

export function E2EProvider({ children }) {
  const { session } = useSession();
  const [keys, setKeys] = useState(null);
  const [peerPub, setPeerPub] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const k = await loadOrGenerateKeys();
      setKeys(k);
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!session) return;
    const peer = session.partner?.pub_key;
    setPeerPub(peer || null);
  }, [session]);

  const setPeerPubKey = useCallback((pk) => setPeerPub(pk), []);

  return (
    <E2EContext.Provider value={{ keys, ready, peerPub, setPeerPubKey }}>
      {children}
    </E2EContext.Provider>
  );
}

export function useE2E() {
  const ctx = useContext(E2EContext);
  if (!ctx) throw new Error("useE2E debe usarse dentro de E2EProvider");
  return ctx;
}

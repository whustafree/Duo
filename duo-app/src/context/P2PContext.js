import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system";
import { Relay } from "../services/relay";
import { useSession } from "./SessionContext";
import { useE2E } from "./E2EContext";
import {
  decryptBytes,
  encryptBytes,
  bytesToB64,
  b64ToBytes,
  randomId,
} from "../services/cryptocore";
import {
  buildMsg,
  buildTyping,
  buildAck,
  buildGame,
  readGame,
  splitPhoto,
  PhotoAssembler,
  readMsg,
} from "../services/protocol";
import {
  configureNotifications,
  requestNotificationPermission,
  notifyNewMessage,
} from "../services/notifications";

// Orquesta el chat, los juegos y el transporte "relay": los dos teléfonos hablan
// a través de un broker MQTT público que solo hace de cartero. TODO va cifrado de
// extremo a extremo, así que el broker no puede leer nada.
//
//   - Estado de conexión (en línea / conectando / sin conexión).
//   - Historial local en AsyncStorage (solo texto descifrado y rutas de fotos
//     guardadas en el propio dispositivo; NUNCA en un servidor).
//   - Bandeja de salida: lo que no se pudo entregar queda "pendiente" y se
//     reintenta hasta recibir el ACK de la pareja.
//   - Juegos compartidos: al abrir un juego se sincroniza con la pareja, para
//     que ambos vean el mismo reto aunque estén lejos.
//   - Borrado local: historial y fotos se pueden eliminar del dispositivo.

const P2PContext = createContext(null);

function msgsKey(coupleId) {
  return `duo.msgs.${coupleId}`;
}

function log(...args) {
  if (global.__DUO_DEBUG) console.log("[p2pctx]", ...args);
}

const RETRY_INTERVAL = 12000;
const GAME_BEACON_INTERVAL = 6000;

export function P2PProvider({ children }) {
  const { session } = useSession();
  const { keys } = useE2E();
  const [status, setStatus] = useState("offline");
  const [messages, setMessages] = useState([]);
  const [typing, setTyping] = useState(false);
  const [pendingPair, setPendingPair] = useState(null); // {name, emoji, sas, ts}
  const [pairedResult, setPairedResult] = useState(null);
  const [gameSession, setGameSession] = useState(null); // {gameId, level, prompt, host, ts}
  const [incomingGame, setIncomingGame] = useState(null); // {gameId, level, ts}

  const relayRef = useRef(null);
  const assemblerRef = useRef(new PhotoAssembler());
  const idsRef = useRef(new Set());
  const msgsRef = useRef([]);
  const typingTimer = useRef(null);
  const sessionRef = useRef(session);
  const keysRef = useRef(keys);
  const handleFrameRef = useRef(null);
  const statusRef = useRef("offline");
  const flushRef = useRef(() => {});
  const gameRef = useRef(null);
  const sendGameRef = useRef(() => false);
  sessionRef.current = session;
  keysRef.current = keys;

  const coupleId = session?.linked ? session.coupleId : null;
  const partnerPub = session?.linked ? session.partnerPub : null;
  const priv = keys?.privateKeyB64;
  const myPub = keys?.publicKeyB64;

  msgsRef.current = messages;
  statusRef.current = status;
  gameRef.current = gameSession;

  const persist = useCallback((rows) => {
    const cid = sessionRef.current?.coupleId;
    if (!cid) return;
    AsyncStorage.setItem(msgsKey(cid), JSON.stringify(rows.slice(-300))).catch(
      () => {}
    );
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!coupleId) {
        idsRef.current = new Set();
        setMessages([]);
        return;
      }
      try {
        const raw = await AsyncStorage.getItem(msgsKey(coupleId));
        if (!alive) return;
        const rows = raw ? JSON.parse(raw) : [];
        idsRef.current = new Set(rows.map((r) => r.id));
        setMessages(rows);
      } catch {
        if (alive) setMessages([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [coupleId]);

  useEffect(() => {
    configureNotifications();
    requestNotificationPermission();

    const relay = relayRef.current || new Relay();
    relayRef.current = relay;
    relay.onEvent((type, data) => {
      if (type === "status") setStatus(data);
      else if (type === "session") flushRef.current();
      else if (type === "frame") handleFrame(data);
      else if (type === "pair-request")
        setPendingPair({ ...data, ts: Date.now() });
      else if (type === "paired") setPairedResult(data);
    });

    if (priv && myPub) {
      relay.configure({
        keys,
        partnerPub,
        myName: session?.myName,
        myEmoji: session?.myEmoji,
      });
      relay.start();
    } else {
      relay.stop();
    }

    return () => {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priv, myPub, partnerPub, session?.myName, session?.myEmoji]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") relayRef.current?.wake();
    });
    return () => sub.remove();
  }, []);

  // Reintento periódico mientras estamos en línea: entrega diferida fiable.
  useEffect(() => {
    const iv = setInterval(() => {
      if (statusRef.current === "online") flushRef.current();
    }, RETRY_INTERVAL);
    return () => clearInterval(iv);
  }, []);

  // Baliza del juego: si somos los anfitriones, repetimos el estado cada pocos
  // segundos para que la pareja lo vea aunque se pierda algún mensaje.
  useEffect(() => {
    if (!partnerPub) return;
    const iv = setInterval(() => {
      const g = gameRef.current;
      if (g && g.host === "me" && statusRef.current === "online") {
        sendGameRef.current({
          k: "sync",
          gameId: g.gameId,
          level: g.level,
          prompt: g.prompt,
          mode: g.mode,
        });
      }
    }, GAME_BEACON_INTERVAL);
    return () => clearInterval(iv);
  }, [partnerPub]);

  const appendMessage = useCallback(
    (row) => {
      if (idsRef.current.has(row.id)) return false;
      idsRef.current.add(row.id);
      setMessages((prev) => {
        const next = [...prev, row];
        persist(next);
        return next;
      });
      return true;
    },
    [persist]
  );

  const markDelivered = useCallback(
    (id) => {
      setMessages((prev) => {
        const next = prev.map((m) =>
          m.id === id && m.pending ? { ...m, pending: false } : m
        );
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const notifyIfBackground = useCallback((body) => {
    if (AppState.currentState !== "active") {
      notifyNewMessage({
        title: sessionRef.current?.partnerName || "Mi Amor 💞",
        body,
      });
    }
  }, []);

  const sendFrame = useCallback((frame) => {
    return relayRef.current?.send(frame) || false;
  }, []);

  // ----------------------------------------------------------- juegos ------
  const sendGame = useCallback(
    (payload) => {
      if (!priv || !partnerPub) return false;
      const frame = buildGame(payload, priv, partnerPub);
      return frame ? sendFrame(frame) : false;
    },
    [priv, partnerPub, sendFrame]
  );
  sendGameRef.current = sendGame;

  const startGame = useCallback(
    (gameId, level = 1) => {
      const s = {
        gameId,
        level,
        prompt: null,
        mode: null,
        host: "me",
        ts: Date.now(),
      };
      gameRef.current = s;
      setGameSession(s);
      sendGame({ k: "start", gameId, level });
      return s;
    },
    [sendGame]
  );

  const setGameLevel = useCallback(
    (level) => {
      const prev = gameRef.current || {};
      const s = {
        ...prev,
        level,
        prompt: null,
        mode: null,
        host: "me",
        ts: Date.now(),
      };
      gameRef.current = s;
      setGameSession(s);
      if (s.gameId) sendGame({ k: "level", gameId: s.gameId, level });
    },
    [sendGame]
  );

  const drawGame = useCallback(
    (prompt, mode = null) => {
      const prev = gameRef.current || {};
      const s = { ...prev, prompt, mode, host: "me", ts: Date.now() };
      gameRef.current = s;
      setGameSession(s);
      sendGame({ k: "draw", gameId: s.gameId, level: s.level, prompt, mode });
    },
    [sendGame]
  );

  const endGame = useCallback(() => {
    gameRef.current = null;
    setGameSession(null);
    sendGame({ k: "end" });
  }, [sendGame]);

  const clearIncomingGame = useCallback(() => setIncomingGame(null), []);

  const handleGameFrame = useCallback(
    (frame) => {
      const g = readGame(frame, priv, partnerPub);
      if (!g || !g.k) return;
      if (g.k === "end") {
        gameRef.current = null;
        setGameSession(null);
        return;
      }
      const prev =
        gameRef.current && gameRef.current.gameId === g.gameId
          ? gameRef.current
          : null;
      const s = {
        gameId: g.gameId || prev?.gameId,
        level: g.level != null ? g.level : prev?.level || 1,
        prompt:
          g.k === "level"
            ? null
            : g.prompt !== undefined
            ? g.prompt
            : prev?.prompt ?? null,
        mode:
          g.k === "level"
            ? null
            : g.mode !== undefined
            ? g.mode
            : prev?.mode ?? null,
        host: "them",
        ts: Date.now(),
      };
      if (g.k === "start") {
        s.prompt = g.prompt ?? null;
        setIncomingGame({ gameId: s.gameId, level: s.level, ts: Date.now() });
        notifyIfBackground(
          `🎮 ${sessionRef.current?.partnerName || "Tu pareja"} quiere jugar contigo`
        );
      }
      gameRef.current = s;
      setGameSession(s);
    },
    [priv, partnerPub, notifyIfBackground]
  );

  // ------------------------------------------------------------- chat ------
  const sendFrameFor = useCallback(
    (row) => {
      if (!priv || !partnerPub) return false;
      if (row.kind === "photo") {
        if (!row.uri) return false;
        return (async () => {
          try {
            const info = await FileSystem.getInfoAsync(row.uri);
            if (!info.exists) return false;
            const b64 = await FileSystem.readAsStringAsync(row.uri, {
              encoding: FileSystem.EncodingType.Base64,
            });
            const enc = encryptBytes(b64ToBytes(b64), priv, partnerPub);
            if (!enc) return false;
            const frames = splitPhoto(row.id, enc.nonceB64, enc.cipherB64);
            let ok = true;
            for (const f of frames) {
              const sent = sendFrame(f);
              if (!sent) {
                ok = false;
                break;
              }
            }
            return ok;
          } catch {
            return false;
          }
        })();
      }
      const msgFrame = buildMsg(row.id, row.text, priv, partnerPub);
      return sendFrame(msgFrame);
    },
    [priv, partnerPub, sendFrame]
  );

  const flushOutbox = useCallback(() => {
    const rows = msgsRef.current.filter((m) => m.from === "me" && m.pending);
    for (const row of rows) {
      sendFrameFor(row);
    }
  }, [sendFrameFor]);
  flushRef.current = flushOutbox;

  const sendText = useCallback(
    (text) => {
      const row = {
        id: `m_${randomId()}`,
        from: "me",
        kind: "text",
        text,
        ts: Date.now(),
        pending: true,
      };
      appendMessage(row);
      sendFrameFor(row);
      return row;
    },
    [appendMessage, sendFrameFor]
  );

  const sendPhoto = useCallback(
    async (tmpUri) => {
      const id = `m_${randomId()}`;
      const dest = `${FileSystem.documentDirectory}duo_send_${id}.jpg`;
      await FileSystem.copyAsync({ from: tmpUri, to: dest });
      const row = {
        id,
        from: "me",
        kind: "photo",
        uri: dest,
        ts: Date.now(),
        pending: true,
      };
      appendMessage(row);
      await sendFrameFor(row);
      return row;
    },
    [appendMessage, sendFrameFor]
  );

  const sendTyping = useCallback(
    (isTyping) => {
      sendFrame(buildTyping(isTyping));
    },
    [sendFrame]
  );

  const handleFrame = useCallback(
    async (frame) => {
      if (!frame || !priv || !partnerPub) return;

      if (frame.t === "game") {
        handleGameFrame(frame);
        return;
      }

      if (frame.t === "msg") {
        const got = readMsg(frame, priv, partnerPub);
        sendFrame(buildAck(frame.id));
        if (!got) return;
        const added = appendMessage({
          id: got.id,
          from: "them",
          kind: "text",
          text: got.text,
          ts: got.ts || Date.now(),
          pending: false,
        });
        if (added) {
          notifyIfBackground(got.text || "💬 Nuevo mensaje");
        }
        return;
      }

      if (frame.t === "ack") {
        markDelivered(frame.id);
        return;
      }

      if (frame.t === "typing") {
        setTyping(!!frame.typing);
        clearTimeout(typingTimer.current);
        if (frame.typing) {
          typingTimer.current = setTimeout(() => setTyping(false), 2500);
        }
        return;
      }

      if (frame.t === "photo-meta" || frame.t === "photo-chunk") {
        const done = assemblerRef.current.accept(frame);
        if (!done) return;
        const plain = decryptBytes(
          done.cipherB64,
          done.nonceB64,
          priv,
          partnerPub
        );
        sendFrame(buildAck(frame.id));
        if (!plain) return;
        const dest = `${FileSystem.documentDirectory}duo_${done.id}.jpg`;
        try {
          await FileSystem.writeAsStringAsync(dest, bytesToB64(plain), {
            encoding: FileSystem.EncodingType.Base64,
          });
        } catch {
          return;
        }
        const added = appendMessage({
          id: done.id,
          from: "them",
          kind: "photo",
          uri: dest,
          ts: Date.now(),
          pending: false,
        });
        if (added) notifyIfBackground("📷 Te envió una foto");
      }
    },
    [
      priv,
      partnerPub,
      appendMessage,
      markDelivered,
      notifyIfBackground,
      sendFrame,
      handleGameFrame,
    ]
  );
  handleFrameRef.current = handleFrame;

  // ---------------------------------------------------- borrar contenido ----
  const clearHistory = useCallback(async () => {
    const cid = sessionRef.current?.coupleId;
    if (cid) {
      try {
        await AsyncStorage.removeItem(msgsKey(cid));
      } catch {}
    }
    idsRef.current = new Set();
    setMessages([]);
  }, []);

  // Borra las fotos guardadas por Duo en este dispositivo (enviadas y recibidas).
  const deleteStoredPhotos = useCallback(async () => {
    try {
      const dir = FileSystem.documentDirectory;
      if (!dir) return;
      const names = await FileSystem.readDirectoryAsync(dir);
      const mine = names.filter((n) => n.startsWith("duo_"));
      await Promise.all(
        mine.map((n) =>
          FileSystem.deleteAsync(dir + n, { idempotent: true }).catch(() => {})
        )
      );
    } catch {}
  }, []);

  // Borra TODO el contenido local: historial de mensajes + fotos guardadas.
  const wipeAllContent = useCallback(async () => {
    await clearHistory();
    await deleteStoredPhotos();
  }, [clearHistory, deleteStoredPhotos]);

  const startPairing = useCallback(
    async (name) => {
      const relay = relayRef.current;
      if (!relay || !priv || !myPub) throw new Error("La app aún no está lista.");
      relay.configure({
        keys: keysRef.current,
        partnerPub: null,
        myName: name,
        myEmoji: sessionRef.current?.myEmoji,
      });
      relay.start();
      return relay.startPairing({
        name,
        emoji: sessionRef.current?.myEmoji,
      });
    },
    [priv, myPub]
  );

  const joinPairing = useCallback(
    async (qr) => {
      const relay = relayRef.current;
      if (!relay || !priv || !myPub) throw new Error("La app aún no está lista.");
      relay.configure({
        keys: keysRef.current,
        partnerPub: null,
        myName: sessionRef.current?.myName,
        myEmoji: sessionRef.current?.myEmoji,
      });
      relay.start();
      return relay.joinPairing(qr);
    },
    [priv, myPub]
  );

  const acceptPairing = useCallback(() => {
    const ok = relayRef.current?.acceptPairing() || false;
    if (ok) setPendingPair(null);
    return ok;
  }, []);

  const rejectPairing = useCallback(() => {
    relayRef.current?.rejectPairing();
    setPendingPair(null);
  }, []);

  const cancelPairing = useCallback(() => {
    relayRef.current?.cancelPairing();
    setPendingPair(null);
  }, []);

  const clearPairedResult = useCallback(() => setPairedResult(null), []);

  return (
    <P2PContext.Provider
      value={{
        ready: !!(priv && myPub),
        status, // offline | connecting | online
        messages,
        typing,
        sendText,
        sendPhoto,
        sendTyping,
        pendingPair,
        acceptPairing,
        rejectPairing,
        pairedResult,
        clearPairedResult,
        startPairing,
        cancelPairing,
        joinPairing,
        // juegos
        gameSession,
        incomingGame,
        clearIncomingGame,
        startGame,
        setGameLevel,
        drawGame,
        endGame,
        // borrado
        clearHistory,
        deleteStoredPhotos,
        wipeAllContent,
      }}
    >
      {children}
    </P2PContext.Provider>
  );
}

export function useP2P() {
  const ctx = useContext(P2PContext);
  if (!ctx) throw new Error("useP2P debe usarse dentro de P2PProvider");
  return ctx;
}

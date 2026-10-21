import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { AppState, Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system";
import BackgroundFetch from "react-native-background-fetch";
import { Relay } from "../services/relay";
import { deviceClientId } from "../services/relayproto";
import { registerForPush, sendWakePush } from "../services/push";
import { shouldWakePush } from "../services/pushproto";
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
  buildRead,
  buildGame,
  readGame,
  iterFileFrames,
  PhotoAssembler,
  readMsg,
} from "../services/protocol";
import {
  configureNotifications,
  requestNotificationPermission,
  notifyNewMessage,
} from "../services/notifications";
import {
  decodeChat,
  encodeText,
  encodeReaction,
  encodePushToken,
} from "../services/chatcodec";
import { filterExpired, parseTtlDays } from "../services/retention";
import { shouldHideContent } from "../services/applock";
import { makeDraw } from "../services/gamecontent";
import {
  vaultGet,
  vaultSet,
  vaultRemove,
  onVaultChange,
  vaultReady,
  vaultIsReady,
} from "../services/localvault";

// Orquesta el chat, los juegos y el transporte "relay": los dos teléfonos hablan
// a través de un broker MQTT (propio si está configurado, públicos de
// respaldo) que solo hace de cartero. TODO va cifrado de extremo a extremo,
// así que el broker no puede leer nada.
//
//   - Estado de conexión (en línea / conectando / sin conexión) y presencia
//     de la pareja (baliza retenida cada 90 s).
//   - Historial local en AsyncStorage (solo texto descifrado y rutas de fotos
//     guardadas en el propio dispositivo; NUNCA en un servidor).
//   - Bandeja de salida: lo que no se pudo entregar queda "pendiente" y se
//     reintenta hasta recibir el ACK de la pareja.
//   - Push "despertador": si la pareja está desconectada, además del relay se
//     le envía un aviso GENÉRICO vía Expo Push Service para que su app se
//     despierte y recoja lo encolado (avisos aunque la app esté minimizada;
//     el contenido del mensaje NUNCA sale de vuestros teléfonos).
//   - Juegos compartidos: al abrir un juego se sincroniza con la pareja, para
//     que ambos vean el mismo reto aunque estén lejos.
//   - Borrado local: historial y fotos se pueden eliminar del dispositivo.

const P2PContext = createContext(null);

function msgsKey(coupleId) {
  return `duo.msgs.${coupleId}`;
}

// Extensión del archivo: así el otro teléfono sabe cómo abrirlo (foto/audio/vídeo).
function extOf(uri, kind) {
  const m = /\.([a-z0-9]+)(\?|#|$)/i.exec(String(uri || ""));
  const e = m ? m[1].toLowerCase() : "";
  if (e === "mp4" || e === "mov") return "mp4";
  if (e === "m4a" || e === "aac" || e === "mp3" || e === "caf") return "m4a";
  if (e === "webp") return "webp";
  return kind === "audio" ? "m4a" : kind === "video" ? "mp4" : "jpg";
}

function log(...args) {
  if (global.__DUO_DEBUG) console.log("[p2pctx]", ...args);
}

const RETRY_INTERVAL = 12000;
const GAME_BEACON_INTERVAL = 6000;
const TTL_CHECK_INTERVAL = 60000;
const TTL_KEY = "duo.retention.days";
const CLIENT_ID_KEY = "duo.client.id";
const BG_FETCH_TIMEOUT_MS = 15000;

// Token de push de la pareja (desperta su app cuando estamos desconectados).
// Es señalización, no contenido: el token viaja cifrado E2E por el relay.
function pushTokenKey(coupleId) {
  return `duo.push.token.${coupleId}`;
}
// Archivos: tope duro y ritmo de envío. Sin el tope, un vídeo grande leído
// entero en base64 congelaba la app y podía cerrarla por memoria; sin la pausa
// entre trozos, los ~170 trozos de un vídeo de 6 MB se publicaban de golpe y
// bloqueaban la interfaz segundos.
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB para vídeos/fotos/note voices (MQTT relay, troceado)
const CHUNK_DELAY_MS = 20;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mbOf = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

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
  const [partnerOnline, setPartnerOnline] = useState(true); // optimista: sin push hasta prueba de lo contrario
  const [partnerLastSeen, setPartnerLastSeen] = useState(0); // última vez que la pareja estuvo en línea

  const relayRef = useRef(null);
  const assemblerRef = useRef(new PhotoAssembler());
  const idsRef = useRef(new Set());
  const msgsRef = useRef([]);
  const loadedRef = useRef(false);
  const sendingRef = useRef(new Map()); // filas con envío en curso (id -> {ts, kind})
  const typingTimer = useRef(null);
  const sessionRef = useRef(session);
  const keysRef = useRef(keys);
  const handleFrameRef = useRef(null);
  const statusRef = useRef("offline");
  const flushRef = useRef(() => {});
  const gameRef = useRef(null);
  const sendGameRef = useRef(() => false);
  const partnerOnlineRef = useRef(true);
  const readSentRef = useRef(new Set()); // ids de mensajes recibidos ya confirmados como leídos
  const myPushTokenRef = useRef(null);
  const partnerPushTokenRef = useRef(null);
  const lastWakePushRef = useRef(0);
  const announcePushTokenRef = useRef(() => {});
  sessionRef.current = session;
  keysRef.current = keys;
  partnerOnlineRef.current = partnerOnline;

  const coupleId = session?.linked ? session.coupleId : null;
  const partnerPub = session?.linked ? session.partnerPub : null;
  const priv = keys?.privateKeyB64;
  const myPub = keys?.publicKeyB64;

  msgsRef.current = messages;
  statusRef.current = status;
  gameRef.current = gameSession;

  // La copia local pasa por el cofre: si hay PIN con cifrado activo, se guarda
  // cifrada; si no, en claro (mismo formato que antes).
  const persist = useCallback((rows) => {
    const cid = sessionRef.current?.coupleId;
    if (!cid) return;
    vaultSet(msgsKey(cid), JSON.stringify(rows.slice(-300))).catch(() => {});
  }, []);

  // Carga la copia local al emparejar. Si el bloqueo tiene cifrado activo,
  // esperamos a que se introduzca el PIN (vaultReady) antes de leer: mientras
  // tanto la copia no se toca. Después, la retención decide cuánto dura cada
  // mensaje en ESTE teléfono (el otro puede tener otra política).
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!coupleId) {
        idsRef.current = new Set();
        setMessages([]);
        loadedRef.current = false;
        return;
      }
      try {
        await vaultReady();
        const raw = await vaultGet(msgsKey(coupleId));
        if (!alive) return;
        let rows = raw ? JSON.parse(raw) : [];
        const ttl = parseTtlDays(await AsyncStorage.getItem(TTL_KEY));
        if (ttl) {
          const { keep, gone } = filterExpired(rows, ttl);
          rows = keep;
          // La auto-destrucción borra también los archivos locales asociados.
          for (const g of gone) {
            if (g.uri) {
              FileSystem.deleteAsync(g.uri, { idempotent: true }).catch(
                () => {}
              );
            }
          }
          if (gone.length) {
            vaultSet(msgsKey(coupleId), JSON.stringify(keep)).catch(() => {});
          }
        }
        idsRef.current = new Set(rows.map((r) => r.id));
        setMessages(rows);
        loadedRef.current = true;
      } catch {
        if (alive) setMessages([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [coupleId]);

  // Al cambiar de modo (activar/desactivar el cifrado del cofre) reescribimos
  // la copia con el modo nuevo.
  useEffect(() => {
    return onVaultChange(() => {
      const cid = sessionRef.current?.coupleId;
      if (cid && loadedRef.current) persist(msgsRef.current);
    });
  }, [persist]);

  useEffect(() => {
    configureNotifications();
    requestNotificationPermission();

    const relay = relayRef.current || new Relay();
    relayRef.current = relay;
    relay.onEvent((type, data) => {
      if (type === "status") setStatus(data);
      else if (type === "presence") {
        setPartnerOnline(!!data.online);
        if (data.lastSeenAt) setPartnerLastSeen(data.lastSeenAt);
      }
      else if (type === "session") {
        flushRef.current();
        // Con la sesión en línea anuncio mi token de push: así la pareja
        // puede despertarme (genérico) cuando yo esté desconectado.
        announcePushTokenRef.current();
      } else if (type === "frame") handleFrame(data);
      else if (type === "pair-request")
        setPendingPair({ ...data, ts: Date.now() });
      else if (type === "paired") setPairedResult(data);
    });

    if (coupleId) {
      AsyncStorage.getItem(pushTokenKey(coupleId))
        .then((t) => {
          partnerPushTokenRef.current = t || null;
        })
        .catch(() => {});
    } else {
      partnerPushTokenRef.current = null;
    }

    if (priv && myPub) {
      // clientId ÚNICO por instalación (se genera una vez y se guarda):
      // si los dos teléfonos usaran el mismo, el broker los expulsaría en
      // bucle y se perderían mensajes (causa raíz de las viejas pérdidas).
      (async () => {
        let suffix = null;
        try {
          suffix = await AsyncStorage.getItem(CLIENT_ID_KEY);
          if (!suffix) {
            suffix = Array.from({ length: 16 }, () =>
              Math.floor(Math.random() * 16).toString(16)
            ).join("");
            await AsyncStorage.setItem(CLIENT_ID_KEY, suffix);
          }
        } catch {
          suffix = Date.now().toString(16);
        }
        relay.configure({
          keys,
          partnerPub,
          myName: session?.myName,
          myEmoji: session?.myEmoji,
          clientId: deviceClientId(suffix),
        });
        relay.start();
      })();
      registerForPush().then((token) => {
        myPushTokenRef.current = token;
        if (token && statusRef.current === "online") {
          announcePushTokenRef.current();
        }
      });
    } else {
      relay.stop();
    }

    return () => {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priv, myPub, partnerPub, session?.myName, session?.myEmoji]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") {
        relayRef.current?.wake();
        // Al volver a primer plano, confirmamos lectura de lo que llegó
        // mientras la app estaba en segundo plano (doble check verde).
        const pendingRead = (msgsRef.current || []).filter(
          (m) =>
            m.from === "them" &&
            m.kind !== "game" &&
            !readSentRef.current.has(m.id)
        );
        if (pendingRead.length && vaultIsReady()) {
          pendingRead.slice(-40).forEach((m) => {
            readSentRef.current.add(m.id);
            sendFrame(buildRead(m.id));
          });
        }
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reintento periódico mientras estamos en línea: entrega diferida fiable.
  // También limpia envíos atascados (OOM/crash al enviar vídeo) para que
  // el chat vuelva a funcionar.
  useEffect(() => {
    const iv = setInterval(() => {
      if (statusRef.current === "online") {
        // Limpiar envíos atascados > 3 minutos
        const now = Date.now();
        for (const [id, info] of sendingRef.current) {
          if (info?.ts && now - info.ts > 180000) {
            sendingRef.current.delete(id);
            setMessages((prev) => {
              const next = prev.map((m) =>
                m.id === id && m.pending ? { ...m, failed: true } : m
              );
              persist(next);
              return next;
            });
          }
        }
        flushRef.current();
      }
    }, RETRY_INTERVAL);
    return () => clearInterval(iv);
  }, [persist]);

  // Respaldo en segundo plano: si Android ha congelado el socket al
  // minimizar, cada ~15 min el sistema despierta esta tarea, reconectamos y
  // caen los mensajes encolados (sesión persistente del broker) con su
  // aviso local. El push remoto es el camino rápido; esto es la red de
  // seguridad para cuando FCM no llegue.
  useEffect(() => {
    const onBackgroundFetch = () => {
      try {
        relayRef.current?.wake();
      } catch {}
      setTimeout(() => {
        try {
          BackgroundFetch.finish();
        } catch {}
      }, BG_FETCH_TIMEOUT_MS);
    };
    (async () => {
      try {
        await BackgroundFetch.configure(
          {
            minimumFetchInterval: 15,
            stopOnTerminate: false,
            startOnBoot: false,
            enableHeadless: false,
            requiredNetworkType: BackgroundFetch.NETWORK_TYPE_ANY,
          },
          onBackgroundFetch
        );
      } catch (e) {
        log("background-fetch no disponible:", e?.message);
      }
    })();
    return () => {};
  }, []);

  // Auto-destrucción local: cada minuto comprobamos la retención elegida y
  // borramos lo vencido (solo de ESTE teléfono).
  useEffect(() => {
    const iv = setInterval(async () => {
      const cid = sessionRef.current?.coupleId;
      if (!cid || !loadedRef.current) return;
      try {
        const ttl = parseTtlDays(await AsyncStorage.getItem(TTL_KEY));
        if (!ttl) return;
        setMessages((prev) => {
          const { keep, gone } = filterExpired(prev, ttl);
          if (!gone.length) return prev;
          // La auto-destrucción borra también los archivos locales asociados.
          for (const g of gone) {
            if (g.uri) {
              FileSystem.deleteAsync(g.uri, { idempotent: true }).catch(
                () => {}
              );
            }
          }
          persist(keep);
          return keep;
        });
      } catch {}
    }, TTL_CHECK_INTERVAL);
    return () => clearInterval(iv);
  }, [persist]);

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
          replies: g.replies,
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
          m.id === id && m.pending ? { ...m, pending: false, deliveredAt: Date.now() } : m
        );
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const markRead = useCallback(
    (id) => {
      setMessages((prev) => {
        const next = prev.map((m) =>
          m.id === id && m.from === "me"
            ? {
                ...m,
                pending: false,
                sent: true,
                read: true,
                deliveredAt: m.deliveredAt || Date.now(),
                readAt: m.readAt || Date.now(),
              }
            : m
        );
        persist(next);
        return next;
      });
    },
    [persist]
  );

  // Estados de entrega: ✓ (publicado en el relay) y ✓✓ (la pareja confirmó).
  // Si el envío falla, el mensaje queda con ⭕ para poder reintentarlo a mano.
  const markSent = useCallback(
    (id) => {
      setMessages((prev) => {
        const next = prev.map((m) =>
          m.id === id && m.pending && (m.failed || !m.sent)
            ? { ...m, sent: true, failed: false }
            : m
        );
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const markFailed = useCallback(
    (id) => {
      setMessages((prev) => {
        const next = prev.map((m) =>
          m.id === id && m.pending && !m.failed ? { ...m, failed: true } : m
        );
        persist(next);
        return next;
      });
    },
    [persist]
  );

  // Aviso de mensaje nuevo. Si la pareja pidió avisos ocultos (o la app está
  // bloqueada), el contenido no se enseña: solo que hay mensaje.
  const notifyIfBackground = useCallback((body) => {
    if (AppState.currentState !== "active") {
      const hide = shouldHideContent() || !vaultIsReady();
      notifyNewMessage({
        title: sessionRef.current?.partnerName || "Mi Amor 💞",
        body,
        hidden: hide,
      });
    }
  }, []);

  const sendFrame = useCallback((frame) => {
    return relayRef.current?.send(frame) || false;
  }, []);

  // ------------------------------------------------- push "despertador" ----
  // Anuncio mi token de push a la pareja (va cifrado E2E como un mensaje
  // más; ella lo guarda sin burbuja). Ella lo usará para enviarme un aviso
  // GENÉRICO que despierte mi app cuando yo esté desconectado.
  const announcePushToken = useCallback(() => {
    const token = myPushTokenRef.current;
    if (!token || !priv || !partnerPub) return;
    const frame = buildMsg(
      `m_${randomId()}`,
      encodePushToken(token),
      priv,
      partnerPub
    );
    if (frame) relayRef.current?.send(frame);
  }, [priv, partnerPub]);
  announcePushTokenRef.current = announcePushToken;

  const storePartnerPushToken = useCallback((token) => {
    partnerPushTokenRef.current = token || null;
    const cid = sessionRef.current?.coupleId;
    if (!cid) return;
    if (token) AsyncStorage.setItem(pushTokenKey(cid), token).catch(() => {});
    else AsyncStorage.removeItem(pushTokenKey(cid)).catch(() => {});
  }, []);

  // Solo si la pareja está desconectada y ha pasado el hueco mínimo:
  // el aviso lleva SIEMPRE texto genérico (privacidad), nunca el mensaje.
  const maybeWakePush = useCallback(() => {
    const token = partnerPushTokenRef.current;
    if (
      !shouldWakePush({
        hasToken: !!token,
        online: partnerOnlineRef.current,
        lastSentAt: lastWakePushRef.current,
        now: Date.now(),
      })
    ) {
      return;
    }
    lastWakePushRef.current = Date.now();
    sendWakePush(token);
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
        dice: null,
        replies: [],
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
        dice: null,
        host: "me",
        ts: Date.now(),
      };
      gameRef.current = s;
      setGameSession(s);
      if (s.gameId) sendGame({ k: "level", gameId: s.gameId, level });
    },
    [sendGame]
  );

  // Cada jugada elige contenido REAL del nivel (verdad, reto, pregunta o dados)
  // y lo publica como un mensaje más del chat, para los dos teléfonos.
  const drawGame = useCallback(
    (mode = "roll") => {
      const prev = gameRef.current || {};
      if (!prev.gameId) return null;
      const level = prev.level || 1;
      const draw = makeDraw(prev.gameId, level, mode, prev.prompt);
      if (!draw.text) return null;
      const ts = Date.now();
      const s = {
        ...prev,
        prompt: draw.text,
        mode: draw.mode,
        dice: draw.dice,
        host: "me",
        ts,
      };
      gameRef.current = s;
      setGameSession(s);
      appendMessage({
        id: `gmsg:${prev.gameId}:${ts}`,
        from: "me",
        kind: "game",
        gameId: prev.gameId,
        mode: draw.mode,
        dice: draw.dice,
        level,
        text: draw.text,
        ts,
        pending: false,
      });
      sendGame({
        k: "draw",
        gameId: prev.gameId,
        level,
        prompt: draw.text,
        mode: draw.mode,
        dice: draw.dice,
        ts,
      });
      return s;
    },
    [appendMessage, sendGame]
  );

  // Respuesta al reto/pregunta: cualquiera de los dos puede contestar y se
  // sincroniza en el juego (por eso se ve la conversación del reto en los dos).
  const sendGameReply = useCallback(
    (text) => {
      const clean = String(text || "").trim().slice(0, 300);
      if (!clean) return false;
      const prev = gameRef.current || {};
      if (!prev.gameId) return false; // no hay partida activa: nada que responder
      const replies = [
        ...(prev.replies || []),
        { from: "me", text: clean, ts: Date.now() },
      ].slice(-30);
      const s = { ...prev, replies, ts: Date.now() };
      gameRef.current = s;
      setGameSession(s);
      sendGame({ k: "reply", gameId: s.gameId, text: clean, ts: Date.now() });
      return true;
    },
    [sendGame]
  );

  const endGame = useCallback(() => {
    gameRef.current = null;
    setGameSession(null);
    sendGame({ k: "end" });
  }, [sendGame]);

  // Termina SOLO si la sesión activa es del juego indicado (evita matar un
  // juego distinto si la pareja acaba de iniciar otro mientras salimos).
  const endGameIf = useCallback(
    (gameId) => {
      const g = gameRef.current;
      if (g && g.gameId === gameId) endGame();
    },
    [endGame]
  );

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
      // La pareja contesta un reto/pregunta: añadimos su respuesta al hilo.
      if (g.k === "reply") {
        const base =
          gameRef.current && gameRef.current.gameId === g.gameId
            ? gameRef.current
            : null;
        const replies = [
          ...(base?.replies || []),
          { from: "them", text: String(g.text || "").slice(0, 300), ts: g.ts || Date.now() },
        ].slice(-30);
        const s2 = {
          gameId: g.gameId || base?.gameId,
          level: base?.level || 1,
          prompt: base?.prompt ?? null,
          mode: base?.mode ?? null,
          replies,
          host: base?.host || "them",
          ts: Date.now(),
        };
        gameRef.current = s2;
        setGameSession(s2);
        notifyIfBackground(
          `💬 ${sessionRef.current?.partnerName || "Tu pareja"} te respondió en el juego`
        );
        return;
      }
      const prev =
        gameRef.current && gameRef.current.gameId === g.gameId
          ? gameRef.current
          : null;
      const s = {
        gameId: g.gameId || prev?.gameId,
        replies:
          Array.isArray(g.replies) && g.replies.length
            ? g.replies.slice(-30)
            : prev?.replies || [],
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
        dice: g.dice !== undefined ? g.dice : prev?.dice ?? null,
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
      // La jugada de la pareja también aparece como mensaje en el chat. El id
      // se deriva del sello de la jugada, así los dos teléfonos ven el mismo
      // mensaje una sola vez (y los avisos de sincronización no lo duplican).
      if (g.k === "draw" && s.gameId && g.prompt && g.ts) {
        appendMessage({
          id: `gmsg:${s.gameId}:${g.ts}`,
          from: "them",
          kind: "game",
          gameId: s.gameId,
          mode: s.mode,
          dice: s.dice,
          level: s.level,
          text: String(g.prompt),
          ts: g.ts,
          pending: false,
        });
        notifyIfBackground(`🎮 ${sessionRef.current?.partnerName || "Tu pareja"} jugó`);
      }
      gameRef.current = s;
      setGameSession(s);
    },
    [priv, partnerPub, notifyIfBackground, appendMessage]
  );

  // ------------------------------------------------------------- chat ------
  const sendFrameFor = useCallback(
    (row) => {
      if (!priv || !partnerPub) return false;
      if (
        row.kind === "photo" ||
        row.kind === "audio" ||
        row.kind === "video"
      ) {
        if (!row.uri) return false;
        return (async () => {
          try {
            const info = await FileSystem.getInfoAsync(row.uri);
            if (!info.exists) return false;
            // Doble red de seguridad: no se lee en memoria nada que exceda el
            // tope (al crear la fila ya se avisó con el peso real).
            if (typeof info.size === "number" && info.size > MAX_FILE_BYTES) {
              return false;
            }
            // Leer con protección: videos grandes pueden colapsar la app
            let b64;
            try {
              b64 = await FileSystem.readAsStringAsync(row.uri, {
                encoding: FileSystem.EncodingType.Base64,
              });
            } catch (e) {
              console.warn("[p2pctx] no se pudo leer archivo para enviar:", e?.message);
              return false;
            }
            if (!b64 || b64.length === 0) return false;
            const enc = encryptBytes(b64ToBytes(b64), priv, partnerPub);
            if (!enc) return false;
            b64 = null; // liberar memoria
            const ext = extOf(row.uri, row.kind);
            // Trozo a trozo con una pausa mínima entre envíos (generador: sin
            // copiar el cifrado entero en memoria): la interfaz respira y el
            // socket da tiempo a drenar. Antes el envío entero seguido
            // congelaba la app durante segundos.
            try {
              for (const f of iterFileFrames(
                row.id,
                row.kind,
                ext,
                enc.nonceB64,
                enc.cipherB64
              )) {
                if (!sendFrame(f)) return false;
                if (f.t === "file-chunk") await sleep(CHUNK_DELAY_MS * 2);
              }
              return true;
            } catch (e) {
              console.warn("[p2pctx] error enviando archivo troceado:", e?.message);
              return false;
            }
          } catch (e) {
            console.warn("[p2pctx] sendFrameFor archivo error:", e?.message);
            return false;
          }
        })();
      }
      const msgFrame = buildMsg(row.id, row.body ?? row.text, priv, partnerPub);
      return sendFrame(msgFrame);
    },
    [priv, partnerPub, sendFrame]
  );

  // Envía una fila pendiente y anota el resultado (el envío de archivos es
  // asíncrono y largo: se espera a que termine para marcar ✓ o ⭕). La guardia
  // `sendingRef` impide que la cola de reintentos lance el mismo archivo por
  // segunda vez mientras aún va en curso: antes duplicaba el envío y el
  // receptor mezclaba trozos de dos cifrados distintos (vídeo corrupto).
  const dispatchRow = useCallback(
    (row) => {
      if (sendingRef.current.has(row.id)) return false;
      sendingRef.current.set(row.id, { ts: Date.now(), kind: row.kind });
      const done = () => {
        try {
          sendingRef.current.delete(row.id);
        } catch {}
      };
      let ok;
      try {
        ok = sendFrameFor(row);
      } catch (e) {
        console.warn("[p2pctx] dispatchRow sync error:", e?.message);
        done();
        markFailed(row.id);
        return false;
      }
      // Si la pareja está desconectada (app minimizada/cerrada), además del
      // relay le mandamos el aviso genérico que despierta su app (push).
      if (!partnerOnlineRef.current) maybeWakePush();
      const settle = (r) => {
        done();
        if (r) markSent(row.id);
        else markFailed(row.id);
      };
      if (ok && typeof ok.then === "function") {
        return ok
          .then(settle)
          .catch((e) => {
            console.warn("[p2pctx] dispatchRow error:", e?.message);
            done();
            markFailed(row.id);
          });
      }
      settle(ok);
      return ok;
    },
    [sendFrameFor, markSent, markFailed, maybeWakePush]
  );

  // Reintento manual desde la burbuja (la cola también reenvía sola cada pocos
  // segundos mientras la app esté abierta y en línea).
  const retryMessage = useCallback(
    (id) => {
      if (sendingRef.current.has(id)) {
        // Forzar limpieza si está muy viejo
        const info = sendingRef.current.get(id);
        if (info?.ts && Date.now() - info.ts > 120000) {
          sendingRef.current.delete(id);
        } else {
          return false;
        }
      }
      const row = msgsRef.current.find(
        (m) => m.id === id && m.from === "me" && m.pending
      );
      if (!row) return false;
      setMessages((prev) => {
        const next = prev.map((m) =>
          m.id === id ? { ...m, failed: false, sent: false } : m
        );
        persist(next);
        return next;
      });
      dispatchRow(row);
      return true;
    },
    [dispatchRow, persist]
  );

  // Reacciones: se guardan por mensaje, cada una con su lado (mía / de la
  // pareja), para que los dos vean la misma burbuja.
  const applyIncomingReaction = useCallback(
    (targetId, emoji) => {
      if (!targetId || !emoji) return;
      setMessages((prev) => {
        let changed = false;
        const next = prev.map((m) => {
          if (m.id !== targetId) return m;
          const reactions = { ...(m.reactions || {}) };
          Object.keys(reactions).forEach((k) => {
            if (k !== emoji && reactions[k] && reactions[k].theirs) {
              const upd = { ...reactions[k], theirs: false };
              if (upd.mine) reactions[k] = upd;
              else delete reactions[k];
            }
          });
          const cur = reactions[emoji] || {};
          reactions[emoji] = { mine: !!cur.mine, theirs: true };
          changed = true;
          return { ...m, reactions };
        });
        if (changed) persist(next);
        return next;
      });
    },
    [persist]
  );

  const sendReaction = useCallback(
    (targetId, emoji) => {
      const target = msgsRef.current.find((m) => m.id === targetId);
      if (!target || !emoji || !priv || !partnerPub) return false;
      const frame = buildMsg(
        `r_${randomId()}`,
        encodeReaction(targetId, emoji),
        priv,
        partnerPub
      );
      const ok = frame ? sendFrame(frame) : false;
      setMessages((prev) => {
        const next = prev.map((m) => {
          if (m.id !== targetId) return m;
          const reactions = { ...(m.reactions || {}) };
          Object.keys(reactions).forEach((k) => {
            if (reactions[k] && reactions[k].mine) {
              const upd = { ...reactions[k], mine: false };
              if (upd.theirs) reactions[k] = upd;
              else delete reactions[k];
            }
          });
          const cur = reactions[emoji] || {};
          reactions[emoji] = { mine: true, theirs: !!cur.theirs };
          return { ...m, reactions };
        });
        persist(next);
        return next;
      });
      return ok;
    },
    [priv, partnerPub, sendFrame, persist]
  );

  const flushOutbox = useCallback(() => {
    const rows = msgsRef.current.filter(
      (m) => m.from === "me" && m.pending && !sendingRef.current.has(m.id)
    );
    for (const row of rows) {
      try {
        dispatchRow(row);
      } catch (e) {
        console.warn("[p2pctx] flush error:", e?.message);
      }
    }
  }, [dispatchRow]);
  flushRef.current = flushOutbox;

  // `replyTo` (opcional) cita un mensaje anterior: viaja codificado dentro del
  // propio texto, así los teléfonos con versión antigua lo ven como texto.
  const sendText = useCallback(
    (text, replyTo = null) => {
      const row = {
        id: `m_${randomId()}`,
        from: "me",
        kind: "text",
        text,
        body: encodeText(text, replyTo),
        replyTo: replyTo && replyTo.id ? { ...replyTo } : null,
        ts: Date.now(),
        pending: true,
        sent: false,
        failed: false,
      };
      appendMessage(row);
      dispatchRow(row);
      return row;
    },
    [appendMessage, dispatchRow]
  );

  // Envía un archivo cifrado (foto, audio o vídeo) troceado por el relay.
  // El tamaño se comprueba con el tamaño REAL del archivo (getInfoAsync, sin
  // leerlo en memoria) ANTES de copiarlo o cifrarlo: un archivo grande leído
  // entero en base64 congelaba la app y podía cerrarla por memoria.
  const sendMedia = useCallback(
    async (tmpUri, kind = "photo") => {
      const info = await FileSystem.getInfoAsync(tmpUri).catch(() => null);
      const size = info?.size ?? 0;
      if (!info?.exists) {
        Alert.alert(
          "No se pudo leer el archivo",
          "El archivo ya no está disponible. Prueba a elegirlo de nuevo."
        );
        return null;
      }
      if (size > MAX_FILE_BYTES) {
        Alert.alert(
          "Archivo demasiado grande",
          `${
            kind === "video"
              ? "El vídeo"
              : kind === "audio"
              ? "La nota de voz"
              : "El archivo"
          } pesa ${mbOf(size)} y el máximo para enviar son ${Math.round(
            MAX_FILE_BYTES / (1024 * 1024)
          )} MB. ${
            kind === "video" ? "Recórtalo o envíalo en menor calidad" : "Elige uno más pequeño"
          } e inténtalo de nuevo.`
        );
        return null;
      }
      const id = `m_${randomId()}`;
      const ext = extOf(tmpUri, kind);
      const dest = `${FileSystem.documentDirectory}duo_send_${id}.${ext}`;
      await FileSystem.copyAsync({ from: tmpUri, to: dest });
      const row = {
        id,
        from: "me",
        kind,
        uri: dest,
        ts: Date.now(),
        pending: true,
        sent: false,
        failed: false,
      };
      appendMessage(row);
      dispatchRow(row);
      return row;
    },
    [appendMessage, dispatchRow]
  );

  const sendPhoto = useCallback(
    (tmpUri) => sendMedia(tmpUri, "photo"),
    [sendMedia]
  );
  const sendAudio = useCallback(
    (tmpUri) => sendMedia(tmpUri, "audio"),
    [sendMedia]
  );
  const sendVideo = useCallback(
    (tmpUri) => sendMedia(tmpUri, "video"),
    [sendMedia]
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
        // Sin confirmar mientras el cofre esté cerrado: la pareja verá ⏳ y
        // reintentará, y así nada se pierde por llegar con la app bloqueada.
        if (got && vaultIsReady()) sendFrame(buildAck(frame.id));
        if (!got) return;
        const decoded = decodeChat(got.text);
        if (decoded.type === "push-token") {
          // Señalización interna: guardo el token de la pareja para poder
          // despertar su app cuando esté desconectada. Sin burbuja ni aviso.
          if (decoded.token) storePartnerPushToken(decoded.token);
          return;
        }
        if (decoded.type === "reaction") {
          applyIncomingReaction(decoded.target, decoded.emoji);
          return;
        }
        const added = appendMessage({
          id: got.id,
          from: "them",
          kind: "text",
          text: decoded.text,
          replyTo: decoded.replyTo || null,
          ts: got.ts || Date.now(),
          pending: false,
        });
        if (added) {
          notifyIfBackground(decoded.text || "💬 Nuevo mensaje");
          // Recibo de lectura: si la app está abierta, avisamos a la pareja
          // de que ya lo leímos (doble check verde).
          if (vaultIsReady() && AppState.currentState === "active") {
            readSentRef.current.add(got.id);
            sendFrame(buildRead(got.id));
          }
        }
        return;
      }

      if (frame.t === "ack") {
        markDelivered(frame.id);
        return;
      }

      if (frame.t === "read") {
        markRead(frame.id);
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

      if (
        frame.t === "photo-meta" ||
        frame.t === "photo-chunk" ||
        frame.t === "file-meta" ||
        frame.t === "file-chunk"
      ) {
        const done = assemblerRef.current.accept(frame);
        if (!done) return;
        const plain = decryptBytes(
          done.cipherB64,
          done.nonceB64,
          priv,
          partnerPub
        );
        done.cipherB64 = null; // liberar en seguida la cadena grande
        if (vaultIsReady()) sendFrame(buildAck(frame.id));
        if (!plain) return;
        const dest = `${FileSystem.documentDirectory}duo_${done.id}.${done.ext}`;
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
          kind: done.kind || "photo",
          uri: dest,
          ts: Date.now(),
          pending: false,
        });
        if (added) {
          const k = done.kind || "photo";
          notifyIfBackground(
            k === "audio"
              ? "🎙️ Te envió una nota de voz"
              : k === "video"
              ? "🎬 Te envió un vídeo"
              : "📷 Te envió una foto"
          );
          if (vaultIsReady() && AppState.currentState === "active") {
            readSentRef.current.add(done.id);
            sendFrame(buildRead(done.id));
          }
        }
      }
    },
    [
      priv,
      partnerPub,
      appendMessage,
      markDelivered,
      markRead,
      notifyIfBackground,
      sendFrame,
      handleGameFrame,
      applyIncomingReaction,
      storePartnerPushToken,
    ]
  );
  handleFrameRef.current = handleFrame;

  // ---------------------------------------------------- borrar contenido ----
  const clearHistory = useCallback(async () => {
    const cid = sessionRef.current?.coupleId;
    if (cid) await vaultRemove(msgsKey(cid));
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
        partnerOnline, // presencia de la pareja (baliza retenida del relay)
        partnerLastSeen, // hora de la última conexión de la pareja (0 = desconocida)
        messages,
        typing,
        sendText,
        sendPhoto,
        sendAudio,
        sendVideo,
        sendTyping,
        sendReaction,
        retryMessage,
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
        endGameIf,
        sendGameReply,
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

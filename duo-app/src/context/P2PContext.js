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
import { P2P } from "../services/p2p";
import { useSession } from "./SessionContext";
import { useE2E } from "./E2EContext";
import {
  decryptBytes,
  encryptBytes,
  bytesToB64,
  b64ToBytes,
  randomId,
  verificationCode,
  deriveCoupleId,
} from "../services/cryptocore";
import {
  buildMsg,
  buildTyping,
  buildAck,
  splitPhoto,
  PhotoAssembler,
  readMsg,
  FrameParser,
  buildWebRTCOfferQr,
  buildWebRTCAnswerQr,
  parseWebRTCQr,
} from "../services/protocol";
import {
  configureNotifications,
  requestNotificationPermission,
  notifyNewMessage,
} from "../services/notifications";
import { WebRTCService } from "../services/webrtc";

// Orquesta la conexión P2P y el chat local:
//  - Estado de conexión (en línea / conectando / sin conexión).
//  - Historial local en AsyncStorage (solo texto descifrado y rutas de fotos
//    guardadas en el propio dispositivo; NUNCA en un servidor).
//  - Bandeja de salida: lo que no se pudo enviar queda "pendiente" y se envía
//    solo en cuanto los dos teléfonos vuelven a estar conectados.
//  - Vinculación por QR (crear / escanear).

const P2PContext = createContext(null);

function msgsKey(coupleId) {
  return `duo.msgs.${coupleId}`;
}

const ADDR_KEY = "duo.partner.addr";

function log(...args) {
  if (global.__DUO_DEBUG) console.log("[p2pctx]", ...args);
}

export function P2PProvider({ children }) {
  const { session } = useSession();
  const { keys } = useE2E();
  const [status, setStatus] = useState("offline");
  const [messages, setMessages] = useState([]);
  const [typing, setTyping] = useState(false);
  const [pendingPair, setPendingPair] = useState(null); // {name, emoji, sas}
  const [pairedResult, setPairedResult] = useState(null);
  const [connMode, setConnMode] = useState("lan"); // lan | webrtc

  const p2pRef = useRef(null);
  const assemblerRef = useRef(new PhotoAssembler());
  const idsRef = useRef(new Set());
  const msgsRef = useRef([]);
  const typingTimer = useRef(null);
  const sessionRef = useRef(session);
  const keysRef = useRef(keys);
  const webrtcRef = useRef(null);
  const webrtcModeRef = useRef(false);
  const webrtcParserRef = useRef(new FrameParser());
  const handleFrameRef = useRef(null);
  sessionRef.current = session;
  keysRef.current = keys;

  const coupleId = session?.linked ? session.coupleId : null;
  const partnerPub = session?.linked ? session.partnerPub : null;
  const priv = keys?.privateKeyB64;
  const myPub = keys?.publicKeyB64;

  msgsRef.current = messages;

  const persist = useCallback((rows) => {
    const cid = sessionRef.current?.coupleId;
    if (!cid) return;
    AsyncStorage.setItem(msgsKey(cid), JSON.stringify(rows.slice(-300))).catch(
      () => {}
    );
  }, []);

  const addrKey = (cid) => `${ADDR_KEY}.${cid}`;

  const getSavedAddr = useCallback(async () => {
    const cid = sessionRef.current?.coupleId;
    if (!cid) return null;
    try {
      const raw = await AsyncStorage.getItem(addrKey(cid));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);

  const saveAddr = useCallback((addr) => {
    const cid = sessionRef.current?.coupleId;
    if (!cid) return;
    AsyncStorage.setItem(addrKey(cid), JSON.stringify(addr)).catch(() => {});
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

    const p2p = p2pRef.current || new P2P();
    p2pRef.current = p2p;
    p2p.onEvent((type, data) => {
      if (type === "status") {
        // En modo WebRTC el estado lo manda el DataChannel; no dejar que el
        // sondeo LAN (que sigue activo como ruta preferente) lo pise.
        if (webrtcModeRef.current && webrtcRef.current?.isConnected()) return;
        setStatus(data);
      } else if (type === "session") {
        flushOutbox();
        setConnMode("lan");
        webrtcModeRef.current = false;
        if (webrtcRef.current) {
          try { webrtcRef.current.cleanup(); } catch {}
          webrtcRef.current = null;
        }
      } else if (type === "frame") handleFrame(data);
      else if (type === "pair-request")
        setPendingPair({ ...data, ts: Date.now() });
      else if (type === "paired") setPairedResult(data);
    });

    if (priv && myPub) {
      p2p.configure({
        keys,
        partnerPub,
        myName: session?.myName,
        myEmoji: session?.myEmoji,
        getSavedAddr,
        saveAddr,
      });
      p2p.start();
    } else {
      p2p.stop();
    }

    return () => {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priv, myPub, partnerPub, session?.myName, session?.myEmoji]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") p2pRef.current?.wake();
    });
    return () => sub.remove();
  }, []);

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

  const sendFrame = useCallback(
    (frame) => {
      if (webrtcModeRef.current && webrtcRef.current && webrtcRef.current.isConnected()) {
        try {
          webrtcRef.current.send(JSON.stringify(frame));
          return true;
        } catch (e) {
          return false;
        }
      }
      return p2pRef.current?.send(frame);
    },
    []
  );

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
      const frame = buildTyping(isTyping);
      sendFrame(frame);
    },
    [sendFrame]
  );

  const enableWebRTC = useCallback(() => {
    webrtcModeRef.current = true;
    setConnMode("webrtc");
    setStatus("connecting");
  }, []);

  const disableWebRTC = useCallback(() => {
    webrtcModeRef.current = false;
    setConnMode("lan");
    if (webrtcRef.current) {
      try { webrtcRef.current.cleanup(); } catch {}
      webrtcRef.current = null;
    }
    // Devolver el estado al que reporta el transporte LAN.
    setStatus(p2pRef.current?.status || "offline");
  }, []);

  // Datachannel → tramas. Recibe string (JSON) o bytes; se reusa FrameParser
  // para tolerar fragmentación (mismo encuadre que TCP).
  const onWebRTCData = useCallback((data) => {
    try {
      if (typeof data === "string") {
        try {
          handleFrameRef.current?.(JSON.parse(data));
        } catch {}
        return;
      }
      const frames = webrtcParserRef.current.feed(new Uint8Array(data));
      for (const f of frames) handleFrameRef.current?.(f);
    } catch (e) {}
  }, []);

  const onWebRTCState = useCallback((state) => {
    if (!webrtcModeRef.current) return;
    if (state === "connected" || state === "completed") setStatus("online");
    else if (state === "failed" || state === "closed") setStatus("connecting");
    else if (state === "disconnected") setStatus("connecting");
  }, []);

  const ensureWebRTCService = useCallback(() => {
    if (!webrtcRef.current) {
      webrtcRef.current = new WebRTCService();
      webrtcRef.current.onData(onWebRTCData);
      webrtcRef.current.onStateChange(onWebRTCState);
    }
  }, [onWebRTCData, onWebRTCState]);

  const createWebRTCOffer = useCallback(async () => {
    ensureWebRTCService();
    return await webrtcRef.current.createOffer();
  }, [ensureWebRTCService]);

  const createWebRTCAnswer = useCallback(async (offer) => {
    ensureWebRTCService();
    return await webrtcRef.current.createAnswer(offer);
  }, [ensureWebRTCService]);

  const setWebRTCAnswer = useCallback(async (answer) => {
    if (!webrtcRef.current) return;
    await webrtcRef.current.setAnswer(answer);
    enableWebRTC();
  }, [enableWebRTC]);

  const addWebRTCIceCandidate = useCallback(async (candidate) => {
    if (!webrtcRef.current) return;
    await webrtcRef.current.addIceCandidate(candidate);
  }, []);

  const handleFrame = useCallback(
    async (frame) => {
      if (!priv || !partnerPub) return;

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
    [priv, partnerPub, appendMessage, markDelivered, notifyIfBackground, sendFrame]
  );
  handleFrameRef.current = handleFrame;

  const startPairing = useCallback(
    async (name) => {
      const p2p = p2pRef.current;
      if (!p2p || !priv || !myPub) throw new Error("La app aún no está lista.");
      p2p.configure({
        keys: keysRef.current,
        partnerPub: null,
        myName: name,
        myEmoji: sessionRef.current?.myEmoji,
        getSavedAddr,
        saveAddr,
      });
      return p2p.startPairing({ name, emoji: sessionRef.current?.myEmoji });
    },
    [priv, myPub, getSavedAddr, saveAddr]
  );

  const startPairingWebRTC = useCallback(
    async (name) => {
      if (!priv || !myPub) throw new Error("La app aún no está lista.");
      const offer = await createWebRTCOffer();
      return { qr: buildWebRTCOfferQr(myPub, offer), pub: myPub };
    },
    [priv, myPub, createWebRTCOffer]
  );

  const cancelPairing = useCallback(() => {
    p2pRef.current?.cancelPairing();
    setPendingPair(null);
  }, []);

  const acceptPairing = useCallback(() => {
    const ok = p2pRef.current?.acceptPairing() || false;
    if (ok) setPendingPair(null);
    return ok;
  }, []);

  const rejectPairing = useCallback(() => {
    p2pRef.current?.rejectPairing();
    setPendingPair(null);
  }, []);

  const joinPairing = useCallback(
    async (qr, name) => {
      const webrtcQr = parseWebRTCQr(qr);
      if (webrtcQr && webrtcQr.kind === "offer") {
        // B escaneó el Offer de A: calcula el Answer y su propio QR.
        const answer = await createWebRTCAnswer(webrtcQr.sdp);
        // B ya está en modo WebRTC: al abrirse el DataChannel podrá enviar.
        enableWebRTC();
        const answerQr = buildWebRTCAnswerQr(myPub, answer);
        const sas = verificationCode(myPub, webrtcQr.pub);
        const coupleId = deriveCoupleId(myPub, webrtcQr.pub);
        return {
          mode: "webrtc-answer",
          qr: answerQr,
          sas,
          partnerPub: webrtcQr.pub,
          coupleId,
        };
      }
      if (webrtcQr && webrtcQr.kind === "answer") {
        // A escaneó el Answer de B: cierra el handshake SDP.
        await setWebRTCAnswer(webrtcQr.sdp);
        const sas = verificationCode(myPub, webrtcQr.pub);
        const coupleId = deriveCoupleId(myPub, webrtcQr.pub);
        return { mode: "webrtc-connected", partnerPub: webrtcQr.pub, coupleId, sas };
      }
      const p2p = p2pRef.current;
      if (!p2p || !priv || !myPub) throw new Error("La app aún no está lista.");
      p2p.configure({
        keys: keysRef.current,
        partnerPub: null,
        myName: name || sessionRef.current?.myName,
        myEmoji: sessionRef.current?.myEmoji,
        getSavedAddr,
        saveAddr,
      });
      return p2p.joinPairing(qr);
    },
    [priv, myPub, getSavedAddr, saveAddr, createWebRTCAnswer, setWebRTCAnswer, enableWebRTC]
  );

  const clearPairedResult = useCallback(() => setPairedResult(null), []);

  const getWebRTCService = useCallback(() => webrtcRef.current, []);

  const setPairedResultDirect = useCallback((res) => {
    setPairedResult(res);
  }, []);

  return (
    <P2PContext.Provider
      value={{
        ready: !!(priv && myPub),
        status, // offline | connecting | online
        connMode,
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
        startPairingWebRTC,
        cancelPairing,
        joinPairing,
        createWebRTCOffer,
        createWebRTCAnswer,
        setWebRTCAnswer,
        addWebRTCIceCandidate,
        enableWebRTC,
        disableWebRTC,
        getWebRTCService,
        setPairedResultDirect,
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

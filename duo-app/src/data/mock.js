export const mockUser = {
  id: "u1",
  name: "Tú",
  emoji: "🦊",
  avatarColor: "#FF4D6D",
};

export const mockPartner = {
  id: "u2",
  name: "Mi Amor",
  emoji: "🐰",
  avatarColor: "#A855F7",
  online: true,
  lastSeen: "en línea",
};

export const coupleMeta = {
  code: "DUO-7X4K2",
  togetherSince: "2023-02-14",
  daysTogether: 610,
};

export const mockMessages = [];

// ---------------------------------------------------------------------------
// Juegos pensados para la DISTANCIA: casi todo se cumple por chat, audio, foto
// o videollamada, para que sirvan aunque cada uno esté en su casa o su país.
//
// Niveles (se eligen ANTES de jugar):
//   1 Suave · 2 Romántico · 3 Picante · 4 Atrevido · 5 Íntimo (lo más hot)
//
// El contenido vive en los pools (pool-*.js): 22 opciones ÚNICAS por nivel y
// por juego (mínimo exigido: 20), verificado por los tests.
// ---------------------------------------------------------------------------

export const challengeLevels = [
  { id: 1, name: "Suave", emoji: "🌸", color: "#34D399" },
  { id: 2, name: "Romántico", emoji: "💞", color: "#F472B6" },
  { id: 3, name: "Picante", emoji: "🌶️", color: "#FB7185" },
  { id: 4, name: "Atrevido", emoji: "🔥", color: "#F43F5E" },
  { id: 5, name: "Íntimo", emoji: "😈", color: "#9F1239" },
];

// Ruleta de Retos (nivel 1..5)
export { challenges } from "./pool-retos";
// Verdad o Reto: verdades y retos (nivel 1..5)
export { truths } from "./pool-truths";
export { dares } from "./pool-dares";
// Dados del Deseo (nivel 1..5)
export { diceChallenges } from "./pool-dados";
// Para Conocernos (nivel 1..5)
export { coupleQuestions } from "./pool-preguntas";

export const games = [
  {
    id: "verdad",
    name: "Verdad o Reto",
    emoji: "🎲",
    desc: "El clásico que sube la temperatura.",
    color: "#EC4899",
  },
  {
    id: "ruleta",
    name: "Ruleta de Retos",
    emoji: "🎯",
    desc: "Gira y cumple el reto del nivel elegido.",
    color: "#A855F7",
  },
  {
    id: "dados",
    name: "Dados del Deseo",
    emoji: "🎰",
    desc: "Tira los dados y deja que decida.",
    color: "#F43F5E",
  },
  {
    id: "preguntas",
    name: "Para Conocernos",
    emoji: "💬",
    desc: "Preguntas que acercan de verdad.",
    color: "#F59E0B",
  },
];

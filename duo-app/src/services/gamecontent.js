import {
  truths,
  dares,
  challenges,
  diceChallenges,
  coupleQuestions,
} from "../data/mock";

// Contenido real de los juegos. Antes el panel del chat mandaba textos fijos
// ("Verdad", "Tira los dados") y por eso el mensaje no decía nada. Aquí se
// elige una pregunta/reto real del nivel y, en los dados, se tiran dos dados.

export const GAME_INFO = {
  verdad: { name: "Verdad o Reto", emoji: "🎭" },
  ruleta: { name: "Ruleta de Retos", emoji: "🎡" },
  dados: { name: "Dados del Deseo", emoji: "🎲" },
  preguntas: { name: "Para Conocernos", emoji: "💬" },
};

const MODE_LABEL = {
  truth: "VERDAD",
  dare: "RETO",
  spin: "RETO",
  roll: "DADOS",
  question: "PREGUNTA",
};

export function modeLabel(mode) {
  return MODE_LABEL[mode] || "JUEGO";
}

function levelPool(book, level) {
  if (!book) return [];
  return book[level] || book[1] || [];
}

// Elige al azar evitando repetir el último resultado (si hay más de uno).
export function pickFrom(pool, avoid) {
  const items = Array.isArray(pool) ? pool : [];
  if (!items.length) return null;
  let next = items[Math.floor(Math.random() * items.length)];
  if (items.length > 1 && next === avoid) {
    next = items[(items.indexOf(next) + 1) % items.length];
  }
  return next;
}

export function rollTwoDice() {
  return [
    1 + Math.floor(Math.random() * 6),
    1 + Math.floor(Math.random() * 6),
  ];
}

// Devuelve { text, mode, dice } listo para mostrarse en el chat.
export function makeDraw(gameId, level, mode, avoidText) {
  if (gameId === "verdad") {
    const isTruth = mode !== "dare";
    const pool = levelPool(isTruth ? truths : dares, level);
    return {
      text: pickFrom(pool, avoidText),
      mode: isTruth ? "truth" : "dare",
      dice: null,
    };
  }
  if (gameId === "ruleta") {
    return {
      text: pickFrom(levelPool(challenges, level), avoidText),
      mode: "spin",
      dice: null,
    };
  }
  if (gameId === "dados") {
    return {
      text: pickFrom(levelPool(diceChallenges, level), avoidText),
      mode: "roll",
      dice: rollTwoDice(),
    };
  }
  if (gameId === "preguntas") {
    return {
      text: pickFrom(levelPool(coupleQuestions, level), avoidText),
      mode: "question",
      dice: null,
    };
  }
  return { text: null, mode, dice: null };
}

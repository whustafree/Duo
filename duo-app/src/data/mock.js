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

export const mockMessages = [
  {
    id: "m1",
    from: "other",
    text: "Holaa mi amor 😍",
    time: "20:04",
    type: "text",
  },
  {
    id: "m2",
    from: "me",
    text: "Holaa preciosa, ¿cómo estuvo tu día?",
    time: "20:05",
    type: "text",
  },
  {
    id: "m3",
    from: "other",
    text: "Largo... pero pensé en ti todo el día 😏",
    time: "20:06",
    type: "text",
  },
  {
    id: "m4",
    from: "other",
    type: "photo",
    photoLabel: "foto",
    time: "20:06",
  },
  {
    id: "m5",
    from: "me",
    text: "Uff... me acabas de alegrar la noche 🔥",
    time: "20:07",
    type: "text",
  },
  {
    id: "m6",
    from: "other",
    text: "¿Jugamos un reto? Tengo ganas 😜",
    time: "20:08",
    type: "text",
  },
];

// Niveles: 1 = suave, 2 = romántico, 3 = picante, 4 = atrevido
export const challengeLevels = [
  { id: 1, name: "Suave", emoji: "🌸", color: "#34D399" },
  { id: 2, name: "Romántico", emoji: "💞", color: "#F472B6" },
  { id: 3, name: "Picante", emoji: "🌶️", color: "#FB7185" },
  { id: 4, name: "Atrevido", emoji: "🔥", color: "#F43F5E" },
];

export const challenges = {
  1: [
    "Dale un abrazo de 20 segundos sin soltar.",
    "Dile 3 cosas que te enamoran de él/ella.",
    "Cuéntale tu recuerdo favorito juntos.",
    "Mírense a los ojos 30 segundos sin hablar.",
    "Báilen una canción lenta en la sala.",
  ],
  2: [
    "Dale un beso en la frente y susúrrale algo bonito.",
    "Masaje de hombros por 2 minutos.",
    "Escribe un piropo y mándalo al chat ahora mismo.",
    "Cuéntale un sueño que tengan juntos a futuro.",
    "Tómense una selfie abrazados para el recuerdo.",
  ],
  3: [
    "Beso de 10 segundos donde él/ella elija dónde.",
    "Susúrrale al oído lo que más te gusta de su cuerpo.",
    "Quita una prenda a tu elección (o un calcetín 😜).",
    "Dale un beso en el cuello, lento.",
    "Describe tu fantasía favorita con detalle.",
  ],
  4: [
    "Beso apasionado de 30 segundos sin tocar los labios con manos.",
    "Manda una foto sugerente al chat (solo para tus ojos 😏).",
    "Deja que él/ella te dé una orden… y obedece.",
    "Reto de 5 minutos: sin hablar, solo lenguaje corporal.",
    "Elige un lugar de la casa y cumple la fantasía de tu pareja.",
  ],
};

export const truths = [
  "¿Cuál fue tu primer pensamiento cuando me viste?",
  "¿Qué es lo que más te calienta de mí?",
  "¿Cuál es tu lugar favorito de mi cuerpo?",
  "¿Alguna fantasía que no me hayas contado?",
  "¿Qué gesto mío te derrite?",
  "¿Cuándo fue la última vez que pensaste en mí de forma... traviesa?",
];

export const dares = [
  "Manda un audio susurrando algo provocador.",
  "Dale un beso donde menos se lo espere.",
  "Imita tu cara de... ya sabes 😏",
  "Quítate una prenda por cada mensaje que te haga sonreír.",
  "Envíale un emoji prohibido y explica por qué.",
  "Baila 15 segundos de forma insinuante.",
];

export const diceChallenges = {
  1: ["Un piropo", "Un masaje de 1 min", "Un abrazo", "Un beso tierno", "Una canción", "Un mensaje dulce"],
  2: ["Un beso largo", "Un mordisco suave", "Un baile juntos", "Un baile de ojos", "Una confesión", "Un mimo"],
  3: ["Un beso apasionado", "Susurro al oído", "Masaje sensual", "Foto sugerente", "Reto de 30s", "Ronda de preguntas"],
  4: ["Carta blanca del otro", "3 minutos sin normas", "Reto sorpresa", "Fantasía en voz alta", "Doble reto", "El/ella decide"],
};

export const coupleQuestions = [
  "¿Cuál fue el momento en que supiste que me querías?",
  "Si pudiéramos viajar mañana, ¿a dónde iríamos?",
  "¿Qué te hace sentir más deseado/a por mí?",
  "¿Qué canción te recuerda a nosotros?",
  "¿Qué es lo que más te gusta de nuestra intimidad?",
  "¿Qué te gustaría que hiciéramos más seguido?",
  "¿Cuál es tu recuerdo favorito de la última semana?",
  "¿Qué te gustaría probar juntos que aún no hemos hecho?",
];

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

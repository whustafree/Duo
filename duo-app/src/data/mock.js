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
// ---------------------------------------------------------------------------

export const challengeLevels = [
  { id: 1, name: "Suave", emoji: "🌸", color: "#34D399" },
  { id: 2, name: "Romántico", emoji: "💞", color: "#F472B6" },
  { id: 3, name: "Picante", emoji: "🌶️", color: "#FB7185" },
  { id: 4, name: "Atrevido", emoji: "🔥", color: "#F43F5E" },
  { id: 5, name: "Íntimo", emoji: "😈", color: "#9F1239" },
];

// Ruleta de Retos: retos para hacer cada uno desde su teléfono (a distancia).
export const challenges = {
  1: [
    "Cuéntale tu día con un audio de voz, con calma.",
    "Mándale 3 cosas que te enamoran de él/ella por mensaje.",
    "Envía el emoji que mejor describa cómo te sientes hoy por tu pareja.",
    "Cuéntale un recuerdo bonito que tengan juntos.",
    "Pon su canción favorita y grábate bailando 15 segundos.",
    "Escribe un piropo y mándalo ahora mismo.",
  ],
  2: [
    "Manda un audio susurrando algo bonito al oído.",
    "Cuéntale un sueño que quieran cumplir juntos algún día.",
    "Envía una selfie tuya sonriendo, solo para ella/él.",
    "Dile en un audio por qué te enamoraste.",
    "Describe con detalle el próximo abrazo que se darán.",
    "Mándale un mensaje largo contando lo que más extrañas.",
  ],
  3: [
    "Manda un audio con voz sensual leyendo un piropo.",
    "Envía una foto provocadora (solo para sus ojos 😏).",
    "Cuéntale en audio lo primero que harás cuando la/lo veas.",
    "Describe tu fantasía favorita por mensaje.",
    "Manda un emoji prohibido y explica por qué.",
    "Susúrrale en audio algo que te encantaría hacerle.",
  ],
  4: [
    "Manda una foto sugerente en ropa interior o recién salido/a de la ducha.",
    "Grábate un audio describiendo un sueño erótico con ella/él.",
    "Cuéntale qué te gustaría que te hiciera ahora mismo, sin filtros.",
    "Envía un video corto (10 s) coqueteando con la cámara.",
    "Elige una parte de tu cuerpo y mándale una foto sensual.",
    "Dile por audio una orden que quieras que cumpla cuando se vean.",
  ],
  5: [
    "Manda una foto o video cada vez más provocativo y deja que ella/él pida más.",
    "Describe por audio, con voz sexy, paso a paso lo que te gustaría hacerle.",
    "Grábate 30 segundos cumpliendo la fantasía que tu pareja te pida.",
    "Prohibido escribir con ropa: cuéntale qué llevas puesto (o no) ahora mismo.",
    "Confiesa tu fantasía más secreta y pídele que te cuente la suya.",
    "Propón un juego: por cada mensaje que te mande, quítate una prenda en video.",
  ],
};

// Verdad: preguntas por nivel (a distancia, se responden por chat o audio).
export const truths = {
  1: [
    "¿Cuál fue tu primer pensamiento cuando me viste?",
    "¿Qué es lo que más te gusta de mi forma de ser?",
    "¿Qué momento nuestro te hace sonreír siempre?",
    "¿Qué te gustaría que hiciéramos más seguido juntos?",
    "¿Qué gesto mío te derrite?",
  ],
  2: [
    "¿Cuándo supiste que me querías de verdad?",
    "¿Qué es lo que más extrañas de mí cuando no nos vemos?",
    "¿Qué sueño te gustaría cumplir conmigo?",
    "¿Qué canción te recuerda a nosotros?",
    "¿Qué te hace sentir más querido/a?",
  ],
  3: [
    "¿Qué es lo que más te calienta de mí?",
    "¿Cuál es tu lugar favorito de mi cuerpo?",
    "¿Cuándo fue la última vez que pensaste en mí de forma... traviesa?",
    "¿Qué mensaje mío te volvió loco/a?",
    "¿Qué te gustaría que te susurre al oído?",
  ],
  4: [
    "¿Alguna fantasía que no me hayas contado todavía?",
    "¿Qué te gustaría que hiciéramos la próxima vez que nos veamos?",
    "¿Dónde te gustaría que te toque primero?",
    "¿Qué te imaginas cuando te mando una foto sugerente?",
    "¿Qué es lo más atrevido que has pensado hacer conmigo?",
  ],
  5: [
    "Cuéntame paso a paso la fantasía que te da más morbo.",
    "¿Qué te gustaría que te haga una noche entera sin prisa?",
    "¿Cuál es el lugar más arriesgado donde me has deseado?",
    "¿Qué te gustaría que te mande ahora mismo por mensaje?",
    "Si te diera una noche de carta blanca, ¿qué me pedirías?",
  ],
};

// Reto: retos por nivel, casi todos por chat/audio/foto/video (a distancia).
export const dares = {
  1: [
    "Manda un audio cantando el estribillo de nuestra canción.",
    "Envía una foto de algo que te recuerde a mí.",
    "Escribe un mini poema de 2 líneas y mándalo.",
    "Grábate mandándome un beso al aire.",
    "Manda 5 emojis que digan cómo te sientes por mí.",
  ],
  2: [
    "Manda un audio susurrando algo provocador.",
    "Envía una foto tuya con tu mejor sonrisa.",
    "Cuéntame por chat qué te gustaría hacer este finde conmigo.",
    "Dedícame una canción y explica por qué.",
    "Mándame un mensaje bonito que pueda leer mañana al despertar.",
  ],
  3: [
    "Manda un audio con voz sensual diciéndome un piropo.",
    "Envía una foto sugerente (tú decides cuánto 😏).",
    "Describe por chat tu fantasía favorita con detalle.",
    "Manda un emoji prohibido y explica por qué.",
    "Baila 15 segundos de forma insinuante y mándame el video.",
  ],
  4: [
    "Manda una foto atrevida en ropa interior o recién duchado/a.",
    "Grábate un audio erótico describiendo lo que harías conmigo.",
    "Envía un video corto coqueteando con la cámara.",
    "Quítate una prenda por cada mensaje que te haga sonreír.",
    "Dime por audio una orden que quieras que cumpla cuando nos veamos.",
  ],
  5: [
    "Manda un video sensual de 30 segundos solo para mí.",
    "Descríbeme por audio, con voz sexy, qué me harías ahora mismo.",
    "Quítate una prenda en video por cada halago que te mande.",
    "Cuéntame tu fantasía más secreta y hazme cumplir la mía.",
    "Mándame un audio en plena intimidad dedicándomelo.",
  ],
};

// Dados del Deseo: resultados cortos por nivel.
export const diceChallenges = {
  1: ["Un piropo", "Un audio dulce", "Un recuerdo bonito", "Una canción", "Un emoji", "Un mensaje de buenos días"],
  2: ["Un audio susurrado", "Una foto sonriendo", "Un sueño juntos", "Un poema corto", "Una videollamada", "Un «te extraño»"],
  3: ["Un audio sensual", "Una foto provocadora", "Una fantasía", "Un reto de 30 s en video", "Un emoji prohibido", "Un piropo picante"],
  4: ["Una foto sugerente", "Un audio erótico", "Un video coqueto", "Una orden para cuando se vean", "Una confesión sin filtros", "3 minutos sin censura"],
  5: ["Una foto íntima", "Un video sensual", "Una fantasía en detalle", "Quitarse una prenda en video", "Un audio en la cama", "El/ella decide y tú obedeces"],
};

// Para Conocernos: preguntas que acercan aunque estén lejos.
export const coupleQuestions = [
  "¿Cuál fue el momento en que supiste que me querías?",
  "Si pudiéramos viajar mañana, ¿a dónde iríamos?",
  "¿Qué te hace sentir más deseado/a por mí?",
  "¿Qué canción te recuerda a nosotros?",
  "¿Qué es lo que más te gusta de nuestra intimidad?",
  "¿Qué te gustaría que hiciéramos más seguido?",
  "¿Cuál es tu recuerdo favorito de la última semana?",
  "¿Qué te gustaría probar juntos que aún no hemos hecho?",
  "¿Qué es lo primero que haremos cuando por fin nos veamos?",
  "¿En qué momento del día piensas más en mí?",
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

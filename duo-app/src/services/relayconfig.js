// Configuración del relay (broker MQTT) usado como cartero.
//
// PRIVATE_BROKERS es el relay PROPIO (EMQX Serverless gratis): va primero en
// la lista y es el preferido. Mientras esté vacío se usan solo los brokers
// públicos de respaldo de mqttws.js (inestables: se usan como red de
// seguridad, no como canal principal).
//
// Para activarlo, añadir aquí el endpoint y las credenciales del deployment:
//   { url: "wss://xxxxx.s1.eu-west-1.emqxok.com:8084/mqtt",
//     user: "duo", pass: "********" }
//
// Privacidad: el contenido sigue cifrado de extremo a extremo; el broker
// (propio o público) solo ve metadatos (temas hasheados y tamaños).

export const PRIVATE_BROKERS = [
  {
    url: "wss://dc111c11.ala.us-east-1.emqxsl.com:8084/mqtt",
    user: "whustaf",
    pass: "claudia1988",
  },
];

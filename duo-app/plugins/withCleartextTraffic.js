// Config plugin local: permite tráfico HTTP (cleartext) en el build de RELEASE.
// Necesario porque el servidor Duo corre por http://TU_IP:4000 en la red local.
// (El manifest de debug ya lo permite; el de release lo bloquea por defecto.)
const { withAndroidManifest } = require("@expo/config-plugins");

module.exports = function withCleartextTraffic(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (app) {
      app.$["android:usesCleartextTraffic"] = "true";
    }
    return cfg;
  });
};

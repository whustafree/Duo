// Comparación de versiones sin dependencias (se usa para avisar de
// actualizaciones desde GitHub Releases y también por los tests).

export function parseVersion(tag) {
  const clean = String(tag || "")
    .replace(/^v/, "")
    .split("-")[0];
  const parts = clean.split(".").map((n) => parseInt(n, 10) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

export function isNewer(remoteTag, localVersion) {
  const a = parseVersion(remoteTag);
  const b = parseVersion(localVersion);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

import { API_URL } from "../config";

// Todas las rutas privadas requieren el header `x-duo-token`: el secreto de la
// pareja que se genera al vincularse. Sin él el servidor responde 401.
async function request(path, { method = "GET", body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["x-duo-token"] = token;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

export function createPair({ name, emoji, pubKey }) {
  return request("/api/pair/create", {
    method: "POST",
    body: { name, emoji, pubKey },
  });
}

export function joinPair({ code, name, emoji, pubKey }) {
  return request("/api/pair/join", {
    method: "POST",
    body: { code, name, emoji, pubKey },
  });
}

export function getCouple(coupleId, userId, token) {
  return request(`/api/couple/${coupleId}?userId=${userId}`, { token });
}

export function getMessages(coupleId, userId, token) {
  return request(`/api/messages/${coupleId}?userId=${userId}`, { token });
}

// La foto viaja YA CIFRADA (AES-256-GCM hecho en el dispositivo).
export function postPhoto({ coupleId, senderId, token, nonceB64, imageDataB64 }) {
  return request("/api/photo", {
    method: "POST",
    token,
    body: { coupleId, senderId, nonceB64, imageDataB64 },
  });
}

export function photoFileUrl(url) {
  if (!url) return null;
  return url.startsWith("http") ? url : `${API_URL}${url}`;
}

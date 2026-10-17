import { API_URL } from "../config";

async function request(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

export function createPair({ name, emoji }) {
  return request("/api/pair/create", {
    method: "POST",
    body: JSON.stringify({ name, emoji }),
  });
}

export function joinPair({ code, name, emoji }) {
  return request("/api/pair/join", {
    method: "POST",
    body: JSON.stringify({ code, name, emoji }),
  });
}

export function getCouple(coupleId, userId) {
  return request(`/api/couple/${coupleId}?userId=${userId}`);
}

export function getMessages(coupleId) {
  return request(`/api/messages/${coupleId}`);
}

export async function uploadPhoto({ coupleId, senderId, uri }) {
  const form = new FormData();
  form.append("coupleId", coupleId);
  form.append("senderId", senderId);
  const name = uri.split("/").pop() || "photo.jpg";
  const ext = name.split(".").pop().toLowerCase();
  const type = ext === "png" ? "image/png" : "image/jpeg";
  form.append("photo", { uri, name, type });

  const res = await fetch(`${API_URL}/api/upload`, { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "No se pudo subir la foto");
  return data;
}

export function photoUrl(url) {
  if (!url) return null;
  return url.startsWith("http") ? url : `${API_URL}${url}`;
}

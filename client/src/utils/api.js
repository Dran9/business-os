const API_BASE = '';

export function getToken() {
  return localStorage.getItem('bos_token');
}

function getUserKey() {
  return 'bos_user';
}

export function setToken(token) {
  localStorage.setItem('bos_token', token);
}

export function clearToken() {
  localStorage.removeItem('bos_token');
  localStorage.removeItem(getUserKey());
  window.dispatchEvent(new CustomEvent('bos-user-updated', { detail: null }));
}

export function isAuthenticated() {
  return !!getToken();
}

export function setStoredUser(user) {
  localStorage.setItem(getUserKey(), JSON.stringify(user));
  window.dispatchEvent(new CustomEvent('bos-user-updated', { detail: user }));
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(getUserKey());
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function api(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
    throw new Error('Sesión expirada');
  }

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || `Error ${res.status}`);
  }

  return data;
}

export function apiGet(path) {
  return api(path);
}

export function apiPost(path, body) {
  return api(path, { method: 'POST', body: JSON.stringify(body) });
}

export function apiPut(path, body) {
  return api(path, { method: 'PUT', body: JSON.stringify(body) });
}

export function apiDelete(path) {
  return api(path, { method: 'DELETE' });
}

export async function apiUpload(path, formData, method = 'POST') {
  const token = getToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: formData,
  });

  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
    throw new Error('Sesión expirada');
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Error ${res.status}`);
  }
  return data;
}

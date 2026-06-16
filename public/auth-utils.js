const API_BASE = '';

async function parseJsonResponse(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(res.ok ? 'Invalid server response' : `Server error (${res.status})`);
  }
}

async function apiFetch(url, options = {}) {
  const token = localStorage.getItem('auth_token');
  const authHeaders = token ? { 'Authorization': 'Bearer ' + token } : {};

  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...(options.headers || {})
    }
  });

  if (res.status === 401 && !window.location.pathname.includes('login.html')) {
    localStorage.removeItem('auth_token');
    window.location.href = '/login.html?expired=1';
    throw new Error('Session expired');
  }

  return res;
}

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
  const res = await fetch(`${API_BASE}${url}`, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  if (res.status === 401 && !window.location.pathname.includes('login.html')) {
    window.location.href = '/login.html?expired=1';
    throw new Error('Session expired');
  }

  return res;
}

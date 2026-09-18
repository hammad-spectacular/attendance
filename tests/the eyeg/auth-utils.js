// Same-origin — Vercel rewrites /api/* to the Railway backend
// For local development with Live Server (on any local IP) or file:// protocol:
let API_BASE = '';

let isRedirecting = false;

function authHeader() {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: 'Bearer ' + token } : {};
}

function setAuthToken(token) {
  if (token) localStorage.setItem('auth_token', token);
}

function redirectToLogin() {
  if (isRedirecting) return;
  isRedirecting = true;
  localStorage.removeItem('auth_token');
  window.location.href = '/index.html';
}

function formatFetchError(err) {
  return 'Connection error. Please check your internet and try again.';
}

/** Safely read a fetch Response — never throws on HTML/404 pages from a misconfigured backend */
async function parseApiResponse(res) {
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();

  if (!text) {
    return { ok: res.ok, status: res.status, data: {} };
  }

  const trimmed = text.trim();
  if (contentType.includes('application/json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return { ok: res.ok, status: res.status, data: JSON.parse(text) };
    } catch (_) {
      /* fall through to non-JSON handling */
    }
  }

  // HTML or plain-text error pages (e.g. "Cannot POST /api/auth/login", Vercel/Railway 404)
  if (trimmed.includes('<!DOCTYPE') || trimmed.includes('<html') || trimmed.includes('Cannot POST')) {
    const hint = res.status === 404
      ? 'Login API not found — the backend may be running the wrong server file.'
      : `The server returned an unexpected page (HTTP ${res.status}).`;
    throw new Error(hint);
  }

  throw new Error(`Server error (${res.status})`);
}

async function refreshSession(retries = 2) {
  try {
    const res = await fetch(API_BASE + '/api/auth/me', {
      credentials: 'include',
      headers: authHeader()
    });
    if (!res.ok) {
      if (retries > 0) {
        await new Promise(r => setTimeout(r, 500));
        return refreshSession(retries - 1);
      }
      return null;
    }
    const { data } = await parseApiResponse(res);
    if (data.token) setAuthToken(data.token);
    return data;
  } catch (err) {
    console.warn('refreshSession:', err.message);
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 500));
      return refreshSession(retries - 1);
    }
    return null;
  }
}

async function apiFetch(url, options = {}, retries = 2) {
  const fullUrl = url.startsWith('/api') ? API_BASE + url : url;
  const doFetch = () => fetch(fullUrl, {
    credentials: 'include',
    ...options,
    headers: {
      ...authHeader(),
      ...(options.headers || {})
    }
  });

  let res;
  try {
    res = await doFetch();
  } catch (err) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 500));
      return apiFetch(url, options, retries - 1);
    }
    throw err;
  }

  if (res.status >= 502 && retries > 0) {
    await new Promise(r => setTimeout(r, 800));
    return apiFetch(url, options, retries - 1);
  }

  if (res.status === 401) {
    const session = await refreshSession();
    if (!session) {
      redirectToLogin();
      return res;
    }
    res = await doFetch();
    if (res.status === 401) redirectToLogin();
  }

  return res;
}

/** Login with retries and safe JSON parsing — use this on index.html */
async function apiLogin(fullId, password, retries = 2) {
  const body = JSON.stringify({ full_id: fullId.toUpperCase(), password });
  const doLogin = () => fetch(API_BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body
  });

  try {
    let res = await doLogin();
    if (res.status >= 502 && retries > 0) {
      await new Promise(r => setTimeout(r, 800));
      return apiLogin(fullId, password, retries - 1);
    }
    const parsed = await parseApiResponse(res);
    return parsed;
  } catch (err) {
    if (retries > 0 && (err.name === 'TypeError' || String(err.message).toLowerCase().includes('fetch'))) {
      await new Promise(r => setTimeout(r, 800));
      return apiLogin(fullId, password, retries - 1);
    }
    throw err;
  }
}

function startSessionKeepAlive(intervalMs = 10 * 60 * 1000) {
  refreshSession();
  setInterval(refreshSession, intervalMs);
}

function setButtonLoading(btn, loading, loadingHtml) {
  if (!btn) return;
  if (loading) {
    if (!btn.dataset.originalHtml) btn.dataset.originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = loadingHtml || '<i class="fas fa-spinner fa-spin"></i> Saving...';
  } else {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.originalHtml || btn.innerHTML;
    delete btn.dataset.originalHtml;
  }
}

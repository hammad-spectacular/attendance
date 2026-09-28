// Same-origin — Vercel rewrites /api/* to the Railway backend
// For local development with Live Server (on any local IP) or file:// protocol:
let API_BASE = '';

let isRedirecting = false;

// One browser, one origin, one localStorage key. Signing in as a teacher in a second
// tab therefore REPLACES the school admin's token, and the still-open admin page keeps
// looking normal until it saves something and gets a bare "Forbidden". These helpers
// read the token's own claims so a 403 can say who you actually are and what went wrong,
// instead of leaving the caller to print a one-word error.
const ROLE_LABELS = {
  super_admin: 'Super Admin',
  admin: 'School Admin',
  coordinator: 'Coordinator',
  teacher: 'Teacher',
  student: 'Student'
}

function currentIdentity() {
  const token = localStorage.getItem('auth_token')
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(decodeURIComponent(escape(atob(base64))))
    if (!claims || !claims.role) return null
    return {
      role: claims.role,
      roleLabel: ROLE_LABELS[claims.role] || claims.role,
      loginId: claims.login_id || null,
      tenant: claims.tenant_id || null
    }
  } catch (err) {
    return null
  }
}

/**
 * Turn a 403 into something actionable. Called by pages that want to explain rather
 * than surface the server's generic "Forbidden".
 */
function describeForbidden(res, requiredRole) {
  const me = currentIdentity()
  if (!me) {
    return 'You are not signed in, or your sign-in has expired. Please log in again.'
  }
  if (requiredRole && me.role !== requiredRole) {
    return `You are signed in as ${me.roleLabel}` +
      (me.loginId ? ` (${me.loginId})` : '') +
      `, but this page needs a ${ROLE_LABELS[requiredRole] || requiredRole}. ` +
      `You are probably signed in on another tab or browser window - sign in here again as the right role.`
  }
  return `Signed in as ${me.roleLabel}` +
    (me.loginId ? ` (${me.loginId})` : '') +
    `. Your account does not have permission for this action. If you were expecting access, ask your Super Admin to grant it.`
}

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
  window.location.replace('/index.html');
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

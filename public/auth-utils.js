const API_BASE = window.location.origin.includes('localhost')
  ? window.location.origin
  : 'https://attendance-production-fb0b.up.railway.app';

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

async function refreshSession() {
  try {
    const res = await fetch(API_BASE + '/api/auth/me', {
      credentials: 'include',
      headers: authHeader()
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.token) setAuthToken(data.token);
    return data;
  } catch {
    return null;
  }
}

async function apiFetch(url, options = {}) {
  const fullUrl = url.startsWith('/api') ? API_BASE + url : url;
  const doFetch = () => fetch(fullUrl, {
    credentials: 'include',
    ...options,
    headers: {
      ...authHeader(),
      ...(options.headers || {})
    }
  });

  let res = await doFetch();
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

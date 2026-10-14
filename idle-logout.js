/**
 * Idle auto-logout for The Eye.
 *
 * Signs the user out after a long stretch with no activity, then returns them to
 * the login screen. Include it on any authenticated page with:
 *
 *   <script src="./idle-logout.js"></script>
 *
 * It is fully self-contained (no globals, no dependency on auth-utils.js), so it
 * can sit next to pages that already declare their own authHeader/apiFetch.
 *
 * Tune the timing by editing IDLE_TIMEOUT_MINUTES below, or per page before the
 * script tag:
 *
 *   <script>window.IDLE_LOGOUT_CONFIG = { timeoutMs: 15 * 60 * 1000 };</script>
 *
 * Only runs when an auth_token is present, so it is safe to include on pages a
 * signed-out visitor may reach.
 */
(function () {
  'use strict';

  var IDLE_TIMEOUT_MINUTES = 30;
  var WARN_SECONDS = 60;

  var cfg = Object.assign({
    timeoutMs: IDLE_TIMEOUT_MINUTES * 60 * 1000,
    warnMs: WARN_SECONDS * 1000,
    pollMs: 5000,
    redirect: '/index.html',
    activityKey: 'idle:lastActivity'
  }, window.IDLE_LOGOUT_CONFIG || {});

  function hasToken() {
    try { return !!localStorage.getItem('auth_token'); } catch (e) { return false; }
  }

  // Nothing to guard when signed out (login page, public pages).
  if (!hasToken()) return;

  var ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'click', 'keydown', 'scroll', 'wheel', 'touchstart', 'touchmove'];

  // Last real activity, shared across tabs through localStorage so that typing in
  // one tab keeps every other tab alive.
  var last = Date.now();
  try {
    var stored = parseInt(localStorage.getItem(cfg.activityKey), 10);
    if (!isNaN(stored) && stored > 0 && stored <= Date.now()) last = stored;
  } catch (e) { /* ignore */ }

  function persist() {
    try { localStorage.setItem(cfg.activityKey, String(last)); } catch (e) { /* ignore */ }
  }

  var throttling = false;
  function markActive() {
    if (throttling) return;
    throttling = true;
    setTimeout(function () { throttling = false; }, 1000);
    last = Date.now();
    persist();
    hideWarning();
  }

  for (var i = 0; i < ACTIVITY_EVENTS.length; i++) {
    window.addEventListener(ACTIVITY_EVENTS[i], markActive, { passive: true, capture: true });
  }

  // Warning banner ---------------------------------------------------------
  var warnEl = null;
  var warnMsg = null;

  function buildWarning() {
    warnEl = document.createElement('div');
    warnEl.id = 'idleLogoutWarning';
    warnEl.setAttribute('role', 'alertdialog');
    warnEl.setAttribute('aria-live', 'assertive');
    warnEl.style.cssText =
      'position:fixed;z-index:2147483647;left:50%;bottom:24px;transform:translateX(-50%);' +
      'background:#111827;color:#f9fafb;border:1px solid #374151;border-radius:10px;' +
      'padding:14px 18px;box-shadow:0 10px 30px rgba(0,0,0,.35);' +
      'font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
      'display:flex;align-items:center;gap:14px;max-width:92vw;';

    warnMsg = document.createElement('span');

    var stay = document.createElement('button');
    stay.type = 'button';
    stay.textContent = 'Stay signed in';
    stay.style.cssText =
      'background:#2563eb;color:#fff;border:0;border-radius:6px;padding:8px 14px;' +
      'cursor:pointer;font:inherit;white-space:nowrap;';
    stay.addEventListener('click', markActive);

    warnEl.appendChild(warnMsg);
    warnEl.appendChild(stay);
    if (document.body) document.body.appendChild(warnEl);
  }

  function showWarning(secondsLeft) {
    if (!document.body) return;
    if (!warnEl) buildWarning();
    if (!warnEl) return;
    warnMsg.textContent = 'You will be signed out in ' + secondsLeft + 's due to inactivity.';
    warnEl.style.display = 'flex';
  }

  function hideWarning() {
    if (warnEl) warnEl.style.display = 'none';
  }

  // Logout -----------------------------------------------------------------
  var loggingOut = false;
  function doLogout() {
    if (loggingOut) return;
    loggingOut = true;
    try {
      localStorage.removeItem('auth_token');
      localStorage.removeItem(cfg.activityKey);
    } catch (e) { /* ignore */ }
    // Best effort: tell the server, but never let a slow/failed call hold up the redirect.
    try {
      var base = (typeof window.API_BASE === 'string') ? window.API_BASE : '';
      fetch(base + '/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        keepalive: true
      }).catch(function () { /* ignore */ });
    } catch (e) { /* ignore */ }
    hideWarning();
    var sep = cfg.redirect.indexOf('?') === -1 ? '?' : '&';
    window.location.replace(cfg.redirect + sep + 'reason=inactivity');
  }

  var timer = setInterval(function () {
    if (!hasToken()) { clearInterval(timer); hideWarning(); return; }
    var idleFor = Date.now() - last;
    if (idleFor >= cfg.timeoutMs) { doLogout(); return; }
    if (idleFor >= cfg.timeoutMs - cfg.warnMs) {
      showWarning(Math.max(1, Math.round((cfg.timeoutMs - idleFor) / 1000)));
    } else {
      hideWarning();
    }
  }, cfg.pollMs);

  // Another tab signed out, or was active -----------------------------------
  window.addEventListener('storage', function (e) {
    if (e.key === 'auth_token' && !e.newValue) {
      clearInterval(timer);
      hideWarning();
      return;
    }
    if (e.key === cfg.activityKey && e.newValue) {
      var v = parseInt(e.newValue, 10);
      if (!isNaN(v)) { last = v; hideWarning(); }
    }
  });

  window.idleLogout = { reset: markActive, stop: function () { clearInterval(timer); hideWarning(); } };
})();

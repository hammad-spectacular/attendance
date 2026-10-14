/**
 * DraftStore — a tiny, safe helper for keeping form and view state across a
 * page reload.
 *
 * Two backends, chosen by intent:
 *   persist = true   -> localStorage   (operational state such as which class
 *                        and date attendance is being taken for; survives
 *                        closing the tab)
 *   persist = false  -> sessionStorage (per-tab, cleared when the tab closes;
 *                        used for anything carrying personal details)
 *
 * Values are wrapped with a timestamp so a caller can expire stale drafts.
 * This helper never stores credentials: callers must simply not pass any
 * password, token, OTP or similar value to save().
 *
 * All access is wrapped in try/catch — storage may be full or disabled, and a
 * draft is only ever a convenience, never a source of truth.
 */
(function () {
  'use strict';

  function backend(persist) {
    return persist ? window.localStorage : window.sessionStorage;
  }

  /** Persist a structured value under key. Best effort: failures are ignored. */
  function save(key, value, persist) {
    try {
      backend(persist).setItem(key, JSON.stringify({ t: Date.now(), v: value }));
    } catch (e) { /* storage disabled or full — drafts are best-effort */ }
  }

  /**
   * Read a value back. Returns null when missing, unreadable, malformed, or
   * older than maxAgeMs (which, when given, also prunes the stale entry).
   */
  function load(key, maxAgeMs, persist) {
    try {
      var raw = backend(persist).getItem(key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !('v' in parsed)) return null;
      if (maxAgeMs && (Date.now() - (parsed.t || 0)) > maxAgeMs) {
        backend(persist).removeItem(key);
        return null;
      }
      return parsed.v;
    } catch (e) {
      return null;
    }
  }

  /** Remove a stored value. */
  function clear(key, persist) {
    try { backend(persist).removeItem(key); } catch (e) { /* ignore */ }
  }

  window.DraftStore = { save: save, load: load, clear: clear };
})();

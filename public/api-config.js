/**
 * API Configuration for The Eye Frontend
 *
 * Loaded before auth-utils.js on every page. It sets window.API_BASE.
 *
 * API_BASE is ALWAYS an empty string: every API call uses a relative path
 * (/api/...) so the browser stays same-origin and Nginx proxies /api to the
 * backend. A previous version pointed non-local hostnames straight at the
 * backend IP, which broke with CORS whenever the site
 * was opened by IP address instead of a domain.
 */

(function () {
  window.API_BASE = '';
})();

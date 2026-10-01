/**
 * API Configuration for The Eye Frontend
 *
 * This file MUST be loaded before auth-utils.js in every HTML page.
 * It sets window.API_BASE for cross-origin frontend-backend communication.
 *
 * LOCAL DEVELOPMENT:
 *   Automatically detects localhost / 127.0.0.1 / local IP → empty string (same-origin)
 *
 * PRODUCTION (currently AWS):
 *   Any deployed domain → uses AWS backend URL
 *
 * PRODUCTION (Render — switch once ready):
 *   Update AWS_BACKEND_URL to your Render backend URL
 */

(function () {
  const hostname = window.location.hostname;

  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    /^192\.168\.\d+\.\d+$/.test(hostname) ||
    /^10\.\d+\.\d+\.\d+$/.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(hostname)
  ) {
    // Local development — same-origin requests
    window.API_BASE = '';
  } else {
    // Deployed on Vercel (or any domain) — use AWS backend for now
    // Switch to Render URL once backend is deployed there
    window.API_BASE = 'http://13.63.55.73';
  }
})();

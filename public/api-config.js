/**
 * API Configuration for The Eye Frontend
 *
 * This file MUST be loaded before auth-utils.js in every HTML page.
 * It sets window.API_BASE for cross-origin Vercel -> Render communication.
 *
 * LOCAL DEVELOPMENT:
 *   Automatically detects localhost / 127.0.0.1 / local IP → empty string (same-origin)
 *
 * PRODUCTION (Vercel → Render):
 *   Detects vercel.app domain → uses the Render backend URL below
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
    // Production on Vercel (or any deployed domain)
    // Update this URL when your Render backend URL changes
    window.API_BASE = 'https://attendance-2-akos.onrender.com';
  }
})();

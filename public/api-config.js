/**
 * API Configuration for The Eye Frontend
 * 
 * This file configures the API base URL for frontend-backend communication.
 * 
 * LOCAL DEVELOPMENT:
 *   API_BASE = '' (empty string - uses same origin)
 * 
 * VERCEL FRONTEND + RENDER BACKEND:
 *   API_BASE = 'https://your-render-app.onrender.com' (your Render backend URL)
 * 
 * AWS ROLLBACK:
 *   API_BASE = 'http://13.63.55.73' (your AWS backend IP)
 */

// Detect environment and set API_BASE accordingly
// For local development with Live Server or file:// protocol, use empty string
// For production, set this to your backend URL

(function() {
  // Default: empty string (same-origin requests)
  // Change this to your Render backend URL for production
  window.API_BASE = '';
  
  // Alternative: Auto-detect based on hostname
  // const hostname = window.location.hostname;
  // if (hostname === 'localhost' || hostname === '127.0.0.1') {
  //   window.API_BASE = ''; // Local development
  // } else if (hostname.includes('vercel.app')) {
  //   window.API_BASE = 'https://your-render-app.onrender.com'; // Vercel -> Render
  // } else {
  //   window.API_BASE = ''; // Same-origin fallback
  // }
})();

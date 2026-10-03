(function () {
  const hostname = window.location.hostname
  const isLocal = hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    /^192\.168\.\d+\.\d+$/.test(hostname) ||
    /^10\.\d+\.\d+\.\d+$/.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(hostname)

  window.API_BASE = isLocal ? '' : 'http://13.63.55.73'
})()
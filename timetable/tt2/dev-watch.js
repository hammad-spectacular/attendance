'use strict'

/**
 * tt2 — dev server with auto-restart on save.
 *
 *   node timetable/tt2/dev-watch.js      ->   http://localhost:4011/
 *
 * WHY THIS EXISTS
 *   Node caches every `require()` in the module registry. dev-server.js pulls
 *   in store.js and routes.js, and routes.js pulls in solver.js, validator.js,
 *   wizard.js and model.js — all read once at boot. So editing any of those
 *   files changes the file on disk but NOT the running process. Until now the
 *   only way to pick up a server-side edit was to kill the server and start it
 *   again by hand.
 *
 *   This wrapper watches exactly those server-side modules and restarts the
 *   dev server whenever one is saved. Frontend files (public/*.html|css|js)
 *   are NOT watched — express.static serves them straight off disk, so a plain
 *   browser reload already picks those up.
 *
 * WHAT IS WATCHED (server-side modules only)
 *   timetable/tt2/wizard.js       timetable/solver.js
 *   timetable/tt2/model.js        timetable/validator.js
 *   timetable/tt2/routes.js
 *   timetable/tt2/store.js
 *   timetable/tt2/dev-server.js
 *
 *   Any new .js dropped directly in timetable/ or timetable/tt2/ is picked up
 *   too. timetable/public/, timetable/tt2/public/ and timetable/tt2/test/ are
 *   ignored — they are not part of the running server.
 *
 * NOTES
 *   - The child is spawned with stdio: 'inherit', so the tt2 banner and any
 *     error output still land in the terminal exactly as before.
 *   - Restart is debounced, and the child gets SIGTERM first and SIGKILL after
 *     3s, so a wedged server can never block the restart.
 *   - The child is killed with the exact process handle that was spawned, so a
 *     slow shutdown can never kill the *new* child by accident.
 */

const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const TT2_DIR = __dirname
const REPO_ROOT = path.join(TT2_DIR, '..', '..')
const SERVER_ENTRY = path.join(TT2_DIR, 'dev-server.js')

// Directories that hold server-side modules we care about.
const WATCH_DIRS = [TT2_DIR, path.join(TT2_DIR, '..')]

// Relative path fragments that must never trigger a restart.
//
// The `(^|[\\/])` prefix matters: on Windows, fs.watch reports filenames
// RELATIVE to the watched directory, so a file in timetable/tt2/public/ shows
// up as "public\app.js" — no leading separator. Matching on "/public/" alone
// would miss it and restart the server on every frontend save.
const IGNORE_PATTERNS = [
  /node_modules/,
  /_scratch_backup/,
  /(^|[\\/])public[\\/]/,
  /(^|[\\/])test[\\/]/,
  /dev-watch\.js$/,
  /(^|[\\/])routes[\\/]/
]

const DEBOUNCE_MS = 250

let child = null
let restartTimer = null
let shuttingDown = false

function log(...args) {
  console.log('[tt2 watch]', ...args)
}

function startChild() {
  child = spawn(process.execPath, [SERVER_ENTRY], {
    stdio: 'inherit',
    cwd: REPO_ROOT
  })

  child.on('exit', (code, signal) => {
    // A restart kills the child on purpose — only report exits we didn't ask for.
    if (!shuttingDown && !pendingRestart) {
      log(`dev server exited unexpectedly (code=${code} signal=${signal})`)
    }
    child = null
  })

  child.on('error', err => {
    log(`could not spawn dev server: ${err.message}`)
  })
}

let pendingRestart = false

function restart(reason) {
  if (pendingRestart) return
  pendingRestart = true
  log(`change detected (${reason}) — restarting dev server`)

  const dying = child
  child = null

  if (!dying) {
    pendingRestart = false
    startChild()
    return
  }

  const killTimer = setTimeout(() => {
    try {
      dying.kill('SIGKILL')
    } catch (_) {
      /* already gone */
    }
  }, 3000)

  dying.once('exit', () => {
    clearTimeout(killTimer)
    pendingRestart = false
    startChild()
  })

  try {
    dying.kill('SIGTERM')
  } catch (_) {
    /* already gone */
  }
}

function scheduleRestart(filename) {
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    restartTimer = null
    restart(filename)
  }, DEBOUNCE_MS)
}

function shouldWatch(filename) {
  if (!filename) return false
  const ext = path.extname(filename)
  if (ext !== '.js') return false
  const normalised = filename.split(path.sep).join('/')
  if (IGNORE_PATTERNS.some(re => re.test(normalised))) return false
  return true
}

function startWatching() {
  for (const dir of WATCH_DIRS) {
    try {
      fs.watch(dir, { recursive: true }, (eventType, filename) => {
        if (!shouldWatch(filename)) return
        scheduleRestart(filename)
      })
      log(`watching ${path.relative(REPO_ROOT, dir) || '.'} for server-side changes`)
    } catch (err) {
      log(`could not watch ${dir}: ${err.message}`)
    }
  }
}

function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  log(`received ${signal} — stopping`)
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
  if (child) {
    try {
      child.kill('SIGTERM')
    } catch (_) {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(0), 400)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

log('starting dev server with auto-restart')
startChild()
startWatching()

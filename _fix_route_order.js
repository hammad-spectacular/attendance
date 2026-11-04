'use strict'

/**
 * One-off fix: the JSON error handler and the /api catch-all 404 were
 * registered BEFORE the /api/datesheet/* and /api/complaints/* routes.
 *
 * Express matches middleware in registration order, so the catch-all answered
 * every one of those requests with 404 before their real handler could run.
 * Seven routes were dead code.
 *
 * Fix: move both middleware blocks to the very end of the file, after every
 * route registration. Nothing else is touched.
 */

const fs = require('fs')

const FILE = 'C:/Users/Hammad/Desktop/the eyeg/serverg.js'

const src = fs.readFileSync(FILE, 'utf8')
const lines = src.split(/\r?\n/)

const findLine = (pred, from = 0) => {
  for (let i = from; i < lines.length; i++) if (pred(lines[i], i)) return i
  return -1
}

const errIdx = findLine(l => l.includes("app.use('/api', (err, req, res, next) => {"))
const notFoundIdx = findLine(l => l.includes("app.use('/api', (req, res) => {"))

if (errIdx === -1 || notFoundIdx === -1) {
  console.error('Could not locate the middleware blocks — aborting, nothing changed.')
  process.exit(1)
}
if (notFoundIdx < errIdx) {
  console.error('Unexpected order (404 before error handler) — aborting, nothing changed.')
  process.exit(1)
}

// Walk back from the error handler to include its banner comment block.
let start = errIdx
while (start > 0 && lines[start - 1].trim().startsWith('//')) start--

// Walk forward from the 404 handler to its closing "})".
let end = notFoundIdx
while (end < lines.length && lines[end].trim() !== '})') end++
if (end >= lines.length) {
  console.error('Could not find the end of the catch-all block — aborting, nothing changed.')
  process.exit(1)
}

const block = lines.slice(start, end + 1)

console.log('=== MOVING THIS BLOCK TO THE END OF THE FILE ===')
console.log(block.map((l, i) => `${start + i + 1}: ${l}`).join('\n'))
console.log('=== END OF BLOCK ===')

// Sanity: the block must contain both middleware and nothing else of value.
const text = block.join('\n')
if (!text.includes("(err, req, res, next)") || !text.includes('Cannot ${req.method}')) {
  console.error('Extracted block does not look right — aborting, nothing changed.')
  process.exit(1)
}

const before = lines.slice(0, start)
const after = lines.slice(end + 1)

const trailer = [
  '',
  '',
  '// ============================================',
  '// API ERROR HANDLER + CATCH-ALL 404',
  '//',
  '// These MUST be registered after every route. Express matches middleware in',
  '// registration order, so a catch-all placed earlier answers /api/datesheet/*',
  '// and /api/complaints/* with 404 before their real handlers ever run.',
  '// ============================================',
  ...block,
  ''
]

const out = [...before, ...after, ...trailer].join('\n')
fs.writeFileSync(FILE, out, 'utf8')

console.log(`Moved ${block.length} lines from ${start + 1}-${end + 1} to the end of the file.`)
console.log(`File length: ${lines.length} -> ${out.split('\n').length} lines`)

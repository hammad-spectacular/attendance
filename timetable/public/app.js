'use strict'

/* ===========================================================================
 * Timetable module UI.
 *
 * One client for BOTH environments:
 *   - standalone dev server (timetable/dev-server.js) — dev identity picker
 *   - mounted inside The Eye — uses The Eye's existing sign-in token
 *
 * It follows The Eye's own frontend conventions: the same localStorage key
 * ('auth_token' — see public/auth-utils.js), the same optional window.API_BASE,
 * and Bearer-header fetch. No login system is duplicated here: if there is no
 * token and the server says it is NOT the dev server, we redirect to The Eye's
 * own /index.html login page.
 * =========================================================================== */

const API_BASE = (typeof window !== 'undefined' && window.API_BASE) ? window.API_BASE : ''
const API = API_BASE + '/api/timetable'
const TOKEN_KEY = 'auth_token'

const state = {
  meta: null,
  boot: null,          // bootstrap payload (tenant, config, timetable, validation)
  entries: [],         // working copy shown in the grid
  savedEntries: [],    // last server-confirmed state (for revert)
  status: 'draft',
  view: 'class',
  selectedClassId: null,
  preview: false,      // true while showing an unsaved generation
  selectedCell: null,  // { day, period }
  moveFrom: null,      // { day, period } when a move is armed
  lastValidation: null,
  readOnly: true
}

/* ------------------------------- helpers ------------------------------- */

const $ = (sel) => document.querySelector(sel)

function token() {
  return localStorage.getItem(TOKEN_KEY)
}

function toast(message, kind = '') {
  document.querySelectorAll('.toast').forEach(t => t.remove())
  const el = document.createElement('div')
  el.className = `toast ${kind}`
  el.textContent = message
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 4200)
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token()) headers.Authorization = 'Bearer ' + token()
  const res = await fetch(API + path, { ...options, headers })
  let data = {}
  try { data = await res.json() } catch (_) { /* empty body */ }
  if (res.status === 401) {
    // Token expired or invalid: in standalone this returns to the picker,
    // inside The Eye it hands over to The Eye's own login page.
    localStorage.removeItem(TOKEN_KEY)
    await boot()
    throw new Error('Your sign-in has expired. Please sign in again.')
  }
  return { res, data }
}

function nameOf(list, id) {
  const found = (list || []).find(x => String(x.id) === String(id))
  return found ? found.name : String(id)
}

function config() { return state.boot && state.boot.config }

function subjectName(id) { return nameOf(config().subjects, id) }
function teacherName(id) { return nameOf(config().teachers, id) }
function className(id) {
  const c = config().classes.find(x => String(x.id) === String(id))
  return c ? (c.section ? `${c.name} (${c.section})` : c.name) : String(id)
}

function entryAt(day, period) {
  return state.entries.find(e => e.day === day && e.period === period &&
    String(e.classId) === String(state.selectedClassId))
}

function requireWrite() {
  if (state.readOnly) { toast('Your role can view timetables but not change them.', 'error'); return false }
  return true
}

/* ------------------------------ sign-in -------------------------------- */

async function boot() {
  const metaRes = await api('/meta')
  state.meta = metaRes.data

  if (!token()) {
    if (state.meta.devAuth) return showSignin()
    window.location.replace('/index.html')
    return
  }
  await loadBootstrap()
}

async function showSignin() {
  $('#signin').classList.remove('hidden')
  $('#app').classList.add('hidden')
  const res = await fetch(API + '/dev-users')
  const users = await res.json()
  const host = $('#devUserList')
  host.innerHTML = ''
  for (const u of users) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'dev-user'
    btn.innerHTML = `<span>${u.label}</span><span class="tag">${u.role} · ${u.tenant}</span>`
    btn.onclick = async () => {
      const r = await fetch(API + '/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: u.user_id })
      })
      const body = await r.json()
      if (!r.ok) return toast(body.error || 'Sign-in failed', 'error')
      localStorage.setItem(TOKEN_KEY, body.token)
      $('#signin').classList.add('hidden')
      $('#app').classList.remove('hidden')
      await loadBootstrap()
    }
    host.appendChild(btn)
  }
}

async function loadBootstrap() {
  const { res, data } = await api('/bootstrap')
  if (!res.ok) {
    if (res.status === 403 && !state.meta.devAuth) {
      localStorage.removeItem(TOKEN_KEY)
      window.location.replace('/index.html')
      return
    }
    toast(data.error || 'Could not load timetable data', 'error')
    return
  }
  state.boot = data
  state.readOnly = !!data.readOnly

  if (data.config && !state.selectedClassId) {
    state.selectedClassId = data.config.classes[0].id
  }
  state.savedEntries = data.timetable.entries || []
  state.entries = data.timetable.entries.map(e => ({ ...e }))
  state.status = data.timetable.status
  state.lastValidation = data.validation
  state.preview = false
  state.moveFrom = null
  state.selectedCell = null

  $('#signin').classList.add('hidden')
  $('#app').classList.remove('hidden')
  $('#schoolName').textContent = data.tenant.name
  $('#whoami').textContent = `${data.user.role}${data.readOnly ? ' (read-only)' : ''}`
  render()
}

/* ------------------------------- rendering ----------------------------- */

function render() {
  renderStatus()
  renderClassSelect()
  renderToolbar()
  if (state.view === 'class') renderClassGrid()
  else renderTableView(state.view)
  renderValidation(state.lastValidation)
}

function renderStatus() {
  const badge = $('#statusBadge')
  badge.textContent = state.preview ? 'preview (unsaved)' : state.status
  badge.className = 'badge ' + (state.status === 'published' ? 'badge-published' : 'badge-draft')
}

function renderClassSelect() {
  const sel = $('#classSelect')
  sel.innerHTML = ''
  for (const c of config().classes) {
    const opt = document.createElement('option')
    opt.value = c.id
    opt.textContent = c.section ? `${c.name} (${c.section})` : c.name
    sel.appendChild(opt)
  }
  sel.value = state.selectedClassId
}

function renderToolbar() {
  const write = !state.readOnly
  for (const id of ['#btnGenerate', '#btnRegenerate', '#btnSave', '#btnPublish']) {
    $(id).disabled = !write
  }
  $('#previewBanner').classList.toggle('hidden', !state.preview)
}

function renderClassGrid() {
  const cfg = config()
  const host = $('#grid')
  host.innerHTML = ''

  const table = document.createElement('table')
  table.className = 'timetable'

  const thead = document.createElement('thead')
  const headRow = document.createElement('tr')
  headRow.innerHTML = '<th class="period-col">Period</th>' +
    cfg.days.map(d => `<th>${d}</th>`).join('')
  thead.appendChild(headRow)
  table.appendChild(thead)

  const tbody = document.createElement('tbody')
  cfg.periods.forEach((p, pi) => {
    const tr = document.createElement('tr')
    if (p.kind === 'break') tr.className = 'row-break'
    if (p.kind === 'lunch') tr.className = 'row-lunch'

    const th = document.createElement('th')
    th.innerHTML = `<span class="period-label">${p.label}</span>` +
      (p.start ? `<span class="period-time">${p.start}–${p.end || ''}</span>` : '')
    tr.appendChild(th)

    if (p.kind !== 'teaching') {
      const td = document.createElement('td')
      td.colSpan = cfg.days.length
      td.textContent = p.label
      tr.appendChild(td)
      tbody.appendChild(tr)
      return
    }

    cfg.days.forEach((d, di) => {
      const td = document.createElement('td')
      td.className = 'cell'
      const lesson = entryAt(di, pi)
      if (lesson) {
        td.innerHTML =
          `<div class="lesson">
             <span class="subject">${escapeHtml(subjectName(lesson.subjectId))}</span>
             <span class="teacher">${escapeHtml(teacherName(lesson.teacherId))}</span>
             ${lesson.locked ? '<span class="lock">🔒 locked</span>' : ''}
           </div>`
        if (lesson.locked) td.classList.add('locked')
      } else {
        td.innerHTML = '<span class="cell-empty">free</span>'
      }

      if (!state.readOnly) {
        td.classList.add('editable')
        if (state.selectedCell && state.selectedCell.day === di && state.selectedCell.period === pi) {
          td.classList.add('selected')
        }
        if (state.moveFrom && state.moveFrom.day === di && state.moveFrom.period === pi) {
          td.classList.add('move-source')
        } else if (state.moveFrom) {
          td.classList.add('move-target')
        }
        td.onclick = () => onCellClick(di, pi)
      }
      tr.appendChild(td)
    })
    tbody.appendChild(tr)
  })

  table.appendChild(tbody)
  host.appendChild(table)

  if (state.view !== 'class') { /* nothing */ }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ))
}

async function renderTableView(by) {
  const host = $('#grid')
  host.innerHTML = '<p class="muted small">Loading view…</p>'
  const { res, data } = await api('/view?by=' + by)
  if (!res.ok) { host.innerHTML = `<p class="error-box">${escapeHtml(data.error || 'Failed to load')}</p>`; return }
  host.innerHTML = ''

  const table = document.createElement('table')
  table.className = 'view-table'

  if (by === 'teacher') {
    table.innerHTML =
      '<thead><tr><th>Teacher</th><th>Lessons / week</th><th>Daily load</th><th>Assigned lessons</th></tr></thead>'
    const tbody = document.createElement('tbody')
    for (const r of data.rows) {
      const daily = Object.entries(r.byDay).map(([d, n]) => `${d.slice(0, 3)}: ${n}`).join(' · ')
      const assigned = r.slots
        .map(s => `${config().days[s.day].slice(0, 3)} ${config().periods[s.period].label} → ${className(s.classId)} (${subjectName(s.subjectId)})`)
        .join('<br>') || '<span class="muted">—</span>'
      const limit = r.maxPerWeek !== null ? `${r.lessons} / ${r.maxPerWeek}` : String(r.lessons)
      const tr = document.createElement('tr')
      tr.innerHTML =
        `<td>${escapeHtml(r.name)}</td>
         <td class="${r.overWeekLimit ? 'overview-short' : ''}">${limit}${r.overWeekLimit ? ' ⚠ over limit' : ''}</td>
         <td class="small">${daily}</td>
         <td class="small">${assigned}</td>`
      tbody.appendChild(tr)
    }
    table.appendChild(tbody)
  }

  if (by === 'room') {
    table.innerHTML = '<thead><tr><th>Room</th><th>Bookings</th><th>Slots</th></tr></thead>'
    const tbody = document.createElement('tbody')
    for (const r of data.rows) {
      const slots = r.slots
        .map(s => `${config().days[s.day].slice(0, 3)} ${config().periods[s.period].label} → ${className(s.classId)}`)
        .join('<br>') || '<span class="muted">—</span>'
      const tr = document.createElement('tr')
      tr.innerHTML = `<td>${escapeHtml(r.name)}</td><td>${r.bookings}</td><td class="small">${slots}</td>`
      tbody.appendChild(tr)
    }
    table.appendChild(tbody)
  }

  if (by === 'school') {
    const days = data.days
    table.innerHTML = '<thead><tr><th>Class</th>' + days.map(d => `<th>${d}</th>`).join('') + '<th>Week</th></tr></thead>'
    const tbody = document.createElement('tbody')
    for (const r of data.rows) {
      const cells = days.map(d => {
        const n = r.byDay[d] || 0
        return `<td class="${n ? '' : 'muted'}">${n || '·'}</td>`
      }).join('')
      const required = config().requirements
        .filter(req => String(req.classId) === String(r.classId))
        .reduce((s, req) => s + req.periodsPerWeek, 0)
      const cls = r.lessons >= required ? 'overview-ok' : 'overview-short'
      const tr = document.createElement('tr')
      tr.innerHTML = `<td>${escapeHtml(r.name)}${r.section ? ' (' + r.section + ')' : ''}</td>${cells}<td class="${cls}">${r.lessons}/${required}</td>`
      tbody.appendChild(tr)
    }
    table.appendChild(tbody)
  }

  host.appendChild(table)
}

/* ------------------------------ validation ----------------------------- */

function renderValidation(validation, extraMessages = []) {
  const host = $('#validationList')
  host.innerHTML = ''

  for (const msg of extraMessages) {
    const div = document.createElement('div')
    div.className = 'error-box'
    div.textContent = msg
    host.appendChild(div)
  }

  if (!validation) {
    host.insertAdjacentHTML('beforeend', '<p class="small muted">No report yet. Press Validate, Save or Publish.</p>')
    updateMeter(null)
    return
  }

  const v = validation
  if (v.ok && v.totals.scheduled >= v.totals.required) {
    host.insertAdjacentHTML('beforeend',
      `<div class="ok-note">Valid: ${v.totals.scheduled} of ${v.totals.required} required lessons scheduled, no conflicts.</div>`)
  } else {
    for (const h of v.hard || []) {
      const div = document.createElement('div')
      div.className = 'violation'
      div.textContent = h.message || h.code
      host.appendChild(div)
    }
  }
  // Soft penalties are informational — they never block anything.
  const soft = (v.soft || []).slice(0, 8)
  for (const s of soft) {
    const div = document.createElement('div')
    div.className = 'penalty'
    div.textContent = 'Preference: ' + (s.message || s.code)
    host.appendChild(div)
  }
  if ((v.soft || []).length > soft.length) {
    host.insertAdjacentHTML('beforeend',
      `<p class="small muted">…and ${v.soft.length - soft.length} more preference notes</p>`)
  }

  updateMeter(v)
}

function updateMeter(v) {
  const fill = $('#meterFill')
  const text = $('#meterText')
  if (!v || !v.totals || !v.totals.required) {
    fill.style.width = '0%'
    text.textContent = '—'
    return
  }
  const pct = Math.min(100, Math.round((v.totals.scheduled / v.totals.required) * 100))
  fill.style.width = pct + '%'
  fill.classList.toggle('warn', pct < 100)
  text.textContent = `${v.totals.scheduled} / ${v.totals.required} lessons scheduled (${pct}%)`
}

function setStats(text) { $('#statsText').textContent = text }

/* ----------------------------- cell editing ---------------------------- */

function onCellClick(day, period) {
  if (!requireWrite()) return

  // Second click of a move: drop the lesson here — but never silently destroy
  // whatever was already in the destination cell.
  if (state.moveFrom) {
    const source = entryAt(state.moveFrom.day, state.moveFrom.period)
    const target = entryAt(day, period)
    if (source && target && source !== target) {
      toast(`That slot already has ${subjectName(target.subjectId)} — clear or move it first`, 'error')
      return // keep the move armed so the user can pick another slot
    }
    if (source && source !== target) {
      state.entries = state.entries.filter(e => e !== source)
      state.entries.push({ ...source, day, period })
    }
    state.moveFrom = null
    state.selectedCell = { day, period }
    render()
    renderEditor()
    save('Moved')
    return
  }

  state.selectedCell = { day, period }
  render()
  renderEditor()
}

function renderEditor() {
  const host = $('#editor')
  if (!state.selectedCell) {
    host.innerHTML = '<p class="small muted">Select a cell in the grid to edit, move, lock or clear it.</p>'
    return
  }
  const cfg = config()
  const { day, period } = state.selectedCell
  const existing = entryAt(day, period)
  const where = `${cfg.days[day]} · ${cfg.periods[period].label}`

  // Requirements for this class: how many periods each subject still needs.
  const counts = {}
  state.entries.forEach(e => {
    counts[e.subjectId] = (counts[e.subjectId] || 0) + 1
  })
  const reqs = cfg.requirements.filter(r => String(r.classId) === String(state.selectedClassId))

  let html = `<div class="where">${escapeHtml(where)} — ${escapeHtml(className(state.selectedClassId))}</div>`

  if (existing) {
    html += `
      <div class="row"><strong>${escapeHtml(subjectName(existing.subjectId))}</strong></div>
      <div class="row"><span class="muted small">${escapeHtml(teacherName(existing.teacherId))}</span></div>
      <div class="row">
        <button class="btn" type="button" id="edMove">Move…</button>
        <button class="btn" type="button" id="edLock">${existing.locked ? 'Unlock' : 'Lock'}</button>
        <button class="btn btn-danger" type="button" id="edClear">Clear</button>
      </div>`
  } else {
    const subjectOptions = reqs.map(r =>
      `<option value="${escapeHtml(String(r.subjectId))}">${escapeHtml(subjectName(r.subjectId))} (${counts[r.subjectId] || 0}/${r.periodsPerWeek})</option>`
    ).join('')
    html += `
      <div class="row"><select id="edSubject">${subjectOptions || '<option value="">No subjects required</option>'}</select></div>
      <div class="row"><select id="edTeacher"><option>Loading…</option></select></div>
      <div class="row"><button class="btn btn-primary" type="button" id="edApply">Add lesson</button></div>`
  }
  host.innerHTML = html

  if (existing) {
    $('#edMove').onclick = () => { state.moveFrom = { day, period }; render() ; toast('Now click the destination cell', 'ok') }
    $('#edLock').onclick = () => {
      existing.locked = !existing.locked
      render(); save(existing.locked ? 'Lesson locked' : 'Lesson unlocked')
    }
    $('#edClear').onclick = () => {
      state.entries = state.entries.filter(e => e !== existing)
      state.selectedCell = null
      render(); save('Lesson removed')
    }
  } else {
    const subjectSel = $('#edSubject')
    const teacherSel = $('#edTeacher')
    const fillTeachers = () => {
      const subjectId = subjectSel.value
      const req = reqs.find(r => String(r.subjectId) === String(subjectId))
      const eligible = cfg.teachers.filter(t => (t.subjectIds || []).some(id => String(id) === String(subjectId)))
        .filter(t => !req || !req.teacherIds || req.teacherIds.some(id => String(id) === String(t.id)))
      teacherSel.innerHTML = eligible.map(t =>
        `<option value="${escapeHtml(String(t.id))}">${escapeHtml(t.name)}</option>`).join('') ||
        '<option value="">No qualified teacher</option>'
    }
    subjectSel.onchange = fillTeachers
    fillTeachers()
    $('#edApply').onclick = () => {
      if (!subjectSel.value || !teacherSel.value) return toast('Pick a subject and a teacher', 'error')
      state.entries.push({
        classId: state.selectedClassId,
        day, period,
        subjectId: isNaN(Number(subjectSel.value)) ? subjectSel.value : Number(subjectSel.value),
        teacherId: isNaN(Number(teacherSel.value)) ? teacherSel.value : Number(teacherSel.value),
        locked: false
      })
      render(); save('Lesson added')
    }
  }
}

/* ------------------------------ persistence ---------------------------- */

async function save(successMessage) {
  const { res, data } = await api('/entries', {
    method: 'PUT',
    body: JSON.stringify({ entries: state.entries })
  })

  if (res.status === 409) {
    // Backend rejected the edit — show exactly why and roll back to the last
    // state the server accepted.
    state.entries = state.savedEntries.map(e => ({ ...e }))
    state.selectedCell = null
    state.moveFrom = null
    state.preview = false
    render()
    renderValidation(data.validation, (data.violations || []).map(v => v.message || v.code))
    toast(data.error || 'Conflict — change rejected', 'error')
    return false
  }
  if (!res.ok) {
    toast(data.error || 'Save failed', 'error')
    return false
  }

  state.savedEntries = data.timetable.entries.map(e => ({ ...e }))
  state.entries = data.timetable.entries.map(e => ({ ...e }))
  state.status = data.timetable.status
  state.lastValidation = data.validation
  state.preview = false
  render()
  if (successMessage) toast(successMessage + ' (draft saved)', 'ok')
  setStats(`Saved ${state.entries.length} cells at ${new Date(data.timetable.updatedAt).toLocaleTimeString()}`)
  return true
}

/* ------------------------------- actions ------------------------------- */

async function doGenerate(keepLocked) {
  if (!requireWrite()) return
  const btn = keepLocked ? $('#btnRegenerate') : $('#btnGenerate')
  btn.disabled = true
  btn.textContent = 'Generating…'
  try {
    const { res, data } = await api('/generate', {
      method: 'POST',
      body: JSON.stringify({ keepLocked: !!keepLocked })
    })
    if (!res.ok) return toast(data.error || 'Generation failed', 'error')

    if (!data.ok) {
      state.lastValidation = data.validation
      render()
      renderValidation(data.validation, [
        'No valid timetable could be found. ' + (data.diagnostics || []).join(' ')
      ])
      toast('Generation failed — see the Validation panel for why', 'error')
      return
    }

    state.entries = data.entries.map(e => ({ ...e }))
    state.preview = true
    state.selectedCell = null
    state.moveFrom = null
    state.lastValidation = data.validation
    state.view = 'class'
    syncTabs()
    render()
    setStats(`Generated ${data.stats.scheduledLessons}/${data.stats.requiredLessons} lessons in ${data.stats.generationMs} ms ` +
      `(${data.stats.nodeCount} search nodes, ${data.locksUsed} locks kept)`)
    toast('Generated — review the preview, then accept or discard', 'ok')
  } finally {
    btn.disabled = state.readOnly
    btn.textContent = keepLocked ? 'Regenerate (keep locks)' : 'Generate (automatic)'
  }
}

async function doAccept() {
  const ok = await save('Preview accepted')
  if (ok) toast('Preview saved as a draft', 'ok')
}

function doDiscard() {
  state.entries = state.savedEntries.map(e => ({ ...e }))
  state.preview = false
  state.selectedCell = null
  state.lastValidation = state.boot.validation
  render()
  toast('Preview discarded — showing the saved draft', 'ok')
}

async function doValidate() {
  const { res, data } = await api('/validate', {
    method: 'POST',
    body: JSON.stringify({ entries: state.entries })
  })
  if (!res.ok) return toast(data.error || 'Validation failed', 'error')
  state.lastValidation = data.validation
  renderValidation(data.validation)
  toast(data.validation.ok ? 'No conflicts found' : `${data.validation.hard.length} problem(s) found`,
    data.validation.ok ? 'ok' : 'error')
}

async function doPublish() {
  if (!requireWrite()) return
  if (state.preview) return toast('Accept or discard the preview first', 'error')
  const { res, data } = await api('/publish', { method: 'POST', body: JSON.stringify({}) })
  if (!res.ok) {
    renderValidation(data.validation, [data.error || 'Publish rejected'])
    toast(data.error || 'Publish rejected', 'error')
    return
  }
  state.status = 'published'
  state.lastValidation = data.validation
  render()
  toast('Timetable published', 'ok')
}

function syncTabs() {
  document.querySelectorAll('#viewTabs .tab').forEach(t => {
    t.classList.toggle('active', t.dataset.view === state.view)
  })
  $('#classWrap').style.display = state.view === 'class' ? '' : 'none'
}

/* -------------------------------- wiring ------------------------------- */

function wire() {
  document.querySelectorAll('#viewTabs .tab').forEach(tab => {
    tab.onclick = () => {
      state.view = tab.dataset.view
      state.moveFrom = null
      syncTabs()
      render()
    }
  })

  $('#classSelect').onchange = (e) => {
    state.selectedClassId = e.target.value
    state.selectedCell = null
    state.moveFrom = null
    render()
    renderEditor()
  }

  $('#btnGenerate').onclick = () => doGenerate(false)
  $('#btnRegenerate').onclick = () => doGenerate(true)
  $('#btnSave').onclick = () => { if (requireWrite()) save('Saved') }
  $('#btnValidate').onclick = doValidate
  $('#btnPublish').onclick = doPublish
  $('#btnAccept').onclick = doAccept
  $('#btnDiscard').onclick = doDiscard
  $('#btnPrint').onclick = () => window.print()
  $('#btnSignout').onclick = () => {
    localStorage.removeItem(TOKEN_KEY)
    if (state.meta && state.meta.devAuth) window.location.reload()
    else window.location.replace('/index.html')
  }
}

/* --------------------------------- init -------------------------------- */

async function init() {
  wire()
  try {
    await boot()
  } catch (err) {
    console.error(err)
    toast(err.message || 'Could not start the timetable module', 'error')
  }
}

document.addEventListener('DOMContentLoaded', init)

/* ==========================================================================
   tt2 — Timetable Builder (client)
   Vanilla JS, no build step. The server owns validation; this file renders
   whatever the server says and collects the answers to the setup questions.
   ========================================================================== */
'use strict'

/* ---------------------------------------------------------------- state -- */

const state = {
  screen: 'list',
  meta: null,
  config: null,
  step: 0,
  stepIds: [],
  docId: null,
  doc: null,
  view: 'classes',
  activeClassId: null,
  activeTeacherId: null,
  readiness: { errors: [], warnings: [], canGenerate: false },
  busy: false,
  existingClasses: [],
  fetchedExistingClasses: false,
  quickClassCount: 2,
  cornerErrorMinimized: false
}

let checkTimer = null

/* ------------------------------------------------------------------ api -- */

async function api(path, options = {}) {
  const res = await fetch(`/api/tt2${path}`, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined
  })
  let data = null
  try { data = await res.json() } catch (_) { data = null }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`)
    err.payload = data
    err.status = res.status
    throw err
  }
  return data
}

async function fetchExistingClasses() {
  if (state.fetchedExistingClasses) return
  state.fetchedExistingClasses = true
  try {
    const res = await api('/existing-classes')
    if (res && Array.isArray(res.classes)) {
      state.existingClasses = res.classes
      if (state.screen === 'wizard' && state.meta && state.meta.steps[state.step] && state.meta.steps[state.step].id === 'classes') {
        renderWizard()
      }
    }
  } catch (_) {
    state.existingClasses = []
  }
}

function checkClassDuplicates(classes) {
  const seen = new Set()
  for (const c of classes) {
    const key = `${(c.name || '').trim().toLowerCase()}:::${(c.section || '').trim().toLowerCase()}`
    if (seen.has(key)) return { duplicate: true, class: c }
    seen.add(key)
  }
  return { duplicate: false }
}

function getStepErrors(stepId) {
  const errs = (state.readiness && state.readiness.errors) || []
  switch (stepId) {
    case 'identity':
      return errs.filter(e => e.toLowerCase().includes('school name'))
    case 'week':
      return errs.filter(e => e.toLowerCase().includes('working day'))
    case 'periods':
      return errs.filter(e => e.toLowerCase().includes('period') || e.toLowerCase().includes('duration') || e.toLowerCase().includes('break'))
    case 'classes':
      return errs.filter(e => e.toLowerCase().includes('class'))
    case 'subjects':
      return errs.filter(e => e.toLowerCase().includes('subject'))
    case 'teachers':
      return errs.filter(e => e.toLowerCase().includes('teacher'))
    case 'rooms':
      return errs.filter(e => e.toLowerCase().includes('room'))
    case 'curriculum':
      return errs.filter(e => e.toLowerCase().includes('curriculum') || e.toLowerCase().includes('teaching slots'))
    case 'preferences':
      return errs.filter(e => e.toLowerCase().includes('preference'))
    default:
      return []
  }
}

function toast(message, kind = '') {
  const el = document.getElementById('toast')
  el.textContent = message
  el.className = `toast ${kind}`
  el.hidden = false
  clearTimeout(el._timer)
  el._timer = setTimeout(() => { el.hidden = true }, 3600)
}

/* -------------------------------------------------------------- helpers -- */

const esc = value => String(value === null || value === undefined ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const uid = prefix => `${prefix}_${Math.random().toString(36).slice(2, 8)}`

function getPath(path) {
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), state.config)
}

function setPath(path, value) {
  const keys = path.split('.')
  const last = keys.pop()
  const target = keys.reduce((acc, key) => {
    if (acc[key] == null) acc[key] = {}
    return acc[key]
  }, state.config)
  target[last] = value
}

/** Read a value that may be a number-ish string from an input. */
function readValue(el) {
  if (el.type === 'number') {
    if (el.value === '') return el.hasAttribute('data-empty-null') ? null : 0
    return Number(el.value)
  }
  if (el.type === 'checkbox') return el.checked
  return el.value
}

/* --------------------------------------------------------------- wizard -- */

function scheduleCheck() {
  clearTimeout(checkTimer)
  checkTimer = setTimeout(runCheck, 220)
}

async function runCheck() {
  try {
    const res = await api('/check', { method: 'POST', body: { config: state.config } })
    state.readiness = { errors: res.errors, warnings: res.warnings, canGenerate: res.canGenerate }
  } catch (err) {
    state.readiness = { errors: [err.message], warnings: [], canGenerate: false }
  }
  renderReadiness()
  updateGenerateButton()
}

function renderReadiness() {
  const el = document.getElementById('readiness')
  const { errors, warnings } = state.readiness
  let html = ''

  if (!errors.length && !warnings.length) {
    html += `<div class="r-line ok"><span>✓</span><span>Everything is answered. Ready to generate.</span></div>`
  } else {
    if (errors.length) {
      html += `<div class="r-line err"><span>✕</span><span>${errors.length} thing${errors.length > 1 ? 's' : ''} still to fix</span></div>`
      html += `<ul>${errors.slice(0, 6).map(e => `<li>${esc(e)}</li>`).join('')}</ul>`
      if (errors.length > 6) html += `<div class="r-line err"><span>…</span><span>and ${errors.length - 6} more</span></div>`
    }
    if (warnings.length) {
      html += `<div class="r-line warn"><span>!</span><span>${warnings.length} warning${warnings.length > 1 ? 's' : ''}</span></div>`
      html += `<ul>${warnings.slice(0, 4).map(e => `<li>${esc(e)}</li>`).join('')}</ul>`
    }
  }

  el.innerHTML = html
}

function updateGenerateButton() {
  const btn = document.getElementById('btn-generate')
  if (!btn) return
  btn.disabled = !state.readiness.canGenerate || state.busy
  btn.title = state.readiness.canGenerate
    ? 'Generate the timetable'
    : 'Answer the remaining questions first'
}

/* ---------------------------------------------------------- step render -- */

const stepRenderers = {

  identity: () => `
    <div class="card">
      <h4>Who is this for?</h4>
      <label class="field">
        <span>School name *</span>
        <input type="text" data-bind="schoolName" value="${esc(state.config.schoolName)}" placeholder="e.g. Greenwood Academy">
      </label>
      <label class="field">
        <span>Branch / campus</span>
        <input type="text" data-bind="branchName" value="${esc(state.config.branchName)}" placeholder="e.g. North Campus (optional)">
        <small>Leave blank if the school has only one campus.</small>
      </label>
    </div>`,

  week: () => `
    <div class="card">
      <h4>Working days</h4>
      <p class="muted" style="margin-bottom:12px">Tap every day the school is open. The timetable is built for these days only.</p>
      <div class="day-set">
        ${(state.meta.allDays).map(d => `
          <button class="chip ${state.config.days.includes(d) ? 'on' : ''}" data-act="toggle-day" data-day="${esc(d)}">
            ${esc(d.slice(0, 3))}
          </button>`).join('')}
      </div>
    </div>
    <div class="card">
      <h4>Summary</h4>
      <p class="muted">${state.config.days.length} working day${state.config.days.length === 1 ? '' : 's'}:
        ${state.config.days.map(d => `<b>${esc(d.slice(0, 3))}</b>`).join(', ')}.</p>
    </div>`,

  periods: () => {
    const cfg = state.config
    // Calculate school end time from startTime, periodCount, periodDuration and breaks
    function calcEndTime() {
      try {
        const [h, m] = cfg.startTime.split(':').map(Number)
        let totalMins = h * 60 + m
        for (let i = 1; i <= cfg.periodCount; i++) {
          const override = cfg.periodOverrides && cfg.periodOverrides[String(i)]
          totalMins += override || cfg.periodDuration
          const brk = cfg.breaks.find(b => b.afterPeriod === i)
          if (brk) totalMins += brk.duration
        }
        const endH = Math.floor(totalMins / 60) % 24
        const endM = totalMins % 60
        return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`
      } catch (_) { return '—' }
    }
    const endTime = calcEndTime()
    return `
    <div class="card">
      <h4>Length of a class</h4>
      <div class="row">
        <label class="field">
          <span>Class duration (minutes) *</span>
          <input type="number" min="15" max="180" step="5" data-bind="periodDuration" value="${cfg.periodDuration}">
          <small>The usual length of one period. Every period starts with this value.</small>
        </label>
        <label class="field">
          <span>Teaching periods per day *</span>
          <input type="number" min="1" max="12" step="1" data-bind="periodCount" value="${cfg.periodCount}">
          <small>Excludes breaks and lunch.</small>
        </label>
        <label class="field">
          <span>School starts at</span>
          <input type="time" data-bind="startTime" value="${esc(cfg.startTime)}">
          <small>When the first period begins.</small>
        </label>
        <label class="field">
          <span>School ends at (calculated)</span>
          <input type="time" value="${endTime}" disabled style="opacity:0.6;cursor:not-allowed">
          <small>Automatically calculated from start, ${cfg.periodCount} period${cfg.periodCount === 1 ? '' : 's'} × ${cfg.periodDuration} min + breaks.</small>
        </label>
      </div>
    </div>

    <div class="card">
      <h4>Breaks & lunch</h4>
      <p class="muted" style="margin-bottom:12px">Breaks sit between periods and take their own column. They are not teaching periods.</p>
      ${cfg.breaks.map((b, i) => `
        <div class="item-row">
          <div class="grow">
            <div class="row tight">
              <input type="text" data-list="breaks" data-id="${esc(b.id)}" data-field="label" value="${esc(b.label)}" placeholder="Lunch">
              <label class="field" style="margin:0">
                <span>After period</span>
                <input type="number" min="1" max="${cfg.periodCount}" data-list="breaks" data-id="${esc(b.id)}" data-field="afterPeriod" value="${b.afterPeriod}">
              </label>
              <label class="field" style="margin:0">
                <span>Minutes</span>
                <input type="number" min="0" max="120" data-list="breaks" data-id="${esc(b.id)}" data-field="duration" value="${b.duration}">
              </label>
            </div>
          </div>
          <button class="btn btn-sm btn-danger" data-act="del-break" data-id="${esc(b.id)}">✕</button>
        </div>`).join('') || '<p class="muted">No breaks configured.</p>'}
      <div class="add-row">
        <button class="btn btn-sm" data-act="add-break">+ Add a break</button>
      </div>
    </div>

    <div class="card">
      <h4>Different length for a specific period</h4>
      <p class="muted" style="margin-bottom:12px">Optional — for example a longer double period or a shorter assembly slot.</p>
      ${Object.keys(cfg.periodOverrides).length
        ? Object.entries(cfg.periodOverrides).map(([k, v]) => `
          <div class="item-row">
            <div class="grow row tight">
              <label class="field" style="margin:0"><span>Period</span>
                <input type="number" min="1" max="${cfg.periodCount}" data-override="period" value="${esc(k)}"></label>
              <label class="field" style="margin:0"><span>Minutes</span>
                <input type="number" min="15" max="180" data-override="duration" value="${v}"></label>
            </div>
            <button class="btn btn-sm btn-danger" data-act="del-override" data-key="${esc(k)}">✕</button>
          </div>`).join('')
        : '<p class="muted">Every period uses the same duration.</p>'}
      <div class="add-row">
        <button class="btn btn-sm" data-act="add-override">+ Override one period</button>
      </div>
    </div>`
  },

  classes: () => {
    fetchExistingClasses()
    const cfg = state.config
    const dupInfo = checkClassDuplicates(cfg.classes)
    return `
    <div class="card" style="margin-bottom:14px">
      <h4>🏫 Choose from existing school classes</h4>
      <p class="muted" style="margin-bottom:12px">
        Select which classes to generate a timetable for. Only classes already existing in the school database can be selected.
      </p>
      ${state.existingClasses && state.existingClasses.length ? `
      <div class="chip-set" style="margin-bottom:14px">
        ${state.existingClasses.map(ec => {
          const isSelected = cfg.classes.some(c =>
            String(c.id) === String(ec.id) ||
            String(c.id) === `class_${ec.id}` ||
            (c.name.trim().toLowerCase() === ec.name.trim().toLowerCase() &&
             (c.section || '').trim().toLowerCase() === (ec.section || '').trim().toLowerCase())
          )
          return `<label class="chip ${isSelected ? 'on' : ''}" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px">
            <input type="checkbox" data-act="toggle-existing-class" data-id="${esc(ec.id)}" data-name="${esc(ec.name)}" data-section="${esc(ec.section || '')}" ${isSelected ? 'checked' : ''} style="margin:0">
            <span>${esc(ec.name)}${ec.section ? ` (${esc(ec.section)})` : ''}</span>
          </label>`
        }).join('')}
      </div>` : `
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:12px;color:#991b1b;font-size:13px;margin-bottom:12px">
        ⚠️ No classes found in the school system database. Please add your school classes in the Admin Classes section first.
      </div>`}
    </div>

    <div class="card">
      <h4>Selected Classes for Timetable (${cfg.classes.length})</h4>
      <p class="muted" style="margin-bottom:6px">Each selected class gets its own timetable.</p>
      ${dupInfo.duplicate ? `
        <div style="background:var(--bad-soft);border:1px solid var(--bad);border-radius:6px;padding:8px 12px;margin-bottom:12px;color:var(--bad);font-size:13px">
          ⚠️ Duplicate class section: <b>"${esc(dupInfo.class.name)}" (Section "${esc(dupInfo.class.section || 'None')}")</b> already exists.
        </div>` : ''}
      ${cfg.classes.length ? `
      <div class="row tight" style="margin-bottom:6px;padding:0 4px">
        <span style="flex:1 1 0;font-size:12px;font-weight:600;color:var(--ink-2)">Class name</span>
        <span style="width:110px;font-size:12px;font-weight:600;color:var(--ink-2)">Section</span>
        <span style="width:100px;font-size:12px;font-weight:600;color:var(--ink-2)">Students</span>
        <span style="width:32px"></span>
      </div>
      ${cfg.classes.map(c => `
        <div class="item-row">
          <div class="grow row tight">
            <input type="text" value="${esc(c.name)}" disabled style="background:#f8fafc;cursor:not-allowed">
            <input type="text" value="${esc(c.section || '—')}" disabled style="max-width:110px;background:#f8fafc;cursor:not-allowed">
            <input type="number" min="0" data-list="classes" data-id="${esc(c.id)}" data-field="studentCount" value="${c.studentCount}" placeholder="0" style="max-width:100px">
          </div>
          <button class="btn btn-sm btn-danger" data-act="del-class" data-id="${esc(c.id)}" title="Remove from timetable">✕</button>
        </div>`).join('')}` : '<p class="muted">No classes selected yet. Tick classes from the list above.</p>'}
    </div>`
  },

  subjects: () => {
    const classLabels = state.config.classes.map(c => c.section ? `${esc(c.name)} (${esc(c.section)})` : esc(c.name)).join(', ') || 'None selected'
    return `
    <div class="card" style="margin-bottom:14px;background:#fefce8;border:1px solid #fef08a">
      <h4 style="color:#854d0e">📚 Subjects for Selected Classes</h4>
      <p style="font-size:13px;color:#713f12;margin-top:4px">
        These subjects apply to your selected classes: <b>${classLabels}</b>.<br>
        In the Curriculum step, you will specify the exact number of periods each class gets for each subject.
      </p>
    </div>
    <div class="card">
      <h4>Subjects</h4>
      <p class="muted" style="margin-bottom:14px">
        Mark a subject <b>difficult</b> (such as Mathematics or Physics) so two difficult subjects are never scheduled back to back. Sports, Music, and Labs can be marked Easy or Medium to space out tough subjects.
      </p>
      ${state.config.subjects.map(s => `
        <div class="item-row">
          <div class="grow row tight">
            <input type="text" data-list="subjects" data-id="${esc(s.id)}" data-field="name" value="${esc(s.name)}" placeholder="Subject">
            <select data-list="subjects" data-id="${esc(s.id)}" data-field="difficult" style="max-width:150px">
              ${state.meta.difficulties.map(d => `<option value="${d}" ${s.difficult === d ? 'selected' : ''}>${d[0].toUpperCase() + d.slice(1)}</option>`).join('')}
            </select>
            <select data-list="subjects" data-id="${esc(s.id)}" data-field="roomId" style="max-width:170px">
              <option value="">Any room</option>
              ${state.config.rooms.map(r => `<option value="${esc(r.id)}" ${s.roomId === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-sm btn-danger" data-act="del-subject" data-id="${esc(s.id)}">✕</button>
        </div>`).join('') || '<p class="muted">No subjects yet.</p>'}
      <div class="add-row">
        <button class="btn btn-sm" data-act="add-subject">+ Add a subject</button>
      </div>
    </div>`
  },

  teachers: () => {
    const cfg = state.config
    return `
    <div class="card">
      <h4>Teachers &amp; their subjects</h4>
      <div class="hint">
        A teacher can teach <b>two or three subjects</b> — tick every subject they are responsible for.
        The generator will spread their workload across the week.
      </div>
      <div class="hint" style="margin-top:8px;font-size:12.5px;color:var(--ink-3)">
        <b>Max periods per day</b> — the most classes a teacher teaches in a single school day (leave blank for no limit).<br>
        <b>Max periods per week</b> — the most classes a teacher teaches across the entire week (leave blank for no limit).
      </div>
      ${cfg.teachers.map(t => `
        <div class="item-row">
          <div class="grow">
            <div class="row tight">
              <input type="text" data-list="teachers" data-id="${esc(t.id)}" data-field="name" value="${esc(t.name)}" placeholder="Teacher name" style="max-width:240px">
              <label class="field" style="margin:0;flex:0 0 180px">
                <span>Max periods per day</span>
                <input type="number" min="0" max="${cfg.periodCount}" data-empty-null="1" data-list="teachers" data-id="${esc(t.id)}" data-field="maxPerDay" value="${t.maxPerDay === null ? '' : t.maxPerDay}" placeholder="No limit">
              </label>
              <label class="field" style="margin:0;flex:0 0 180px">
                <span>Max periods per week</span>
                <input type="number" min="0" max="60" data-empty-null="1" data-list="teachers" data-id="${esc(t.id)}" data-field="maxPerWeek" value="${t.maxPerWeek === null ? '' : t.maxPerWeek}" placeholder="No limit">
              </label>
              <button class="btn btn-sm btn-danger" data-act="del-teacher" data-id="${esc(t.id)}">✕</button>
            </div>

            <div class="sub">
              <div>
                <span class="muted" style="font-size:12px;font-weight:600">Subjects taught</span>
                <div class="chip-set" style="margin-top:5px">
                  ${cfg.subjects.length ? cfg.subjects.map(s => `
                    <button class="chip sm ${t.subjectIds.includes(s.id) ? 'on' : ''}"
                            data-act="toggle-teacher-subject" data-teacher="${esc(t.id)}" data-subject="${esc(s.id)}">${esc(s.name)}</button>`).join('')
                    : '<span class="muted">Add subjects in the previous step first.</span>'}
                </div>
              </div>
            </div>

            <details style="margin-top:10px">
              <summary class="muted" style="cursor:pointer;font-size:12.5px">
                Unavailable slots${t.unavailableSlots.length ? ` (${t.unavailableSlots.length})` : ''}
              </summary>
              <div class="matrix-wrap" style="margin-top:8px">
                <table class="matrix">
                  <thead><tr><th></th>${Array.from({ length: cfg.periodCount }, (_, i) => `<th>P${i + 1}</th>`).join('')}</tr></thead>
                  <tbody>
                    ${cfg.days.map((d, di) => `
                      <tr>
                        <th>${esc(d.slice(0, 3))}</th>
                        ${Array.from({ length: cfg.periodCount }, (_, pi) => {
                          const on = t.unavailableSlots.some(s => s.day === di && s.period === pi + 1)
                          return `<td class="num"><button class="chip sm ${on ? 'on' : ''}"
                            data-act="toggle-unavailable" data-teacher="${esc(t.id)}" data-day="${di}" data-period="${pi + 1}"
                            title="Mark unavailable">${on ? '✕' : ''}</button></td>`
                        }).join('')}
                      </tr>`).join('')}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        </div>`).join('') || '<p class="muted">No teachers yet.</p>'}
      <div class="add-row">
        <button class="btn btn-sm" data-act="add-teacher">+ Add a teacher</button>
      </div>
    </div>`
  },

  rooms: () => `
    <div class="card">
      <h4>Rooms &amp; labs</h4>
      <p class="muted" style="margin-bottom:14px">
        Optional. Only needed when the school has more than one room, or a subject needs a specialist lab.
      </p>
      ${state.config.rooms.map(r => `
        <div class="item-row">
          <div class="grow"><input type="text" data-list="rooms" data-id="${esc(r.id)}" data-field="name" value="${esc(r.name)}" placeholder="Room name"></div>
          <button class="btn btn-sm btn-danger" data-act="del-room" data-id="${esc(r.id)}">✕</button>
        </div>`).join('') || '<p class="muted">No rooms — every class is assumed to meet anywhere.</p>'}
      <div class="add-row">
        <button class="btn btn-sm" data-act="add-room">+ Add a room</button>
      </div>
    </div>`,

  curriculum: () => {
    const cfg = state.config
    if (!cfg.classes.length || !cfg.subjects.length) {
      return `<div class="card"><p class="muted">Add classes and subjects first — the curriculum table needs both.</p></div>`
    }

    const rowFor = (classId, subjectId) =>
      cfg.curriculum.find(r => r.classId === classId && r.subjectId === subjectId)

    const pair = (classId, subjectId) => `${classId}::${subjectId}`

    const classLabel = c => c.section ? `${esc(c.name)} (${esc(c.section)})` : esc(c.name)

    return `
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div>
          <h4 style="margin:0 0 4px 0">Periods per week</h4>
          <p class="muted" style="margin:0">
            How many periods of each subject each class gets in a week. Put <b>0</b> to leave it out.
          </p>
        </div>
        <button class="btn btn-sm btn-accent" data-act="auto-fill-curriculum">⚡ Auto-fill balanced periods</button>
      </div>
      <div class="matrix-wrap">
        <table class="matrix">
          <thead>
            <tr>
              <th>Subject</th>
              ${cfg.classes.map(c => `<th>${classLabel(c)}</th>`).join('')}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${cfg.subjects.map(s => {
              const total = cfg.classes.reduce((sum, c) => {
                const r = rowFor(c.id, s.id)
                return sum + (r ? r.periodsPerWeek : 0)
              }, 0)
              return `<tr>
                <th>${esc(s.name)}</th>
                ${cfg.classes.map(c => {
                  const r = rowFor(c.id, s.id)
                  return `<td class="num">
                    <input type="number" min="0" max="20"
                      data-curriculum="${esc(pair(c.id, s.id))}"
                      data-field="periodsPerWeek"
                      value="${r ? r.periodsPerWeek : 0}">
                  </td>`
                }).join('')}
                <td class="num"><b>${total}</b></td>
              </tr>`
            }).join('')}
            <tr>
              <th>Total</th>
              ${cfg.classes.map(c => {
                const total = cfg.subjects.reduce((sum, s) => {
                  const r = rowFor(c.id, s.id)
                  return sum + (r ? r.periodsPerWeek : 0)
                }, 0)
                return `<td class="num"><b>${total}</b></td>`
              }).join('')}
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>`
  },

  preferences: () => {
    const p = state.config.preferences
    return `
    <div class="card">
      <h4>How should the week be balanced?</h4>
      <label class="field">
        <span>Maximum periods of one subject in a day</span>
        <input type="number" min="1" max="6" data-pref="maxSameSubjectPerDay" value="${p.maxSameSubjectPerDay}">
        <small>1 means a subject appears at most once per day. 2 allows a double period.</small>
      </label>
      <label class="field">
        <span>Avoid two difficult subjects back to back</span>
        <select data-pref="avoidConsecutiveDifficult">
          <option value="true" ${p.avoidConsecutiveDifficult ? 'selected' : ''}>Yes — keep them apart</option>
          <option value="false" ${!p.avoidConsecutiveDifficult ? 'selected' : ''}>No — allow it</option>
        </select>
      </label>
      <label class="field">
        <span>Spread each class evenly across the week</span>
        <select data-pref="balanceClassDays">
          <option value="true" ${p.balanceClassDays ? 'selected' : ''}>Yes — no class should have a heavy day and a light day</option>
          <option value="false" ${!p.balanceClassDays ? 'selected' : ''}>No — let it fall where it may</option>
        </select>
      </label>
      <label class="field">
        <span>Spread each teacher evenly across the week</span>
        <select data-pref="balanceTeacherDays">
          <option value="true" ${p.balanceTeacherDays ? 'selected' : ''}>Yes — no teacher should have a heavy day</option>
          <option value="false" ${!p.balanceTeacherDays ? 'selected' : ''}>No — let it fall where it may</option>
        </select>
      </label>
    </div>`
  }
}

/* ------------------------------------------------------------- wizard ui -- */

function renderWizard() {
  const steps = state.meta.steps
  const step = steps[state.step]

  document.getElementById('wizard-steps').innerHTML = steps.map((s, i) => {
    const stepErrs = getStepErrors(s.id)
    const hasErr = stepErrs.length > 0
    let cls = ''
    if (i === state.step) cls = 'active'
    else if (i < state.step) cls = hasErr ? 'has-error' : 'done'
    else if (hasErr) cls = 'has-error'

    return `<li class="${cls}" data-act="goto-step" data-index="${i}" title="${hasErr ? stepErrs.join('; ') : ''}">
      <span class="dot">${hasErr ? '!' : (i < state.step ? '✓' : i + 1)}</span>
      <span>${esc(s.title)}</span>
    </li>`
  }).join('')

  document.getElementById('step-title').textContent = step.title
  document.getElementById('step-blurb').textContent = step.blurb
  document.getElementById('step-counter').textContent = `Step ${state.step + 1} of ${steps.length}`

  const currentStepErrs = getStepErrors(step.id)
  let bannerHtml = ''
  if (currentStepErrs.length) {
    bannerHtml = `
      <div class="step-error-banner">
        <strong>⚠️ Please fix the following issue${currentStepErrs.length > 1 ? 's' : ''} in this step:</strong>
        <ul>
          ${currentStepErrs.map(e => `<li>${esc(e)}</li>`).join('')}
        </ul>
      </div>`
  }

  document.getElementById('step-body').innerHTML = bannerHtml + stepRenderers[step.id]()

  const isLast = state.step === steps.length - 1
  document.getElementById('btn-next').hidden = isLast
  document.getElementById('btn-generate').hidden = !isLast
  document.getElementById('btn-prev').disabled = state.step === 0

  document.getElementById('wizard-school').textContent =
    state.config.schoolName || 'Not named yet'

  renderReadiness()
  updateGenerateButton()
}

/* ------------------------------------------------------------ list screen -- */

async function renderList() {
  const res = await api('/timetables')
  const items = res.timetables
  document.getElementById('list-empty').hidden = items.length > 0

  document.getElementById('list-items').innerHTML = items.map(t => `
    <div class="tt-card">
      <div>
        <h3>${esc(t.name)}</h3>
        <div class="muted" style="font-size:12.5px;margin-top:2px">
          ${esc(t.schoolName || 'Unnamed school')}${t.branchName ? ' · ' + esc(t.branchName) : ''}
        </div>
      </div>
      <div class="meta">
        <span class="pill">${t.classCount} class${t.classCount === 1 ? '' : 'es'}</span>
        <span class="pill">${t.teacherCount} teacher${t.teacherCount === 1 ? '' : 's'}</span>
        <span class="pill">${t.subjectCount} subject${t.subjectCount === 1 ? '' : 's'}</span>
        ${t.generated ? '<span class="pill good">Generated</span>' : '<span class="pill warn">Draft</span>'}
      </div>
      <div class="foot">
        <button class="btn btn-sm" data-act="open-doc" data-id="${esc(t.id)}" data-mode="edit">Setup</button>
        <button class="btn btn-sm btn-primary" data-act="open-doc" data-id="${esc(t.id)}" data-mode="view">Open</button>
        <button class="btn btn-sm btn-danger" data-act="del-doc" data-id="${esc(t.id)}">✕</button>
      </div>
    </div>`).join('')
}

/* --------------------------------------------------------- table screen -- */

function subjectById(id) { return state.doc.config.subjects.find(s => s.id === id) }
function teacherById(id) { return state.doc.config.teachers.find(t => t.id === id) }

function renderTable() {
  const doc = state.doc
  const cfg = doc.config
  document.getElementById('table-title').textContent = doc.name
  let activeLabel = ''
  if (state.view === 'classes') {
    if (state.activeClassId === '__all__') {
      activeLabel = `All Classes (${cfg.classes.length})`
    } else {
      const activeId = (state.activeClassId && state.activeClassId !== '__all__') ? state.activeClassId : (cfg.classes[0] && cfg.classes[0].id)
      const c = cfg.classes.find(cls => cls.id === activeId)
      activeLabel = c ? `Class: ${c.name}${c.section ? ` (Section ${c.section})` : ''}` : 'Class'
    }
  } else {
    const t = cfg.teachers.find(tch => tch.id === state.activeTeacherId) || cfg.teachers[0]
    activeLabel = t ? `Teacher: ${t.name}` : 'Teacher'
  }

  document.getElementById('table-title').textContent = doc.name
  document.getElementById('table-subtitle').textContent =
    `${cfg.schoolName || 'School'}${cfg.branchName ? ' · ' + cfg.branchName : ''} — ${activeLabel} — ${cfg.days.length} days × ${cfg.periodCount} periods`

  // entity picker
  const picker = document.getElementById('entity-picker')
  if (state.view === 'classes') {
    const allChip = `<button class="chip ${state.activeClassId === '__all__' ? 'on' : ''}" data-act="pick-class" data-id="__all__">All Classes (${cfg.classes.length})</button>`
    picker.innerHTML = allChip + cfg.classes.map(c => {
      const label = c.section ? `${esc(c.name)} (${esc(c.section)})` : esc(c.name)
      return `<button class="chip ${c.id === state.activeClassId ? 'on' : ''}" data-act="pick-class" data-id="${esc(c.id)}">${label}</button>`
    }).join('')
  } else {
    picker.innerHTML = cfg.teachers.map(t =>
      `<button class="chip ${t.id === state.activeTeacherId ? 'on' : ''}" data-act="pick-teacher" data-id="${esc(t.id)}">${esc(t.name)}</button>`).join('')
  }

  // status
  const v = doc.validation
  const status = document.getElementById('table-status')
  if (v.totals.required === 0) {
    status.className = 'status-pill warn'
    status.textContent = 'No curriculum set'
  } else if (!v.ok) {
    status.className = 'status-pill bad'
    status.textContent = `${v.hard.length} problem${v.hard.length === 1 ? '' : 's'}`
  } else if (v.soft.length) {
    status.className = 'status-pill warn'
    status.textContent = `Complete · ${v.soft.length} note${v.soft.length === 1 ? '' : 's'}`
  } else {
    status.className = 'status-pill ok'
    status.textContent = 'Complete &amp; clean'
  }

  renderGrid()
  renderReport()
  renderCoverage()
  renderLegend()
}

function renderLegend() {
  document.getElementById('legend').innerHTML = `
    <span><i style="background:#fffdf5;border-color:#f59e0b"></i> Pinned by hand</span>
    <span><i style="background:#fff"></i> Generated</span>
    <span><i style="background:#f0f1f5"></i> Break</span>
    <span><i style="background:#fff"></i> <span style="color:#d92d20">●</span> Difficult subject</span>
    <span class="muted">Click any period to place or change a lesson.</span>`
}

function renderSingleClassTableHtml(doc, classId) {
  const cfg = doc.config
  const periods = doc.periods
  const grid = (doc.grids && doc.grids[classId]) || {}

  let head = '<thead><tr><th></th>' + periods.map(p => {
    const cls = p.kind === 'break' ? 'break-col' : ''
    const label = p.kind === 'break' ? esc(p.label) : `P${p.teachingNumber}`
    return `<th class="${cls}">${label}<span class="t">${esc(p.text)}</span></th>`
  }).join('') + '</tr></thead>'

  let body = '<tbody>'
  for (let d = 0; d < cfg.days.length; d++) {
    body += `<tr><th>${esc(cfg.days[d])}<span class="d">day ${d + 1}</span></th>`
    for (const p of periods) {
      if (p.kind === 'break') {
        body += `<td><div class="cell break">${esc(p.label)}<br><span style="font-size:10px">${p.duration}m</span></div></td>`
        continue
      }
      const key = `${classId}|${d}|${p.index}`
      const cell = grid[key]
      body += renderCell(cell, d, p, true, classId)
    }
    body += '</tr>'
  }
  body += '</tbody>'
  return head + body
}

function renderGrid() {
  const doc = state.doc
  const cfg = doc.config
  const periods = doc.periods

  const multiGrid = document.getElementById('multi-grid')
  const singleGrid = document.getElementById('grid')
  const headerBanner = document.getElementById('grid-header-banner')

  if (state.view === 'classes' && state.activeClassId === '__all__') {
    if (headerBanner) headerBanner.hidden = true
    if (multiGrid) {
      multiGrid.hidden = false
      multiGrid.innerHTML = cfg.classes.map(c => `
        <div class="class-timetable-block" id="block-${c.id}">
          <div class="class-timetable-header">
            <h3>
              <span>🏫</span>
              <span>Class: ${esc(c.name)}${c.section ? ` (Section ${esc(c.section)})` : ''}</span>
            </h3>
            <span class="badge">${c.studentCount ? `${c.studentCount} students` : 'Timetable'}</span>
          </div>
          <div style="overflow-x:auto">
            <table class="grid">
              ${renderSingleClassTableHtml(doc, c.id)}
            </table>
          </div>
        </div>
      `).join('')
    }
    if (singleGrid) singleGrid.hidden = true
    return
  }

  // Single class or teacher view
  if (multiGrid) multiGrid.hidden = true
  if (singleGrid) singleGrid.hidden = false

  if (headerBanner) {
    if (state.view === 'classes') {
      const activeId = (state.activeClassId && state.activeClassId !== '__all__') ? state.activeClassId : (cfg.classes[0] && cfg.classes[0].id)
      const cls = cfg.classes.find(c => c.id === activeId)
      const className = cls ? `${cls.name}${cls.section ? ` (Section ${cls.section})` : ''}` : 'Class'
      headerBanner.hidden = false
      headerBanner.innerHTML = `
        <div class="active-timetable-title">
          <div class="att-main">
            <span class="att-badge">🏫 Timetable for Class</span>
            <h2 class="att-class-name">${esc(className)}</h2>
          </div>
          <div class="att-meta">
            <span class="att-school">School: <strong>${esc(cfg.schoolName || doc.name)}</strong></span>
            ${cls && cls.studentCount ? `<span class="badge">${cls.studentCount} students</span>` : ''}
          </div>
        </div>`
    } else {
      const activeTeacher = cfg.teachers.find(t => t.id === state.activeTeacherId) || cfg.teachers[0]
      const teacherName = activeTeacher ? activeTeacher.name : 'Teacher'
      headerBanner.hidden = false
      headerBanner.innerHTML = `
        <div class="active-timetable-title">
          <div class="att-main">
            <span class="att-badge">👨‍🏫 Timetable for Teacher</span>
            <h2 class="att-class-name">${esc(teacherName)}</h2>
          </div>
          <div class="att-meta">
            <span class="att-school">School: <strong>${esc(cfg.schoolName || doc.name)}</strong></span>
            ${activeTeacher ? `<span class="badge">${activeTeacher.subjectIds.length} subjects</span>` : ''}
          </div>
        </div>`
    }
  }

  let head = '<thead><tr><th></th>' + periods.map(p => {
    const cls = p.kind === 'break' ? 'break-col' : ''
    const label = p.kind === 'break' ? esc(p.label) : `P${p.teachingNumber}`
    return `<th class="${cls}">${label}<span class="t">${esc(p.text)}</span></th>`
  }).join('') + '</tr></thead>'

  let body = '<tbody>'

  if (state.view === 'classes') {
    const activeId = (state.activeClassId && state.activeClassId !== '__all__') ? state.activeClassId : (cfg.classes[0] && cfg.classes[0].id)
    const grid = (doc.grids[activeId]) || {}
    for (let d = 0; d < cfg.days.length; d++) {
      body += `<tr><th>${esc(cfg.days[d])}<span class="d">day ${d + 1}</span></th>`
      for (const p of periods) {
        if (p.kind === 'break') {
          body += `<td><div class="cell break">${esc(p.label)}<br><span style="font-size:10px">${p.duration}m</span></div></td>`
          continue
        }
        const key = `${activeId}|${d}|${p.index}`
        const cell = grid[key]
        body += renderCell(cell, d, p, true, activeId)
      }
      body += '</tr>'
    }
  } else {
    for (let d = 0; d < cfg.days.length; d++) {
      body += `<tr><th>${esc(cfg.days[d])}<span class="d">day ${d + 1}</span></th>`
      for (const p of periods) {
        if (p.kind === 'break') {
          body += `<td><div class="cell break">${esc(p.label)}</div></td>`
          continue
        }
        const cell = findTeacherCell(state.activeTeacherId, d, p.index)
        body += renderCell(cell, d, p, false, cell ? cell.classId : null)
      }
      body += '</tr>'
    }
  }

  body += '</tbody>'
  singleGrid.innerHTML = head + body
}

function explainEmptyCell(classId, day, periodIndex) {
  const doc = state.doc
  if (!doc) return 'Free slot'
  const cfg = doc.config
  const grids = doc.grids || {}

  let reqTotal = 0
  for (const r of cfg.curriculum) {
    if (r.classId === classId) reqTotal += r.periodsPerWeek
  }

  const classGrid = grids[classId] || {}
  const scheduledCount = Object.values(classGrid).filter(c => c && c.subjectId).length

  if (reqTotal > 0 && scheduledCount >= reqTotal) {
    return 'Free · Class curriculum 100% scheduled'
  }

  const needed = []
  for (const r of cfg.curriculum) {
    if (r.classId !== classId || r.periodsPerWeek <= 0) continue
    const placed = Object.values(classGrid).filter(c => c && c.subjectId === r.subjectId).length
    if (placed < r.periodsPerWeek) {
      const subj = cfg.subjects.find(s => s.id === r.subjectId)
      if (subj) needed.push(subj)
    }
  }

  if (!needed.length) return 'Free slot · No subjects assigned'

  for (const subj of needed) {
    const qualified = cfg.teachers.filter(t => t.subjectIds.includes(subj.id))
    if (!qualified.length) return `Unscheduled · No teacher for ${subj.name}`

    const busy = qualified.every(t => {
      for (const grid of Object.values(grids)) {
        for (const cell of Object.values(grid)) {
          if (cell && cell.teacherId === t.id && Number(cell.day) === day && Number(cell.period) === periodIndex) return true
        }
      }
      return false
    })
    if (busy) return `Open · Teacher busy with another class`

    const unavailable = qualified.every(t => {
      return t.unavailableSlots.some(s => Number(s.day) === day && Number(s.period) === Number(periodIndex + 1))
    })
    if (unavailable) return `Open · Teacher unavailable at this slot`

    const atDailyLimit = qualified.every(t => {
      if (t.maxPerDay === null) return false
      let count = 0
      for (const grid of Object.values(grids)) {
        for (const cell of Object.values(grid)) {
          if (cell && cell.teacherId === t.id && Number(cell.day) === day) count++
        }
      }
      return count >= t.maxPerDay
    })
    if (atDailyLimit) return `Open · Teacher daily workload cap reached`
  }

  return 'Free slot · Click to place lesson'
}

function renderCell(cell, day, period, editable, classId) {
  if (!cell || !cell.subjectId) {
    const reason = explainEmptyCell(classId, day, period.index)
    return `<td><div class="cell empty ${editable ? '' : 'readonly'}"
      data-class-id="${esc(classId || '')}" data-cell-day="${day}" data-cell-period="${period.index}"
      ${editable ? `data-act="edit-cell" data-class="${esc(classId || '')}" data-day="${day}" data-period="${period.index}"` : ''}
      title="${esc(reason)}">
        <span class="empty-title">Free</span>
        <span class="empty-reason">${esc(reason)}</span>
      </div></td>`
  }
  const subject = subjectById(cell.subjectId)
  const teacher = cell.teacherId ? teacherById(cell.teacherId) : null
  const difficult = subject && subject.difficult === 'difficult'
  const second = cell.className ? cell.className : (teacher ? teacher.name : '')
  return `<td><div class="cell ${cell.manual ? 'manual' : ''} ${difficult ? 'diff' : ''} ${editable ? '' : 'readonly'}"
      data-class-id="${esc(classId || cell.classId || '')}" data-cell-day="${day}" data-cell-period="${period.index}"
      ${editable ? `data-act="edit-cell" data-class="${esc(classId || cell.classId || '')}" data-day="${day}" data-period="${period.index}"` : ''}>
    <div class="subj">${esc(subject ? subject.name : cell.subjectId)}</div>
    ${second ? `<div class="teach">${esc(second)}</div>` : ''}
  </div></td>`
}

/** Find the lesson a teacher is teaching in a given slot (teacher view). */
function findTeacherCell(teacherId, day, column) {
  const grids = state.doc.grids || {}
  for (const [classId, grid] of Object.entries(grids)) {
    const cell = grid[`${classId}|${day}|${column}`]
    if (cell && cell.teacherId === teacherId) {
      const cls = state.doc.config.classes.find(c => c.id === classId)
      return { ...cell, className: cls ? cls.name : classId, classId }
    }
  }
  return null
}

function renderReport() {
  const v = (state.doc && state.doc.validation) || { hard: [], soft: [] }
  const el = document.getElementById('report')
  const cornerEl = document.getElementById('corner-error-panel')

  const totalErrors = v.hard.length + v.soft.length

  if (!totalErrors) {
    if (el) el.innerHTML = '<p class="none">No problems found. The timetable is clean.</p>'
    if (cornerEl) cornerEl.hidden = true
    return
  }

  const row = (issue, kind, idx) => `
    <div class="issue ${kind}">
      <span class="tag">${kind}</span>
      <span>${esc(issue.message)}</span>
      <button class="btn btn-sm" style="margin-left:auto" data-act="jump-to-error" data-error-kind="${kind}" data-error-idx="${idx}">🎯 Go to Error</button>
    </div>`
  if (el) {
    el.innerHTML =
      v.hard.map((i, idx) => row(i, 'hard', idx)).join('') +
      v.soft.map((i, idx) => row(i, 'soft', idx)).join('')
  }

  if (cornerEl) {
    cornerEl.hidden = false
    cornerEl.innerHTML = `
      <div class="corner-error-head">
        <div class="title">
          <span>⚠️</span>
          <span>Timetable Issues</span>
          <span class="badge">${totalErrors}</span>
        </div>
        <div>
          <button data-act="toggle-corner-error" title="${state.cornerErrorMinimized ? 'Expand' : 'Minimize'}">
            ${state.cornerErrorMinimized ? '▲ Expand' : '▼ Minimize'}
          </button>
        </div>
      </div>
      ${state.cornerErrorMinimized ? '' : `
      <div class="corner-error-body">
        ${v.hard.map((i, idx) => `
          <div class="corner-error-item hard">
            <span class="msg"><b>Error:</b> ${esc(i.message)}</span>
            <button class="btn-jump" data-act="jump-to-error" data-error-kind="hard" data-error-idx="${idx}">
              🎯 Go to Error
            </button>
          </div>
        `).join('')}
        ${v.soft.map((i, idx) => `
          <div class="corner-error-item soft">
            <span class="msg"><b>Note:</b> ${esc(i.message)}</span>
            <button class="btn-jump" data-act="jump-to-error" data-error-kind="soft" data-error-idx="${idx}">
              🎯 Go to Error
            </button>
          </div>
        `).join('')}
      </div>`}
    `
  }
}

function renderCoverage() {
  const cfg = state.doc.config
  const grids = state.doc.grids || {}
  const counts = {}
  for (const grid of Object.values(grids)) {
    for (const cell of Object.values(grid)) {
      if (!cell.subjectId) continue
      counts[cell.subjectId] = (counts[cell.subjectId] || 0) + 1
    }
  }

  const required = {}
  for (const r of cfg.curriculum) {
    required[r.subjectId] = (required[r.subjectId] || 0) + r.periodsPerWeek
  }

  const subjects = cfg.subjects.filter(s => required[s.id] || counts[s.id])
  if (!subjects.length) {
    document.getElementById('coverage').innerHTML = '<p class="none">Nothing scheduled yet.</p>'
    return
  }

  document.getElementById('coverage').innerHTML = subjects.map(s => {
    const need = required[s.id] || 0
    const got = counts[s.id] || 0
    const pct = need ? Math.min(100, Math.round(got / need * 100)) : 0
    const short = got < need
    return `<div class="coverage-row">
      <span class="nm">${esc(s.name)}</span>
      <span class="bar"><i class="${short ? 'short' : ''}" style="width:${pct}%"></i></span>
      <span class="val">${got} / ${need}</span>
    </div>`
  }).join('')
}

/* --------------------------------------------------------------- modal --- */

function openCellModal(day, column, explicitClassId) {
  const doc = state.doc
  const cfg = doc.config
  const period = doc.periods[column]
  if (!period) return

  const classId = explicitClassId || (state.activeClassId && state.activeClassId !== '__all__' ? state.activeClassId : (cfg.classes[0] && cfg.classes[0].id))
  const cls = cfg.classes.find(c => c.id === classId)
  const key = `${classId}|${day}|${column}`
  const current = (doc.grids[classId] || {})[key]

  // subjects this class actually takes
  const classSubjects = cfg.subjects.filter(s =>
    cfg.curriculum.some(r => r.classId === classId && r.subjectId === s.id && r.periodsPerWeek > 0))

  const qualifiedFor = subjectId => cfg.teachers.filter(t => t.subjectIds.includes(subjectId))

  const busyTeachers = teacherId => {
    for (const [cid, grid] of Object.entries(doc.grids || {})) {
      for (const [k, cell] of Object.entries(grid)) {
        if (k === key) continue
        if (cell.teacherId === teacherId && Number(cell.day) === day && Number(cell.period) === column) return true
      }
    }
    return false
  }

  const body = `
    <h3>${esc(cfg.days[day])} · P${period.teachingNumber}</h3>
    <p class="muted" style="margin-bottom:14px">
      ${esc(period.text)} · ${esc(cls ? cls.name : '')}
      ${current ? `· currently <b>${esc(subjectById(current.subjectId) ? subjectById(current.subjectId).name : '')}</b>` : ''}
    </p>

    <div class="field" style="margin-bottom:12px">
      <span style="display:block;margin-bottom:6px;font-size:13px;font-weight:600;color:var(--ink-2)">Subject</span>
      <div class="chip-set">
        ${classSubjects.length ? classSubjects.map(s => `
          <button class="chip ${current && current.subjectId === s.id ? 'on' : ''}"
                  data-act="modal-subject" data-subject="${esc(s.id)}">${esc(s.name)}</button>`).join('')
          : '<span class="muted">This class has no subjects in the curriculum yet.</span>'}
      </div>
    </div>

    <div id="modal-teacher-area"></div>

    <div class="modal-foot">
      ${current ? '<button class="btn btn-danger" data-act="modal-clear">Clear this period</button>' : ''}
      <div class="spacer"></div>
      <button class="btn" data-act="close-modal">Cancel</button>
      <button class="btn btn-primary" id="modal-place" data-act="modal-place" disabled>Place lesson</button>
    </div>`

  showModal(body)
  state.modal = { day, column, classId, subjectId: current ? current.subjectId : null, teacherId: current ? current.teacherId : null }
  if (state.modal.subjectId) renderModalTeacher()
}

function renderModalTeacher() {
  const area = document.getElementById('modal-teacher-area')
  if (!area) return
  const m = state.modal
  if (!m.subjectId) {
    area.innerHTML = '<p class="muted" style="font-size:13px">Pick a subject first — then choose who teaches it.</p>'
    return
  }
  const cfg = state.doc.config
  const teachers = cfg.teachers.filter(t => t.subjectIds.includes(m.subjectId))
  const busy = teacherId => {
    for (const [cid, grid] of Object.entries(state.doc.grids || {})) {
      for (const [k, cell] of Object.entries(grid)) {
        if (k === `${m.classId}|${m.day}|${m.column}`) continue
        if (cell.teacherId === teacherId && Number(cell.day) === m.day && Number(cell.period) === m.column) return true
      }
    }
    return false
  }

  area.innerHTML = `
    <div class="field" style="margin-bottom:12px">
      <span style="display:block;margin-bottom:6px;font-size:13px;font-weight:600;color:var(--ink-2)">Teacher</span>
      ${teachers.length ? `<select id="modal-teacher" style="max-width:100%">
        ${teachers.map(t => {
          const isBusy = busy(t.id)
          const unavailable = t.unavailableSlots.some(s => s.day === m.day && s.period === m.column)
          const disabled = isBusy || unavailable
          const note = isBusy ? ' — busy' : (unavailable ? ' — unavailable' : '')
          return `<option value="${esc(t.id)}" ${m.teacherId === t.id ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${esc(t.name)}${note}</option>`
        }).join('')}
      </select>` : '<span class="muted">No teacher is qualified for this subject.</span>'}
    </div>`

  const select = document.getElementById('modal-teacher')
  if (select) {
    m.teacherId = select.value
    select.onchange = () => { m.teacherId = select.value }
  }
  const placeBtn = document.getElementById('modal-place')
  if (placeBtn) placeBtn.disabled = !m.teacherId
}

function showModal(html) {
  const back = document.createElement('div')
  back.className = 'modal-back'
  back.innerHTML = `<div class="modal">${html}</div>`
  back.addEventListener('click', e => { if (e.target === back) closeModal() })
  document.body.appendChild(back)
  state.modalBack = back
}

function closeModal() {
  if (state.modalBack) { state.modalBack.remove(); state.modalBack = null }
  state.modal = null
}

/* ------------------------------------------------------------- actions --- */

async function ensureDoc() {
  if (state.docId) {
    const res = await api(`/timetables/${state.docId}`, { method: 'PUT', body: { config: state.config } })
    state.doc = res.timetable
    return state.doc
  }
  const res = await api('/timetables', { method: 'POST', body: { config: state.config } })
  state.docId = res.timetable.id
  state.doc = res.timetable
  return state.doc
}

async function doGenerate() {
  if (state.busy) return
  state.busy = true
  updateGenerateButton()
  try {
    await ensureDoc()
    const res = await api(`/timetables/${state.docId}/generate`, { method: 'POST', body: {} })
    state.doc = res.timetable
    const report = res.report
    if (res.timetable.config.classes.length > 1) {
      state.activeClassId = '__all__'
    } else {
      state.activeClassId = res.timetable.config.classes.length ? res.timetable.config.classes[0].id : null
    }
    if (report.ok) {
      toast(`Timetable generated in ${report.stats.generationMs}ms.`, 'good')
    } else {
      const first = (report.diagnostics && report.diagnostics[0] && report.diagnostics[0].message)
        || 'The generator could not place every lesson.'
      toast(first, 'bad')
    }
    showScreen('table')
    renderTable()
  } catch (err) {
    const errors = err.payload && err.payload.errors
    toast(errors && errors.length ? errors.slice(0, 2).join(' · ') : err.message, 'bad')
  } finally {
    state.busy = false
    updateGenerateButton()
  }
}

async function openDoc(id, mode) {
  const res = await api(`/timetables/${id}`)
  state.doc = res.timetable
  state.docId = res.timetable.id
  state.config = res.timetable.config
  if (res.timetable.config.classes.length > 1) {
    state.activeClassId = '__all__'
  } else {
    state.activeClassId = res.timetable.config.classes.length ? res.timetable.config.classes[0].id : null
  }
  state.activeTeacherId = res.timetable.config.teachers.length ? res.timetable.config.teachers[0].id : null
  state.view = 'classes'
  if (mode === 'edit') {
    state.step = 0
    showScreen('wizard')
    runCheck()
  } else {
    showScreen('table')
    renderTable()
  }
}

/* --------------------------------------------------------------- screens -- */

function showScreen(name) {
  state.screen = name
  document.getElementById('screen-list').hidden = name !== 'list'
  document.getElementById('screen-wizard').hidden = name !== 'wizard'
  document.getElementById('screen-table').hidden = name !== 'table'
  window.scrollTo(0, 0)
}

/* ------------------------------------------------------------- listeners -- */

function handleFormInput(e) {
  const el = e.target
  if (el.dataset.bind) {
    setPath(el.dataset.bind, readValue(el))
    scheduleCheck()
    return
  }
  if (el.dataset.list && el.dataset.field) {
    const list = state.config[el.dataset.list] || []
    const item = list.find(x => x.id === el.dataset.id)
    if (item) {
      item[el.dataset.field] = readValue(el)
      if (el.dataset.list === 'classes' && (el.dataset.field === 'name' || el.dataset.field === 'section')) {
        const dupInfo = checkClassDuplicates(list)
        if (dupInfo.duplicate) {
          toast(`⚠️ Duplicate section: "${dupInfo.class.name}" (Section "${dupInfo.class.section || 'None'}") already exists. Each section must be unique!`, 'bad')
        }
      }
      scheduleCheck()
    }
    return
  }
  if (el.dataset.curriculum && el.dataset.field) {
    const [classId, subjectId] = el.dataset.curriculum.split('::')
    let row = state.config.curriculum.find(r => r.classId === classId && r.subjectId === subjectId)
    if (!row) {
      row = { id: uid('req'), classId, subjectId, periodsPerWeek: 0, teacherIds: [] }
      state.config.curriculum.push(row)
    }
    if (el.dataset.field === 'periodsPerWeek') row.periodsPerWeek = readValue(el)
    if (el.dataset.field === 'teacherId') row.teacherIds = el.value ? [el.value] : []
    scheduleCheck()
    return
  }
  if (el.dataset.pref) {
    const key = el.dataset.pref
    state.config.preferences[key] = (el.tagName === 'SELECT' && el.value === 'true') ? true
      : (el.tagName === 'SELECT' && el.value === 'false') ? false
      : readValue(el)
    scheduleCheck()
    return
  }
  if (el.dataset.override) {
    scheduleCheck()
  }
}

document.addEventListener('input', handleFormInput)
document.addEventListener('change', handleFormInput)

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]')
  if (!el) return
  const act = el.dataset.act
  const cfg = state.config

  switch (act) {

    /* ---- list ---- */
    case 'new':
      state.config = JSON.parse(JSON.stringify(state.meta.defaults))
      state.step = 0
      state.docId = null
      state.doc = null
      showScreen('wizard')
      renderWizard()
      runCheck()
      return

    case 'open-doc':
      await openDoc(el.dataset.id, el.dataset.mode)
      return

    case 'del-doc':
      if (!confirm('Delete this timetable? This cannot be undone.')) return
      await api(`/timetables/${el.dataset.id}`, { method: 'DELETE' })
      toast('Timetable deleted.')
      renderList()
      return

    /* ---- wizard navigation ---- */
    case 'goto-step':
      state.step = Number(el.dataset.index)
      renderWizard()
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return

    case 'prev':
      if (state.step > 0) { state.step--; renderWizard(); window.scrollTo({ top: 0, behavior: 'smooth' }) }
      return

    case 'next':
      if (state.step < state.meta.steps.length - 1) {
        const curStep = state.meta.steps[state.step]
        const errs = getStepErrors(curStep.id)
        if (errs.length) {
          toast(`Please resolve errors in "${curStep.title}" first: ${errs[0]}`, 'bad')
          renderWizard()
          window.scrollTo({ top: 0, behavior: 'smooth' })
          return
        }
        state.step++
        renderWizard()
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
      return

    case 'save-draft':
      try {
        await ensureDoc()
        toast('Draft saved.', 'good')
      } catch (err) { toast(err.message, 'bad') }
      return

    case 'generate':
      await doGenerate()
      return

    /* ---- step: week ---- */
    case 'toggle-day': {
      const day = el.dataset.day
      const i = cfg.days.indexOf(day)
      if (i >= 0) cfg.days.splice(i, 1); else cfg.days.push(day)
      renderWizard(); scheduleCheck()
      return
    }

    /* ---- step: periods ---- */
    case 'add-break':
      cfg.breaks.push({ id: uid('break'), afterPeriod: Math.max(1, cfg.periodCount), label: 'Break', duration: 15 })
      renderWizard(); scheduleCheck()
      return
    case 'del-break':
      cfg.breaks = cfg.breaks.filter(b => b.id !== el.dataset.id)
      renderWizard(); scheduleCheck()
      return
    case 'add-override': {
      const used = Object.keys(cfg.periodOverrides).map(Number)
      const next = Array.from({ length: cfg.periodCount }, (_, i) => i + 1).find(n => !used.includes(n)) || 1
      cfg.periodOverrides[String(next)] = cfg.periodDuration
      renderWizard(); scheduleCheck()
      return
    }
    case 'del-override':
      delete cfg.periodOverrides[el.dataset.key]
      renderWizard(); scheduleCheck()
      return

    /* ---- step: classes / subjects / rooms ---- */
    case 'toggle-existing-class': {
      const dbId = el.dataset.id ? String(el.dataset.id) : null
      const name = el.dataset.name
      const section = el.dataset.section || ''
      const isChecked = el.checked
      const matchId = dbId ? `class_${dbId}` : null

      if (isChecked) {
        const exists = cfg.classes.some(c =>
          (matchId && c.id === matchId) ||
          (dbId && String(c.id) === dbId) ||
          (c.name.trim().toLowerCase() === name.trim().toLowerCase() &&
           (c.section || '').trim().toLowerCase() === section.trim().toLowerCase())
        )
        if (!exists) {
          const newId = matchId || uid('class')
          cfg.classes.push({
            id: newId,
            name,
            section,
            studentCount: 30
          })
          toast(`Added ${name}${section ? ` (${section})` : ''}`, 'good')
        }
      } else {
        const idx = cfg.classes.findIndex(c =>
          (matchId && c.id === matchId) ||
          (dbId && String(c.id) === dbId) ||
          (c.name.trim().toLowerCase() === name.trim().toLowerCase() &&
           (c.section || '').trim().toLowerCase() === section.trim().toLowerCase())
        )
        if (idx >= 0) {
          const removedId = cfg.classes[idx].id
          cfg.classes.splice(idx, 1)
          cfg.curriculum = cfg.curriculum.filter(r => r.classId !== removedId)
          toast(`Removed ${name}${section ? ` (${section})` : ''}`)
        }
      }
      // Ensure any orphaned curriculum rows are pruned
      const validClassIds = new Set(cfg.classes.map(c => c.id))
      cfg.curriculum = cfg.curriculum.filter(r => validClassIds.has(r.classId))
      renderWizard(); scheduleCheck()
      return
    }

    case 'del-class':
      cfg.classes = cfg.classes.filter(c => c.id !== el.dataset.id)
      cfg.curriculum = cfg.curriculum.filter(r => r.classId !== el.dataset.id)
      renderWizard(); scheduleCheck()
      return

    case 'auto-fill-curriculum': {
      if (!cfg.classes.length || !cfg.subjects.length) {
        toast('Select classes and subjects first', 'warn')
        return
      }
      const totalSlots = cfg.days.length * cfg.periodCount
      const subCount = cfg.subjects.length
      const basePeriods = Math.floor(totalSlots / subCount)
      const remainder = totalSlots % subCount

      for (const cls of cfg.classes) {
        cfg.subjects.forEach((s, idx) => {
          const count = basePeriods + (idx < remainder ? 1 : 0)
          let row = cfg.curriculum.find(r => r.classId === cls.id && r.subjectId === s.id)
          if (row) {
            row.periodsPerWeek = count
          } else {
            cfg.curriculum.push({
              id: uid('req'),
              classId: cls.id,
              subjectId: s.id,
              periodsPerWeek: count,
              teacherIds: []
            })
          }
        })
      }
      toast('Auto-filled balanced periods for all classes and subjects!', 'good')
      renderWizard(); scheduleCheck()
      return
    }
    case 'add-subject':
      cfg.subjects.push({ id: uid('subject'), name: `Subject ${cfg.subjects.length + 1}`, difficult: 'medium', roomId: null })
      renderWizard(); scheduleCheck()
      return
    case 'del-subject':
      cfg.subjects = cfg.subjects.filter(s => s.id !== el.dataset.id)
      cfg.curriculum = cfg.curriculum.filter(r => r.subjectId !== el.dataset.id)
      cfg.teachers.forEach(t => { t.subjectIds = t.subjectIds.filter(id => id !== el.dataset.id) })
      renderWizard(); scheduleCheck()
      return
    case 'add-room':
      cfg.rooms.push({ id: uid('room'), name: `Room ${cfg.rooms.length + 1}` })
      renderWizard(); scheduleCheck()
      return
    case 'del-room':
      cfg.rooms = cfg.rooms.filter(r => r.id !== el.dataset.id)
      renderWizard(); scheduleCheck()
      return

    /* ---- step: teachers ---- */
    case 'add-teacher':
      cfg.teachers.push({ id: uid('teacher'), name: `Teacher ${cfg.teachers.length + 1}`, subjectIds: [], maxPerDay: null, maxPerWeek: null, unavailableSlots: [] })
      renderWizard(); scheduleCheck()
      return
    case 'del-teacher':
      cfg.teachers = cfg.teachers.filter(t => t.id !== el.dataset.id)
      renderWizard(); scheduleCheck()
      return
    case 'toggle-teacher-subject': {
      const t = cfg.teachers.find(x => x.id === el.dataset.teacher)
      if (!t) return
      const i = t.subjectIds.indexOf(el.dataset.subject)
      if (i >= 0) t.subjectIds.splice(i, 1); else t.subjectIds.push(el.dataset.subject)
      renderWizard(); scheduleCheck()
      return
    }
    case 'toggle-unavailable': {
      const t = cfg.teachers.find(x => x.id === el.dataset.teacher)
      if (!t) return
      const day = Number(el.dataset.day)
      const period = Number(el.dataset.period)
      const i = t.unavailableSlots.findIndex(s => s.day === day && s.period === period)
      if (i >= 0) t.unavailableSlots.splice(i, 1)
      else t.unavailableSlots.push({ day, period })
      renderWizard(); scheduleCheck()
      return
    }

    /* ---- table screen ---- */
    case 'view-switch':
      break

    case 'pick-class':
      state.activeClassId = el.dataset.id
      renderTable()
      return

    case 'pick-teacher':
      state.activeTeacherId = el.dataset.id
      renderTable()
      return

    case 'edit-cell':
      openCellModal(Number(el.dataset.day), Number(el.dataset.period), el.dataset.class)
      return

    case 'toggle-corner-error':
      state.cornerErrorMinimized = !state.cornerErrorMinimized
      renderReport()
      return

    case 'jump-to-error': {
      const kind = el.dataset.errorKind
      const idx = Number(el.dataset.errorIdx)
      const list = kind === 'soft' ? ((state.doc && state.doc.validation && state.doc.validation.soft) || [])
        : ((state.doc && state.doc.validation && state.doc.validation.hard) || [])
      const issue = list[idx]
      if (!issue) return

      const detail = issue.detail || {}
      let targetClassId = detail.classId
      let day = detail.day
      let period = detail.period

      if (state.view !== 'classes') {
        state.view = 'classes'
        document.querySelectorAll('#view-switch button').forEach(b => b.classList.toggle('active', b.dataset.view === 'classes'))
        renderTable()
      }

      if (targetClassId && state.activeClassId !== '__all__' && state.activeClassId !== targetClassId) {
        state.activeClassId = targetClassId
        renderTable()
      }

      let selector = ''
      if (day !== undefined && period !== undefined) {
        selector = `.cell[data-cell-day="${day}"][data-cell-period="${period}"]`
        if (targetClassId) selector += `[data-class-id="${targetClassId}"]`
      } else if (targetClassId) {
        selector = `.cell.empty[data-class-id="${targetClassId}"]`
      } else {
        selector = `.cell.empty`
      }

      let cellEl = document.querySelector(selector)
      if (!cellEl && targetClassId) {
        cellEl = document.querySelector(`.cell[data-class-id="${targetClassId}"]`)
      }
      if (!cellEl && day !== undefined && period !== undefined) {
        cellEl = document.querySelector(`.cell[data-cell-day="${day}"][data-cell-period="${period}"]`)
      }

      if (cellEl) {
        cellEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
        cellEl.classList.remove('cell-error-target')
        void cellEl.offsetWidth
        cellEl.classList.add('cell-error-target')
        setTimeout(() => cellEl.classList.remove('cell-error-target'), 5000)
        toast(`Jumped to error: ${issue.message.slice(0, 50)}...`, 'bad')
      } else {
        toast(`Could not locate cell on screen: ${issue.message}`, 'bad')
      }
      return
    }

    case 'modal-subject':
      state.modal.subjectId = el.dataset.subject
      state.modal.teacherId = null
      renderModalTeacher()
      // highlight the chosen chip
      el.parentElement.querySelectorAll('.chip').forEach(c => c.classList.remove('on'))
      el.classList.add('on')
      return

    case 'modal-place': {
      const m = state.modal
      if (!m || !m.subjectId || !m.teacherId) return
      try {
        const res = await api(`/timetables/${state.docId}/place`, {
          method: 'POST',
          body: { classId: m.classId, day: m.day, period: m.column, subjectId: m.subjectId, teacherId: m.teacherId }
        })
        state.doc = res.timetable
        closeModal()
        renderTable()
        toast('Lesson placed.', 'good')
      } catch (err) { toast(err.message, 'bad') }
      return
    }

    case 'modal-clear': {
      const m = state.modal
      if (!m) return
      try {
        const res = await api(`/timetables/${state.docId}/cell`, {
          method: 'DELETE',
          body: { classId: m.classId, day: m.day, period: m.column }
        })
        state.doc = res.timetable
        closeModal()
        renderTable()
        toast('Period cleared.')
      } catch (err) { toast(err.message, 'bad') }
      return
    }

    case 'close-modal':
      closeModal()
      return

    case 'back-to-wizard':
      state.step = 0
      showScreen('wizard')
      renderWizard()
      runCheck()
      return

    case 'regenerate':
      await doGenerate()
      return

    case 'export':
      window.location.href = `/api/tt2/timetables/${state.docId}/export.csv`
      return
  }
})

// view switch (segmented control)
document.getElementById('view-switch').addEventListener('click', e => {
  const btn = e.target.closest('button[data-view]')
  if (!btn) return
  state.view = btn.dataset.view
  document.querySelectorAll('#view-switch button').forEach(b => b.classList.toggle('active', b === btn))
  renderTable()
})

document.getElementById('btn-new').addEventListener('click', () => {
  state.config = JSON.parse(JSON.stringify(state.meta.defaults))
  state.step = 0
  state.docId = null
  state.doc = null
  showScreen('wizard')
  renderWizard()
  runCheck()
})

document.getElementById('btn-prev').addEventListener('click', () => {
  if (state.step > 0) { state.step--; renderWizard(); window.scrollTo({ top: 0, behavior: 'smooth' }) }
})

document.getElementById('btn-next').addEventListener('click', () => {
  const currentStep = state.meta.steps[state.step]
  const errs = getStepErrors(currentStep.id)
  if (errs.length) {
    toast(`Please fix the errors in "${currentStep.title}" before proceeding: ${errs[0]}`, 'bad')
    renderWizard()
    window.scrollTo({ top: 0, behavior: 'smooth' })
    return
  }
  if (state.step < state.meta.steps.length - 1) {
    state.step++
    renderWizard()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
})

document.getElementById('btn-generate').addEventListener('click', doGenerate)

document.getElementById('btn-save-draft').addEventListener('click', async () => {
  try {
    await ensureDoc()
    toast('Draft saved.', 'good')
  } catch (err) { toast(err.message, 'bad') }
})

document.getElementById('btn-back-to-wizard').addEventListener('click', () => {
  state.step = 0
  showScreen('wizard')
  renderWizard()
  runCheck()
})

document.getElementById('btn-regenerate').addEventListener('click', doGenerate)

document.getElementById('btn-export').addEventListener('click', () => {
  window.location.href = `/api/tt2/timetables/${state.docId}/export.csv`
})

document.getElementById('btn-save-table').addEventListener('click', () => {
  toast('Everything is saved automatically.', 'good')
})

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && state.modalBack) closeModal()
})

/* ---------------------------------------------------------------- boot --- */

async function boot() {
  try {
    const meta = await api('/meta')
    state.meta = meta
    state.stepIds = meta.steps.map(s => s.id)
    await renderList()
  } catch (err) {
    toast(`Could not reach the tt2 API: ${err.message}`, 'bad')
  }
}

boot()

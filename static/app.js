let appState = null;
let chartInstance = null;
let subjectsCache = [];

function log(level, component, message, data) {
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level}] [${component}]`;
  if (data !== undefined) {
    console.log(prefix, message, data);
  } else {
    console.log(prefix, message);
  }
}

function logInfo(component, message, data) { log('INFO', component, message, data); }
function logWarn(component, message, data) { log('WARN', component, message, data); }
function logError(component, message, data) { log('ERROR', component, message, data); }

function showToast(message, type = 'info', timeout = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) { alert(message); return; }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), timeout);
}

let _promptResolve = null;
function showPrompt(title, label, defaultValue = '') {
  return new Promise((resolve) => {
    const modal = document.getElementById('prompt-modal');
    const titleEl = document.getElementById('prompt-modal-title');
    const labelEl = document.getElementById('prompt-modal-label');
    const input = document.getElementById('prompt-modal-input');
    if (!modal || !input) { resolve(prompt(label, defaultValue)); return; }
    _promptResolve = resolve;
    titleEl.textContent = title;
    labelEl.textContent = label;
    input.value = defaultValue;
    modal.classList.remove('hidden');
    setTimeout(() => input.focus(), 50);
  });
}

function _closePrompt(value) {
  const modal = document.getElementById('prompt-modal');
  if (modal) modal.classList.add('hidden');
  if (_promptResolve) { _promptResolve(value); _promptResolve = null; }
}

function ensureChartAvailable() {
  return typeof Chart !== 'undefined';
}

function uColor(v) {
  const x = Math.max(0, Math.min(100, Number(v) || 0));
  // Red (0°) -> amber (~42°) -> green (~142°), darker for text contrast
  const h = x * 1.42;
  return `hsl(${h.toFixed(1)} 62% 34%)`;
}

function uBar(v) {
  const x = Math.max(0, Math.min(100, Number(v) || 0));
  const h = x * 1.42;
  return `hsl(${h.toFixed(1)} 70% 45%)`;
}

function toneOf(v) {
  const x = Number(v) || 0;
  if (x < 40) return 'low';
  if (x < 70) return 'mid';
  return 'high';
}

function barHTML(v) {
  return `<span class="mini-bar" role="img" aria-label="${Math.round(v)} percent"><span style="width:${Math.max(0, Math.min(100, v))}%;background:${uBar(v)}"></span></span>`;
}

function fmtPct(v) {
  const n = (Math.round(v * 100) / 100);
  return (n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)) + '%';
}

function fmtPctShort(v) {
  return Math.round(v) + '%';
}

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Accept': 'application/json' },
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const start = performance.now();
  logInfo('api', `${method} ${path}`, body);
  const res = await fetch(path, opts);
  const elapsed = (performance.now() - start).toFixed(1);
  if (!res.ok) {
    const text = await res.text();
    logError('api', `${method} ${path} -> ${res.status} (${elapsed}ms)`, text);
    throw new Error(`API ${method} ${path}: ${res.status} ${text}`);
  }
  if (res.status === 204) {
    logInfo('api', `${method} ${path} -> 204 (${elapsed}ms)`);
    return null;
  }
  const data = await res.json();
  logInfo('api', `${method} ${path} -> ${res.status} (${elapsed}ms)`, data);
  return data;
}

async function loadApp(subjectId) {
  logInfo('loadApp', 'Loading application', { subjectId });
  const subs = await api('GET', '/api/subjects');
  subjectsCache = subs;
  if (subs.length === 0) {
    logInfo('loadApp', 'No subjects found, creating default Chemistry subject');
    await api('POST', '/api/subjects', { name: 'Chemistry' });
    return loadApp();
  }
  const id = subjectId || subs[0].id;
  const data = await api('GET', `/api/subjects/${id}`);
  appState = data;
  logInfo('loadApp', 'App state loaded', { id, name: data.name, totalLessons: data.total_lessons, overallAverage: data.overall_average });
  render();
}

/* ----- Sidebar ----- */
function renderSidebar() {
  const ul = document.getElementById('subject-list');
  ul.innerHTML = '';
  subjectsCache.forEach(s => {
    const li = document.createElement('li');
    li.className = 'subject-item' + (appState && appState.id === s.id ? ' active' : '');
    li.dataset.id = s.id;
    li.textContent = `${s.name}`;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', appState && appState.id === s.id ? 'true' : 'false');
    li.onclick = () => {
      logInfo('sidebar', 'Subject selected', { id: s.id, name: s.name });
      document.body.classList.remove('sidebar-open');
      loadApp(s.id);
    };
    ul.appendChild(li);
  });
  logInfo('sidebar', `Rendered ${subjectsCache.length} subject(s) in sidebar`);
}

document.getElementById('subject-search').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  logInfo('sidebar', 'Subject search filter', { query: q });
  const items = document.querySelectorAll('.subject-item');
  items.forEach(it => {
    const text = it.textContent.toLowerCase();
    it.style.display = text.includes(q) ? '' : 'none';
  });
});

document.getElementById('new-subject').addEventListener('click', async () => {
  const name = (await showPrompt('New Subject', 'Subject name')).trim();
  if (!name) return;
  logInfo('sidebar', 'Creating new subject', { name });
  try {
    const res = await api('POST', '/api/subjects', { name });
    subjectsCache.push({ id: res.id, name: res.name });
    renderSidebar();
    loadApp(res.id);
  } catch (err) {
    logError('sidebar', 'Failed to create subject', err.message);
    showToast('Failed to create subject: ' + err.message, 'error');
  }
});

/* Weak topics filter: one queue. The toolbar threshold highlights weak lessons
   everywhere and filters the "Today to Land" review queue to the same
   threshold, then scrolls to it. The legacy weak-panel is kept hidden. */
function applyWeakHighlight() {
  const thrEl = document.getElementById('weak-threshold');
  if (!thrEl) return;
  const thr = parseInt(thrEl.value, 10);
  document.querySelectorAll('.lesson-item').forEach(li => {
    const val = parseInt(li.dataset.understanding || '0', 10);
    li.classList.toggle('weak-highlight', val < thr);
  });
  filterTodayByThreshold(thr);
}

function filterTodayByThreshold(thr) {
  document.querySelectorAll('.today-item').forEach(row => {
    const badge = row.querySelector('.weak-badge');
    const val = badge ? parseInt(badge.textContent || '0', 10) : 0;
    row.style.display = val < thr ? '' : 'none';
  });
  const list = document.querySelector('.today-list');
  if (list) {
    const visible = list.querySelectorAll('.today-item:not([style*="none"])').length;
    const total = list.querySelectorAll('.today-item').length;
    let note = document.getElementById('today-filter-note');
    if (total > 0 && visible < total) {
      if (!note) {
        note = document.createElement('p');
        note.id = 'today-filter-note';
        note.className = 'muted small today-filter-note';
        list.prepend(note);
      }
      note.textContent = `Showing ${visible} of ${total} queued topics under ${thr}%. Raise the slider to see more.`;
    } else if (note) {
      note.remove();
    }
  }
}

document.getElementById('weak-filter').addEventListener('click', () => {
  const thr = parseInt(document.getElementById('weak-threshold').value, 10);
  logInfo('weak', 'Weak filter triggered — highlighting + filtering Today queue', { threshold: thr });
  applyWeakHighlight();
  const panel = document.querySelector('.today-panel');
  if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  showToast(`Highlighting topics under ${thr}% in the review queue`, 'info', 2500);
});

document.getElementById('weak-threshold').addEventListener('input', (e) => {
  const thr = parseInt(e.target.value, 10);
  const label = document.getElementById('weak-threshold-val');
  if (label) label.textContent = thr + '%';
  applyWeakHighlight();
});

/* JSON import — shared by the toolbar picker and the import modal picker. */
async function importJsonFile(f) {
  if (!f) return;
  logInfo('import', 'JSON file selected', { fileName: f.name, fileSize: f.size });
  try {
    const txt = await f.text();
    const data = JSON.parse(txt);
    const sections = (data.sections || []).map((s, si) => ({
      name: s.name || `Section ${si+1}`,
      chapters: (s.chapters || []).map((ch, ci) => ({
        name: ch.name || `Chapter ${ci+1}`,
        lessons: (ch.lessons || []).map((l, li) => ({
          name: l.name || `Lesson ${li+1}`,
          understanding: l.understanding || 0,
          sort_order: li
        }))
      }))
    }));
    const sub = await api('POST', '/api/import', { name: data.subject || 'Imported', sections });
    subjectsCache.push({ id: sub.id, name: data.subject || 'Imported' });
    renderSidebar();
    await loadApp(sub.id);
    logInfo('import', 'JSON import successful', { subject: data.subject, lessons: sub.lessons });
    showToast(`Imported "${data.subject || 'Imported'}" (${sub.lessons} lessons)`, 'success');
    document.getElementById('import-modal').classList.add('hidden');
  } catch (err) {
    logError('import', 'JSON import failed', err.message);
    showToast('Import failed: ' + err.message, 'error');
  }
}

document.getElementById('import-json').addEventListener('change', async (e) => {
  await importJsonFile(e.target.files && e.target.files[0]);
  e.target.value = '';
});

document.getElementById('import-json-modal').addEventListener('change', async (e) => {
  await importJsonFile(e.target.files && e.target.files[0]);
  e.target.value = '';
});

/* ----- Render ----- */
function render() {
  const d = appState;
  logInfo('render', 'Rendering app', { name: d.name, sections: d.sections?.length, totalLessons: d.total_lessons });
  // Render into dedicated container so toolbar / weak panel / loading persist
  let app = document.getElementById('subject-content');
  if (!app) {
    // fallback for stale HTML builds
    app = document.getElementById('app');
    app.innerHTML = '';
  } else {
    app.innerHTML = '';
  }
  const loading = document.getElementById('loading');
  if (loading) loading.classList.add('hidden');

  const header = ce('div', 'subject-header');
  header.innerHTML = `
    <h1>${esc(d.name)}</h1>
    <div class="subject-meta">
      <span class="subject-average" style="color:${uColor(d.overall_average)}">
        ${fmtPct(d.overall_average)}
      </span>
      <span class="lesson-count">${d.total_lessons} lesson${d.total_lessons === 1 ? '' : 's'}</span>
      <button class="history-btn" data-subject-history>Chart</button>
    </div>
    <div class="progress-track" role="progressbar" aria-valuenow="${Math.round(d.overall_average)}" aria-valuemin="0" aria-valuemax="100" aria-label="Overall progress">
      <div class="progress-fill" data-tone="${toneOf(d.overall_average)}" style="width:${Math.max(0, Math.min(100, d.overall_average))}%"></div>
    </div>
    <div class="subject-actions">
      <button class="btn btn-sm" data-import-btn>＋ Import</button>
      <button class="btn btn-sm" data-add-section>＋ Section</button>
      <button class="btn btn-sm" data-rename-subject>Rename</button>
      <button class="btn btn-sm btn-danger" data-delete-subject>Delete subject</button>
    </div>
  `;
  app.appendChild(header);

  header.querySelector('[data-subject-history]').onclick = () => {
    logInfo('render', 'Subject history chart clicked', { subjectId: d.id, name: d.name });
    showAggHistory('subject', d.id, `${d.name} (overall)`);
  };

  header.querySelector('[data-import-btn]').onclick = () => {
    logInfo('render', 'Import button clicked');
    document.getElementById('import-modal').classList.remove('hidden');
  };

  header.querySelector('[data-add-section]').onclick = async () => {
    const name = ((await showPrompt('New Section', 'Section name')) || '').trim();
    if (!name) return;
    try {
      const maxOrder = Math.max(0, ...((appState.sections || []).map(s => s.sort_order || 0)));
      await api('POST', '/api/sections', { subject_id: d.id, name, sort_order: maxOrder + 1 });
      await reloadPreservingScroll();
      showToast('Section added', 'success');
    } catch (err) {
      showToast('Failed to add section: ' + err.message, 'error');
    }
  };

  header.querySelector('[data-rename-subject]').onclick = async () => {
    const name = ((await showPrompt('Rename Subject', 'Subject name', d.name)) || '').trim();
    if (!name || name === d.name) return;
    try {
      await api('PUT', `/api/subjects/${d.id}`, { name });
      await loadApp(d.id);
      showToast('Subject renamed', 'success');
    } catch (err) {
      showToast('Rename failed: ' + err.message, 'error');
    }
  };

  header.querySelector('[data-delete-subject]').onclick = async () => {
    if (!confirm(`Delete subject "${d.name}" and all its data?`)) return;
    logInfo('render', 'Deleting subject', { subjectId: d.id, name: d.name });
    await api('DELETE', `/api/subjects/${d.id}`);
    subjectsCache = subjectsCache.filter(s => s.id !== d.id);
    renderSidebar();
    if (subjectsCache.length > 0) await loadApp(subjectsCache[0].id);
    else { appState = null; document.getElementById('subject-content').innerHTML = '<p class="empty-state">No subjects yet. Create one from the sidebar.</p>'; }
  };

  // Today to Land panel — the single review queue (weak + stale first).
  // The toolbar "Show weak topics" slider filters this same list.
  const todayEl = ce('div', 'today-panel');
  todayEl.innerHTML = `
    <div class="today-header">
      <h3>Today to Land</h3>
      <span class="muted small">weak + stale first · filtered by the slider above</span>
    </div>
    <div class="today-list"><p class="muted small">Loading queue…</p></div>
  `;
  // insert after header, before sections
  app.appendChild(todayEl);
  loadReviewQueue(d.id, todayEl).then(() => applyWeakHighlight());

  if (!d.sections || d.sections.length === 0) {
    const empty = ce('p', 'empty-state');
    empty.textContent = 'No sections yet — use ＋ Section above or import markdown to get started.';
    app.appendChild(empty);
  } else {
    d.sections.forEach(s => {
      app.appendChild(renderSection(s));
    });
  }

  renderSidebar();

  const mobileName = document.getElementById('mobile-subject-name');
  if (mobileName) mobileName.textContent = d.name || '';
}

function renderSection(s) {
  const div = ce('div', 'section');
  const avg = s.average || 0;
  const header = ce('div', 'section-header');
  header.innerHTML = `
    <span class="toggle-icon" aria-hidden="true">&#9660;</span>
    <span class="section-name">${esc(s.name)}</span>
    ${barHTML(avg)}
    <span class="lesson-count">${s.lesson_count}</span>
    <span class="average" style="color:${uColor(avg)}">${fmtPct(avg)}</span>
    <button class="history-btn" data-section-history="${s.id}" aria-label="Show chart for ${esc(s.name)}">Chart</button>
    <span class="row-actions">
      <button class="mini-btn" data-add-chapter="${s.id}" title="Add chapter to ${esc(s.name)}">＋</button>
      <button class="mini-btn" data-rename-section="${s.id}" title="Rename section">✎</button>
      <button class="mini-btn mini-btn-danger" data-delete-section="${s.id}" title="Delete section">×</button>
    </span>
  `;
  div.appendChild(header);

  const body = ce('div', 'section-body');
  s.chapters.forEach(ch => {
    const chEl = renderChapter(ch, s.id);
    body.appendChild(chEl);
  });
  div.appendChild(body);

  header.onclick = (e) => {
    if (e.target.closest('.history-btn') || e.target.closest('.row-actions')) return;
    div.classList.toggle('collapsed');
    const icon = header.querySelector('.toggle-icon');
    const nowCollapsed = div.classList.contains('collapsed');
    icon.innerHTML = nowCollapsed ? '&#9654;' : '&#9660;';
    logInfo('render', 'Section toggle', { sectionId: s.id, name: s.name, collapsed: nowCollapsed });
  };

  header.querySelector('[data-section-history]').onclick = () => {
    logInfo('render', 'Section history chart clicked', { sectionId: s.id, name: s.name });
    showAggHistory('section', s.id, s.name);
  };

  header.querySelector('[data-add-chapter]').onclick = async (e) => {
    e.stopPropagation();
    const name = ((await showPrompt('New Chapter', 'Chapter name')) || '').trim();
    if (!name) return;
    try {
      const maxOrder = Math.max(0, ...((s.chapters || []).map(c => c.sort_order || 0)));
      await api('POST', '/api/chapters', { section_id: s.id, name, sort_order: maxOrder + 1 });
      await reloadPreservingScroll();
      showToast('Chapter added', 'success');
    } catch (err) {
      showToast('Failed to add chapter: ' + err.message, 'error');
    }
  };

  header.querySelector('[data-rename-section]').onclick = async (e) => {
    e.stopPropagation();
    const name = ((await showPrompt('Rename Section', 'Section name', s.name)) || '').trim();
    if (!name || name === s.name) return;
    try {
      await api('PUT', `/api/sections/${s.id}`, { name });
      await reloadPreservingScroll();
      showToast('Section renamed', 'success');
    } catch (err) {
      showToast('Rename failed: ' + err.message, 'error');
    }
  };

  header.querySelector('[data-delete-section]').onclick = async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete section "${s.name}" and all its chapters and lessons?`)) return;
    try {
      await api('DELETE', `/api/sections/${s.id}`);
      await reloadPreservingScroll();
      showToast('Section deleted', 'success');
    } catch (err) {
      showToast('Delete failed: ' + err.message, 'error');
    }
  };

  return div;
}

function renderChapter(ch, sectionId) {
  const div = ce('div', 'chapter');
  const avg = ch.average || 0;
  const header = ce('div', 'chapter-header');
  header.innerHTML = `
    <span class="toggle-icon" aria-hidden="true">&#9660;</span>
    <span class="chapter-name">${esc(ch.name)}</span>
    ${barHTML(avg)}
    <span class="lesson-count">${ch.lesson_count}</span>
    <span class="average" style="color:${uColor(avg)}">${fmtPct(avg)}</span>
    <button class="history-btn" data-chapter-history="${ch.id}" aria-label="Show chart for ${esc(ch.name)}">Chart</button>
    <span class="row-actions">
      <button class="mini-btn" data-add-lesson="${ch.id}" title="Add lesson to ${esc(ch.name)}">＋</button>
      <button class="mini-btn" data-rename-chapter="${ch.id}" title="Rename chapter">✎</button>
      <button class="mini-btn mini-btn-danger" data-delete-chapter="${ch.id}" title="Delete chapter">×</button>
    </span>
  `;
  div.appendChild(header);

  const body = ce('div', 'chapter-body');
  const ul = ce('ul', 'lesson-list');
  ch.lessons.forEach(l => {
    const li = renderLesson(l, ch.id);
    ul.appendChild(li);
  });
  body.appendChild(ul);
  div.appendChild(body);

  header.onclick = (e) => {
    if (e.target.closest('.history-btn') || e.target.closest('.row-actions')) return;
    div.classList.toggle('collapsed');
    const icon = header.querySelector('.toggle-icon');
    const nowCollapsed = div.classList.contains('collapsed');
    icon.innerHTML = nowCollapsed ? '&#9654;' : '&#9660;';
    logInfo('render', 'Chapter toggle', { chapterId: ch.id, name: ch.name, collapsed: nowCollapsed });
  };

  header.querySelector('[data-chapter-history]').onclick = () => {
    logInfo('render', 'Chapter history chart clicked', { chapterId: ch.id, name: ch.name });
    showAggHistory('chapter', ch.id, ch.name);
  };

  header.querySelector('[data-add-lesson]').onclick = async (e) => {
    e.stopPropagation();
    const name = ((await showPrompt('New Lesson', 'Lesson name')) || '').trim();
    if (!name) return;
    try {
      const maxOrder = Math.max(0, ...((ch.lessons || []).map(l => l.sort_order || 0)));
      await api('POST', '/api/lessons', { chapter_id: ch.id, name, understanding: 0, sort_order: maxOrder + 1 });
      await reloadPreservingScroll();
      showToast('Lesson added', 'success');
    } catch (err) {
      showToast('Failed to add lesson: ' + err.message, 'error');
    }
  };

  header.querySelector('[data-rename-chapter]').onclick = async (e) => {
    e.stopPropagation();
    const name = ((await showPrompt('Rename Chapter', 'Chapter name', ch.name)) || '').trim();
    if (!name || name === ch.name) return;
    try {
      await api('PUT', `/api/chapters/${ch.id}`, { name });
      await reloadPreservingScroll();
      showToast('Chapter renamed', 'success');
    } catch (err) {
      showToast('Rename failed: ' + err.message, 'error');
    }
  };

  header.querySelector('[data-delete-chapter]').onclick = async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete chapter "${ch.name}" and all its lessons?`)) return;
    try {
      await api('DELETE', `/api/chapters/${ch.id}`);
      await reloadPreservingScroll();
      showToast('Chapter deleted', 'success');
    } catch (err) {
      showToast('Delete failed: ' + err.message, 'error');
    }
  };

  return div;
}

function renderLesson(l, chapterId) {
  const li = ce('li', 'lesson-item');
  li.dataset.lessonId = l.id;
  li.dataset.understanding = l.understanding;
  li.innerHTML = `
    <span class="lesson-name" title="${esc(l.name)} — click ✎ to rename">${esc(l.name)}</span>
    ${barHTML(l.understanding)}
    <span class="understanding-display" style="color:${uColor(l.understanding)}"
          data-lesson-id="${l.id}" title="Click to edit understanding" role="button" tabindex="0">${fmtPctShort(l.understanding)}</span>
    <button class="history-btn" data-lesson-history="${l.id}" aria-label="History for ${esc(l.name)}">Chart</button>
    <button class="history-btn" data-log-session="${l.id}" title="Log study session">+ Log</button>
    <span class="row-actions">
      <button class="mini-btn" data-rename-lesson="${l.id}" title="Rename lesson">✎</button>
      <button class="mini-btn mini-btn-danger" data-delete-lesson="${l.id}" title="Delete lesson">×</button>
    </span>
  `;
  const display = li.querySelector('.understanding-display');
  const openEdit = (e) => {
    e.stopPropagation();
    logInfo('render', 'Lesson understanding edit clicked', { lessonId: l.id, name: l.name, currentValue: l.understanding });
    startEdit(display);
  };
  display.onclick = openEdit;
  display.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEdit(e); }
  };
  li.querySelector('[data-lesson-history]').onclick = () => {
    logInfo('render', 'Lesson history chart clicked', { lessonId: l.id, name: l.name });
    showLessonHistory(l.id, l.name);
  };
  li.querySelector('[data-log-session]').onclick = (e) => {
    e.stopPropagation();
    openSessionModal(l.id, l.name);
  };
  li.querySelector('[data-rename-lesson]').onclick = async (e) => {
    e.stopPropagation();
    const name = ((await showPrompt('Rename Lesson', 'Lesson name', l.name)) || '').trim();
    if (!name || name === l.name) return;
    try {
      await api('PUT', `/api/lessons/${l.id}`, { name });
      await reloadPreservingScroll();
      showToast('Lesson renamed', 'success');
    } catch (err) {
      showToast('Rename failed: ' + err.message, 'error');
    }
  };
  li.querySelector('[data-delete-lesson]').onclick = async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete lesson "${l.name}"? Sessions and history for it are removed too.`)) return;
    try {
      await api('DELETE', `/api/lessons/${l.id}`);
      await reloadPreservingScroll();
      showToast('Lesson deleted', 'success');
    } catch (err) {
      showToast('Delete failed: ' + err.message, 'error');
    }
  };
  return li;
}

/* Reload the current subject while keeping scroll + collapse state. */
async function reloadPreservingScroll() {
  const y = window.scrollY;
  const collapsed = new Set();
  document.querySelectorAll('.section.collapsed .section-header .section-name').forEach(el => {
    collapsed.add('s:' + el.textContent);
  });
  document.querySelectorAll('.chapter.collapsed .chapter-header .chapter-name').forEach(el => {
    collapsed.add('c:' + el.textContent);
  });
  if (appState) await loadApp(appState.id);
  document.querySelectorAll('.section').forEach(sec => {
    const n = sec.querySelector('.section-name');
    if (n && collapsed.has('s:' + n.textContent)) sec.classList.add('collapsed');
  });
  document.querySelectorAll('.chapter').forEach(ch => {
    const n = ch.querySelector('.chapter-name');
    if (n && collapsed.has('c:' + n.textContent)) ch.classList.add('collapsed');
  });
  applyWeakHighlight();
  window.scrollTo(0, y);
}

/* ----- Review queue + sessions ----- */
let _sessionLessonId = null;

async function loadReviewQueue(subjectId, container) {
  const list = container.querySelector('.today-list');
  try {
    const q = await api('GET', `/api/review-queue?subject_id=${subjectId}&limit=8`);
    if (!q.length) {
      list.innerHTML = '<p class="muted small">All landed. No lessons yet.</p>';
      return;
    }
    list.innerHTML = '';
    q.forEach(item => {
      const row = document.createElement('div');
      row.className = 'today-item';
      row.innerHTML = `
        <div class="today-left">
          <strong>${esc(item.name)}</strong>
          <div class="muted small">${esc(item.section_name)} › ${esc(item.chapter_name)} · ${esc(item.reason)} · ${item.total_minutes}m logged</div>
        </div>
        <div class="today-right">
          <span class="weak-badge" style="color:${uColor(item.understanding)}">${fmtPctShort(item.understanding)}</span>
          <button class="btn btn-sm" data-today-go="${item.id}">Go</button>
          <button class="btn btn-sm" data-today-log="${item.id}" data-name="${esc(item.name)}">Log</button>
        </div>`;
      row.querySelector('[data-today-go]').onclick = () => openLessonById(item.id);
      row.querySelector('[data-today-log]').onclick = () => openSessionModal(item.id, item.name);
      list.appendChild(row);
    });
  } catch (err) {
    list.innerHTML = `<p class="muted small">Queue unavailable: ${esc(err.message)}</p>`;
  }
}

function openSessionModal(lessonId, lessonName) {
  _sessionLessonId = lessonId;
  const nameEl = document.getElementById('session-lesson-name');
  const modal = document.getElementById('session-modal');
  if (!modal || !nameEl) {
    logError('session', 'Session modal not found in this build - hard-refresh / rebuild server', { lessonId });
    showToast('Log UI not loaded in this build - hard-refresh the page', 'error');
    return;
  }
  nameEl.textContent = `Lesson: ${lessonName} (#${lessonId})`;
  document.getElementById('session-status').classList.add('hidden');
  modal.classList.remove('hidden');
}

function closeSessionModal() {
  const modal = document.getElementById('session-modal');
  if (modal) modal.classList.add('hidden');
  _sessionLessonId = null;
}

/* ----- Inline Editing ----- */
function startEdit(display) {
  if (display.tagName === 'INPUT') return;
  const lessonId = parseInt(display.dataset.lessonId);
  const current = parseFloat(display.textContent);
  logInfo('edit', 'Starting inline edit', { lessonId, currentValue: current });

  const rect = display.getBoundingClientRect();

  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'understanding-input';
  input.min = 0;
  input.max = 100;
  input.step = 1;
  input.value = current;
  input.style.width = Math.max(rect.width, 56) + 'px';

  display.replaceWith(input);
  input.focus();
  input.select();

  let cancelled = false;

  const finish = async (save) => {
    if (save) {
      const val = clamp(parseFloat(input.value), 0, 100);
      if (!isNaN(val) && val !== current) {
        try {
          logInfo('edit', 'Saving understanding update', { lessonId, oldValue: current, newValue: val });
          const result = await api(
            'PUT', `/api/lessons/${lessonId}/understanding`,
            { understanding: val }
          );
          applyUpdate(result);
          display.textContent = fmtPctShort(val);
          display.style.color = uColor(val);
          logInfo('edit', 'Understanding update applied successfully', result);
        } catch (err) {
          logError('edit', 'Understanding update failed', { lessonId, value: val, error: err.message });
          display.textContent = fmtPctShort(current);
          display.style.color = uColor(current);
        }
      } else {
        display.textContent = fmtPctShort(current);
        display.style.color = uColor(current);
      }
    } else {
      logInfo('edit', 'Edit cancelled', { lessonId });
      display.textContent = fmtPctShort(current);
      display.style.color = uColor(current);
    }
    input.replaceWith(display);
  };

  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelled = true; finish(false); }
    if (e.key === 'ArrowUp') { e.preventDefault(); input.value = clamp(parseInt(input.value || 0) + 5, 0, 100); }
    if (e.key === 'ArrowDown') { e.preventDefault(); input.value = clamp(parseInt(input.value || 0) - 5, 0, 100); }
  };

  input.onblur = () => { if (!cancelled) finish(true); };
}

function applyUpdate(result) {
  logInfo('applyUpdate', 'Applying cascade update', result);

  const li = document.querySelector(`.lesson-item[data-lesson-id="${result.id}"]`);
  if (li) {
    li.dataset.understanding = result.understanding;
    flash(li);
  }

  const chDiv = findChapter(result.chapter_id);
  if (chDiv) {
    const avgSpan = chDiv.querySelector('.chapter-header .average');
    if (avgSpan) {
      avgSpan.textContent = fmtPct(result.chapter_average);
      avgSpan.style.color = uColor(result.chapter_average);
      flash(avgSpan);
    }
  }

  const secDiv = findSection(result.section_id);
  if (secDiv) {
    const avgSpan = secDiv.querySelector('.section-header .average');
    if (avgSpan) {
      avgSpan.textContent = fmtPct(result.section_average);
      avgSpan.style.color = uColor(result.section_average);
      flash(avgSpan);
    }
  }

  const subAvg = document.querySelector('.subject-average');
  if (subAvg) {
    subAvg.textContent = fmtPct(result.subject_average);
    subAvg.style.color = uColor(result.subject_average);
    flash(subAvg);
  }

  if (appState) {
    for (const s of appState.sections || []) {
      for (const ch of s.chapters || []) {
        for (const l of ch.lessons || []) {
          if (l.id === result.id) {
            l.understanding = result.understanding;
          }
        }
      }
    }
  }
}

function findChapter(chapterId) {
  const btn = document.querySelector(`[data-chapter-history="${chapterId}"]`);
  return btn ? btn.closest('.chapter') : null;
}

function findSection(sectionId) {
  const btn = document.querySelector(`[data-section-history="${sectionId}"]`);
  return btn ? btn.closest('.section') : null;
}

function flash(el) {
  el.classList.remove('highlight-flash');
  void el.offsetWidth;
  el.classList.add('highlight-flash');
}

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

/* ----- History Charts ----- */
function showLessonHistory(lessonId, lessonName) {
  logInfo('chart', 'Fetching lesson history', { lessonId, lessonName });
  Promise.all([
    api('GET', `/api/lessons/${lessonId}/history`),
    api('GET', `/api/lessons/${lessonId}/sessions`).catch(() => ({ sessions: [], total_minutes: 0, count: 0 })),
  ]).then(([points, sess]) => {
    logInfo('chart', `Received ${points.length} history point(s) for lesson`, { lessonId, points });
    showChart(`${esc(lessonName)}`, points, sess);
  }).catch(err => {
    logError('chart', 'Failed to fetch lesson history', { lessonId, error: err.message });
    showToast('Failed to load history: ' + err.message, 'error');
  });
}

function showAggHistory(type, id, label) {
  logInfo('chart', 'Fetching aggregate history', { type, id, label });
  api('GET', `/api/${type}s/${id}/history`).then(points => {
    logInfo('chart', `Received ${points.length} aggregate history point(s)`, { type, id, points });
    showChart(`${esc(label)} average over time`, points, null,
      'Tip: the line moves only when you edit a % — logging sessions alone does not move it yet. Use Log → New understanding % to move it.');
  }).catch(err => {
    logError('chart', 'Failed to fetch aggregate history', { type, id, error: err.message });
    showToast('Failed to load history: ' + err.message, 'error');
  });
}

function renderSessionList(sess) {
  const box = document.getElementById('history-sessions');
  if (!box) return;
  const sessions = (sess && sess.sessions) || [];
  if (!sessions.length) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  const total = sess.total_minutes || sessions.reduce((a, s) => a + (s.duration_min || 0), 0);
  box.classList.remove('hidden');
  box.innerHTML = `
    <h4 class="session-list-title">Study sessions (${sessions.length}, ${total}m total)</h4>
    <ul class="session-list">` + sessions.slice(0, 20).map(s => {
      const when = (s.created_at || '').slice(0, 16).replace('T', ' ');
      const score = (s.score === null || s.score === undefined) ? '—' : `${s.score}/5`;
      return `<li>${esc(when)} · ${s.duration_min}m ${esc(s.mode)} · score ${esc(String(score))}</li>`;
    }).join('') + `</ul>`;
}

function showChart(title, points, sess, emptyHint) {
  const modal = document.getElementById('history-modal');
  const titleEl = document.getElementById('history-modal-title');

  renderSessionList(sess);

  if (!points || points.length < 2) {
    logInfo('chart', 'Not enough data points for chart, showing empty state', { title, pointCount: points?.length || 0 });
    titleEl.textContent = title;
    document.getElementById('history-chart').classList.add('hidden');
    const empty = document.getElementById('history-empty');
    empty.classList.remove('hidden');
    const n = (sess && sess.sessions && sess.sessions.length) || 0;
    empty.textContent = n > 0
      ? `No % changes yet — ${n} session(s) logged below. Edit the % (or Log → New understanding %) to start the line.`
      : (emptyHint || 'No history data yet. Edit the % to start tracking.');
    modal.classList.remove('hidden');
    return;
  }

  logInfo('chart', 'Rendering chart', { title, pointCount: points.length });
  titleEl.textContent = title;
  document.getElementById('history-empty').classList.add('hidden');
  const canvas = document.getElementById('history-chart');

  if (!ensureChartAvailable()) {
    logWarn('chart', 'Chart.js unavailable, showing fallback list');
    document.getElementById('history-chart').classList.add('hidden');
    const empty = document.getElementById('history-empty');
    empty.classList.remove('hidden');
    empty.textContent = points.map(p => `${p.timestamp}: ${p.value}%`).join(' | ');
    modal.classList.remove('hidden');
    showToast('Chart library failed to load — showing values as text', 'info');
    return;
  }

  canvas.classList.remove('hidden');

  if (chartInstance) chartInstance.destroy();

  const labels = points.map(p => {
    if (p.timestamp === 'now') return 'now';
    const d = new Date(p.timestamp + 'Z');
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  });

  const values = points.map(p => Math.round(p.value * 100) / 100);

  const colors = values.map(v => uColor(v));

  chartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Understanding %',
        data: values,
        borderColor: '#4f46e5',
        backgroundColor: 'rgba(79, 70, 229, 0.12)',
        fill: true,
        tension: 0.3,
        pointBackgroundColor: colors,
        pointBorderColor: '#fff',
        pointBorderWidth: 1.5,
        pointRadius: 5,
        pointHoverRadius: 7,
        borderWidth: 2.5,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.parsed.y}%`
          }
        }
      },
      scales: {
        y: {
          min: 0,
          max: 100,
          ticks: { callback: (v) => v + '%' }
        },
        x: {
          ticks: { maxTicksLimit: 12, maxRotation: 45 }
        }
      }
    }
  });

  modal.classList.remove('hidden');
}

/* ----- Weak panel rendering and helpers ----- */
function collectWeakLessons(threshold) {
  const results = [];
  if (!appState) return results;
  const subject = appState.name;
  for (const s of appState.sections || []) {
    for (const ch of s.chapters || []) {
      for (const l of ch.lessons || []) {
        if (Number(l.understanding) < threshold) {
          results.push({
            lessonId: l.id,
            lessonName: l.name,
            understanding: Number(l.understanding),
            chapterName: ch.name,
            sectionName: s.name
          });
        }
      }
    }
  }
  results.sort((a,b) => a.understanding - b.understanding);
  return results;
}

function renderWeakPanel(threshold) {
  const list = document.getElementById('weak-list');
  list.innerHTML = '';
  const items = collectWeakLessons(threshold);
  logInfo('weak', `Rendering weak panel: ${items.length} lesson(s) below threshold ${threshold}%`, items);
  if (items.length === 0) {
    list.innerHTML = '<p class="muted">No weak topics below threshold.</p>';
    return;
  }
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'weak-item';
    row.innerHTML = `<div class="weak-item-left"><strong>${esc(it.lessonName)}</strong>
      <div class="muted small">${esc(it.sectionName)} › ${esc(it.chapterName)}</div></div>
      <div class="weak-item-right"><span class="weak-badge" style="color:${uColor(it.understanding)}">${fmtPctShort(it.understanding)}</span>
      <button class="btn btn-sm" data-jump="${it.lessonId}">Go</button></div>`;
    row.querySelector('[data-jump]').onclick = (e) => {
      const id = e.currentTarget.dataset.jump;
      logInfo('weak', 'Navigating to weak lesson', { lessonId: id });
      openLessonById(id);
    };
    list.appendChild(row);
  }
}

function openLessonById(id) {
  const sel = `.lesson-item[data-lesson-id="${id}"]`;
  const li = document.querySelector(sel);
  if (!li) return;
  const chapter = li.closest('.chapter');
  const section = li.closest('.section');
  if (chapter && chapter.classList.contains('collapsed')) chapter.classList.remove('collapsed');
  if (section && section.classList.contains('collapsed')) section.classList.remove('collapsed');
  const secHeader = section ? section.querySelector('.section-header .toggle-icon') : null;
  if (secHeader) secHeader.innerHTML = '&#9660;';
  const chHeader = chapter ? chapter.querySelector('.chapter-header .toggle-icon') : null;
  if (chHeader) chHeader.innerHTML = '&#9660;';
  li.scrollIntoView({ behavior: 'smooth', block: 'center' });
  flash(li);
}

document.getElementById('weak-panel-close').addEventListener('click', () => {
  document.getElementById('weak-panel').classList.add('hidden');
});

/* ----- Modal management ----- */
function wireModal(id, fn) {
  const el = document.getElementById(id);
  if (el) el.onclick = fn;
  else logWarn('init', `Modal element #${id} missing - serving stale HTML? Hard-refresh / rebuild.`);
}
wireModal('modal-close', () => {
  document.getElementById('history-modal').classList.add('hidden');
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
});

document.getElementById('history-modal').querySelector('.modal-backdrop').onclick = () => {
  document.getElementById('modal-close').click();
};

wireModal('import-modal-close', () => {
  document.getElementById('import-modal').classList.add('hidden');
});

document.getElementById('import-modal').querySelector('.modal-backdrop').onclick = () => {
  const btn = document.getElementById('import-modal-close');
  if (btn) btn.click();
};

wireModal('session-modal-close', () => closeSessionModal());
wireModal('session-cancel', () => closeSessionModal());
(function wireSessionBackdrop() {
  const m = document.getElementById('session-modal');
  const b = m && m.querySelector('.modal-backdrop');
  if (b) b.onclick = () => closeSessionModal();
})();
(function wireSessionSave() {
  const btn = document.getElementById('session-save');
  if (!btn) { logWarn('init', 'Session save #session-save missing - serving stale HTML?'); return; }
  btn.onclick = async () => {
  const status = document.getElementById('session-status');
  const minutes = Math.min(Math.max(parseInt(document.getElementById('session-minutes').value || '15', 10) || 15, 1), 480);
  const mode = document.getElementById('session-mode').value || 'review';
  const scoreRaw = document.getElementById('session-score').value;
  const score = scoreRaw === '' ? null : Math.min(Math.max(parseFloat(scoreRaw), 0), 5);
  const pctRaw = document.getElementById('session-understanding').value;
  const pct = pctRaw === '' ? null : Math.min(Math.max(parseFloat(pctRaw), 0), 100);
  try {
    await api('POST', '/api/sessions', { lesson_id: _sessionLessonId, duration_min: minutes, mode, score });
    if (pct !== null && !isNaN(pct)) {
      await api('PUT', `/api/lessons/${_sessionLessonId}/understanding`, { understanding: pct });
      status.textContent = `Logged ${minutes}m ${mode} + set to ${pct}%. Chart will move.`;
    } else {
      status.textContent = `Logged ${minutes}m ${mode}. Note: only changing % moves the chart — set one above to record progress.`;
    }
    status.className = 'import-status success';
    status.classList.remove('hidden');
    showToast(pct !== null && !isNaN(pct) ? 'Session logged + progress updated' : 'Session logged (chart unchanged — set a % to move it)', 'success');
    const sid = appState && appState.id;
    closeSessionModal();
    if (sid) await reloadPreservingScroll();
  } catch (err) {
    status.textContent = `Failed: ${err.message}`;
    status.className = 'import-status error';
    status.classList.remove('hidden');
  }
  };
})();

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const mc = document.getElementById('modal-close');
    const ic = document.getElementById('import-modal-close');
    if (mc) mc.click();
    if (ic) ic.click();
    closeSessionModal();
  }
});

/* ----- Import ----- */
document.getElementById('import-execute').onclick = async () => {
  const text = document.getElementById('import-text').value.trim();
  const subjectName = document.getElementById('import-subject-name').value.trim() || 'Imported Subject';
  const status = document.getElementById('import-status');
  status.className = 'import-status hidden';

  if (!text) {
    status.textContent = 'Please paste some markdown content.';
    status.className = 'import-status error';
    status.classList.remove('hidden');
    return;
  }

  try {
    logInfo('import', 'Starting markdown import', { subjectName, textLength: text.length });
    const result = await parseAndImport(text, subjectName);
    logInfo('import', 'Markdown import successful', result);
    status.textContent = `Imported successfully: ${result.lessons} lessons across ${result.chapters} chapters in ${result.sections} sections.`;
    status.className = 'import-status success';
    status.classList.remove('hidden');
    document.getElementById('import-text').value = '';
    await loadApp(result.subject_id);
  } catch (err) {
    logError('import', 'Markdown import failed', err.message);
    status.textContent = `Import failed: ${err.message}`;
    status.className = 'import-status error';
    status.classList.remove('hidden');
  }
};

async function parseAndImport(text, subjectName) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  let currentSection = null;
  let currentChapter = null;
  let parsingTable = false;

  const sections = [];

  logInfo('import', `Parsing ${lines.length} line(s) of markdown`);

  for (const line of lines) {
    if (line.startsWith('## ') && !line.startsWith('### ')) {
      const name = line.replace(/^##\s+/, '').replace(/\*+\s*$/, '').trim();
      currentSection = { name, chapters: [] };
      sections.push(currentSection);
      currentChapter = null;
      parsingTable = false;
    } else if (line.startsWith('### ')) {
      const name = line.replace(/^###\s+/, '').replace(/\*+\s*$/, '').trim();
      if (currentSection === null) {
        currentSection = { name: 'Default', chapters: [] };
        sections.push(currentSection);
      }
      currentChapter = { name, lessons: [] };
      currentSection.chapters.push(currentChapter);
      parsingTable = false;
    } else if (line.startsWith('|')) {
      const cells = line.split('|').map(c => c.trim()).filter(c => c);
      if (cells.length < 2) continue;

      if (cells[0].startsWith('**') || cells[0].includes('average')) {
        continue;
      }

      if (cells[0] === 'Lesson' || cells[0].toLowerCase() === 'lesson') {
        parsingTable = true;
        continue;
      }

      if (!parsingTable || currentChapter === null) {
        if (cells[0].startsWith('-')) continue;
        continue;
      }

      const lessonName = cells[0];
      const pctCell = cells[cells.length - 1];
      const pctMatch = pctCell.match(/(\d+(?:\.\d+)?)\s*%/);
      if (!pctMatch) continue;

      const understanding = parseFloat(pctMatch[1]);

      currentChapter.lessons.push({ name: lessonName, understanding });
    } else {
      parsingTable = false;
    }
  }

  logInfo('import', `Parsed ${sections.length} section(s) from markdown`, sections);

  const result = await api('POST', '/api/import', { name: subjectName, sections });
  return {
    lessons: result.lessons,
    chapters: result.chapters,
    sections: result.sections,
    subject_id: result.id
  };
}

/* ----- Utilities ----- */
function ce(tag, className) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/* ----- Init ----- */
logInfo('init', 'Application starting');
loadApp();

/* ----- Mobile navigation ----- */
const sidebarToggle = document.getElementById('sidebar-toggle');
if (sidebarToggle) {
  sidebarToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = !document.body.classList.contains('sidebar-open');
    logInfo('mobile', 'Sidebar toggle', { opening });
    document.body.classList.toggle('sidebar-open');
  });
}

document.addEventListener('click', (e) => {
  if (!document.body.classList.contains('sidebar-open')) return;
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  if (!sidebar.contains(e.target) && e.target.id !== 'sidebar-toggle') {
    document.body.classList.remove('sidebar-open');
  }
});

function ensureMobilePanels() {
  if (window.innerWidth <= 768) {
    document.getElementById('weak-panel').classList.add('mobile-modal');
  } else {
    document.getElementById('weak-panel').classList.remove('mobile-modal');
  }
}

window.addEventListener('resize', ensureMobilePanels);
ensureMobilePanels();

const mobileWeakBtn = document.getElementById('mobile-weak-btn');
if (mobileWeakBtn) mobileWeakBtn.addEventListener('click', () => {
  logInfo('mobile', 'Mobile weak topics button clicked');
  applyWeakHighlight();
  const panel = document.querySelector('.today-panel');
  if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.body.classList.remove('sidebar-open');
});

const mobileImportBtn = document.getElementById('mobile-import-btn');
if (mobileImportBtn) mobileImportBtn.addEventListener('click', () => {
  logInfo('mobile', 'Mobile import button clicked');
  document.getElementById('import-modal').classList.remove('hidden');
  document.body.classList.remove('sidebar-open');
});

const mobileAddBtn = document.getElementById('mobile-add-lesson');
if (mobileAddBtn) mobileAddBtn.addEventListener('click', async () => {
  const name = (await showPrompt('Add Lesson', 'Lesson name')).trim();
  if (!name) return;
  const understandingRaw = await showPrompt('Add Lesson', 'Understanding % (0-100)', '0');
  const understanding = Math.min(Math.max(parseFloat(understandingRaw || 0) || 0, 0), 100);
  logInfo('mobile', 'Mobile quick add lesson', { name, understanding });
  try {
    let chapterId = null;
    if (appState && appState.sections && appState.sections.length > 0) {
      const firstSection = appState.sections[0];
      if (firstSection.chapters && firstSection.chapters.length > 0) {
        chapterId = firstSection.chapters[0].id;
      } else {
        const sec = await api('POST', '/api/sections', { subject_id: appState.id, name: 'Quick Section', sort_order: 0 });
        const ch = await api('POST', '/api/chapters', { section_id: sec.id, name: 'Quick Chapter', sort_order: 0 });
        chapterId = ch.id;
      }
    } else {
      const subRes = await api('POST', '/api/subjects', { name: 'Quick Subject' });
      const sec = await api('POST', '/api/sections', { subject_id: subRes.id, name: 'Quick Section', sort_order: 0 });
      const ch = await api('POST', '/api/chapters', { section_id: sec.id, name: 'Quick Chapter', sort_order: 0 });
      chapterId = ch.id;
    }

    if (chapterId) {
      await api('POST', '/api/lessons', { chapter_id: chapterId, name, understanding, sort_order: 0 });
      await loadApp(appState.id);
      logInfo('mobile', 'Quick lesson added successfully', { name, understanding });
      showToast('Lesson added', 'success');
    }
  } catch (err) {
    logError('mobile', 'Failed to add quick lesson', { name, error: err.message });
    showToast('Failed to add lesson: ' + err.message, 'error');
  }
});

/* ----- Prompt modal wiring ----- */
(function wirePromptModal() {
  const ok = document.getElementById('prompt-modal-ok');
  const cancel = document.getElementById('prompt-modal-cancel');
  const close = document.getElementById('prompt-modal-close');
  const input = document.getElementById('prompt-modal-input');
  if (!ok || !input) return;
  ok.onclick = () => _closePrompt(input.value ?? '');
  if (cancel) cancel.onclick = () => _closePrompt('');
  if (close) close.onclick = () => _closePrompt('');
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); _closePrompt(input.value ?? ''); }
    if (e.key === 'Escape') { e.preventDefault(); _closePrompt(''); }
  };
  const backdrop = document.querySelector('#prompt-modal .modal-backdrop');
  if (backdrop) backdrop.onclick = () => _closePrompt('');
})();

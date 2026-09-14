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
  const t = Math.min(v / 100, 1);
  const r = Math.round(0x78 + (0x16 - 0x78) * t);
  const g = Math.round(0x35 + (0xA3 - 0x35) * t);
  const b = Math.round(0x0F + (0x4A - 0x0F) * t);
  return `rgb(${r}, ${g}, ${b})`;
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
    li.className = 'subject-item';
    li.dataset.id = s.id;
    li.textContent = `${s.name}`;
    li.onclick = () => {
      logInfo('sidebar', 'Subject selected', { id: s.id, name: s.name });
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

/* Weak topics filter: show weak panel and highlight matches */
document.getElementById('weak-filter').addEventListener('click', () => {
  const thr = parseInt(document.getElementById('weak-threshold').value, 10);
  logInfo('weak', 'Weak filter triggered', { threshold: thr });
  renderWeakPanel(thr);
  document.getElementById('weak-panel').classList.remove('hidden');
});

document.getElementById('weak-threshold').addEventListener('input', (e) => {
  const thr = parseInt(e.target.value, 10);
  document.querySelectorAll('.lesson-item').forEach(li => {
    const val = parseInt(li.dataset.understanding || '0', 10);
    li.classList.toggle('weak-highlight', val < thr);
  });
  if (!document.getElementById('weak-panel').classList.contains('hidden')) renderWeakPanel(thr);
});

/* JSON import */
document.getElementById('import-json').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
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
    subjectsCache.push({ id: sub.id, name: data.subject });
    renderSidebar();
    await loadApp(sub.id);
    e.target.value = '';
    logInfo('import', 'JSON import successful', { subject: data.subject, lessons: sub.lessons });
    showToast('Import successful', 'success');
  } catch (err) {
    logError('import', 'JSON import failed', err.message);
    showToast('Import failed: ' + err.message, 'error');
  }
});

/* ----- Render ----- */
function render() {
  const d = appState;
  logInfo('render', 'Rendering app', { name: d.name, sections: d.sections?.length, totalLessons: d.total_lessons });
  const app = document.getElementById('app');
  app.innerHTML = '';

  const header = ce('div', 'subject-header');
  header.innerHTML = `
    <h1>${esc(d.name)}</h1>
    <div class="subject-meta">
      <span class="subject-average" style="color:${uColor(d.overall_average)}">
        ${fmtPct(d.overall_average)}
      </span>
      <span class="lesson-count">${d.total_lessons} lessons</span>
      <button class="history-btn" data-subject-history>Chart</button>
    </div>
    <div class="toolbar">
      <button class="btn" data-import-btn>Import</button>
      <button class="btn btn-danger" data-delete-subject>Delete Subject</button>
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

  header.querySelector('[data-delete-subject]').onclick = async () => {
    if (!confirm(`Delete subject "${d.name}" and all its data?`)) return;
    logInfo('render', 'Deleting subject', { subjectId: d.id, name: d.name });
    await api('DELETE', `/api/subjects/${d.id}`);
    subjectsCache = subjectsCache.filter(s => s.id !== d.id);
    renderSidebar();
    if (subjectsCache.length > 0) await loadApp(subjectsCache[0].id);
    else { appState = null; document.getElementById('app').innerHTML = ''; }
  };

  d.sections.forEach(s => {
    const sectionEl = renderSection(s);
    app.appendChild(sectionEl);
  });

  renderSidebar();

  const mobileName = document.getElementById('mobile-subject-name');
  if (mobileName) mobileName.textContent = d.name || '';
}

function renderSection(s) {
  const div = ce('div', 'section');
  const avg = s.average || 0;
  const header = ce('div', 'section-header');
  header.innerHTML = `
    <span class="toggle-icon">&#9660;</span>
    <span class="section-name">${esc(s.name)}</span>
    <span class="lesson-count">${s.lesson_count} lessons</span>
    <span class="average" style="color:${uColor(avg)}">${fmtPct(avg)}</span>
    <button class="history-btn" data-section-history="${s.id}">Chart</button>
  `;
  div.appendChild(header);

  const body = ce('div', 'section-body');
  s.chapters.forEach(ch => {
    const chEl = renderChapter(ch, s.id);
    body.appendChild(chEl);
  });
  div.appendChild(body);

  header.onclick = (e) => {
    if (e.target.closest('.history-btn')) return;
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

  return div;
}

function renderChapter(ch, sectionId) {
  const div = ce('div', 'chapter');
  const avg = ch.average || 0;
  const header = ce('div', 'chapter-header');
  header.innerHTML = `
    <span class="toggle-icon">&#9660;</span>
    <span class="chapter-name">${esc(ch.name)}</span>
    <span class="lesson-count">${ch.lesson_count} lessons</span>
    <span class="average" style="color:${uColor(avg)}">${fmtPct(avg)}</span>
    <button class="history-btn" data-chapter-history="${ch.id}">Chart</button>
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
    if (e.target.closest('.history-btn')) return;
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

  return div;
}

function renderLesson(l, chapterId) {
  const li = ce('li', 'lesson-item');
  li.dataset.lessonId = l.id;
  li.dataset.understanding = l.understanding;
  li.innerHTML = `
    <span class="lesson-name">${esc(l.name)}</span>
    <span class="understanding-display" style="color:${uColor(l.understanding)}"
          data-lesson-id="${l.id}">${fmtPctShort(l.understanding)}</span>
    <button class="history-btn" data-lesson-history="${l.id}">Chart</button>
  `;
  const display = li.querySelector('.understanding-display');
  display.onclick = (e) => {
    e.stopPropagation();
    logInfo('render', 'Lesson understanding edit clicked', { lessonId: l.id, name: l.name, currentValue: l.understanding });
    startEdit(display);
  };
  li.querySelector('[data-lesson-history]').onclick = () => {
    logInfo('render', 'Lesson history chart clicked', { lessonId: l.id, name: l.name });
    showLessonHistory(l.id, l.name);
  };
  return li;
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
  api('GET', `/api/lessons/${lessonId}/history`).then(points => {
    logInfo('chart', `Received ${points.length} history point(s) for lesson`, { lessonId, points });
    showChart(`${esc(lessonName)}`, points);
  }).catch(err => {
    logError('chart', 'Failed to fetch lesson history', { lessonId, error: err.message });
    showToast('Failed to load history: ' + err.message, 'error');
  });
}

function showAggHistory(type, id, label) {
  logInfo('chart', 'Fetching aggregate history', { type, id, label });
  api('GET', `/api/${type}s/${id}/history`).then(points => {
    logInfo('chart', `Received ${points.length} aggregate history point(s)`, { type, id, points });
    showChart(`${esc(label)} average over time`, points);
  }).catch(err => {
    logError('chart', 'Failed to fetch aggregate history', { type, id, error: err.message });
    showToast('Failed to load history: ' + err.message, 'error');
  });
}

function showChart(title, points) {
  const modal = document.getElementById('history-modal');
  const titleEl = document.getElementById('history-modal-title');

  if (!points || points.length < 2) {
    logInfo('chart', 'Not enough data points for chart, showing empty state', { title, pointCount: points?.length || 0 });
    titleEl.textContent = title;
    document.getElementById('history-chart').classList.add('hidden');
    document.getElementById('history-empty').classList.remove('hidden');
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
        borderColor: '#16A34A',
        backgroundColor: '#DCFCE7',
        fill: true,
        tension: 0.2,
        pointBackgroundColor: colors,
        pointRadius: 5,
        pointHoverRadius: 7,
        borderWidth: 2,
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
      <div class="weak-item-right"><span class="weak-badge">${fmtPctShort(it.understanding)}</span>
      <button class="btn" data-jump="${it.lessonId}">Go</button></div>`;
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
document.getElementById('modal-close').onclick = () => {
  document.getElementById('history-modal').classList.add('hidden');
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
};

document.getElementById('history-modal').querySelector('.modal-backdrop').onclick = () => {
  document.getElementById('modal-close').click();
};

document.getElementById('import-modal-close').onclick = () => {
  document.getElementById('import-modal').classList.add('hidden');
};

document.getElementById('import-modal').querySelector('.modal-backdrop').onclick = () => {
  document.getElementById('import-modal-close').click();
};

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.getElementById('modal-close').click();
    document.getElementById('import-modal-close').click();
  }
});

/* ----- Import ----- */
document.getElementById('import-execute').onclick = async () => {
  const text = document.getElementById('import-text').value.trim();
  const subjectName = document.getElementById('import-subject-name').value.trim() || 'Imported Subject';
  const status = document.getElementById('import-status');
  status.className = 'hidden';

  if (!text) {
    status.textContent = 'Please paste some markdown content.';
    status.className = 'error';
    status.classList.remove('hidden');
    return;
  }

  try {
    logInfo('import', 'Starting markdown import', { subjectName, textLength: text.length });
    const result = await parseAndImport(text, subjectName);
    logInfo('import', 'Markdown import successful', result);
    status.textContent = `Imported successfully: ${result.lessons} lessons across ${result.chapters} chapters in ${result.sections} sections.`;
    status.className = 'success';
    status.classList.remove('hidden');
    document.getElementById('import-text').value = '';
    await loadApp(result.subject_id);
  } catch (err) {
    logError('import', 'Markdown import failed', err.message);
    status.textContent = `Import failed: ${err.message}`;
    status.className = 'error';
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
  const thr = parseInt(document.getElementById('weak-threshold').value, 10);
  renderWeakPanel(thr);
  document.getElementById('weak-panel').classList.remove('hidden');
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

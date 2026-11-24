// Shared UI pieces: event binding, rows, import, quick capture, reminders, checklists, pickers.
import { html, raw, str, $, $$, api, dialog, toast, errorToast, options, saveStatus, KIND, KIND_ICON, ROLE, SOURCE, STATUS, sourceBadge, fmtSize } from './util.js';
import { S, T, byId, courses, courseName, topicsOf, create, patch, remove, link, checklistOf, remindersOf, targetInfo, dueReminders, reload } from './store.js';
import { fmtStamp, fmtDateTime, nowStamp, addMinutes, dueStamp, today, addDays, relDay } from './time.js';

// Event delegation for a rendered root. handlers: { act: (el, event) => … }
export function bind(root, handlers) {
  const pick = (e, attr) => { const el = e.target.closest(`[${attr}]`); return el && root.contains(el) ? [el, handlers[el.getAttribute(attr)]] : []; };
  root.onclick = e => { const [el, fn] = pick(e, 'data-act'); if (fn) { e.preventDefault(); Promise.resolve(fn(el, e)).catch(errorToast); } };
  root.onchange = e => { const [el, fn] = pick(e, 'data-change'); if (fn) Promise.resolve(fn(el, e)).catch(errorToast); };
  root.oninput = e => { const [el, fn] = pick(e, 'data-input'); if (fn) fn(el, e); };
  root.onsubmit = e => { const [el, fn] = pick(e, 'data-submit'); if (fn) { e.preventDefault(); Promise.resolve(fn(el, Object.fromEntries(new FormData(el)), e)).catch(errorToast); } };
}
export async function refresh() { (await import('./app.js')).refresh(); }

export const empty = (text, action = '') => html`<div class="empty-inline"><p>${text}</p>${action}</div>`;
export const statusPill = s => html`<span class="pill status-${s}">${STATUS[s]}</span>`;
export const courseOptions = (sel, { none = 'לא ממוין' } = {}) => html`<option value="">${none}</option>${courses().map(c => html`<option value="${c.id}" ${c.id === Number(sel) ? raw('selected') : ''}>${c.name}</option>`)}`;
export const crumbs = items => html`<nav class="crumbs" aria-label="מיקום">${items.map((it, i) => html`${i ? html`<span aria-hidden="true"> / </span>` : ''}${it[1] ? html`<a href="${it[1]}"><bdi>${it[0]}</bdi></a>` : html`<bdi>${it[0]}</bdi>`}`)}</nav>`;
export function courseCrumbs(courseId, extra = []) {
  const c = byId('courses', courseId);
  if (!c) return crumbs([['לא ממוין', '#/inbox'], ...extra]);
  const s = byId('semesters', c.semester_id);
  return crumbs([[s ? `${byId('years', s.year_id)?.name} · ${s.name}` : 'סמסטר', s ? `#/semester/${s.id}` : null], [c.name, `#/course/${c.id}`], ...extra]);
}

export function resourceRow(r, { showCourse = false, extra = '' } = {}) {
  const topics = S.data.resource_topics.filter(x => x.resource_id === r.id).map(x => byId('topics', x.topic_id)).filter(t => t && !t.deleted_at);
  const lesson = r.lesson_id ? byId('lessons', r.lesson_id) : null;
  return html`<li class="res-row">
    <span class="res-icon" aria-hidden="true">${KIND_ICON[r.kind] || '📦'}</span>
    <div class="res-main">
      <a class="res-title" href="#/r/${r.id}" dir="auto">${r.title}</a>
      <div class="res-meta">${sourceBadge(r.source)} <span>${KIND[r.kind] || r.kind}</span>${r.role && r.role !== 'material' ? html` · <span>${ROLE[r.role]}</span>` : ''}
        ${showCourse ? html` · <bdi>${courseName(r.course_id)}</bdi>` : ''}${lesson ? html` · <span>שיעור: <bdi>${lessonLabel(lesson)}</bdi></span>` : ''}
        ${topics.map(t => html` <a class="tag" href="#/topic/${t.id}">${t.name}</a>`)}${r.catch_up ? html` <span class="pill pill-warn">להשלמה</span>` : ''}</div>
    </div>${extra}</li>`;
}
export const lessonLabel = l => [l.title, l.date ? fmtDateTime(l.date) : ''].filter(Boolean).join(' · ') || `שיעור #${l.id}`;

// ---------- import ----------
const defaultSource = name => /chatgpt|gpt/i.test(name) ? 'chatgpt' : /claude/i.test(name) ? 'claude' : /\.(pdf|pptx?)$/i.test(name) ? 'lecturer' : 'me';
const defaultRole = name => /סילבוס|syllabus/i.test(name) ? 'syllabus' : /סיכום|summary/i.test(name) ? 'summary' : /תרגול|תרגיל|exercise/i.test(name) ? 'exercise' : /מטלה|עבודה|assignment/i.test(name) ? 'assignment' : /פתרון|תשובות|solution/i.test(name) ? 'solution' : 'material';

export async function importFiles(files, defaults = {}) {
  files = files.filter(f => f.size >= 0 && f.name);
  if (!files.length) return [];
  const courseId = defaults.course_id ?? null;
  const folderish = files.some(f => f.webkitRelativePath?.includes('/'));
  const v = await dialog(`ייבוא ${files.length} ${files.length === 1 ? 'קובץ' : 'קבצים'}`, html`
    <ul class="import-list">${files.slice(0, 30).map(f => html`<li><bdi>${f.webkitRelativePath || f.name}</bdi> <span class="muted">${fmtSize(f.size)}</span>${f.size === 0 ? html` <span class="pill pill-warn">קובץ ריק</span>` : ''}</li>`)}${files.length > 30 ? html`<li>ועוד ${files.length - 30}…</li>` : ''}</ul>
    <div class="form-grid">
      <label>קורס<select name="course_id">${courseOptions(courseId, { none: 'לא ממוין (תיבת הקבצים)' })}</select></label>
      <label>מקור<select name="source"><option value="auto">אוטומטי לפי סוג הקובץ</option>${options(SOURCE)}</select></label>
      <label>סוג חומר<select name="role"><option value="auto">אוטומטי לפי שם הקובץ</option>${options(ROLE)}</select></label>
      ${defaults.lesson_id ? html`<input type="hidden" name="lesson_id" value="${defaults.lesson_id}">` : ''}
      ${defaults.folder_id ? html`<input type="hidden" name="folder_id" value="${defaults.folder_id}">` : ''}
      ${defaults.topic_id ? html`<input type="hidden" name="topic_ids" value="${defaults.topic_id}">` : ''}
    </div>
    ${folderish ? html`<p class="hint">תתי־התיקיות ייווצרו כתיקיות בתוך הקורס.</p>` : ''}
    <p class="hint">הקבצים המקוריים נשמרים כפי שהם. אפשר לשייך נושאים, שיעור ותגיות גם אחר כך.</p>`, { submit: 'ייבוא' });
  if (!v) return [];
  const results = [];
  const folderCache = {};
  const cid = v.course_id ? Number(v.course_id) : null;
  let n = 0;
  const status = document.getElementById('save-status');
  for (const f of files) {
    n++;
    status.textContent = `מייבא ${n}/${files.length}…`;
    let folderId = v.folder_id || '';
    if (cid && f.webkitRelativePath?.includes('/')) folderId = await ensureFolderPath(cid, f.webkitRelativePath.split('/').slice(1, -1), folderCache, Number(v.folder_id) || null);
    const p = new URLSearchParams({ name: f.name, source: v.source === 'auto' ? defaultSource(f.name) : v.source, role: v.role === 'auto' ? defaultRole(f.name) : v.role });
    if (cid) p.set('course_id', cid);
    if (folderId) p.set('folder_id', folderId);
    if (v.lesson_id) p.set('lesson_id', v.lesson_id);
    if (v.topic_ids) p.set('topic_ids', v.topic_ids);
    try { results.push(await api('POST', '/api/upload?' + p, f)); } catch (e) { errorToast(new Error(`${f.name}: ${e.message}`)); }
  }
  status.textContent = 'הכול נשמר';
  const dups = results.filter(r => r.duplicates.length);
  await refresh();
  toast(`יובאו ${results.length} קבצים${dups.length ? ` · ${dups.length} מהם זהים לקבצים שכבר קיימים (הקובץ נשמר פעם אחת בלבד)` : ''}`,
    results.length === 1 ? { action: { label: 'פתיחה', run: () => { location.hash = `#/r/${results[0].resource.id}`; } } } : {});
  return results.map(r => r.resource);
}
async function ensureFolderPath(courseId, parts, cache, parentId) {
  let parent = parentId, key = String(parentId);
  for (const name of parts) {
    key += '/' + name;
    if (!cache[key]) {
      const existing = T('folders').find(f => f.course_id === courseId && (f.parent_id ?? null) === parent && f.name === name);
      cache[key] = existing?.id || (await create('folders', { course_id: courseId, parent_id: parent, name })).id;
    }
    parent = cache[key];
  }
  return parent || '';
}
export function pickFiles(defaults = {}, { directory = false } = {}) {
  const input = document.createElement('input');
  input.type = 'file'; input.multiple = true;
  if (directory) input.webkitdirectory = true;
  input.onchange = () => importFiles([...input.files], defaults);
  input.click();
}

// ---------- quick capture ----------
export async function quickCapture(kind = 'task') {
  const m = /^#\/(?:course|summary)\/(\d+)/.exec(location.hash);
  const cid = m ? +m[1] : '';
  const v = await dialog('הוספה מהירה', html`
    <div class="seg" role="radiogroup" aria-label="סוג">
      ${[['task', 'משימה'], ['note', 'פתק'], ['link', 'קישור'], ['file', 'קובץ']].map(([k, l]) => html`<label class="seg-item"><input type="radio" name="kind" value="${k}" ${k === kind ? raw('checked') : ''}> ${l}</label>`)}
    </div>
    <label>כותרת<input name="title" dir="auto" autofocus placeholder="למשל: לפתור שאלה 3 בתרגיל 2"></label>
    <label data-for="note">תוכן<textarea name="body" rows="4" dir="auto"></textarea></label>
    <label data-for="link">כתובת<input name="url" type="url" dir="ltr" placeholder="https://"></label>
    <div class="form-grid">
      <label>קורס<select name="course_id">${courseOptions(cid)}</select></label>
      <label data-for="task">תאריך יעד (לא חובה)<input type="date" name="due_date"></label>
    </div>
    <p class="hint" data-for="file">לאחר האישור ייפתח חלון לבחירת קבצים.</p>`, {
    submit: 'הוספה',
    onMount(d) {
      const sync = () => { const k = d.querySelector('[name=kind]:checked').value; $$('[data-for]', d).forEach(el => { el.hidden = el.dataset.for !== k; }); d.querySelector('[name=title]').closest('label').hidden = k === 'file'; };
      d.querySelectorAll('[name=kind]').forEach(r => r.onchange = sync); sync();
    },
    onSubmit(data) { if (data.kind !== 'file' && !data.title.trim() && !(data.kind === 'link' && data.url)) { toast('נא למלא כותרת', { error: true }); return false; } },
  });
  if (!v) return;
  const course_id = v.course_id ? Number(v.course_id) : null;
  if (v.kind === 'file') return pickFiles({ course_id });
  if (v.kind === 'task') { await create('tasks', { title: v.title.trim(), course_id, due_date: v.due_date || null, origin: 'capture' }); toast('המשימה נוספה'); return refresh(); }
  if (v.kind === 'note') { const r = await create('resources', { title: v.title.trim(), kind: 'note', source: 'me', role: 'notes', course_id, body: v.body || '' }); location.hash = `#/r/${r.id}`; return reload(); }
  if (v.kind === 'link') { await create('resources', { title: v.title.trim() || v.url, kind: 'link', url: v.url, source: 'other', course_id }); toast('הקישור נשמר'); return refresh(); }
}

// ---------- reminders ----------
const notified = new Set(JSON.parse(sessionStorage.getItem('notified') || '[]'));
export function reminderBar(notify = false) {
  const bar = $('#reminder-bar');
  if (!bar || !S.data) return;
  const due = dueReminders();
  bar.innerHTML = due.length ? str(html`<div class="reminders" role="region" aria-label="תזכורות">${due.map(r => {
    const info = targetInfo(r.target_type, r.target_id);
    return html`<div class="reminder"><span class="reminder-ico" aria-hidden="true">⏰</span>
      <div><strong dir="auto">${r.label || info.title}</strong><div class="small">${info.date ? html`מועד: ${fmtDateTime(info.date, info.time)}` : 'ללא מועד'} · תזכורת ל־${fmtStamp(r.remind_at)}</div></div>
      <a class="btn btn-sm" href="${info.href}">פתיחה</a>
      <button class="btn btn-sm" data-rem="snooze" data-id="${r.id}">דחייה…</button>
      <button class="btn btn-sm" data-rem="dismiss" data-id="${r.id}">סגירה</button></div>`;
  })}</div>`) : '';
  bar.onclick = async e => {
    const b = e.target.closest('[data-rem]');
    if (!b) return;
    const r = byId('reminders', b.dataset.id);
    try {
      if (b.dataset.rem === 'dismiss') await patch('reminders', r.id, { status: 'dismissed' });
      else { const at = await snoozeDialog(); if (!at) return; await patch('reminders', r.id, { remind_at: at, status: 'pending', offset_minutes: null }); toast(`נדחה ל־${fmtStamp(at)}`); }
      await refresh();
    } catch (err) { errorToast(err); }
  };
  if (notify && 'Notification' in window && Notification.permission === 'granted') {
    for (const r of due) {
      const k = `${r.id}@${r.remind_at}`;
      if (notified.has(k)) continue;
      notified.add(k);
      const info = targetInfo(r.target_type, r.target_id);
      new Notification('IJOS · תזכורת', { body: `${r.label || info.title}${info.date ? ` · ${fmtDateTime(info.date, info.time)}` : ''}`, tag: k, lang: 'he', dir: 'rtl' });
    }
    sessionStorage.setItem('notified', JSON.stringify([...notified]));
  }
}
export async function snoozeDialog() {
  const n = nowStamp();
  const choices = [['בעוד שעה', addMinutes(n, 60)], ['בעוד 3 שעות', addMinutes(n, 180)], ['מחר ב־09:00', `${addDays(today(), 1)}T09:00`], ['מחר ב־18:00', `${addDays(today(), 1)}T18:00`]];
  const v = await dialog('דחיית תזכורת', html`<fieldset class="stack"><legend>לאיזה מועד מדויק?</legend>
    ${choices.map(([l, at], i) => html`<label class="radio"><input type="radio" name="at" value="${at}" ${i === 0 ? raw('checked') : ''}> ${l} <span class="muted">(${fmtStamp(at)})</span></label>`)}
    <label class="radio"><input type="radio" name="at" value="custom"> מועד אחר: <input type="datetime-local" name="custom" value="${addMinutes(n, 60)}"></label></fieldset>`, { submit: 'דחייה' });
  if (!v) return null;
  return v.at === 'custom' ? v.custom || null : v.at;
}
export function remindersSection(type, id) {
  const list = remindersOf(type, id);
  return html`<section class="card"><h2 class="card-title">תזכורות</h2>
    ${list.length ? html`<ul class="plain">${list.map(r => html`<li class="row-between"><span>${fmtStamp(r.remind_at)}${r.offset_minutes != null ? html` <span class="muted small">(${offsetLabel(r.offset_minutes)})</span>` : ''}${r.remind_at <= nowStamp() && r.status === 'pending' ? html` <span class="pill pill-warn">הגיע הזמן</span>` : ''}</span>
      <button class="btn-link small" data-act="rem-del" data-id="${r.id}">הסרה</button></li>`)}</ul>` : html`<p class="muted small">אין תזכורות.</p>`}
    <button class="btn btn-sm" data-act="rem-add" data-type="${type}" data-id="${id}">+ תזכורת</button>
    <p class="hint">תזכורות מוצגות כשהאפליקציה פתוחה בדפדפן. אם היא סגורה — הן יופיעו בפתיחה הבאה.</p></section>`;
}
const offsetLabel = m => m === 0 ? 'במועד' : m % 1440 === 0 ? `${m / 1440} ימים לפני` : m % 60 === 0 ? `${m / 60} שעות לפני` : `${m} דקות לפני`;
export const reminderHandlers = {
  'rem-del': async el => { await remove('reminders', el.dataset.id).catch(() => patch('reminders', el.dataset.id, { status: 'dismissed' })); await refresh(); },
  'rem-add': async el => {
    const { type, id } = el.dataset;
    const info = targetInfo(type, +id);
    const due = dueStamp(info?.date, info?.time || '09:00');
    const v = await dialog('תזכורת חדשה', html`<fieldset class="stack"><legend>מתי להזכיר?</legend>
      ${due ? [[0, 'במועד עצמו'], [60, 'שעה לפני'], [1440, 'יום לפני'], [4320, '3 ימים לפני'], [10080, 'שבוע לפני']].map(([m, l], i) => html`<label class="radio"><input type="radio" name="when" value="${m}" ${i === 2 ? raw('checked') : ''}> ${l} <span class="muted">(${fmtStamp(addMinutes(due, -m))})</span></label>`) : html`<p class="muted small">לפריט אין מועד, לכן אפשר לבחור רק זמן מדויק.</p>`}
      <label class="radio"><input type="radio" name="when" value="custom" ${due ? '' : raw('checked')}> זמן מדויק: <input type="datetime-local" name="custom" value="${addMinutes(nowStamp(), 60)}"></label></fieldset>
      ${due && !info.time ? html`<p class="hint">למועד אין שעה — החישוב מניח 09:00 ביום היעד.</p>` : ''}`, { submit: 'הוספה' });
    if (!v) return;
    const offset = v.when === 'custom' ? null : Number(v.when);
    const at = offset == null ? v.custom : addMinutes(due, -offset);
    if (!at) return;
    await create('reminders', { target_type: type, target_id: +id, remind_at: at, offset_minutes: offset });
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    await refresh();
  },
};

// ---------- checklist ----------
export function checklistSection(type, id, title = 'רשימת צעדים') {
  const items = checklistOf(type, id);
  const done = items.filter(i => i.done).length;
  return html`<section class="card"><h2 class="card-title">${title} ${items.length ? html`<span class="muted small">(${done}/${items.length})</span>` : ''}</h2>
    <ul class="checklist">${items.map((c, i) => html`<li><label><input type="checkbox" data-change="chk-toggle" data-id="${c.id}" ${c.done ? raw('checked') : ''}> <span dir="auto" class="${c.done ? 'done' : ''}">${c.text}</span></label>
      <span class="row-tools"><button class="icon-btn" data-act="chk-move" data-id="${c.id}" data-dir="-1" aria-label="הזזה למעלה" ${i === 0 ? raw('disabled') : ''}>↑</button><button class="icon-btn" data-act="chk-move" data-id="${c.id}" data-dir="1" aria-label="הזזה למטה" ${i === items.length - 1 ? raw('disabled') : ''}>↓</button><button class="icon-btn" data-act="chk-del" data-id="${c.id}" aria-label="מחיקה">×</button></span></li>`)}</ul>
    <form class="inline-form" data-submit="chk-add" data-type="${type}" data-owner="${id}"><label class="sr-only" for="chk-${type}-${id}">צעד חדש</label><input id="chk-${type}-${id}" name="text" dir="auto" placeholder="צעד קונקרטי, למשל: לפתור שאלה 3" required><button class="btn btn-sm">הוספה</button></form></section>`;
}
export const checklistHandlers = {
  'chk-toggle': async el => { await patch('checklist', el.dataset.id, { done: el.checked }); await refresh(); },
  'chk-del': async el => { await api('DELETE', `/api/rows/checklist/${el.dataset.id}`); await refresh(); },
  'chk-add': async (form, data) => { const items = checklistOf(form.dataset.type, +form.dataset.owner); await create('checklist', { owner_type: form.dataset.type, owner_id: +form.dataset.owner, text: data.text.trim(), sort: items.length + 1 }); await refresh(); document.getElementById(`chk-${form.dataset.type}-${form.dataset.owner}`)?.focus(); },
  'chk-move': async el => { const c = byId('checklist', el.dataset.id); await reorder(checklistOf(c.owner_type, c.owner_id), c.id, +el.dataset.dir, 'checklist'); },
};
// Swap position within an ordered list and persist 'sort'.
export async function reorder(list, id, dir, table) {
  const i = list.findIndex(x => x.id === Number(id)), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  const arr = [...list];
  [arr[i], arr[j]] = [arr[j], arr[i]];
  await Promise.all(arr.map((x, k) => x.sort !== k + 1 ? patch(table, x.id, { sort: k + 1 }) : null));
  await refresh();
}

// ---------- pickers ----------
export async function pickResources(title, candidates, selected = [], { hint = '' } = {}) {
  const sel = new Set(selected.map(Number));
  const v = await dialog(title, html`${hint ? html`<p class="hint">${hint}</p>` : ''}
    <input type="search" class="filter-input" placeholder="סינון…" dir="auto" aria-label="סינון">
    <ul class="pick-list">${candidates.map(r => html`<li data-name="${r.title.toLowerCase()}"><label><input type="checkbox" name="r${r.id}" ${sel.has(r.id) ? raw('checked') : ''}> ${KIND_ICON[r.kind]} <span dir="auto">${r.title}</span> ${sourceBadge(r.source)} <span class="muted small"><bdi>${courseName(r.course_id)}</bdi></span></label></li>`)}</ul>
    ${candidates.length ? '' : html`<p class="muted">אין חומרים זמינים.</p>`}`, {
    wide: true,
    onMount(d) { const f = d.querySelector('.filter-input'); f.oninput = () => $$('.pick-list li', d).forEach(li => { li.hidden = !li.dataset.name.includes(f.value.toLowerCase()); }); },
  });
  if (!v) return null;
  return candidates.filter(r => v['r' + r.id]).map(r => r.id);
}
export async function pickTopics(courseId, selected = []) {
  const topics = topicsOf(courseId).filter(t => !t.archived);
  const sel = new Set(selected.map(Number));
  const v = await dialog('שיוך לנושאים', html`${topics.length ? html`<ul class="pick-list">${topics.map(t => html`<li><label><input type="checkbox" name="t${t.id}" ${sel.has(t.id) ? raw('checked') : ''}> <span dir="auto">${t.name}</span></label></li>`)}</ul>` : html`<p class="muted">עדיין אין נושאים בקורס.</p>`}
    <label>נושא חדש (לא חובה)<input name="new_topic" dir="auto" placeholder="למשל: לולאות"></label>`);
  if (!v) return null;
  const ids = topics.filter(t => v['t' + t.id]).map(t => t.id);
  if (v.new_topic?.trim()) ids.push((await create('topics', { course_id: courseId, name: v.new_topic.trim(), sort: topics.length + 1 })).id);
  return ids;
}
// Replace a join-table set: e.g. setLinks('resource_topics', 'resource_id', 5, 'topic_id', [1,2])
export async function setLinks(table, keyCol, keyId, valCol, ids, extra = {}) {
  const current = S.data[table].filter(x => x[keyCol] === Number(keyId)).map(x => x[valCol]);
  for (const id of current) if (!ids.includes(id)) await api('DELETE', `/api/join/${table}`, { [keyCol]: Number(keyId), [valCol]: id });
  for (const id of ids) if (!current.includes(id)) await link(table, { [keyCol]: Number(keyId), [valCol]: id, ...extra });
}

// Per-field save on change (forms of metadata). <input data-change="field" data-table data-id name> ; data-nullable → '' saves null; data-refresh → re-render.
export const fieldHandlers = {
  field: async el => {
    const { table, id } = el.dataset;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (v === '' && el.dataset.nullable !== undefined) v = null;
    if (el.dataset.num !== undefined && v !== null) v = Number(v);
    saveStatus(1);
    try { const row = await patch(table, id, { [el.name]: v }); Object.assign(byId(table, id), row); }
    catch (e) { saveStatus(0, true); setTimeout(() => saveStatus(0, false), 4000); throw e; }
    finally { saveStatus(-1); }
    if (el.dataset.refresh !== undefined) await refresh();
  },
  trash: async el => {
    const { table, id, label } = el.dataset;
    await remove(table, id);
    toast(`"${label || 'הפריט'}" הועבר לסל המחזור`, { action: { label: 'ביטול', run: async () => { await api('POST', `/api/rows/${table}/${id}/restore`); await refresh(); } } });
    if (el.dataset.go) { await reload(); location.hash = el.dataset.go; } else await refresh();
  },
};

export const dueLabel =(date, time) => date ? html`<span class="due">${fmtDateTime(date, time)} <span class="muted">(${relDay(date)})</span></span>` : html`<span class="muted">ללא מועד</span>`;

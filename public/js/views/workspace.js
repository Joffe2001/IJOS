// Study workspace: a resource (file/note/link) beside notes, another material or details.
import { html, raw, str, api, dialog, toast, options, parseTags, KIND, KIND_ICON, ROLE, SOURCE, sourceBadge } from '../util.js';
import { md } from '../md.js';
import { T, byId, create, patch, link, unlink, full, related, resTopics, activityOf, touch, autosave } from '../store.js';
import { bind, refresh, empty, courseCrumbs, fieldHandlers, pickTopics, pickResources, setLinks, courseOptions, lessonLabel } from '../ui.js';
import { fmtIso } from '../time.js';
import { folderPath } from './course.js';

const TEXT_STATUS = {
  extracted: 'תוכן הקובץ נכלל בחיפוש.',
  unsupported: 'תוכן הקובץ לא נסרק לחיפוש (PDF, תמונה או פורמט ישן). החיפוש מוצא אותו לפי כותרת, תגיות והערות בלבד.',
  failed: 'לא הצלחנו לקרוא את תוכן הקובץ לחיפוש. החיפוש מוצא אותו לפי כותרת, תגיות והערות בלבד.',
  none: '',
};
const PANELS = [['notes', 'הערות שלי'], ['side', 'חומר נוסף לצד'], ['details', 'פרטים']];

export async function workspace(root, [id], query) {
  const meta = byId('resources', id);
  if (!meta) throw new Error('החומר לא נמצא');
  const r = Object.assign(meta, await full('resources', id)); // same object as the store row: shared updated_at for autosave
  const act = activityOf('resource', r.id);
  touch('resource', r.id).catch(() => {});
  const rel = related(r.id);
  const notes = rel.filter(x => x.kind === 'note');
  const sources = rel.filter(x => x.kind !== 'note');
  const panel = query.get('panel') || (r.kind === 'note' ? (sources.length ? 'side' : 'details') : 'notes');
  const sideId = Number(query.get('with')) || (r.kind === 'note' ? sources[0]?.id : notes[0]?.id) || null;
  const layout = localStorage.getItem('ws-layout') || 'split';

  root.innerHTML = str(html`<div class="page page-wide">
    ${courseCrumbs(r.course_id, r.lesson_id && byId('lessons', r.lesson_id) ? [[lessonLabel(byId('lessons', r.lesson_id)), `#/lesson/${r.lesson_id}`], [r.title]] : [[r.title]])}
    ${r.deleted_at ? html`<aside class="notice notice-warn">החומר נמצא בסל המחזור. <button class="btn btn-sm" data-act="undelete">שחזור</button></aside>` : ''}
    <header class="ws-head">
      <div class="ws-title"><span class="res-icon" aria-hidden="true">${KIND_ICON[r.kind]}</span><h1 dir="auto">${r.title}</h1>
        <div class="res-meta">${sourceBadge(r.source)} <span>${KIND[r.kind]}</span>${r.role ? html` · ${ROLE[r.role]}` : ''} ${resTopics(r.id).map(t => html` <a class="tag" href="#/topic/${t.id}">${t.name}</a>`)}${r.catch_up ? html` <span class="pill pill-warn">להשלמה</span>` : ''}</div></div>
      <div class="actions">
        ${r.blob_sha ? html`<button class="btn btn-sm" data-act="open-ext" title="פותח עותק בתוכנה המתאימה במחשב">פתיחה בתוכנה</button><a class="btn btn-sm" href="/files/${r.id}?download=1">הורדה</a>` : ''}
        ${r.kind === 'note' ? html`<a class="btn btn-sm" href="/api/download/resource/${r.id}">ייצוא Markdown</a>` : ''}
        <button class="btn btn-sm" data-act="catchup">${r.catch_up ? 'הסרת סימון השלמה' : 'סימון להשלמה'}</button>
        <div class="seg seg-sm" role="group" aria-label="פריסה">${[['split', 'מפוצל'], ['main', 'רק החומר'], ['stack', 'זה מעל זה']].map(([k, l]) => html`<button class="seg-item ${layout === k ? 'on' : ''}" data-act="layout" data-v="${k}" aria-pressed="${layout === k}">${l}</button>`)}</div>
      </div>
    </header>
    <form class="resume-bar" data-submit="noop" aria-label="מיקום והצעד הבא">
      <label>איפה עצרתי <input name="position" dir="auto" value="${act?.position || ''}" placeholder="${r.kind === 'pdf' ? 'למשל: עמוד 12' : 'למשל: שקף 8 / שאלה 3'}" data-change="act"></label>
      <label class="grow">הצעד הבא <input name="next_step" dir="auto" value="${act?.next_step || ''}" placeholder="מה הדבר הראשון לעשות כשאחזור? למשל: לפתור תרגיל 4" data-change="act"></label>
      ${act && (act.next_step || act.position) ? html`<button type="button" class="btn btn-sm" data-act="finished">סיימתי עם זה</button>` : ''}
    </form>
    <div class="split layout-${layout}" id="split" style="--split:${localStorage.getItem('ws-split') || '55'}%">
      <section class="pane pane-main" aria-label="החומר">${viewerShell(r)}</section>
      <div class="divider" role="separator" tabindex="0" aria-orientation="vertical" aria-label="שינוי רוחב החלוניות (חיצים)" aria-valuenow="${localStorage.getItem('ws-split') || '55'}" aria-valuemin="25" aria-valuemax="75"></div>
      <section class="pane pane-side" aria-label="חלונית צד">
        <nav class="tabs tabs-sm" role="tablist">${PANELS.map(([k, l]) => html`<a role="tab" href="${panelHref(r.id, k, sideId)}" aria-selected="${k === panel}" ${k === panel ? raw('aria-current="page"') : ''}>${l}${k === 'notes' && notes.length ? html` <span class="count">${notes.length}</span>` : ''}</a>`)}</nav>
        <div class="pane-body" id="side-body">${sidePanel(panel, r, { notes, sources, sideId })}</div>
      </section>
    </div></div>`);

  const handlers = {
    ...fieldHandlers,
    noop: () => {},
    act: async el => { await touch('resource', r.id, { [el.name]: el.value.trim(), done: 0 }); },
    finished: async () => { await touch('resource', r.id, { done: 1, next_step: '' }); toast('הוסר מרשימת ההמשך'); await refresh(); },
    undelete: async () => { await api('POST', `/api/rows/resources/${r.id}/restore`); await refresh(); },
    'open-ext': async () => { await api('POST', `/api/open/${r.id}`); toast('נפתח עותק בתוכנה. שינויים שם לא נשמרים כאן — כדי לשמור, ייבאו את הקובץ המעודכן כ"גרסה חדשה" בלשונית "פרטים".', { ms: 9000 }); },
    catchup: async () => { await patch('resources', r.id, { catch_up: !r.catch_up }); await refresh(); },
    layout: async el => { localStorage.setItem('ws-layout', el.dataset.v); await refresh(); },
    ...sideHandlers(r, { notes, sources }),
  };
  bind(root, handlers);
  mountViewer(root.querySelector('.pane-main'), r, act, { editable: true });
  if (panel === 'side' && sideId) { const sr = byId('resources', sideId); if (sr && !sr.deleted_at) full('resources', sideId).then(x => mountViewer(root.querySelector('#side-viewer'), x, activityOf('resource', x.id), { editable: x.kind === 'note' })); }
  if (panel === 'notes' && sideId && byId('resources', sideId)?.kind === 'note' && r.kind !== 'note') full('resources', sideId).then(x => mountViewer(root.querySelector('#side-viewer'), x, null, { editable: true, compact: true }));
  mountDivider(root.querySelector('#split'));
}
const panelHref = (id, panel, withId) => `#/r/${id}?panel=${panel}${withId ? `&with=${withId}` : ''}`;

// ---------------- viewers ----------------
function viewerShell(r) { return html`<div class="viewer" data-kind="${r.kind}"><p class="loading">טוען…</p></div>`; }

export async function mountViewer(host, r, act, { editable = false, compact = false } = {}) {
  if (!host) return;
  const box = host.classList.contains('viewer') ? host : host.querySelector('.viewer') || host;
  const set = h => { box.innerHTML = str(h); };
  const fileUrl = `/files/${r.id}`;
  if (r.kind === 'note') return mountNote(box, r, { editable, compact });
  if (r.kind === 'link') return set(html`<div class="link-card"><p>קישור חיצוני:</p><p><bdi dir="ltr" class="mono">${r.url}</bdi></p><a class="btn btn-primary" href="${/^https?:/i.test(r.url || '') ? r.url : '#'}" target="_blank" rel="noopener noreferrer">פתיחה בלשונית חדשה</a><p class="hint">אתרים רבים חוסמים הצגה בתוך אפליקציות אחרות, ולכן הקישור נפתח בנפרד.</p></div>`);
  if (!r.blob_sha) return set(empty('אין קובץ מצורף לפריט הזה.'));
  // Missing-file check before embedding
  const head = await fetch(fileUrl, { method: 'HEAD' }).catch(() => null);
  if (!head || head.status === 410 || head.status === 404) return set(html`<div class="empty-inline error-state"><p><strong>הקובץ המקורי חסר בתיקיית הנתונים.</strong> הפרטים וההערות נשמרו. אפשר להעלות את הקובץ שוב כגרסה חדשה, או לשחזר מגיבוי.</p><button class="btn" data-act="new-version">העלאת הקובץ מחדש</button></div>`);
  if (r.kind === 'pdf') {
    const page = /(\d+)/.exec(act?.position || '')?.[1];
    return set(html`<iframe class="frame" title="${r.title}" src="${fileUrl}${page ? `#page=${page}` : ''}"></iframe><p class="hint">PDF מוצג בתצוגה של הדפדפן. ${page ? `נפתח בעמוד ${page} לפי "איפה עצרתי".` : 'רשמו מספר עמוד ב"איפה עצרתי" כדי לחזור אליו.'}</p>`);
  }
  if (r.kind === 'image') return set(html`<div class="img-view"><img src="${fileUrl}" alt="${r.title}"></div>`);
  if (r.kind === 'html') {
    const p = await api('GET', `/api/preview/${r.id}`).catch(() => ({ deps: [] }));
    set(html`<div class="html-bar small"><span>🛡️ הסיכום מוצג בסביבה מבודדת: אין לו גישה לנתוני האפליקציה או לרשת.</span>
      <label><input type="checkbox" data-change="html-opt" name="html_scripts" ${r.html_scripts ? raw('checked') : ''}> הפעלת סקריפטים של הסיכום</label>
      ${p.deps?.length ? html`<label><input type="checkbox" data-change="html-opt" name="html_external" ${r.html_external ? raw('checked') : ''}> טעינת ${p.deps.length} משאבים חיצוניים (<bdi dir="ltr">${p.deps.join(', ')}</bdi>)</label>` : ''}</div>
      ${p.deps?.length && !r.html_external ? html`<p class="hint">הסיכום מפנה לגופנים או סקריפטים מהאינטרנט שנחסמו — ייתכן שהעיצוב ייראה מעט שונה.</p>` : ''}
      ${r.html_scripts ? html`<p class="hint">כפתורים שמנסים לשמור מצב (כמו תיבות סימון) או להעתיק ללוח עשויים לא לעבוד בתצוגה המבודדת.</p>` : ''}
      <iframe class="frame frame-html" title="${r.title}" sandbox="${r.html_scripts ? 'allow-scripts ' : ''}allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" src="${fileUrl}?scripts=${r.html_scripts ? 1 : 0}&external=${r.html_external ? 1 : 0}"></iframe>`);
    return;
  }
  if (['slides', 'doc', 'sheet'].includes(r.kind)) {
    const p = await api('GET', `/api/preview/${r.id}`).catch(e => ({ status: 'failed', error: e.message }));
    const note = html`<p class="hint preview-note">תצוגת טקסט מקוצרת${r.kind === 'sheet' ? ' (ערכים בלבד, ללא עיצוב ונוסחאות מחושבות)' : ''}. לעיצוב המלא: "פתיחה בתוכנה".</p>`;
    if (p.status !== 'extracted') return set(html`<div class="empty-inline"><p>אין תצוגה מקדימה לקובץ הזה (${r.original_name?.split('.').pop()?.toUpperCase()}).</p><button class="btn" data-act="open-ext">פתיחה בתוכנה</button> <a class="btn" href="${fileUrl}?download=1">הורדה</a></div>`);
    if (p.type === 'slides') set(html`${note}<ol class="slides">${p.slides.map((s, i) => html`<li id="slide-${i + 1}"><h3>שקף ${i + 1}</h3>${s.length ? s.map(t => html`<p dir="auto">${t}</p>`) : html`<p class="muted small">(ללא טקסט — ייתכן שיש תמונה)</p>`}</li>`)}</ol>`);
    if (p.type === 'doc') set(html`${note}<div class="prose doc-preview">${p.paragraphs.map(x => /heading|כותרת|title/i.test(x.style) ? html`<h3 dir="auto">${x.text}</h3>` : html`<p dir="auto">${x.text}</p>`)}</div>`);
    if (p.type === 'sheet') set(html`${note}${p.sheets.map(s => html`<h3>${s.name}</h3><div class="table-wrap"><table class="table sheet">${s.rows.map(row => html`<tr>${row.map(c => html`<td dir="auto">${c}</td>`)}</tr>`)}</table></div>`)}`);
    restoreScroll(box, act, r.id);
    return;
  }
  if (['text', 'md', 'code'].includes(r.kind)) {
    const text = await fetch(fileUrl).then(x => x.text());
    set(r.kind === 'md' ? html`<div class="prose">${raw(md(text))}</div>` : html`<pre class="code" dir="ltr"><code>${text}</code></pre>`);
    restoreScroll(box, act, r.id);
    return;
  }
  set(html`<div class="empty-inline"><p>אין תצוגה מקדימה לסוג הקובץ הזה.</p><button class="btn" data-act="open-ext">פתיחה בתוכנה</button> <a class="btn" href="${fileUrl}?download=1">הורדה</a></div>`);
}
function restoreScroll(box, act, rid) {
  const sc = box.closest('.pane-body, .pane') || box;
  if (act?.scroll) requestAnimationFrame(() => { sc.scrollTop = act.scroll * (sc.scrollHeight - sc.clientHeight); });
  let t;
  sc.onscroll = () => { clearTimeout(t); t = setTimeout(() => { const max = sc.scrollHeight - sc.clientHeight; if (max > 0) touch('resource', rid, { scroll: +(sc.scrollTop / max).toFixed(3) }).catch(() => {}); }, 800); };
}

// Note editor: Markdown with live preview, autosave, quick inserts.
function mountNote(box, r, { editable, compact }) {
  const startEdit = editable && (!r.body || location.hash.includes('edit=1'));
  const mode = startEdit ? (compact ? 'edit' : localStorage.getItem('note-mode') || 'both') : 'view';
  box.innerHTML = str(html`<div class="note ${'mode-' + mode}">
    ${editable ? html`<div class="note-tools" role="toolbar" aria-label="עריכת פתק">
      <div class="seg seg-sm">${[['view', 'קריאה'], ['edit', 'עריכה'], ...(compact ? [] : [['both', 'עריכה + תצוגה']])].map(([k, l]) => html`<button type="button" class="seg-item ${mode === k ? 'on' : ''}" data-note-mode="${k}" aria-pressed="${mode === k}">${l}</button>`)}</div>
      <span class="tool-group">${[['**', '**', 'B', 'מודגש'], ['\n## ', '', 'H', 'כותרת'], ['\n- ', '', '•', 'רשימה'], ['`', '`', '</>', 'קוד בשורה'], ['\n```js\n', '\n```\n', '{ }', 'בלוק קוד'], ['$', '$', '∑', 'נוסחה'], ['\n$$\n', '\n$$\n', '∫', 'נוסחה בשורה נפרדת']].map(([a, b, l, t]) => html`<button type="button" class="tool" data-ins-a="${a}" data-ins-b="${b}" title="${t}" aria-label="${t}">${l}</button>`)}</span>
      ${compact ? html`<a class="btn btn-sm" href="#/r/${r.id}">פתיחה מלאה</a>` : ''}
    </div>` : ''}
    <div class="note-body"><textarea class="note-input md-input" dir="auto" aria-label="תוכן הפתק (Markdown)" placeholder="כתבו כאן… נתמך Markdown: ## כותרת, - רשימה, \`קוד\`, $x^2$ לנוסחאות">${r.body || ''}</textarea>
      <div class="note-preview prose" aria-live="off">${raw(md(r.body || '') || '<p class="muted">הפתק ריק. לחצו "עריכה" כדי להתחיל.</p>')}</div></div>
    <p class="hint small note-foot">נוצר ${fmtIso(r.created_at)} · עודכן <span class="upd">${fmtIso(r.updated_at)}</span> · נשמר אוטומטית</p></div>`);
  const ta = box.querySelector('.note-input'), pv = box.querySelector('.note-preview'), note = box.querySelector('.note');
  const saver = autosave({ table: 'resources', id: r.id, field: 'body', base: r, onSaved: row => { box.querySelector('.upd').textContent = fmtIso(row.updated_at); } });
  const draft = saver.draft();
  if (draft != null && draft !== (r.body || '')) {
    const bar = document.createElement('div');
    bar.className = 'notice notice-warn';
    bar.innerHTML = str(html`נמצאה טיוטה שלא נשמרה בשרת (למשל בגלל ניתוק). <button class="btn btn-sm" data-d="use">שחזור הטיוטה</button> <button class="btn btn-sm" data-d="drop">מחיקתה</button>`);
    box.prepend(bar);
    bar.onclick = e => { const d = e.target.dataset.d; if (!d) return; if (d === 'use') { ta.value = draft; saver.set(draft); pv.innerHTML = md(draft); } else saver.clearDraft(); bar.remove(); };
  }
  let pt;
  ta.addEventListener('input', () => { saver.set(ta.value); clearTimeout(pt); pt = setTimeout(() => { pv.innerHTML = md(ta.value); }, 200); });
  ta.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saver.flush(); } });
  box.addEventListener('click', e => {
    const m = e.target.closest('[data-note-mode]');
    if (m) { const k = m.dataset.noteMode; note.className = `note mode-${k}`; box.querySelectorAll('[data-note-mode]').forEach(b => { b.classList.toggle('on', b === m); b.setAttribute('aria-pressed', b === m); }); if (k !== 'view') { if (!compact) localStorage.setItem('note-mode', k); ta.focus(); } pv.innerHTML = md(ta.value); return; }
    const ins = e.target.closest('[data-ins-a]');
    if (ins) { const { insA: a, insB: b } = ins.dataset; const s = ta.selectionStart, en = ta.selectionEnd; ta.setRangeText(a + ta.value.slice(s, en) + b, s, en, 'end'); if (s === en) ta.selectionStart = ta.selectionEnd = s + a.length; ta.focus(); ta.dispatchEvent(new Event('input')); }
  });
}

// ---------------- side panel ----------------
function sidePanel(panel, r, { notes, sources, sideId }) {
  if (panel === 'notes') {
    if (r.kind === 'note') return html`<p class="muted small">זה פתק. מקורות מקושרים מוצגים בלשונית "חומר נוסף לצד".</p>`;
    return html`<div class="side-head"><button class="btn btn-sm btn-primary" data-act="new-note">+ פתק חדש על החומר</button><button class="btn btn-sm" data-act="link-note">קישור פתק קיים</button></div>
      ${notes.length ? html`<div class="note-picker" role="list">${notes.map(n => html`<a role="listitem" class="${n.id === sideId ? 'on' : ''}" href="${panelHref(r.id, 'notes', n.id)}" dir="auto">✏️ ${n.title}</a>`)}</div>
        ${sideId && notes.some(n => n.id === sideId) ? html`<div id="side-viewer" class="viewer"><p class="loading">טוען…</p></div>` : html`<p class="muted small">בחרו פתק להצגה.</p>`}`
        : empty('עדיין אין פתקים על החומר הזה. פתק חדש יקושר אליו אוטומטית.')}`;
  }
  if (panel === 'side') {
    const course = T('resources').filter(x => x.course_id === r.course_id && x.id !== r.id && x.course_id != null);
    const relIds = new Set([...sources, ...notes].map(x => x.id));
    return html`<label class="side-pick">להציג לצד:<select data-change="pick-side"><option value="">— בחרו חומר —</option>
      ${[...sources, ...notes].length ? html`<optgroup label="מקושרים">${[...sources, ...notes].map(x => html`<option value="${x.id}" ${x.id === sideId ? raw('selected') : ''}>${x.title}</option>`)}</optgroup>` : ''}
      <optgroup label="עוד בקורס">${course.filter(x => !relIds.has(x.id)).map(x => html`<option value="${x.id}" ${x.id === sideId ? raw('selected') : ''}>${KIND_ICON[x.kind]} ${x.title}</option>`)}</optgroup></select></label>
      ${sideId ? html`<p class="small"><a href="#/r/${sideId}">פתיחה כחומר ראשי</a>${!relIds.has(sideId) ? html` · <button class="btn-link small" data-act="relate" data-id="${sideId}">קישור קבוע בין החומרים</button>` : ''}</p><div id="side-viewer" class="viewer"><p class="loading">טוען…</p></div>` : html`<p class="muted small">למשל: מצגת המרצה לצד הסיכום שלכם.</p>`}`;
  }
  return detailsPanel(r);
}

function detailsPanel(r) {
  const tags = parseTags(r.tags).join(', ');
  const folders = T('folders').filter(f => f.course_id === r.course_id);
  const lessons = T('lessons').filter(l => l.course_id === r.course_id);
  const topics = resTopics(r.id);
  const rel = related(r.id);
  const f = (name, label, extra = '') => html`<label>${label}<input name="${name}" value="${r[name] ?? ''}" dir="auto" data-change="field" data-table="resources" data-id="${r.id}" ${raw(extra)}></label>`;
  return html`<div class="form-grid one">
    ${f('title', 'כותרת', 'data-refresh required')}
    <label>קורס<select name="course_id" data-change="field" data-table="resources" data-id="${r.id}" data-nullable data-num data-refresh>${courseOptions(r.course_id)}</select></label>
    ${r.course_id ? html`<label>תיקייה<select name="folder_id" data-change="field" data-table="resources" data-id="${r.id}" data-nullable data-num><option value="">ראש הקורס</option>${folders.map(x => html`<option value="${x.id}" ${x.id === r.folder_id ? raw('selected') : ''}>${folderPath(x.id)}</option>`)}</select></label>
    <label>שיעור<select name="lesson_id" data-change="field" data-table="resources" data-id="${r.id}" data-nullable data-num data-refresh><option value="">— ללא —</option>${lessons.map(l => html`<option value="${l.id}" ${l.id === r.lesson_id ? raw('selected') : ''}>${lessonLabel(l)}</option>`)}</select></label>` : ''}
    <div><span class="label">נושאים</span> ${topics.map(t => html`<a class="tag" href="#/topic/${t.id}">${t.name}</a> `)} ${r.course_id ? html`<button class="btn-link small" data-act="topics">עריכה</button>` : html`<span class="muted small">(יש לבחור קורס קודם)</span>`}</div>
    <label>סוג חומר<select name="role" data-change="field" data-table="resources" data-id="${r.id}" data-refresh>${options(ROLE, r.role)}</select></label>
    <label>מקור / מחבר<select name="source" data-change="field" data-table="resources" data-id="${r.id}" data-refresh>${options(SOURCE, r.source)}</select></label>
    <label>תגיות (מופרדות בפסיק)<input name="tags" value="${tags}" dir="auto" data-change="tags"></label>
    <label>הערות על החומר<textarea name="notes" rows="3" dir="auto" data-change="field" data-table="resources" data-id="${r.id}">${r.notes}</textarea></label>
    <div><span class="label">חומרים קשורים</span><ul class="plain small">${rel.map(x => html`<li><a href="#/r/${x.id}" dir="auto">${KIND_ICON[x.kind]} ${x.title}</a> <button class="btn-link small" data-act="unrelate" data-id="${x.id}">ניתוק</button></li>`)}</ul><button class="btn-link small" data-act="relate-pick">+ קישור לחומר</button></div>
    <div class="file-info small">${r.original_name ? html`<p>קובץ מקורי: <bdi>${r.original_name}</bdi></p>` : ''}
      ${TEXT_STATUS[r.text_status] ? html`<p>🔎 ${TEXT_STATUS[r.text_status]}</p>` : r.kind === 'note' ? html`<p>🔎 תוכן הפתק נכלל בחיפוש.</p>` : ''}
      <p>נוצר ${fmtIso(r.created_at)} · עודכן ${fmtIso(r.updated_at)}</p></div>
    <details id="versions" data-rid="${r.id}"><summary>היסטוריית גרסאות</summary><div class="versions-body"><p class="loading">טוען…</p></div></details>
    <div class="toolbar">${r.blob_sha ? html`<button class="btn btn-sm" data-act="new-version">העלאת גרסה חדשה של הקובץ</button>` : ''}
      <button class="btn btn-sm danger" data-act="trash" data-table="resources" data-id="${r.id}" data-label="${r.title}" data-go="${r.course_id ? `#/course/${r.course_id}/materials` : '#/inbox'}">העברה לסל המחזור</button></div></div>`;
}

function sideHandlers(r, { notes }) {
  return {
    'pick-side': el => { location.hash = panelHref(r.id, 'side', el.value || ''); },
    'new-note': async () => {
      const n = await create('resources', { title: `הערות — ${r.title}`, kind: 'note', source: 'me', role: 'notes', course_id: r.course_id, lesson_id: r.lesson_id, body: '' });
      await link('resource_relations', { resource_id: n.id, related_id: r.id });
      for (const t of resTopics(r.id)) await link('resource_topics', { resource_id: n.id, topic_id: t.id });
      await refresh0(); location.hash = panelHref(r.id, 'notes', n.id) + '&edit=1';
    },
    'link-note': async () => {
      const cands = T('resources').filter(x => x.kind === 'note' && x.id !== r.id);
      const ids = await pickResources('קישור פתקים לחומר', cands, notes.map(n => n.id));
      if (!ids) return;
      for (const n of cands) { const has = notes.some(x => x.id === n.id); if (ids.includes(n.id) && !has) await link('resource_relations', { resource_id: n.id, related_id: r.id }); if (!ids.includes(n.id) && has) await unrelate(r.id, n.id); }
      await refresh();
    },
    relate: async el => { await link('resource_relations', { resource_id: r.id, related_id: +el.dataset.id }); toast('החומרים קושרו'); await refresh(); },
    'relate-pick': async () => {
      const cur = related(r.id).map(x => x.id);
      const cands = T('resources').filter(x => x.id !== r.id && (x.course_id === r.course_id || cur.includes(x.id)));
      const ids = await pickResources('חומרים קשורים', cands, cur, { hint: 'למשל: מצגת המקור של סיכום, או פתרון של תרגיל.' });
      if (!ids) return;
      for (const id of cur) if (!ids.includes(id)) await unrelate(r.id, id);
      for (const id of ids) if (!cur.includes(id)) await link('resource_relations', { resource_id: r.id, related_id: id });
      await refresh();
    },
    unrelate: async el => { await unrelate(r.id, +el.dataset.id); await refresh(); },
    topics: async () => { const ids = await pickTopics(r.course_id, resTopics(r.id).map(t => t.id)); if (ids) { await setLinks('resource_topics', 'resource_id', r.id, 'topic_id', ids); await refresh(); } },
    tags: async el => { const tags = el.value.split(/[,،]/).map(x => x.trim()).filter(Boolean); Object.assign(r, await patch('resources', r.id, { tags })); },
    'html-opt': async el => { await patch('resources', r.id, { [el.name]: el.checked }); await refresh(); },
    'new-version': () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.onchange = async () => {
        const f = input.files[0];
        if (!f) return;
        await api('POST', `/api/upload?${new URLSearchParams({ name: f.name, resource_id: r.id })}`, f);
        toast('הגרסה החדשה נשמרה. הגרסה הקודמת זמינה בהיסטוריה.'); await refresh();
      };
      input.click();
    },
  };
}
const refresh0 = () => import('../store.js').then(m => m.reload());
async function unrelate(a, b) { await unlink('resource_relations', { resource_id: a, related_id: b }); await unlink('resource_relations', { resource_id: b, related_id: a }); }

// Versions list (loaded lazily when <details> opens)
document.addEventListener('toggle', async e => {
  const d = e.target;
  if (d.id !== 'versions' || !d.open) return;
  const rid = +d.dataset.rid;
  const list = await api('GET', `/api/versions/${rid}`);
  d.querySelector('.versions-body').innerHTML = str(list.length ? html`<ul class="plain small">${list.map(v => html`<li class="row-between"><span>${fmtIso(v.created_at)} · ${v.label}${v.original_name ? html` · <bdi>${v.original_name}</bdi>` : ''}${v.body != null ? ` · ${v.body.length} תווים` : ''}</span>
    <span>${v.blob_sha ? html`<a href="/files/${rid}?v=${v.id}&download=1">הורדה</a> ` : ''}${v.body != null ? html`<button class="btn-link small" data-ver-view="${v.id}">הצגה</button> ` : ''}<button class="btn-link small" data-ver-restore="${v.id}">שחזור</button></span></li>`)}</ul>` : html`<p class="muted">אין גרסאות קודמות. לפתקים נשמרת גרסה אוטומטית לכל היותר פעם בחצי שעה של עריכה.</p>`);
  d.onclick = async ev => {
    const view = ev.target.dataset.verView, rest = ev.target.dataset.verRestore;
    if (view) { const v = list.find(x => x.id === +view); dialog('גרסה קודמת', html`<div class="prose">${raw(md(v.body))}</div>`, { submit: null, cancel: 'סגירה', wide: true }); }
    if (rest) { await api('POST', `/api/versions/${rest}/restore`); toast('הגרסה שוחזרה. המצב שלפני השחזור נשמר בהיסטוריה.'); await refresh(); }
  };
}, true);

// Draggable + keyboard-resizable divider
function mountDivider(split) {
  const div = split?.querySelector('.divider');
  if (!div) return;
  const setPct = p => { p = Math.max(25, Math.min(75, p)); split.style.setProperty('--split', p + '%'); div.setAttribute('aria-valuenow', Math.round(p)); localStorage.setItem('ws-split', Math.round(p)); };
  div.onpointerdown = e => {
    div.setPointerCapture(e.pointerId);
    split.classList.add('dragging');
    const rect = split.getBoundingClientRect();
    div.onpointermove = ev => setPct(((rect.right - ev.clientX) / rect.width) * 100); // RTL: main pane is on the right
    div.onpointerup = () => { div.onpointermove = null; split.classList.remove('dragging'); };
  };
  div.onkeydown = e => {
    const cur = Number(div.getAttribute('aria-valuenow'));
    if (e.key === 'ArrowLeft') { setPct(cur + 5); e.preventDefault(); }
    if (e.key === 'ArrowRight') { setPct(cur - 5); e.preventDefault(); }
  };
}

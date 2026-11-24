// Summaries: per course, any number of summaries organised in folders (any depth). Versions per course.
import { html, raw, str, api, dialog, toast, confirmDlg } from '../util.js';
import { md } from '../md.js';
import { S, T, byId, courses, topicsOf, create, patch, autosave, reload, full } from '../store.js';
import { bind, refresh, empty, courseCrumbs, pickResources, fieldHandlers, setLinks } from '../ui.js';
import { fmtIso } from '../time.js';

const TEMPLATE = '### הגדרות\n- **מונח** — הגדרה\n\n### הסברים\n\n### דוגמאות\n\n### טעויות נפוצות\n';
const byOrder = (a, b) => a.sort - b.sort || (a.title || a.name).localeCompare(b.title || b.name, 'he');
const summariesOf = cid => T('summary_chapters').filter(x => x.course_id === cid);
const foldersOf = cid => T('summary_folders').filter(f => f.course_id === cid);
const sourcesOf = id => S.data.summary_sources.filter(s => s.chapter_id === id).map(s => byId('resources', s.resource_id)).filter(r => r && !r.deleted_at);
const head = (c, sub) => courseCrumbs(c.id, [['סיכומים', `#/summary/${c.id}`], ...(sub ? [[sub]] : [])]);

// A summary whose folder was deleted shows at the top level instead of disappearing.
function folderOf(x, cid) { const f = x.folder_id && byId('summary_folders', x.folder_id); return f && !f.deleted_at && f.course_id === cid ? f.id : null; }
function folderPath(id) { const out = []; for (let f = id && byId('summary_folders', id); f && out.length < 20; f = f.parent_id && byId('summary_folders', f.parent_id)) out.unshift(f.name); return out.join(' / '); }
function folderOptions(cid, sel, skip = null) {
  const out = [], walk = (pid, depth) => foldersOf(cid).filter(f => (f.parent_id || null) === pid && f.id !== skip).sort(byOrder).forEach(f => { out.push(html`<option value="${f.id}" ${f.id === sel ? raw('selected') : ''}>${'  '.repeat(depth)}📁 ${f.name}</option>`); walk(f.id, depth + 1); });
  walk(null, 0);
  return html`<option value="">ראשי (בלי תיקייה)</option>${out}`;
}

// ---------------- all courses ----------------
export function overview(root) {
  const list = courses();
  const recent = T('summary_chapters').filter(x => byId('courses', x.course_id) && !byId('courses', x.course_id).deleted_at).sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')).slice(0, 6);
  root.innerHTML = str(html`<div class="page"><header class="page-head"><div><h1>סיכומים</h1><p class="muted">כל קורס מקבל ספרייה משלו: כמה סיכומים שרוצים, בתיקיות שאתם מחליטים עליהן.</p></div></header>
    ${list.length ? html`<div class="course-strip">${list.map(c => { const n = summariesOf(c.id).length; return html`<a class="course-tile" href="#/summary/${c.id}"><span class="course-badge" style="--c:${c.color || 'var(--accent)'}" aria-hidden="true">${c.icon || [...c.name.replace(/^[^\p{L}]+/u, '')][0] || '•'}</span><span><strong><bdi>${c.name}</bdi></strong><span class="muted small">${n ? `${n} סיכומים` : 'עוד אין סיכומים'}</span></span></a>`; })}</div>` : html`<div class="card">${empty('עוד אין קורסים. הוסיפו קורס בעמוד הסמסטר.')}</div>`}
    ${recent.length ? html`<section class="card"><h2 class="card-title">עודכנו לאחרונה</h2><ul class="plain">${recent.map(x => html`<li class="row-between"><a href="#/summary/${x.course_id}?s=${x.id}" dir="auto">${x.title}</a><span class="muted small"><bdi>${byId('courses', x.course_id).name}</bdi> · ${fmtIso(x.updated_at)}</span></li>`)}</ul></section>` : ''}</div>`);
}

// ---------------- one course ----------------
export function summary(root, [cid], query) {
  const c = byId('courses', cid);
  if (!c || c.deleted_at) throw new Error('הקורס לא נמצא');
  const items = summariesOf(c.id), folders = foldersOf(c.id);
  const sel = byId('summary_chapters', query.get('s'));
  const cur = sel && !sel.deleted_at && sel.course_id === c.id ? sel : null;
  const editing = !!cur && query.get('edit') === '1';
  const open = new Set(); for (let f = cur && folderOf(cur, c.id); f; f = byId('summary_folders', f)?.parent_id) open.add(f);

  const tree = pid => {
    const fs = folders.filter(f => (f.parent_id || null) === pid).sort(byOrder);
    const ss = items.filter(x => folderOf(x, c.id) === pid).sort(byOrder);
    return html`${fs.map(f => html`<li class="sf-folder" data-drop="${f.id}"><details ${open.has(f.id) || folders.length <= 6 ? raw('open') : ''}><summary><span class="sf-name"><span aria-hidden="true">📁</span> <bdi>${f.name}</bdi> <span class="muted small">${items.filter(x => folderOf(x, c.id) === f.id).length || ''}</span></span>
        <span class="sf-tools"><button class="icon-btn" data-act="new" data-folder="${f.id}" aria-label="סיכום חדש בתיקייה ${f.name}" title="סיכום חדש כאן">+</button><button class="icon-btn" data-act="folder-menu" data-id="${f.id}" aria-label="אפשרויות לתיקייה ${f.name}" title="שינוי שם, תת־תיקייה, מחיקה">⋯</button></span></summary>
        <ul class="sf-list">${tree(f.id)}</ul></details></li>`)}
      ${ss.map(x => html`<li class="sf-item" data-title="${x.title.toLowerCase()}"><a href="#/summary/${c.id}?s=${x.id}" draggable="true" data-drag="${x.id}" ${cur?.id === x.id ? raw('aria-current="page"') : ''}><span aria-hidden="true">📄</span> <bdi>${x.title}</bdi></a></li>`)}`;
  };

  root.innerHTML = str(html`<div class="page page-wide">${head(c)}
    <header class="page-head"><div><h1>סיכומים · <bdi>${c.name}</bdi></h1><p class="muted">${items.length ? `${items.length} סיכומים${folders.length ? ` ב־${folders.length} תיקיות` : ''}` : 'כאן נבנה הסיכום שלכם לקורס'}</p></div>
      <div class="actions"><button class="btn btn-primary" data-act="new">+ סיכום</button><button class="btn" data-act="new-folder">+ תיקייה</button>
        ${items.length ? html`<a class="btn" href="/api/download/summary/${c.id}">ייצוא</a><a class="btn" href="#/summary/${c.id}/versions">גרסאות קודמות</a>` : ''}</div></header>
    <nav class="tabs" aria-label="אזורי הקורס"><a href="#/course/${c.id}">חזרה לקורס</a><a href="#/summary/${c.id}" aria-current="page">סיכומים</a></nav>
    ${items.length || folders.length ? html`<div class="summary-layout">
      <aside class="toc card sf-tree" aria-label="הסיכומים של הקורס">
        ${items.length > 6 ? html`<label class="sr-only" for="sf-filter">חיפוש סיכום</label><input id="sf-filter" type="search" placeholder="חיפוש לפי שם…" dir="auto">` : ''}
        <ul class="sf-list sf-root" data-drop="">${tree(null)}</ul>
        <p class="hint">גוררים סיכום לתיקייה כדי להעביר אותו.</p></aside>
      <article class="summary-doc">${cur ? docView(c, cur, editing) : html`<div class="card sf-welcome">${empty(items.length ? 'בחרו סיכום מהרשימה, או צרו חדש.' : 'התיקיות מוכנות. עכשיו הסיכום הראשון.', html`<button class="btn btn-primary" data-act="new">+ סיכום</button>`)}</div>`}</article></div>`
    : html`<div class="card empty-hero"><h2>הסיכום הראשון שלכם לקורס</h2><p>כותבים כמה סיכומים שרוצים: לפי נושא, לפי שיעור או לקראת מבחן. אפשר לסדר אותם בתיקיות, להוסיף נוסחאות וקוד, ולחזור לכל גרסה קודמת.</p>
      <div class="actions"><button class="btn btn-primary" data-act="new">+ סיכום ראשון</button><button class="btn" data-act="new-folder">+ תיקייה</button>${topicsOf(c.id).length ? html`<button class="btn" data-act="per-topic">סיכום לכל נושא (${topicsOf(c.id).length})</button>` : ''}</div></div>`}
  </div>`);

  const go = (id, edit) => { location.hash = `#/summary/${c.id}?s=${id}${edit ? '&edit=1' : ''}`; };
  bind(root, {
    ...fieldHandlers,
    new: el => newSummary(c, el.dataset.folder ? +el.dataset.folder : cur ? folderOf(cur, c.id) : null).then(x => x && go(x.id, true)),
    'new-folder': () => newFolder(c, null),
    'per-topic': async () => { for (const [i, t] of topicsOf(c.id).entries()) await create('summary_chapters', { course_id: c.id, topic_id: t.id, title: t.name, body_md: '', sort: i + 1 }); await refresh(); },
    'folder-menu': el => folderMenu(c, byId('summary_folders', el.dataset.id)),
    edit: () => go(cur.id, true),
    done: () => go(cur.id, false),
    sources: async () => {
      const ids = await pickResources('על מה הסיכום מבוסס', T('resources').filter(r => r.course_id === c.id), sourcesOf(cur.id).map(r => r.id), { hint: 'החומרים שהסיכום נשען עליהם, כדי שיהיה קל לחזור למקור.' });
      if (ids) { await setLinks('summary_sources', 'chapter_id', cur.id, 'resource_id', ids); await refresh(); }
    },
    del: async () => {
      if (!(await confirmDlg('מחיקת סיכום', `למחוק את "${cur.title}"? הוא עובר לסל המחזור, ואפשר להחזיר אותו משם.`, 'מחיקה'))) return;
      await api('POST', `/api/summary/${c.id}/snapshot`, { reason: `לפני מחיקת "${cur.title}"` });
      await api('DELETE', `/api/rows/summary_chapters/${cur.id}`);
      toast('הסיכום הועבר לסל המחזור'); location.hash = `#/summary/${c.id}`; await reload();
    },
  });

  // drag a summary onto a folder (or the top of the list) to move it
  root.querySelectorAll('[data-drag]').forEach(a => a.addEventListener('dragstart', e => { e.dataTransfer.setData('text/x-summary', a.dataset.drag); e.dataTransfer.effectAllowed = 'move'; }));
  root.querySelectorAll('[data-drop]').forEach(t => {
    t.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/x-summary')) { e.preventDefault(); e.stopPropagation(); t.classList.add('drop-on'); } });
    t.addEventListener('dragleave', () => t.classList.remove('drop-on'));
    t.addEventListener('drop', async e => {
      e.preventDefault(); e.stopPropagation(); t.classList.remove('drop-on');
      const id = +e.dataTransfer.getData('text/x-summary'), to = t.dataset.drop ? +t.dataset.drop : null;
      if (!id || folderOf(byId('summary_chapters', id), c.id) === to) return;
      await patch('summary_chapters', id, { folder_id: to }); toast(to ? `הועבר ל"${folderPath(to)}"` : 'הועבר לרשימה הראשית'); await refresh();
    });
  });
  const filter = root.querySelector('#sf-filter');
  if (filter) filter.oninput = () => { const v = filter.value.trim().toLowerCase(); root.querySelectorAll('.sf-item').forEach(li => { li.hidden = !!v && !li.dataset.title.includes(v); }); root.querySelectorAll('.sf-folder details').forEach(d => { if (v) d.open = true; }); };
  if (editing) mountEditor(root, cur);
}

function docView(c, x, editing) {
  const src = sourcesOf(x.id);
  const f = (field, extra = '') => raw(`data-change="field" data-table="summary_chapters" data-id="${x.id}" ${extra}`);
  return html`<section class="card chapter sf-doc">
    <header class="chapter-head">${editing ? html`<label class="sr-only" for="sf-title">שם הסיכום</label><input id="sf-title" class="sf-title" name="title" value="${x.title}" dir="auto" ${f('title', 'data-refresh')}>` : html`<h2 dir="auto">${x.title}</h2>`}
      <span class="row-tools">${editing ? html`<button class="btn btn-sm btn-primary" data-act="done">סיום עריכה</button>` : html`<button class="btn btn-sm btn-primary" data-act="edit">עריכה</button>`}<button class="btn-link small danger" data-act="del">מחיקה</button></span></header>
    <div class="sf-meta small">
      <label>תיקייה <select name="folder_id" ${f('folder_id', 'data-nullable data-num data-refresh')}>${folderOptions(c.id, folderOf(x, c.id))}</select></label>
      <label>נושא <select name="topic_id" ${f('topic_id', 'data-nullable data-num')}><option value="">ללא</option>${topicsOf(c.id).map(t => html`<option value="${t.id}" ${t.id === x.topic_id ? raw('selected') : ''}>${t.name}</option>`)}</select></label>
      <span class="muted">עודכן ${fmtIso(x.updated_at)}</span>
      <span>מקורות: ${src.length ? src.map(r => html`<a href="#/r/${r.id}" dir="auto">${r.title}</a> `) : html`<span class="muted">לא נבחרו</span> `}<button class="btn-link small" data-act="sources">${src.length ? 'שינוי' : 'בחירה'}</button></span></div>
    ${editing ? html`<div class="split-edit"><textarea id="ch-editor" class="md-input" dir="auto" aria-label="תוכן הסיכום" placeholder="כותבים כאן. # כותרת, **מודגש**, - רשימה, $x^2$ לנוסחה, \`\`\` לקוד.">${x.body_md}</textarea><div class="prose" id="ch-preview" aria-live="off">${raw(md(x.body_md))}</div></div>
      <p class="hint">נשמר אוטומטית תוך כדי כתיבה. גרסה קודמת נשמרת בהיסטוריה לפחות פעם בחצי שעה של עריכה.</p>`
      : html`<div class="prose">${raw(md(x.body_md, { shift: 1 }) || '')}</div>${x.body_md.trim() ? '' : html`<p class="muted">הסיכום ריק. <button class="btn-link" data-act="edit">להתחיל לכתוב</button></p>`}`}</section>`;
}
function mountEditor(root, x) {
  const ta = root.querySelector('#ch-editor'), pv = root.querySelector('#ch-preview');
  if (!ta) return;
  const s = autosave({ table: 'summary_chapters', id: x.id, field: 'body_md', base: x });
  ta.oninput = () => { s.set(ta.value); pv.innerHTML = md(ta.value); };
  if (!root.querySelector('#sf-title') || x.title !== 'סיכום חדש') ta.focus(); else root.querySelector('#sf-title').select();
}

async function newSummary(c, folderId) {
  const v = await dialog('סיכום חדש', html`<label>שם<input name="title" dir="auto" required autofocus placeholder="למשל: שבוע 3 · לולאות"></label>
    <div class="form-grid"><label>תיקייה<select name="folder_id">${folderOptions(c.id, folderId)}</select></label>
      <label>נושא (לא חובה)<select name="topic_id"><option value="">ללא</option>${topicsOf(c.id).map(t => html`<option value="${t.id}">${t.name}</option>`)}</select></label></div>
    <label class="check"><input type="checkbox" name="tpl"> להתחיל עם שלד: הגדרות, הסברים, דוגמאות, טעויות נפוצות</label>`, { submit: 'יצירה' });
  if (!v) return null;
  const fid = v.folder_id ? +v.folder_id : null;
  const x = await create('summary_chapters', { course_id: c.id, folder_id: fid, title: v.title.trim(), topic_id: v.topic_id ? +v.topic_id : null, body_md: v.tpl ? TEMPLATE : '', sort: summariesOf(c.id).filter(y => folderOf(y, c.id) === fid).length + 1 });
  await reload();
  return x;
}
async function newFolder(c, parentId) {
  const v = await dialog(parentId ? `תת־תיקייה בתוך "${byId('summary_folders', parentId).name}"` : 'תיקייה חדשה', html`<label>שם<input name="name" dir="auto" required autofocus placeholder="למשל: לקראת מבחן"></label>`, { submit: 'יצירה' });
  if (!v) return;
  await create('summary_folders', { course_id: c.id, parent_id: parentId, name: v.name.trim(), sort: foldersOf(c.id).length + 1 });
  await refresh();
}
async function folderMenu(c, f) {
  const v = await dialog(`תיקייה: ${f.name}`, html`<label>שם<input name="name" value="${f.name}" dir="auto" required></label>
    <label>בתוך<select name="parent_id">${folderOptions(c.id, f.parent_id, f.id)}</select></label>
    <div class="row-between"><button type="button" class="btn btn-sm" data-sub>+ תת־תיקייה</button><button type="button" class="btn btn-sm danger" data-del>מחיקת התיקייה</button></div>`, {
    onMount: d => {
      d.querySelector('[data-sub]').onclick = () => { d.querySelector('[data-x]').click(); newFolder(c, f.id); };
      d.querySelector('[data-del]').onclick = async () => {
        d.querySelector('[data-x]').click();
        if (!(await confirmDlg('מחיקת תיקייה', `למחוק את התיקייה "${f.name}"? הסיכומים והתיקיות שבתוכה לא נמחקים: הם עוברים לתיקייה שמעליה.`, 'מחיקה'))) return;
        for (const x of summariesOf(c.id).filter(x => x.folder_id === f.id)) await patch('summary_chapters', x.id, { folder_id: f.parent_id || null });
        for (const k of foldersOf(c.id).filter(k => k.parent_id === f.id)) await patch('summary_folders', k.id, { parent_id: f.parent_id || null });
        await api('DELETE', `/api/rows/summary_folders/${f.id}`);
        toast('התיקייה נמחקה, התוכן שלה נשמר'); await reload();
      };
    },
  });
  if (!v) return;
  // a folder cannot move into its own subfolder
  let p = v.parent_id ? +v.parent_id : null; for (let k = p; k; k = byId('summary_folders', k)?.parent_id) if (k === f.id) p = f.parent_id;
  await patch('summary_folders', f.id, { name: v.name.trim(), parent_id: p });
  await refresh();
}

// ---------------- versions ----------------
export async function versions(root, [cid], query) {
  const c = byId('courses', cid);
  const list = T('summary_versions').filter(v => v.course_id === c.id).sort((a, b) => b.id - a.id);
  const sel = Number(query.get('v')) || null;
  const v = sel ? await full('summary_versions', sel) : null;
  const snap = v ? JSON.parse(v.snapshot) : null;
  root.innerHTML = str(html`<div class="page">${head(c, 'גרסאות קודמות')}
    <header class="page-head"><div><h1>גרסאות קודמות · <bdi>${c.name}</bdi></h1><p class="muted">גרסה של כל הסיכומים בקורס נשמרת לפני מחיקה ושחזור, וגם במהלך עריכה (לכל היותר פעם בחצי שעה).</p></div></header>
    <div class="grid-sidebar"><section class="card"><ul class="plain">${list.map(x => html`<li><a href="#/summary/${c.id}/versions?v=${x.id}" ${x.id === sel ? raw('aria-current="true"') : ''}>${fmtIso(x.created_at)}</a> <span class="muted small">${x.reason}</span></li>`)}</ul>${list.length ? '' : empty('אין עדיין גרסאות שמורות.')}</section>
      <section class="card">${snap ? html`<div class="row-between"><h2 class="card-title">גרסה מ־${fmtIso(v.created_at)} (${snap.chapters.length} סיכומים)</h2><button class="btn btn-primary" data-act="restore">שחזור הגרסה הזו</button></div>
        <p class="hint">השחזור מחזיר את כל הסיכומים של הקורס למצב הזה. המצב הנוכחי נשמר קודם כגרסה, כך שאפשר לחזור אליו.</p>
        ${snap.chapters.map(ch => html`<h2 dir="auto">${ch.folder_id && folderPath(ch.folder_id) ? html`<span class="muted small">${folderPath(ch.folder_id)} /</span> ` : ''}${ch.title}</h2><div class="prose">${raw(md(ch.body_md, { shift: 1 }))}</div>`)}` : html`<p class="muted">בחרו גרסה כדי לצפות בה.</p>`}</section></div></div>`);
  bind(root, { restore: async () => { await api('POST', `/api/summary-versions/${sel}/restore`); toast('הגרסה שוחזרה'); await reload(); location.hash = `#/summary/${c.id}`; } });
}

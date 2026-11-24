// Project applications: connect what you learn to your own projects, with exportable implementation briefs.
// Projects are user-defined (table `projects`); an idea can belong to several (join `application_projects`).
import { html, raw, str, api, toast, copyText, options, dialog, APP_STATUS } from '../util.js';
import { S, T, byId, courses, courseName, topicsOf, create, patch, link, unlink, reload } from '../store.js';
import { bind, empty, fieldHandlers, crumbs, refresh } from '../ui.js';
import { fmtIso } from '../time.js';

// Idea templates: a learned concept and the kind of practical question it opens. Added only when chosen.
const TEMPLATES = [
  { title: 'קשרים בין טבלאות במסד נתונים', learned: 'קשרים בין ישויות (אחד-לרבים, רבים-לרבים) ומפתחות זרים.', problem: 'אילו ישויות יש בפרויקט ואיך הן קשורות? למשל: הזמנות ולקוחות, או עובדים ומשמרות.' },
  { title: 'ניתוח מערכות לתהליך עבודה', learned: 'ניתוח מערכות: תהליכים, בעלי עניין ודרישות.', problem: 'איזה תהליך בפרויקט כדאי למפות? למשל: קליטת לקוח חדש, או אישור שיבוץ משמרות.' },
  { title: 'מדדים וניתוח נתונים', learned: 'ניתוח נתונים, טבלאות ציר ומדדים.', problem: 'אילו מספרים עוזרים להחליט? למשל: המרה ושימור לקוחות, או כיסוי משמרות.' },
  { title: 'תרגיל תכנות בהשראת המוצר', learned: 'יסודות תכנות.', problem: 'תרגיל קטן על מודל אמיתי מהפרויקט, למשל חישוב זמינות או סינון הזמנות.' },
];
// Optional example projects (Ido's own). Clearly labelled, removable like any project.
const EXAMPLE_PROJECTS = [
  { name: 'ReSeGo', description: 'דוגמה: גילוי עסקי כושר, הזמנות, ניהול עסק ולקוחות, ואנליטיקה.', color: '#e2562f' },
  { name: 'Tori', description: 'דוגמה: שיבוץ עובדים וניהול משמרות.', color: '#2f7de2' },
];

export const projects = (withArchived = false) => T('projects').filter(p => withArchived || !p.archived).sort((a, b) => a.sort - b.sort || a.id - b.id);
export const projectsOf = appId => (S.data.application_projects || []).filter(x => x.application_id === appId).map(x => byId('projects', x.project_id)).filter(p => p && !p.deleted_at);
const chip = p => html`<span class="proj-chip" style="--c:${p.color || 'var(--accent)'}"><bdi>${p.name}</bdi></span>`;
const projectNames = a => { const ps = projectsOf(a.id); return ps.length ? ps.map(chip) : html`<span class="muted">בלי פרויקט</span>`; };

export function list(root, _, query) {
  if (query.get('new')) return createApp({ course_id: Number(query.get('course')) || null, topic_id: Number(query.get('topic')) || null }, Number(query.get('project')) || null);
  const pid = Number(query.get('project')) || 0;
  const status = query.get('status') || '';
  const items = T('applications').filter(a => (!pid || projectsOf(a.id).some(p => p.id === pid)) && (status ? a.status === status : a.status !== 'archived'))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const q = o => '#/apps?' + new URLSearchParams({ ...(pid ? { project: pid } : {}), ...(status ? { status } : {}), ...o });
  const ps = projects(), archived = projects(true).filter(p => p.archived);
  root.innerHTML = str(html`<div class="page"><header class="page-head"><div><h1>יישומים לפרויקטים</h1><p class="muted">לחבר את מה שלומדים לפרויקטים שלכם. אלה רעיונות ותכנון, לא שינויים אוטומטיים בשום קוד.</p></div>
    <div class="actions"><button class="btn" data-act="new-project">+ פרויקט</button><a class="btn btn-primary" href="${q({ new: 1 })}">+ רעיון חדש</a></div></header>

    ${ps.length ? html`<div class="toolbar"><div class="seg" role="group" aria-label="סינון לפי פרויקט"><a class="seg-item ${!pid ? 'on' : ''}" href="#/apps${status ? '?status=' + status : ''}">הכול</a>${ps.map(p => html`<a class="seg-item ${pid === p.id ? 'on' : ''}" href="${q({ project: p.id })}"><span class="dot" style="--c:${p.color || 'var(--accent)'}"></span><bdi>${p.name}</bdi></a>`)}</div>
      <label>סטטוס <select data-change="status"><option value="">פעילים</option>${options(APP_STATUS, status)}</select></label></div>` : ''}

    ${ps.length ? html`<section class="card">${items.length ? html`<ul class="items">${items.map(a => html`<li class="item"><div class="item-main"><a href="#/app/${a.id}" dir="auto">${a.title}</a> <span class="pill app-${a.status}">${APP_STATUS[a.status]}</span>
      <div class="item-meta">${projectNames(a)}${a.course_id ? html` · <bdi>${courseName(a.course_id)}</bdi>` : ''} · עודכן ${fmtIso(a.updated_at)}</div>
      ${a.next_action ? html`<div class="next-action"><strong>הבא:</strong> <span dir="auto">${a.next_action}</span></div>` : ''}</div></li>`)}</ul>` : empty('עוד אין כאן רעיונות. התחילו מתבנית למטה או מ"רעיון חדש".')}</section>`
    : html`<section class="card empty-hero"><h2>איזה פרויקט אתם בונים?</h2><p class="muted">פרויקט יכול להיות אפליקציה, עסק, מחקר או עבודה. אחרי שתוסיפו אחד, כל מושג מהקורסים יכול להפוך לרעיון יישום עם brief מסודר.</p>
        <div class="actions center"><button class="btn btn-primary" data-act="new-project">+ הפרויקט הראשון שלי</button><button class="btn" data-act="examples">להוסיף פרויקטי דוגמה (ReSeGo, Tori)</button></div></section>`}

    <div class="grid-2">
      <section class="card"><h2 class="card-title">תבניות רעיון</h2><p class="small muted">מושג מהלימודים ושאלה מעשית שהוא פותח. הלחיצה יוצרת רעיון שאפשר לערוך${pid ? ' ומשייכת אותו לפרויקט שנבחר' : ''}.</p>
        <ul class="plain">${TEMPLATES.map((e, i) => html`<li class="row-between"><span dir="auto">${e.title} <span class="muted small">— ${e.problem}</span></span><button class="btn btn-sm" data-act="template" data-i="${i}">הוספה</button></li>`)}</ul></section>
      <section class="card"><h2 class="card-title">הפרויקטים שלי</h2>
        ${ps.length ? html`<ul class="items">${ps.map(p => html`<li class="item"><span class="dot dot-lg" style="--c:${p.color || 'var(--accent)'}"></span><div class="item-main"><strong dir="auto">${p.name}</strong>${p.sample ? html` <span class="pill">דוגמה</span>` : ''}<div class="item-meta" dir="auto">${p.description || ''}</div></div>
          <span class="row-tools"><button class="btn btn-sm" data-act="edit-project" data-id="${p.id}">עריכה</button><button class="btn btn-sm" data-act="archive-project" data-id="${p.id}">ארכיון</button><button class="btn btn-sm danger" data-act="trash" data-table="projects" data-id="${p.id}" data-label="${p.name}">מחיקה</button></span></li>`)}</ul>` : html`<p class="muted small">אין עדיין פרויקטים.</p>`}
        ${archived.length ? html`<details class="small"><summary>${archived.length} בארכיון</summary><ul class="plain">${archived.map(p => html`<li class="row-between"><bdi>${p.name}</bdi><button class="btn-link" data-act="unarchive-project" data-id="${p.id}">החזרה</button></li>`)}</ul></details>` : ''}
      </section>
    </div></div>`);
  bind(root, {
    ...fieldHandlers,
    status: el => { location.hash = q({ status: el.value }); },
    template: async el => { const e = TEMPLATES[+el.dataset.i]; await createApp({ title: e.title, learned: e.learned, problem: e.problem }, pid || null); },
    'new-project': () => projectDialog(),
    'edit-project': el => projectDialog(byId('projects', el.dataset.id)),
    'archive-project': async el => { await patch('projects', el.dataset.id, { archived: 1 }); toast('הפרויקט הועבר לארכיון. הרעיונות שלו נשמרים.'); await refresh(); },
    'unarchive-project': async el => { await patch('projects', el.dataset.id, { archived: 0 }); await refresh(); },
    examples: async () => {
      const have = new Set(projects(true).map(p => p.name));
      for (const [i, p] of EXAMPLE_PROJECTS.entries()) if (!have.has(p.name)) await create('projects', { ...p, sample: 1, sort: i + 1 });
      toast('נוספו פרויקטי דוגמה. אפשר לשנות להם שם, להעביר לארכיון או למחוק.'); await refresh();
    },
  });
}

async function projectDialog(p) {
  const v = await dialog(p ? 'עריכת פרויקט' : 'פרויקט חדש', html`<label>שם<input name="name" dir="auto" required autofocus value="${p?.name || ''}" placeholder="למשל: אפליקציית התורים שלי"></label>
    <label>תיאור קצר<textarea name="description" rows="2" dir="auto">${p?.description || ''}</textarea></label>
    <label>צבע<input type="color" name="color" value="${p?.color || '#5b4bff'}"></label>
    ${p ? html`<p class="hint">השם החדש יופיע בכל הרעיונות המשויכים.</p>` : ''}`,
  { submit: p ? 'שמירה' : 'יצירה' });
  if (!v) return;
  const data = { name: v.name.trim(), description: v.description.trim(), color: v.color };
  if (p) await patch('projects', p.id, data); else await create('projects', { ...data, sort: projects(true).length + 1 });
  await refresh();
}

async function createApp(data, projectId) {
  const a = await create('applications', { title: data.title || 'רעיון חדש', status: 'idea', ...data });
  if (projectId) await link('application_projects', { application_id: a.id, project_id: projectId });
  await reload();
  location.replace(`#/app/${a.id}`);
}

export function edit(root, [id]) {
  const a = byId('applications', id);
  if (!a) throw new Error('הרעיון לא נמצא');
  const f = (name, label, ph = '', rows = 3) => html`<label>${label}<textarea name="${name}" rows="${rows}" dir="auto" placeholder="${ph}" data-change="field" data-table="applications" data-id="${a.id}">${a[name]}</textarea></label>`;
  const res = T('resources').filter(r => !a.course_id || r.course_id === a.course_id);
  const mine = new Set(projectsOf(a.id).map(p => p.id));
  const ps = projects().concat(projects(true).filter(p => p.archived && mine.has(p.id)));
  root.innerHTML = str(html`<div class="page">${crumbs([['יישומים לפרויקטים', '#/apps'], [a.title]])}
    ${a.deleted_at ? html`<aside class="notice notice-warn">הרעיון בסל המחזור. <button class="btn btn-sm" data-act="undelete">שחזור</button></aside>` : ''}
    <header class="page-head"><div><h1 dir="auto">${a.title}</h1><p class="muted">רעיון לימודי, לא שינוי בקוד. נשמר אוטומטית.</p></div>
      <div class="actions"><a class="btn btn-primary" href="/api/download/brief/${a.id}">ייצוא Implementation brief</a><button class="btn" data-act="copy">העתקת ה־brief</button>
      <button class="btn danger" data-act="trash" data-table="applications" data-id="${a.id}" data-label="${a.title}" data-go="#/apps">מחיקה</button></div></header>
    <div class="grid-2"><section class="card"><div class="form-grid one">
      <label>כותרת<input name="title" value="${a.title}" dir="auto" data-change="field" data-table="applications" data-id="${a.id}" data-refresh></label>
      <fieldset><legend>פרויקטים</legend>${ps.length ? html`<div class="seg">${ps.map(p => html`<label class="seg-item"><input type="checkbox" value="${p.id}" ${mine.has(p.id) ? raw('checked') : ''} data-change="toggle-project"> <span class="dot" style="--c:${p.color || 'var(--accent)'}"></span><bdi>${p.name}</bdi></label>`)}</div>`
        : html`<p class="small muted">אין עדיין פרויקטים. <a href="#/apps">להוספת פרויקט</a></p>`}</fieldset>
      <label>סטטוס<select name="status" data-change="field" data-table="applications" data-id="${a.id}">${options(APP_STATUS, a.status)}</select></label>
      <label>קורס<select name="course_id" data-change="field" data-table="applications" data-id="${a.id}" data-nullable data-num data-refresh><option value="">—</option>${courses().map(c => html`<option value="${c.id}" ${c.id === a.course_id ? raw('selected') : ''}>${c.name}</option>`)}</select></label>
      ${a.course_id ? html`<label>נושא<select name="topic_id" data-change="field" data-table="applications" data-id="${a.id}" data-nullable data-num><option value="">—</option>${topicsOf(a.course_id).map(t => html`<option value="${t.id}" ${t.id === a.topic_id ? raw('selected') : ''}>${t.name}</option>`)}</select></label>` : ''}
      <label>חומר מקור<select name="resource_id" data-change="field" data-table="applications" data-id="${a.id}" data-nullable data-num data-refresh><option value="">—</option>${res.map(r => html`<option value="${r.id}" ${r.id === a.resource_id ? raw('selected') : ''}>${r.title}</option>`)}</select></label>
      ${a.resource_id && byId('resources', a.resource_id) ? html`<a class="small" href="#/r/${a.resource_id}">פתיחת חומר המקור</a>` : ''}
    </div></section>
    <section class="card"><div class="form-grid one">
      ${f('learned', 'מה למדתי', 'המושג או הרעיון מהקורס')}
      ${f('problem', 'הבעיה או ההזדמנות בפרויקט', '')}
      ${f('proposal', 'יישום מעשי מוצע', '')}
      ${f('benefit', 'תועלת צפויה', '')}</div></section></div>
    <section class="card"><div class="form-grid">
      ${f('questions', 'שאלות והנחות לבדיקה', 'מה צריך לאמת מול הקוד, הנתונים או המשתמשים?', 4)}
      ${f('acceptance', 'קריטריונים לקבלה', 'איך נדע שהיישום הצליח? שורה לכל קריטריון', 4)}</div>
      <label>הצעד הבא<input name="next_action" value="${a.next_action}" dir="auto" data-change="field" data-table="applications" data-id="${a.id}" placeholder="למשל: לבדוק איך נשמרות היום ההזמנות בפרויקט"></label></section>
    <p class="hint">ה־brief הוא קובץ Markdown שאפשר לצרף לשיחה עם עוזר AI או לתת לשותפים לפרויקט. IJOS לא ניגש לקוד או לנתונים של אף פרויקט.</p></div>`);
  bind(root, {
    ...fieldHandlers,
    'toggle-project': async el => { const row = { application_id: a.id, project_id: +el.value }; await (el.checked ? link : unlink)('application_projects', row); await reload(); },
    undelete: async () => { await api('POST', `/api/rows/applications/${a.id}/restore`); await reload(); location.reload(); },
    copy: async () => { const text = await fetch(`/api/download/brief/${a.id}`).then(r => r.text()); toast(await copyText(text) ? 'ה־brief הועתק ללוח' : 'לא ניתן להעתיק. השתמשו בייצוא.'); },
  });
}

import { html, raw, str, dialog, toast, api, errorToast, options, parseTags, KIND_ICON, SOURCE } from '../util.js';
import { PALETTE } from './onboard.js';
import { md } from '../md.js';
import { S, T, byId, courseName, topicsOf, create, patch, unlink, nextAction, autosave } from '../store.js';
import { bind, refresh, empty, resourceRow, statusPill, dueLabel, courseCrumbs, crumbs, pickFiles, pickResources, fieldHandlers, reorder, lessonLabel, courseOptions, setLinks } from '../ui.js';
import { fmtDateTime, fmtIso, relDay } from '../time.js';

// ---------------- semester ----------------
export function semester(root, [id]) {
  const s = byId('semesters', id);
  if (!s || s.deleted_at) throw new Error('הסמסטר לא נמצא');
  const list = T('courses').filter(c => c.semester_id === s.id).sort((a, b) => a.sort - b.sort);
  const active = list.filter(c => !c.archived);
  const credits = active.filter(c => c.counts_credits && c.credits != null).reduce((n, c) => n + Number(c.credits), 0);
  const sems = T('semesters').sort((a, b) => a.sort - b.sort);
  root.innerHTML = str(html`<div class="page">
    ${crumbs([[byId('years', s.year_id)?.name], [s.name]])}
    <header class="page-head"><div><h1>${byId('years', s.year_id)?.name} · ${s.name}</h1>
      <p class="muted">${active.length} קורסים · ${credits} נקודות זכות בחישוב${active.some(c => !c.counts_credits) ? ' (ללא קורסים שאינם נספרים)' : ''}</p></div>
      <div class="actions"><button class="btn" data-act="import-shared">ייבוא קורס ששיתפו איתי</button><button class="btn" data-act="add-course">+ קורס</button></div></header>
    ${s.notes ? html`<aside class="notice" role="note"><strong>לתשומת לב:</strong> <span dir="auto">${s.notes}</span> <button class="btn-link small" data-act="edit-note">עריכה</button></aside>` : ''}
    <section class="card"><table class="table"><thead><tr><th>קורס</th><th>נק״ז</th><th>נספר בחישוב</th><th>סטטוס</th><th><span class="sr-only">פעולות</span></th></tr></thead><tbody>
      ${list.map((c, i) => html`<tr class="${c.archived ? 'archived' : ''}"><td><span class="dot" style="--c:${c.color || 'var(--accent)'}"></span> <a href="#/course/${c.id}"><bdi>${c.name}</bdi></a>${c.optional ? html` <span class="pill">אופציונלי</span>` : ''}${c.sample || s.sample ? html` <span class="sample-flag">דוגמה</span>` : ''}</td>
        <td><label class="sr-only" for="cr-${c.id}">נקודות זכות</label><input id="cr-${c.id}" class="input-num" type="number" step="0.5" min="0" name="credits" value="${c.credits ?? ''}" data-change="field" data-table="courses" data-id="${c.id}" data-nullable data-num data-refresh></td>
        <td><input type="checkbox" name="counts_credits" aria-label="נספר בחישוב" ${c.counts_credits ? raw('checked') : ''} data-change="field" data-table="courses" data-id="${c.id}" data-refresh></td>
        <td>${c.archived ? 'בארכיון' : 'פעיל'}</td>
        <td class="row-tools"><button class="icon-btn" data-act="move" data-id="${c.id}" data-dir="-1" aria-label="למעלה" ${i === 0 ? raw('disabled') : ''}>↑</button><button class="icon-btn" data-act="move" data-id="${c.id}" data-dir="1" aria-label="למטה" ${i === list.length - 1 ? raw('disabled') : ''}>↓</button>
          <button class="btn-link small" data-act="archive" data-id="${c.id}">${c.archived ? 'החזרה' : 'לארכיון'}</button></td></tr>`)}
    </tbody></table></section>
    <section class="card"><h2 class="card-title">סמסטרים</h2>
      <ul class="plain">${sems.map(x => html`<li class="row-between"><a href="#/semester/${x.id}">${byId('years', x.year_id)?.name} · ${x.name}</a>
        <label>סטטוס <select name="status" data-change="field" data-table="semesters" data-id="${x.id}" data-refresh>${options({ active: 'פעיל', planned: 'עתידי', done: 'הסתיים' }, x.status)}</select></label></li>`)}</ul>
      <p class="hint">רק סמסטרים פעילים מוצגים בתפריט. סמסטרים עתידיים נשמרים ברקע עד שתפעילו אותם.</p>
      <div class="actions"><button class="btn btn-sm" data-act="add-sem">+ סמסטר</button><a class="btn btn-sm" href="#/plan">הוספה מתוכנית לימודים מוכנה</a></div></section>
  </div>`);
  bind(root, {
    ...fieldHandlers,
    'add-course': async () => {
      const v = await dialog('קורס חדש', html`<label>שם הקורס<input name="name" dir="auto" required autofocus></label><div class="form-grid"><label>נקודות זכות<input name="credits" type="number" step="0.5" min="0"></label><label>צבע<input name="color" type="color" value="${PALETTE[list.length % PALETTE.length]}"></label></div>`);
      if (!v) return;
      const c = await create('courses', { semester_id: s.id, name: v.name.trim(), credits: v.credits === '' ? null : Number(v.credits), color: v.color, sort: list.length + 1 });
      location.hash = `#/course/${c.id}`;
    },
    'import-shared': () => importShared(s),
    move: el => reorder(list, +el.dataset.id, +el.dataset.dir, 'courses'),
    archive: async el => { const c = byId('courses', el.dataset.id); await patch('courses', c.id, { archived: !c.archived }); await refresh(); },
    'edit-note': async () => { const v = await dialog('הערה לסמסטר', html`<textarea name="notes" rows="5" dir="auto">${s.notes}</textarea>`); if (v) { await patch('semesters', s.id, { notes: v.notes }); await refresh(); } },
    'add-sem': async () => {
      const years = T('years');
      const v = await dialog('סמסטר חדש', html`<label>שנה<select name="year_id">${years.map(y => html`<option value="${y.id}">${y.name}</option>`)}<option value="new">שנה חדשה…</option></select></label>
        <label>שם שנה חדשה (אם נבחרה)<input name="year_name" dir="auto" placeholder="שנה ב׳"></label><label>שם הסמסטר<input name="name" dir="auto" required placeholder="סמסטר ב׳"></label>
        <label class="check"><input type="checkbox" name="active"> להפעיל עכשיו (יוצג בתפריט)</label>`);
      if (!v) return;
      const yid = v.year_id === 'new' ? (await create('years', { name: v.year_name || 'שנה חדשה', sort: years.length + 1 })).id : +v.year_id;
      await create('semesters', { year_id: yid, name: v.name.trim(), status: v.active ? 'active' : 'planned', sort: T('semesters').length + 1 });
      toast(v.active ? 'הסמסטר נוסף ומופיע בתפריט' : 'הסמסטר נוסף כ"עתידי" ואינו מוצג בתפריט עד שיופעל'); await refresh();
    },
  });
}

// ---------------- course sharing ----------------
async function shareCourse(c) {
  const v = await dialog('שיתוף הקורס', html`<p>נוצר קובץ ZIP שאפשר לשלוח לחברים לכיתה. הם מייבאים אותו כקורס חדש אצלם, ושום דבר לא נדרס.</p>
    <p class="hint">תמיד נכלל: פרטי הקורס, נושאים, שיעורים, תיקיות, קבצים וקישורים.<br>אף פעם לא נכלל: סטטוס מטלות, טיוטות, ציונים, משוב, תזכורות, נקודות לא ברורות ורעיונות לפרויקטים.</p>
    <label class="check"><input type="checkbox" name="notes"> הפתקים שלי (כולל פתקי שיעורים)</label>
    <label class="check"><input type="checkbox" name="mine" checked> קבצים שיצרתי בעצמי</label>
    <label class="check"><input type="checkbox" name="summary" checked> הסיכומים (כולל התיקיות)</label>
    <label class="check"><input type="checkbox" name="deadlines" checked> מטלות ומבחנים (שם, הנחיות ותאריכים בלבד)</label>
    <p class="hint">שימו לב לזכויות יוצרים: שתפו רק חומרים שמותר לכם להעביר הלאה.</p>`, { submit: 'יצירת קובץ והורדה' });
  if (!v) return;
  const q = new URLSearchParams(['notes', 'mine', 'summary', 'deadlines'].map(k => [k, v[k] ? '1' : '0']));
  location.href = `/api/download/share/${c.id}?${q}`;
  toast('הקובץ יורד. שלחו אותו לחברים, והם יבחרו "ייבוא קורס ששיתפו איתי" בעמוד הסמסטר.');
}

export function importShared(s) {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.zip' });
  input.onchange = async () => {
    const f = input.files[0];
    if (!f) return;
    try {
      const r = await api('POST', '/api/share/inspect', f);
      const n = r.counts || {};
      const v = await dialog('ייבוא קורס משותף', html`<p>בקובץ: <strong><bdi>${r.course}</bdi></strong></p>
        <p class="hint">${n.topics ?? 0} נושאים · ${n.resources ?? 0} חומרים (${n.files ?? 0} קבצים, ${n.notes ?? 0} פתקים) · ${n.chapters ?? 0} פרקי סיכום · ${n.assignments ?? 0} מטלות · ${n.exams ?? 0} מבחנים</p>
        <label>שם הקורס אצלי<input name="name" dir="auto" required value="${r.course}"></label>
        <p class="hint">הקורס ייווסף כקורס חדש ל<bdi>${s.name}</bdi>. מטלות מגיעות במצב "לא התחלתי". סיכומי HTML מגיעים עם סקריפטים כבויים, ואפשר להפעיל אותם בפרטי החומר.</p>`, { submit: 'ייבוא' });
      if (!v) return;
      const res = await api('POST', '/api/share/apply', { token: r.token, semester_id: s.id, name: v.name.trim() });
      toast('הקורס יובא');
      await refresh();
      location.hash = `#/course/${res.course.id}`;
    } catch (e) { errorToast(e); }
  };
  input.click();
}

// ---------------- course ----------------
const TABS = [['overview', 'מידע על הקורס'], ['topics', 'נושאים'], ['lessons', 'שיעורים'], ['materials', 'חומרים ותיקיות'], ['assignments', 'מטלות'], ['exams', 'מבחנים'], ['summary', 'סיכומים']];
export function course(root, [id, tab = 'overview'], query) {
  const c = byId('courses', id);
  if (!c || c.deleted_at) throw new Error('הקורס לא נמצא');
  if (tab === 'summary') { location.replace(`#/summary/${c.id}`); return; }
  const body = { overview, topics: topicsTab, lessons: lessonsTab, materials, assignments: asgTab, exams: examsTab }[tab] || overview;
  const part = body(c, query);
  root.innerHTML = str(html`<div class="page">
    ${courseCrumbs(c.id)}
    <header class="page-head"><div class="course-title"><span class="course-badge lg" style="--c:${c.color || 'var(--accent)'}" aria-hidden="true">${c.icon || [...c.name.replace(/^[^\p{L}]+/u, '')][0] || '•'}</span><div><h1><bdi>${c.name}</bdi></h1>${c.sample ? html` <span class="sample-flag">דוגמה</span>` : ''}<p class="muted">${c.credits != null ? `${c.credits} נק״ז` : 'נק״ז לא הוגדרו'}${!c.counts_credits ? ' · לא נספר בחישוב' : ''}${c.lecturer ? ` · ${c.lecturer}` : ''}</p></div></div>
      <div class="actions"><button class="btn" data-act="share">שיתוף הקורס</button><button class="btn" data-act="import">ייבוא קבצים</button><button class="btn" data-act="note">+ פתק</button></div></header>
    <nav class="tabs" aria-label="אזורי הקורס">${TABS.map(([k, l]) => html`<a href="${k === 'summary' ? `#/summary/${c.id}` : `#/course/${c.id}/${k}`}" ${k === tab ? raw('aria-current="page"') : ''}>${l}</a>`)}</nav>
    <div class="tab-body">${part.html}</div></div>`);
  bind(root, {
    ...fieldHandlers,
    import: () => pickFiles({ course_id: c.id }),
    share: () => shareCourse(c),
    note: async () => { const r = await create('resources', { title: 'פתק חדש', kind: 'note', source: 'me', role: 'notes', course_id: c.id, body: '' }); location.hash = `#/r/${r.id}?edit=1`; },
    ...part.handlers,
  });
  part.mount?.(root);
}

function overview(c) {
  const grading = parseTags(c.grading);
  const syllabus = c.syllabus_resource_id ? byId('resources', c.syllabus_resource_id) : null;
  const res = T('resources').filter(r => r.course_id === c.id);
  const asg = T('assignments').filter(a => a.course_id === c.id && !['submitted', 'graded'].includes(a.status));
  const exams = T('exams').filter(e => e.course_id === c.id);
  const flags = T('flags').filter(f => f.course_id === c.id && f.status === 'open');
  const f = (name, label, attrs = '') => html`<label>${label}<input name="${name}" value="${c[name] || ''}" dir="auto" data-change="field" data-table="courses" data-id="${c.id}" ${raw(attrs)}></label>`;
  let saver;
  return {
    html: html`<div class="grid-2">
      <section class="card"><h2 class="card-title">פרטי הקורס</h2><div class="form-grid">
        ${f('name', 'שם הקורס', 'data-refresh required')}${f('code', 'מספר קורס')}${f('lecturer', 'מרצה')}${f('lecturer_contact', 'פרטי קשר')}${f('office_hours', 'שעות קבלה')}
        <label>צבע הקורס<input type="color" name="color" value="${c.color || '#4f3df0'}" data-change="field" data-table="courses" data-id="${c.id}" data-refresh></label>${f('icon', 'סמל (אימוג׳י או אות)', 'maxlength="4" data-refresh')}
        <label>סילבוס<select name="syllabus_resource_id" data-change="field" data-table="courses" data-id="${c.id}" data-nullable data-num data-refresh><option value="">— לא נבחר —</option>${res.filter(r => r.kind !== 'note').map(r => html`<option value="${r.id}" ${r.id === c.syllabus_resource_id ? raw('selected') : ''}>${r.title}</option>`)}</select></label>
      </div>${syllabus ? html`<p><a class="btn btn-sm" href="#/r/${syllabus.id}">פתיחת הסילבוס</a></p>` : ''}
      <p class="hint">שדות שלא ידועים נשארים ריקים. השינויים נשמרים אוטומטית.</p></section>
      <section class="card"><h2 class="card-title">מבט מהיר</h2><ul class="plain stats">
        <li><a href="#/course/${c.id}/materials">${res.length} חומרים</a></li>
        <li><a href="#/course/${c.id}/assignments">${asg.length} מטלות פתוחות</a></li>
        <li><a href="#/course/${c.id}/exams">${exams.length} מבחנים</a></li>
        <li>${flags.length} נקודות לא ברורות פתוחות</li></ul>
        ${asg.slice(0, 4).map(a => html`<p class="small"><a href="#/a/${a.id}" dir="auto">${a.title}</a> · ${dueLabel(a.due_date, a.due_time)}${nextAction(a) ? html` · הבא: <span dir="auto">${nextAction(a)}</span>` : ''}</p>`)}</section></div>
      <section class="card"><h2 class="card-title">רכיבי ציון</h2>
        ${grading.length ? html`<table class="table"><thead><tr><th>רכיב</th><th>משקל</th><th>הערות</th><th><span class="sr-only">פעולות</span></th></tr></thead><tbody>${grading.map((g, i) => html`<tr><td dir="auto">${g.name}</td><td>${g.weight ? `${g.weight}%` : '—'}</td><td dir="auto">${g.notes || ''}</td><td><button class="btn-link small" data-act="grade-edit" data-i="${i}">עריכה</button> <button class="btn-link small" data-act="grade-del" data-i="${i}">מחיקה</button></td></tr>`)}</tbody></table>
          ${grading.reduce((n, g) => n + (Number(g.weight) || 0), 0) !== 100 && grading.some(g => g.weight) ? html`<p class="hint">סכום המשקלים: ${grading.reduce((n, g) => n + (Number(g.weight) || 0), 0)}%</p>` : ''}` : html`<p class="muted small">עדיין לא הוזנו רכיבי ציון. אפשר להעתיק אותם מהסילבוס.</p>`}
        <button class="btn btn-sm" data-act="grade-add">+ רכיב ציון</button></section>
      <section class="card"><h2 class="card-title">הנחיות והערות על הקורס</h2>
        <label class="sr-only" for="info-md">הנחיות</label>
        <textarea id="info-md" class="md-input" rows="8" dir="auto" placeholder="הנחיות הגשה, נוכחות, כללי הקורס… (Markdown)">${c.info_md}</textarea>
        <details><summary class="small">תצוגה מעוצבת</summary><div class="prose" id="info-preview">${raw(md(c.info_md))}</div></details></section>`,
    handlers: {
      'grade-add': () => editGrade(c, grading, -1),
      'grade-edit': el => editGrade(c, grading, +el.dataset.i),
      'grade-del': async el => { grading.splice(+el.dataset.i, 1); await patch('courses', c.id, { grading }); await refresh(); },
    },
    mount(root) {
      const ta = root.querySelector('#info-md');
      saver = autosave({ table: 'courses', id: c.id, field: 'info_md', base: c, onSaved: row => Object.assign(c, row) });
      ta.oninput = () => { saver.set(ta.value); root.querySelector('#info-preview').innerHTML = md(ta.value); };
    },
  };
}
async function editGrade(c, grading, i) {
  const g = grading[i] || {};
  const v = await dialog(i < 0 ? 'רכיב ציון חדש' : 'עריכת רכיב ציון', html`<label>שם הרכיב<input name="name" value="${g.name || ''}" dir="auto" required autofocus placeholder="למשל: מבחן סופי"></label>
    <label>משקל באחוזים (אם ידוע)<input name="weight" type="number" min="0" max="100" value="${g.weight ?? ''}"></label><label>הערות<input name="notes" value="${g.notes || ''}" dir="auto" placeholder="למשל: ציון עובר 60"></label>`);
  if (!v) return;
  const row = { name: v.name.trim(), weight: v.weight === '' ? null : Number(v.weight), notes: v.notes };
  if (i < 0) grading.push(row); else grading[i] = row;
  await patch('courses', c.id, { grading });
  await refresh();
}

function topicsTab(c, query) {
  const showArch = query.get('archived') === '1';
  const all = topicsOf(c.id);
  const list = all.filter(t => showArch || !t.archived);
  const count = tid => S.data.resource_topics.filter(x => x.topic_id === tid && byId('resources', x.resource_id) && !byId('resources', x.resource_id).deleted_at).length;
  const chapters = T('summary_chapters').filter(ch => ch.course_id === c.id);
  return {
    html: html`<section class="card">
      <form class="inline-form" data-submit="add-topic"><label class="sr-only" for="new-topic">נושא חדש</label><input id="new-topic" name="name" dir="auto" placeholder="נושא חדש, למשל: לולאות" required><button class="btn btn-sm">הוספת נושא</button></form>
      ${list.length ? html`<ul class="items">${list.map((t, i) => html`<li class="item ${t.archived ? 'archived' : ''}"><div class="item-main"><a href="#/topic/${t.id}" dir="auto">${t.name}</a>
        <div class="item-meta">${count(t.id)} חומרים${chapters.some(ch => ch.topic_id === t.id) ? ' · יש סיכום' : ''}${t.archived ? ' · בארכיון' : ''}</div></div>
        <span class="row-tools"><button class="icon-btn" data-act="t-move" data-id="${t.id}" data-dir="-1" aria-label="למעלה" ${i === 0 ? raw('disabled') : ''}>↑</button><button class="icon-btn" data-act="t-move" data-id="${t.id}" data-dir="1" aria-label="למטה" ${i === list.length - 1 ? raw('disabled') : ''}>↓</button>
        <button class="btn-link small" data-act="t-rename" data-id="${t.id}">שינוי שם</button><button class="btn-link small" data-act="t-arch" data-id="${t.id}">${t.archived ? 'החזרה' : 'ארכיון'}</button></span></li>`)}</ul>`
        : empty('עדיין אין נושאים. נושא מאגד חומרים משיעורים שונים — למשל "לולאות" או "מודל פורטר".')}
      ${all.some(t => t.archived) ? html`<a class="small" href="#/course/${c.id}/topics${showArch ? '' : '?archived=1'}">${showArch ? 'הסתרת נושאים בארכיון' : 'הצגת נושאים בארכיון'}</a>` : ''}</section>`,
    handlers: {
      'add-topic': async (f, d) => { await create('topics', { course_id: c.id, name: d.name.trim(), sort: all.length + 1 }); await refresh(); document.getElementById('new-topic')?.focus(); },
      't-move': el => reorder(list, +el.dataset.id, +el.dataset.dir, 'topics'),
      't-rename': async el => { const t = byId('topics', el.dataset.id); const v = await dialog('שינוי שם נושא', html`<label>שם<input name="name" value="${t.name}" dir="auto" required></label>`); if (v) { await patch('topics', t.id, { name: v.name.trim() }); await refresh(); } },
      't-arch': async el => { const t = byId('topics', el.dataset.id); await patch('topics', t.id, { archived: !t.archived }); await refresh(); },
    },
  };
}

function lessonsTab(c) {
  const list = T('lessons').filter(l => l.course_id === c.id).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.sort - b.sort || a.id - b.id);
  return {
    html: html`<section class="card">
      <form class="inline-form wrap" data-submit="add-lesson"><label>תאריך <input type="date" name="date"></label><label class="grow">כותרת <input name="title" dir="auto" placeholder="למשל: שיעור 3 — פונקציות"></label>
        <label>סוג <select name="kind"><option value="lecture">הרצאה</option><option value="practice">תרגול</option></select></label><button class="btn btn-sm">הוספת שיעור</button></form>
      ${list.length ? html`<ul class="items">${list.map(l => {
        const n = T('resources').filter(r => r.lesson_id === l.id).length;
        return html`<li class="item"><div class="item-main"><a href="#/lesson/${l.id}" dir="auto">${l.title || 'שיעור ללא כותרת'}</a> ${l.catch_up ? html`<span class="pill pill-warn">להשלמה</span>` : ''}
          <div class="item-meta">${l.date ? fmtDateTime(l.date) : 'ללא תאריך'} · ${l.kind === 'practice' ? 'תרגול' : 'הרצאה'} · ${n} חומרים</div></div>
          <label class="small"><input type="checkbox" name="catch_up" ${l.catch_up ? raw('checked') : ''} data-change="field" data-table="lessons" data-id="${l.id}" data-refresh> פספסתי / להשלמה</label></li>`;
      })}</ul>` : empty('עדיין אין שיעורים. שיעור מקבץ את מה שהיה במפגש מסוים — מצגת, הקלטה, הערות.')}</section>`,
    handlers: { 'add-lesson': async (f, d) => { await create('lessons', { course_id: c.id, date: d.date || null, title: d.title.trim(), kind: d.kind }); await refresh(); } },
  };
}

function materials(c, query) {
  const showArch = query.get('archived') === '1';
  const folders = T('folders').filter(f => f.course_id === c.id && (showArch || !f.archived));
  const res = T('resources').filter(r => r.course_id === c.id);
  const kids = pid => folders.filter(f => (f.parent_id ?? null) === pid).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'he'));
  const inFolder = fid => res.filter(r => (r.folder_id ?? null) === fid && (fid === null || folders.some(f => f.id === fid))).sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title, 'he'));
  const orphans = res.filter(r => r.folder_id && !folders.some(f => f.id === r.folder_id));
  const row = r => resourceRow(r, { extra: html`<button class="btn-link small" data-act="mv-res" data-id="${r.id}">העברה</button>` });
  const tree = (pid, depth) => kids(pid).map((f, i, arr) => html`<li class="folder ${f.archived ? 'archived' : ''}"><details ${depth < 1 ? raw('open') : ''}><summary><span aria-hidden="true">📁</span> <span dir="auto">${f.name}</span> <span class="muted small">(${inFolder(f.id).length})</span></summary>
    <div class="folder-tools"><button class="btn-link small" data-act="f-new" data-id="${f.id}">+ תת־תיקייה</button><button class="btn-link small" data-act="f-import" data-id="${f.id}">ייבוא לכאן</button><button class="btn-link small" data-act="f-rename" data-id="${f.id}">שינוי שם</button>
      <button class="btn-link small" data-act="f-move" data-id="${f.id}">העברה</button><button class="icon-btn" data-act="f-order" data-id="${f.id}" data-dir="-1" aria-label="למעלה" ${i === 0 ? raw('disabled') : ''}>↑</button><button class="icon-btn" data-act="f-order" data-id="${f.id}" data-dir="1" aria-label="למטה" ${i === arr.length - 1 ? raw('disabled') : ''}>↓</button>
      <button class="btn-link small" data-act="f-arch" data-id="${f.id}">${f.archived ? 'החזרה מארכיון' : 'ארכיון'}</button><button class="btn-link small danger" data-act="trash" data-table="folders" data-id="${f.id}" data-label="${f.name}">מחיקה</button></div>
    <ul class="tree">${tree(f.id, depth + 1)}${inFolder(f.id).map(row)}</ul></details></li>`);
  return {
    html: html`<section class="card">
      <div class="toolbar"><button class="btn btn-sm" data-act="import">ייבוא קבצים</button><button class="btn btn-sm" data-act="import-dir">ייבוא תיקייה שלמה</button><button class="btn btn-sm" data-act="f-new">+ תיקייה</button><button class="btn btn-sm" data-act="add-link">+ קישור</button><button class="btn btn-sm" data-act="note">+ פתק</button>
        ${T('folders').some(f => f.course_id === c.id && f.archived) ? html`<a class="small" href="#/course/${c.id}/materials${showArch ? '' : '?archived=1'}">${showArch ? 'הסתרת ארכיון' : 'הצגת ארכיון'}</a>` : ''}</div>
      ${res.length || folders.length ? html`<ul class="tree tree-root">${tree(null, 0)}${inFolder(null).map(row)}${orphans.filter(r => !showArch).map(row)}</ul>` : empty('אין עדיין חומרים בקורס. גררו קבצים לחלון או השתמשו בכפתור הייבוא.')}
      ${orphans.length && !showArch ? html`<p class="hint">חלק מהחומרים נמצאים בתיקיות שבארכיון.</p>` : ''}</section>`,
    handlers: {
      'import-dir': () => pickFiles({ course_id: c.id }, { directory: true }),
      'f-import': el => pickFiles({ course_id: c.id, folder_id: +el.dataset.id }),
      'f-new': async el => { const v = await dialog('תיקייה חדשה', html`<label>שם<input name="name" dir="auto" required autofocus></label>`); if (v) { await create('folders', { course_id: c.id, parent_id: el.dataset.id ? +el.dataset.id : null, name: v.name.trim(), sort: 99 }); await refresh(); } },
      'f-rename': async el => { const f = byId('folders', el.dataset.id); const v = await dialog('שינוי שם תיקייה', html`<label>שם<input name="name" value="${f.name}" dir="auto" required></label>`); if (v) { await patch('folders', f.id, { name: v.name.trim() }); await refresh(); } },
      'f-arch': async el => { const f = byId('folders', el.dataset.id); await patch('folders', f.id, { archived: !f.archived }); await refresh(); },
      'f-order': el => { const f = byId('folders', el.dataset.id); return reorder(kids(f.parent_id ?? null), f.id, +el.dataset.dir, 'folders'); },
      'f-move': async el => {
        const f = byId('folders', el.dataset.id);
        const desc = new Set([f.id]); let grew = true;
        while (grew) { grew = false; for (const x of folders) if (x.parent_id && desc.has(x.parent_id) && !desc.has(x.id)) { desc.add(x.id); grew = true; } }
        const v = await dialog('העברת תיקייה', html`<label>לתוך<select name="parent"><option value="">ראש הקורס</option>${folders.filter(x => !desc.has(x.id)).map(x => html`<option value="${x.id}" ${x.id === f.parent_id ? raw('selected') : ''}>${folderPath(x.id)}</option>`)}</select></label>`);
        if (v) { await patch('folders', f.id, { parent_id: v.parent ? +v.parent : null }); await refresh(); }
      },
      'mv-res': el => moveResource(byId('resources', el.dataset.id)),
      'add-link': async () => { const v = await dialog('קישור חדש', html`<label>כתובת<input name="url" type="url" dir="ltr" required autofocus></label><label>כותרת<input name="title" dir="auto"></label>`); if (v) { await create('resources', { course_id: c.id, kind: 'link', url: v.url, title: v.title || v.url, source: 'other' }); await refresh(); } },
    },
  };
}
export function folderPath(id) {
  const parts = [];
  for (let f = byId('folders', id); f && parts.length < 50; f = f.parent_id ? byId('folders', f.parent_id) : null) parts.unshift(f.name);
  return parts.join(' / ');
}
export async function moveResource(r) {
  const folders = T('folders').filter(f => f.course_id === r.course_id);
  const v = await dialog('העברת חומר', html`<label>קורס<select name="course_id">${courseOptions(r.course_id)}</select></label>
    <label>תיקייה (בקורס הנוכחי)<select name="folder_id"><option value="">ראש הקורס</option>${folders.map(f => html`<option value="${f.id}" ${f.id === r.folder_id ? raw('selected') : ''}>${folderPath(f.id)}</option>`)}</select></label>`);
  if (!v) return;
  const cid = v.course_id ? +v.course_id : null;
  await patch('resources', r.id, cid === r.course_id ? { folder_id: v.folder_id ? +v.folder_id : null } : { course_id: cid, folder_id: null, lesson_id: null });
  await refresh();
}

function asgTab(c) {
  const list = T('assignments').filter(a => a.course_id === c.id).sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  return {
    html: html`<section class="card"><div class="toolbar"><button class="btn btn-sm btn-primary" data-act="new-asg">+ מטלה</button></div>
      ${list.length ? html`<ul class="items">${list.map(a => html`<li class="item"><div class="item-main"><a href="#/a/${a.id}" dir="auto">${a.title}</a> ${statusPill(a.status)}
        <div class="item-meta">הגשה: ${dueLabel(a.due_date, a.due_time)}${a.grade ? ` · ציון: ${a.grade}` : ''}</div>${nextAction(a) && !['submitted', 'graded'].includes(a.status) ? html`<div class="next-action"><strong>הבא:</strong> <span dir="auto">${nextAction(a)}</span></div>` : ''}</div></li>`)}</ul>` : empty('אין מטלות בקורס.')}</section>`,
    handlers: { 'new-asg': () => newAssignment(c.id) },
  };
}
export async function newAssignment(courseId) {
  const v = await dialog('מטלה חדשה', html`<label>שם המטלה<input name="title" dir="auto" required autofocus placeholder="למשל: מטלה 2 — לולאות"></label>
    <label>קורס<select name="course_id">${courseOptions(courseId, { none: '— בחרו —' })}</select></label>
    <div class="form-grid"><label>תאריך הגשה (אם ידוע)<input type="date" name="due_date"></label><label>שעה<input type="time" name="due_time"></label></div>
    <p class="hint">אם אין מועד ידוע — השאירו ריק. לא נמציא תאריכים.</p>`);
  if (!v) return;
  const a = await create('assignments', { title: v.title.trim(), course_id: v.course_id ? +v.course_id : null, due_date: v.due_date || null, due_time: v.due_time || null });
  location.hash = `#/a/${a.id}`;
}

function examsTab(c) {
  const list = T('exams').filter(e => e.course_id === c.id).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  return {
    html: html`<section class="card"><div class="toolbar"><button class="btn btn-sm btn-primary" data-act="new-exam">+ מבחן</button></div>
      ${list.length ? html`<ul class="items">${list.map(e => html`<li class="item"><div class="item-main"><a href="#/exam/${e.id}" dir="auto">${e.title}</a>
        <div class="item-meta">${e.date ? html`${fmtDateTime(e.date, e.time)} (${relDay(e.date)})` : 'תאריך לא ידוע'}${e.location ? ` · ${e.location}` : ''}</div></div></li>`)}</ul>` : empty('לא הוזנו מבחנים. מועדים ייכנסו רק כשתזינו אותם.')}</section>`,
    handlers: { 'new-exam': () => newExam(c.id) },
  };
}
export async function newExam(courseId) {
  const v = await dialog('מבחן חדש', html`<label>כותרת<input name="title" dir="auto" required autofocus placeholder="למשל: מבחן סופי — מועד א׳"></label>
    <label>קורס<select name="course_id">${courseOptions(courseId, { none: '— בחרו —' })}</select></label>
    <div class="form-grid"><label>תאריך (אם ידוע)<input type="date" name="date"></label><label>שעה<input type="time" name="time"></label></div><label>מיקום<input name="location" dir="auto"></label>`);
  if (!v) return;
  const e = await create('exams', { title: v.title.trim(), course_id: v.course_id ? +v.course_id : null, date: v.date || null, time: v.time || null, location: v.location });
  location.hash = `#/exam/${e.id}`;
}

// ---------------- topic ----------------
export function topic(root, [id]) {
  const t = byId('topics', id);
  if (!t || t.deleted_at) throw new Error('הנושא לא נמצא');
  const rids = S.data.resource_topics.filter(x => x.topic_id === t.id).map(x => x.resource_id);
  const res = T('resources').filter(r => rids.includes(r.id));
  const groups = [['חומרי מרצה וקורס', res.filter(r => r.source === 'lecturer')], ['הסיכומים וההערות שלי', res.filter(r => r.source === 'me')], ['הסברים מ־AI', res.filter(r => ['chatgpt', 'claude'].includes(r.source))], ['אחר', res.filter(r => r.source === 'other' || !r.source)]];
  const asg = S.data.assignment_topics.filter(x => x.topic_id === t.id).map(x => byId('assignments', x.assignment_id)).filter(a => a && !a.deleted_at);
  const exams = S.data.exam_topics.filter(x => x.topic_id === t.id).map(x => byId('exams', x.exam_id)).filter(e => e && !e.deleted_at);
  const chapters = T('summary_chapters').filter(ch => ch.topic_id === t.id);
  const flags = T('flags').filter(f => f.status === 'open' && rids.includes(f.resource_id));
  root.innerHTML = str(html`<div class="page">${courseCrumbs(t.course_id, [['נושאים', `#/course/${t.course_id}/topics`], [t.name]])}
    <header class="page-head"><div><h1 dir="auto">${t.name}</h1><p class="muted">כל מה שיש לי על הנושא, מכל השיעורים</p></div>
      <div class="actions"><button class="btn" data-act="link-res">שיוך חומרים קיימים</button><button class="btn" data-act="import">ייבוא לנושא</button></div></header>
    <section class="card"><label>תיאור קצר<textarea name="description" rows="2" dir="auto" data-change="field" data-table="topics" data-id="${t.id}">${t.description}</textarea></label></section>
    <div class="grid-2">
      <section class="card"><h2 class="card-title">חומרים (${res.length})</h2>${res.length ? groups.filter(g => g[1].length).map(([l, rs]) => html`<h3 class="sub">${l}</h3><ul class="res-list">${rs.map(r => resourceRow(r, { extra: html`<button class="btn-link small" data-act="unlink" data-id="${r.id}">ניתוק</button>` }))}</ul>`) : empty('אין חומרים משויכים. חומר אחד יכול להשתייך לכמה נושאים בלי לשכפל את הקובץ.')}</section>
      <div>
        <section class="card"><h2 class="card-title">סיכומים</h2>${chapters.length ? html`<ul class="plain">${chapters.map(ch => html`<li><a href="#/summary/${t.course_id}?s=${ch.id}" dir="auto">${ch.title}</a></li>`)}</ul>` : html`<p class="muted small">עוד אין סיכום שמשויך לנושא הזה.</p>`}<a class="btn btn-sm" href="#/summary/${t.course_id}">לסיכומים של הקורס</a></section>
        ${flags.length ? html`<section class="card"><h2 class="card-title">לא ברור (${flags.length})</h2><ul class="plain">${flags.map(f => html`<li><a href="#/r/${f.resource_id}?panel=unclear" dir="auto">${f.text}</a></li>`)}</ul></section>` : ''}
        <section class="card"><h2 class="card-title">מטלות ומבחנים</h2>${asg.length || exams.length ? html`<ul class="plain">${asg.map(a => html`<li><a href="#/a/${a.id}" dir="auto">${a.title}</a> ${statusPill(a.status)}</li>`)}${exams.map(e => html`<li><a href="#/exam/${e.id}" dir="auto">${e.title}</a>${e.date ? ` · ${fmtDateTime(e.date)}` : ''}</li>`)}</ul>` : html`<p class="muted small">אין מטלות או מבחנים שמקושרים לנושא.</p>`}</section>
      </div></div></div>`);
  bind(root, {
    ...fieldHandlers,
    import: () => pickFiles({ course_id: t.course_id, topic_id: t.id }),
    unlink: async el => { await unlink('resource_topics', { resource_id: +el.dataset.id, topic_id: t.id }); await refresh(); },
    'link-res': async () => {
      const ids = await pickResources('שיוך חומרים לנושא', T('resources').filter(r => r.course_id === t.course_id), rids);
      if (!ids) return;
      await setLinks('resource_topics', 'topic_id', t.id, 'resource_id', ids);
      await refresh();
    },
  });
}

// ---------------- lesson ----------------
export function lesson(root, [id]) {
  const l = byId('lessons', id);
  if (!l || l.deleted_at) throw new Error('השיעור לא נמצא');
  const res = T('resources').filter(r => r.lesson_id === l.id);
  const notes = res.filter(r => r.kind === 'note');
  root.innerHTML = str(html`<div class="page">${courseCrumbs(l.course_id, [['שיעורים', `#/course/${l.course_id}/lessons`], [lessonLabel(l)]])}
    <header class="page-head"><div><h1 dir="auto">${l.title || 'שיעור ללא כותרת'}</h1><p class="muted">${l.date ? fmtDateTime(l.date) : 'ללא תאריך'} · מה היה בשיעור ומה עוד חסר לי</p></div>
      <div class="actions"><button class="btn" data-act="import">ייבוא לשיעור</button><button class="btn" data-act="link">שיוך חומרים קיימים</button><button class="btn" data-act="note">+ פתק לשיעור</button>
      <button class="btn danger" data-act="trash" data-table="lessons" data-id="${l.id}" data-label="${l.title}" data-go="#/course/${l.course_id}/lessons">מחיקה</button></div></header>
    <section class="card"><div class="form-grid">
      <label>כותרת<input name="title" value="${l.title}" dir="auto" data-change="field" data-table="lessons" data-id="${l.id}"></label>
      <label>תאריך<input type="date" name="date" value="${l.date || ''}" data-change="field" data-table="lessons" data-id="${l.id}" data-nullable></label>
      <label>סוג<select name="kind" data-change="field" data-table="lessons" data-id="${l.id}">${options({ lecture: 'הרצאה', practice: 'תרגול' }, l.kind)}</select></label>
      <label class="check"><input type="checkbox" name="catch_up" ${l.catch_up ? raw('checked') : ''} data-change="field" data-table="lessons" data-id="${l.id}" data-refresh> פספסתי / צריך להשלים</label></div></section>
    ${l.catch_up ? html`<aside class="notice notice-warn">השיעור מסומן להשלמה ויופיע בדף הבית עד שתסירו את הסימון.</aside>` : ''}
    <div class="grid-2"><section class="card"><h2 class="card-title">חומרי השיעור (${res.length})</h2>${res.length ? html`<ul class="res-list">${res.map(r => resourceRow(r))}</ul>` : empty('אין חומרים משויכים לשיעור.')}</section>
    <section class="card"><h2 class="card-title">מה חסר לי / מה לבדוק</h2><textarea id="lesson-notes" class="md-input" rows="8" dir="auto" placeholder="למשל: חסרה ההקלטה, לבקש סיכום מחבר/ה, לא הבנתי את הדוגמה בשקף 12">${l.notes_md}</textarea>
      ${notes.length ? html`<p class="small">פתקים מהשיעור: ${notes.map(n => html`<a href="#/r/${n.id}">${n.title}</a> `)}</p>` : ''}</section></div></div>`);
  const saver = autosave({ table: 'lessons', id: l.id, field: 'notes_md', base: l, onSaved: row => Object.assign(l, row) });
  root.querySelector('#lesson-notes').oninput = e => saver.set(e.target.value);
  bind(root, {
    ...fieldHandlers,
    import: () => pickFiles({ course_id: l.course_id, lesson_id: l.id }),
    note: async () => { const r = await create('resources', { title: `הערות — ${lessonLabel(l)}`, kind: 'note', source: 'me', role: 'notes', course_id: l.course_id, lesson_id: l.id, body: '' }); location.hash = `#/r/${r.id}?edit=1`; },
    link: async () => {
      const cands = T('resources').filter(r => r.course_id === l.course_id);
      const ids = await pickResources('שיוך חומרים לשיעור', cands, res.map(r => r.id), { hint: 'לכל חומר יש שיעור אחד לכל היותר. שיוך כאן יחליף שיוך קודם.' });
      if (!ids) return;
      for (const r of cands) { const want = ids.includes(r.id); if (want && r.lesson_id !== l.id) await patch('resources', r.id, { lesson_id: l.id }); if (!want && r.lesson_id === l.id) await patch('resources', r.id, { lesson_id: null }); }
      await refresh();
    },
  });
}

// ---------------- inbox ----------------
export function inbox(root) {
  const list = T('resources').filter(r => r.course_id == null).sort((a, b) => b.created_at.localeCompare(a.created_at));
  root.innerHTML = str(html`<div class="page"><header class="page-head"><div><h1>לא ממוין</h1><p class="muted">קבצים שיובאו בלי קורס. שייכו אותם כשנוח — אין חובה למלא טופס ארוך.</p></div>
    <div class="actions"><button class="btn" data-act="import">ייבוא קבצים</button></div></header>
    ${list.length ? html`<section class="card"><form data-submit="bulk" class="toolbar"><label>שיוך המסומנים לקורס <select name="course_id" required>${courseOptions('', { none: '— בחרו קורס —' })}</select></label><button class="btn btn-sm btn-primary">שיוך</button>
      <button type="button" class="btn-link small" data-act="all">סימון הכול</button></form>
      <ul class="res-list">${list.map(r => html`<li class="res-row"><input type="checkbox" class="sel" value="${r.id}" aria-label="בחירה: ${r.title}"><span class="res-icon" aria-hidden="true">${KIND_ICON[r.kind]}</span>
        <div class="res-main"><a class="res-title" href="#/r/${r.id}" dir="auto">${r.title}</a><div class="res-meta">${SOURCE[r.source]} · יובא ${fmtIso(r.created_at)}</div></div>
        <label class="sr-only" for="ic-${r.id}">קורס</label><select id="ic-${r.id}" name="course_id" data-change="field" data-table="resources" data-id="${r.id}" data-nullable data-num data-refresh>${courseOptions(null, { none: 'קורס…' })}</select>
        <button class="btn-link small danger" data-act="trash" data-table="resources" data-id="${r.id}" data-label="${r.title}">מחיקה</button></li>`)}</ul></section>`
      : html`<section class="card">${empty('אין קבצים ממתינים. 🎉 קבצים שתייבאו מ"הוספה מהירה" בלי קורס יגיעו לכאן.')}</section>`}</div>`);
  bind(root, {
    ...fieldHandlers,
    import: () => pickFiles({}),
    all: () => root.querySelectorAll('.sel').forEach(x => { x.checked = true; }),
    bulk: async (f, d) => {
      const ids = [...root.querySelectorAll('.sel:checked')].map(x => +x.value);
      if (!ids.length) return toast('לא סומנו קבצים', { error: true });
      for (const id of ids) await patch('resources', id, { course_id: +d.course_id });
      toast(`${ids.length} קבצים שויכו ל־${courseName(+d.course_id)}`); await refresh();
    },
  });
}

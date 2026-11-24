// Assignments, exams, calendar and the assignments list.
import { html, raw, str, api, dialog, toast, STATUS, STATUS_ORDER } from '../util.js';
import { md } from '../md.js';
import { S, T, byId, courses, courseName, patch, link, unlink, autosave, nextAction, syncReminders, touch } from '../store.js';
import { bind, refresh, empty, statusPill, dueLabel, courseCrumbs, fieldHandlers, checklistSection, checklistHandlers, remindersSection, reminderHandlers, pickResources, pickTopics, setLinks, courseOptions, importFiles, resourceRow } from '../ui.js';
import { today, nowStamp, fmtDateTime, fmtStamp, isOverdue, addDays, relDay, dueStamp } from '../time.js';
import { newAssignment, newExam } from './course.js';

const ROLE_A = { instructions: 'הנחיות המטלה', attachment: 'קבצים מצורפים', draft: 'טיוטות', final: 'קובץ ההגשה הסופי', related: 'חומרי עזר' };
const mdField = (id, label, value, rows = 6, ph = '') => html`<section class="card"><h2 class="card-title"><label for="${id}">${label}</label></h2>
  <textarea id="${id}" class="md-input" rows="${rows}" dir="auto" placeholder="${ph}">${value || ''}</textarea>
  <details><summary class="small">תצוגה מעוצבת</summary><div class="prose" data-preview="${id}">${raw(md(value || ''))}</div></details></section>`;
function mountMd(root, table, row, fields) {
  for (const [elId, field] of fields) {
    const ta = root.querySelector('#' + elId);
    if (!ta) continue;
    const s = autosave({ table, id: row.id, field, base: row });
    const draft = s.draft();
    if (draft != null && draft !== (row[field] || '')) { ta.value = draft; s.set(draft); toast('שוחזרה טיוטה שלא נשמרה קודם'); }
    ta.oninput = () => { s.set(ta.value); const pv = root.querySelector(`[data-preview="${elId}"]`); if (pv) pv.innerHTML = md(ta.value); };
  }
}

// ---------------- assignment ----------------
export function assignment(root, [id]) {
  const a = byId('assignments', id);
  if (!a) throw new Error('המטלה לא נמצאה');
  touch('assignment', a.id).catch(() => {});
  const links = S.data.assignment_resources.filter(x => x.assignment_id === a.id).map(x => ({ ...x, r: byId('resources', x.resource_id) })).filter(x => x.r && !x.r.deleted_at);
  const topics = S.data.assignment_topics.filter(x => x.assignment_id === a.id).map(x => byId('topics', x.topic_id)).filter(Boolean);
  const idx = STATUS_ORDER.indexOf(a.status);
  const next = nextAction(a);
  const overdue = !['submitted', 'graded'].includes(a.status) && isOverdue(a.due_date, a.due_time);
  const fld = (name, type, label, extra = '') => html`<label>${label}<input type="${type}" name="${name}" value="${a[name] || ''}" data-change="due" data-nullable ${raw(extra)}></label>`;

  root.innerHTML = str(html`<div class="page">
    ${courseCrumbs(a.course_id, [['מטלות', a.course_id ? `#/course/${a.course_id}/assignments` : '#/tasks'], [a.title]])}
    ${a.deleted_at ? html`<aside class="notice notice-warn">המטלה בסל המחזור. <button class="btn btn-sm" data-act="undelete">שחזור</button></aside>` : ''}
    <header class="page-head"><div><h1 dir="auto">${a.title}</h1><p class="muted"><bdi>${courseName(a.course_id)}</bdi> · הגשה: ${dueLabel(a.due_date, a.due_time)}${overdue ? html` <span class="pill pill-danger">באיחור</span>` : ''}</p></div>
      <div class="actions"><button class="btn danger" data-act="trash" data-table="assignments" data-id="${a.id}" data-label="${a.title}" data-go="#/tasks">מחיקה</button></div></header>

    <ol class="stepper" aria-label="סטטוס המטלה">${STATUS_ORDER.map((s, i) => html`<li class="${i < idx ? 'past' : i === idx ? 'current' : ''}"><button type="button" data-act="status" data-s="${s}" ${i === idx ? raw('aria-current="step"') : ''}>${STATUS[s]}</button></li>`)}</ol>
    ${a.status === 'ready' ? html`<aside class="notice notice-warn"><strong>מוכן להגשה ≠ הוגש.</strong> כשתגישו בפועל במערכת הקורס, לחצו "הוגש" ורשמו את מועד ההגשה.</aside>` : ''}
    ${a.status === 'submitted' || a.status === 'graded' ? html`<aside class="notice notice-ok">הוגש ${a.submitted_at ? fmtStamp(a.submitted_at) : ''}${a.confirmation ? html` · אישור: <bdi>${a.confirmation}</bdi>` : ''}${a.grade ? html` · ציון: <strong>${a.grade}</strong>` : ''}</aside>` : ''}

    <section class="card card-accent"><h2 class="card-title"><label for="next-action">הפעולה הבאה</label></h2>
      <input id="next-action" class="input-lg" name="next_action" dir="auto" value="${a.next_action}" placeholder="פעולה קונקרטית, למשל: להשלים את שאלה 3" data-change="field" data-table="assignments" data-id="${a.id}">
      ${!a.next_action && next ? html`<p class="hint">כרגע מוצג בדף הבית הצעד הפתוח הראשון ברשימה: "<span dir="auto">${next}</span>"</p>` : ''}</section>

    <div class="grid-2">
      <section class="card"><h2 class="card-title">מועדים</h2>
        <div class="form-grid"><label>שם המטלה<input name="title" value="${a.title}" dir="auto" required data-change="field" data-table="assignments" data-id="${a.id}" data-refresh></label>
          <label>קורס<select name="course_id" data-change="field" data-table="assignments" data-id="${a.id}" data-nullable data-num data-refresh>${courseOptions(a.course_id, { none: '— ללא —' })}</select></label></div>
        <fieldset class="dates"><legend>מועד הגשה רשמי</legend><div class="form-grid">${fld('due_date', 'date', 'תאריך')}${fld('due_time', 'time', 'שעה')}</div></fieldset>
        <fieldset class="dates planned"><legend>מתי אני מתכנן/ת לעבוד על זה</legend><div class="form-grid">${fld('planned_date', 'date', 'תאריך')}${fld('planned_time', 'time', 'שעה')}</div></fieldset>
        <p class="hint">שדה ריק = לא ידוע. שעון ירושלים.</p></section>
      ${checklistSection('assignment', a.id, 'צעדים / סעיפים')}
    </div>

    <section class="card"><h2 class="card-title">קבצים</h2>
      ${Object.entries(ROLE_A).map(([role, label]) => { const items = links.filter(x => x.role === role); return html`<div class="file-group"><h3 class="sub">${label}</h3>
        ${items.length ? html`<ul class="res-list">${items.map(x => resourceRow(x.r, { extra: html`<button class="btn-link small" data-act="unlink-res" data-id="${x.r.id}">הסרה מהמטלה</button>` }))}</ul>` : ''}
        <span class="toolbar"><button class="btn-link small" data-act="add-file" data-role="${role}">+ ייבוא קובץ</button><button class="btn-link small" data-act="pick-res" data-role="${role}">+ מחומרים קיימים</button></span></div>`; })}
      <p class="hint">קובץ אחד יכול להיות מקושר לכמה מטלות ונושאים — הוא נשמר פעם אחת.</p></section>

    <section class="card"><h2 class="card-title">נושאים קשורים</h2>${topics.map(t => html`<a class="tag" href="#/topic/${t.id}">${t.name}</a> `)}${a.course_id ? html`<button class="btn-link small" data-act="topics">עריכה</button>` : html`<span class="muted small">בחרו קורס כדי לשייך נושאים.</span>`}</section>

    ${mdField('a-instr', 'הנחיות המטלה (טקסט)', a.instructions_md, 6, 'אפשר להדביק כאן את ההנחיות המקוריות')}
    <div class="grid-2">${mdField('a-notes', 'הערות', a.notes_md, 6)}${mdField('a-draft', 'טיוטת עבודה', a.draft_md, 6, 'תשובות, קוד, רעיונות…')}</div>

    <section class="card"><h2 class="card-title">הגשה, משוב וציון</h2><div class="form-grid">
      <label>מועד ההגשה בפועל<input type="datetime-local" name="submitted_at" value="${a.submitted_at || ''}" data-change="field" data-table="assignments" data-id="${a.id}" data-nullable></label>
      <label>אישור הגשה (לא חובה)<input name="confirmation" value="${a.confirmation}" dir="auto" placeholder="מספר אישור / צילום מסך" data-change="field" data-table="assignments" data-id="${a.id}"></label>
      <label>ציון<input name="grade" value="${a.grade}" dir="auto" data-change="field" data-table="assignments" data-id="${a.id}"></label></div>
      <label for="a-feedback" class="label">משוב</label><textarea id="a-feedback" class="md-input" rows="3" dir="auto">${a.feedback_md}</textarea></section>
    ${remindersSection('assignment', a.id)}
  </div>`);

  mountMd(root, 'assignments', a, [['a-instr', 'instructions_md'], ['a-notes', 'notes_md'], ['a-draft', 'draft_md'], ['a-feedback', 'feedback_md']]);
  bind(root, {
    ...fieldHandlers, ...checklistHandlers, ...reminderHandlers,
    undelete: async () => { await api('POST', `/api/rows/assignments/${a.id}/restore`); await refresh(); },
    due: async el => { await patch('assignments', a.id, { [el.name]: el.value || null }); Object.assign(a, { [el.name]: el.value || null }); byId('assignments', a.id)[el.name] = el.value || null; if (el.name.startsWith('due')) await syncReminders('assignment', a.id); await refresh(); },
    status: el => changeStatus(a, el.dataset.s),
    topics: async () => { const ids = await pickTopics(a.course_id, topics.map(t => t.id)); if (ids) { await setLinks('assignment_topics', 'assignment_id', a.id, 'topic_id', ids); await refresh(); } },
    'unlink-res': async el => { await unlink('assignment_resources', { assignment_id: a.id, resource_id: +el.dataset.id }); await refresh(); },
    'add-file': el => {
      const input = document.createElement('input'); input.type = 'file'; input.multiple = true;
      input.onchange = async () => {
        const res = await importFiles([...input.files], { course_id: a.course_id });
        for (const r of res) await link('assignment_resources', { assignment_id: a.id, resource_id: r.id, role: el.dataset.role });
        await refresh();
      };
      input.click();
    },
    'pick-res': async el => {
      const role = el.dataset.role;
      const cands = T('resources').filter(r => r.course_id === a.course_id || r.course_id == null);
      const cur = links.filter(x => x.role === role).map(x => x.r.id);
      const ids = await pickResources(`${ROLE_A[role]} — בחירה מחומרים קיימים`, cands, cur);
      if (!ids) return;
      for (const rid of cur) if (!ids.includes(rid)) await unlink('assignment_resources', { assignment_id: a.id, resource_id: rid });
      for (const rid of ids) if (!cur.includes(rid)) await link('assignment_resources', { assignment_id: a.id, resource_id: rid, role });
      await refresh();
    },
  });
}

async function changeStatus(a, s) {
  if (s === a.status) return;
  const data = { status: s };
  if (s === 'submitted') {
    const v = await dialog('סימון כהוגש', html`<p>"הוגש" אומר שהעבודה נשלחה בפועל (למשל במודל). אם רק סיימתם להכין — בחרו "מוכן להגשה".</p>
      <label>מתי הגשתם<input type="datetime-local" name="at" value="${a.submitted_at || nowStamp()}" required></label>
      <label>אישור הגשה (לא חובה)<input name="confirmation" value="${a.confirmation}" dir="auto"></label>
      <label class="check"><input type="checkbox" name="sure" required> כן, המטלה הוגשה בפועל</label>`, { submit: 'סימון כהוגש' });
    if (!v) return;
    Object.assign(data, { submitted_at: v.at, confirmation: v.confirmation });
    await touch('assignment', a.id, { done: 1 });
  } else if (s === 'graded') {
    const v = await dialog('ציון ומשוב', html`<label>ציון (אם ידוע)<input name="grade" value="${a.grade}" dir="auto"></label><label>משוב<textarea name="feedback_md" rows="4" dir="auto">${a.feedback_md}</textarea></label>`);
    if (!v) return;
    Object.assign(data, v);
    if (!a.submitted_at) data.submitted_at = null;
  } else if (['submitted', 'graded'].includes(a.status)) {
    const ok = await dialog('החזרת סטטוס', html`<p>המטלה מסומנת כ"${STATUS[a.status]}". להחזיר ל"${STATUS[s]}"? מועד ההגשה שנרשם יישמר.</p>`, { submit: 'החזרה' });
    if (!ok) return;
    await touch('assignment', a.id, { done: 0 });
  }
  await patch('assignments', a.id, data);
  toast(`סטטוס: ${STATUS[s]}`);
  await refresh();
}

// ---------------- exam ----------------
export function exam(root, [id]) {
  const e = byId('exams', id);
  if (!e) throw new Error('המבחן לא נמצא');
  const topics = S.data.exam_topics.filter(x => x.exam_id === e.id).map(x => byId('topics', x.topic_id)).filter(Boolean);
  const res = S.data.exam_resources.filter(x => x.exam_id === e.id).map(x => byId('resources', x.resource_id)).filter(r => r && !r.deleted_at);
  const f = (name, type, label) => html`<label>${label}<input type="${type}" name="${name}" value="${e[name] || ''}" dir="auto" data-change="due" data-nullable></label>`;
  root.innerHTML = str(html`<div class="page">${courseCrumbs(e.course_id, [['מבחנים', e.course_id ? `#/course/${e.course_id}/exams` : '#/calendar'], [e.title]])}
    ${e.deleted_at ? html`<aside class="notice notice-warn">המבחן בסל המחזור. <button class="btn btn-sm" data-act="undelete">שחזור</button></aside>` : ''}
    <header class="page-head"><div><h1 dir="auto">${e.title}</h1><p class="muted"><bdi>${courseName(e.course_id)}</bdi> · ${e.date ? html`${fmtDateTime(e.date, e.time)} (${relDay(e.date)})` : 'תאריך לא ידוע'}${e.location ? ` · ${e.location}` : ''}</p></div>
      <div class="actions"><button class="btn danger" data-act="trash" data-table="exams" data-id="${e.id}" data-label="${e.title}" data-go="#/calendar">מחיקה</button></div></header>
    <div class="grid-2"><section class="card"><h2 class="card-title">פרטים</h2><div class="form-grid">
      <label>כותרת<input name="title" value="${e.title}" dir="auto" data-change="field" data-table="exams" data-id="${e.id}" data-refresh></label>
      <label>קורס<select name="course_id" data-change="field" data-table="exams" data-id="${e.id}" data-nullable data-num data-refresh>${courseOptions(e.course_id, { none: '— ללא —' })}</select></label>
      ${f('date', 'date', 'תאריך')}${f('time', 'time', 'שעה')}
      <label>מיקום<input name="location" value="${e.location}" dir="auto" data-change="field" data-table="exams" data-id="${e.id}"></label>
      <label>ציון<input name="grade" value="${e.grade}" dir="auto" data-change="field" data-table="exams" data-id="${e.id}"></label></div>
      <p class="hint">שדות לא ידועים נשארים ריקים.</p></section>
      ${checklistSection('exam', e.id, 'רשימת הכנה למבחן')}</div>
    <div class="grid-2"><section class="card"><h2 class="card-title">נושאים לבחינה</h2>${topics.length ? topics.map(t => html`<a class="tag" href="#/topic/${t.id}">${t.name}</a> `) : html`<p class="muted small">לא נבחרו נושאים.</p>`}${e.course_id ? html`<button class="btn-link small" data-act="topics">עריכה</button>` : ''}</section>
      <section class="card"><h2 class="card-title">חומרים למבחן</h2>${res.length ? html`<ul class="res-list">${res.map(r => resourceRow(r))}</ul>` : ''}<button class="btn-link small" data-act="pick-res">בחירת חומרים</button></section></div>
    ${mdField('e-notes', 'הערות והכנה', e.notes_md, 6)}
    ${remindersSection('exam', e.id)}</div>`);
  mountMd(root, 'exams', e, [['e-notes', 'notes_md']]);
  bind(root, {
    ...fieldHandlers, ...checklistHandlers, ...reminderHandlers,
    undelete: async () => { await api('POST', `/api/rows/exams/${e.id}/restore`); await refresh(); },
    due: async el => { await patch('exams', e.id, { [el.name]: el.value || null }); byId('exams', e.id)[el.name] = el.value || null; await syncReminders('exam', e.id); await refresh(); },
    topics: async () => { const ids = await pickTopics(e.course_id, topics.map(t => t.id)); if (ids) { await setLinks('exam_topics', 'exam_id', e.id, 'topic_id', ids); await refresh(); } },
    'pick-res': async () => { const ids = await pickResources('חומרים למבחן', T('resources').filter(r => r.course_id === e.course_id), res.map(r => r.id)); if (ids) { await setLinks('exam_resources', 'exam_id', e.id, 'resource_id', ids); await refresh(); } },
  });
}

// ---------------- calendar ----------------
function events(courseFilter) {
  const ev = [];
  const ok = r => !courseFilter || r.course_id === courseFilter;
  for (const a of T('assignments').filter(ok)) {
    const open = !['submitted', 'graded'].includes(a.status);
    if (a.due_date) ev.push({ date: a.due_date, time: a.due_time, cls: open ? 'ev-due' : 'ev-done', label: `הגשה: ${a.title}`, href: `#/a/${a.id}`, course: a.course_id, open, kind: 'הגשה (רשמי)' });
    if (a.planned_date && open) ev.push({ date: a.planned_date, time: a.planned_time, cls: 'ev-planned', label: `עבודה על: ${a.title}`, href: `#/a/${a.id}`, course: a.course_id, open, kind: 'זמן עבודה מתוכנן' });
  }
  for (const e of T('exams').filter(ok)) if (e.date) ev.push({ date: e.date, time: e.time, cls: 'ev-exam', label: `מבחן: ${e.title}`, href: `#/exam/${e.id}`, course: e.course_id, open: true, kind: 'מבחן' });
  return ev.sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));
}
export function calendar(root, _, query) {
  const view = query.get('view') || localStorage.getItem('cal-view') || 'month';
  localStorage.setItem('cal-view', view);
  const cf = Number(query.get('course')) || null;
  const t = today();
  const month = query.get('m') || t.slice(0, 7);
  const ev = events(cf);
  const q = (o) => { const p = new URLSearchParams({ view, m: month, ...(cf ? { course: cf } : {}), ...o }); return '#/calendar?' + p; };
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const dow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0 = Sunday
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Array.from({ length: Math.ceil((dow + days) / 7) * 7 }, (_, i) => i - dow < 0 || i - dow >= days ? null : addDays(first, i - dow));
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7), next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  const monthName = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 15)));
  const evRow = e => html`<li class="ev ${e.cls}"><a href="${e.href}"><span class="ev-time">${e.time || ''}</span> <span dir="auto">${e.label}</span></a></li>`;
  const now = nowStamp();
  const upcoming = ev.filter(e => e.open && dueStamp(e.date, e.time) >= now);
  const overdue = ev.filter(e => e.open && e.cls !== 'ev-planned' && dueStamp(e.date, e.time) < now && e.cls !== 'ev-exam');
  const undated = [...T('assignments').filter(a => !a.due_date && !['submitted', 'graded'].includes(a.status) && (!cf || a.course_id === cf)), ...T('exams').filter(e => !e.date && (!cf || e.course_id === cf))];
  const byDate = list => Object.entries(list.reduce((acc, e) => { (acc[e.date] ||= []).push(e); return acc; }, {}));

  root.innerHTML = str(html`<div class="page page-wide"><header class="page-head"><div><h1>לוח שנה ומועדים</h1><p class="muted">מועדי הגשה רשמיים, זמני עבודה מתוכננים ומבחנים · שעון ירושלים</p></div>
    <div class="actions"><button class="btn" data-act="new-asg">+ מטלה</button><button class="btn" data-act="new-exam">+ מבחן</button></div></header>
    <div class="toolbar cal-tools">
      <div class="seg" role="group" aria-label="תצוגה"><a class="seg-item ${view === 'month' ? 'on' : ''}" href="${q({ view: 'month' })}">חודש</a><a class="seg-item ${view === 'list' ? 'on' : ''}" href="${q({ view: 'list' })}">רשימה</a></div>
      <label>קורס <select data-change="course"><option value="">כל הקורסים</option>${courses().map(c => html`<option value="${c.id}" ${c.id === cf ? raw('selected') : ''}>${c.name}</option>`)}</select></label>
      <span class="legend small"><span class="ev-due">הגשה רשמית</span><span class="ev-planned">זמן עבודה מתוכנן</span><span class="ev-exam">מבחן</span></span></div>
    ${view === 'month' ? html`<div class="cal-nav"><a class="btn btn-sm" href="${q({ m: prev })}" aria-label="החודש הקודם">→ הקודם</a><h2>${monthName}</h2><a class="btn btn-sm" href="${q({ m: next })}" aria-label="החודש הבא">הבא ←</a>${month !== t.slice(0, 7) ? html`<a class="btn-link small" href="${q({ m: t.slice(0, 7) })}">היום</a>` : ''}</div>
      <div class="cal" role="grid" aria-label="${monthName}"><div class="cal-row cal-head" role="row">${['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'].map(d => html`<div role="columnheader">${d}</div>`)}</div>
        ${Array.from({ length: cells.length / 7 }, (_, w) => html`<div class="cal-row" role="row">${cells.slice(w * 7, w * 7 + 7).map(d => html`<div role="gridcell" class="cal-cell ${d === t ? 'today' : ''} ${d ? '' : 'pad'}" ${d === t ? raw('aria-current="date"') : ''}>${d ? html`<span class="cal-day">${Number(d.slice(8))}</span><ul class="evs">${ev.filter(e => e.date === d).map(evRow)}</ul>` : ''}</div>`)}</div>`)}
      </div>`
    : html`${overdue.length ? html`<section class="card card-danger"><h2 class="card-title">באיחור</h2><ul class="evs-list">${overdue.map(e => html`<li class="ev ${e.cls}"><a href="${e.href}">${fmtDateTime(e.date, e.time)} · <span dir="auto">${e.label}</span></a> <span class="muted small">${courseName(e.course)}</span></li>`)}</ul></section>` : ''}
      <section class="card"><h2 class="card-title">בקרוב</h2>${upcoming.length ? byDate(upcoming).map(([d, list]) => html`<h3 class="sub">${fmtDateTime(d)} <span class="muted">(${relDay(d)})</span></h3><ul class="evs-list">${list.map(e => html`<li class="ev ${e.cls}"><a href="${e.href}">${e.time ? `${e.time} · ` : ''}<span dir="auto">${e.label}</span></a> <span class="muted small">${e.kind} · <bdi>${courseName(e.course)}</bdi></span></li>`)}</ul>`) : empty('אין מועדים עתידיים.')}</section>
      ${undated.length ? html`<section class="card"><h2 class="card-title">ללא תאריך</h2><ul class="plain">${undated.map(x => html`<li><a href="${x.status ? `#/a/${x.id}` : `#/exam/${x.id}`}" dir="auto">${x.title}</a> <span class="muted small"><bdi>${courseName(x.course_id)}</bdi></span></li>`)}</ul></section>` : ''}`}
  </div>`);
  bind(root, {
    course: el => { location.hash = q({ course: el.value }).replace(/course=&?/, ''); },
    'new-asg': () => newAssignment(cf),
    'new-exam': () => newExam(cf),
  });
}

// ---------------- assignments list (route #/tasks kept for old bookmarks) ----------------
export function tasks(root, _, query) {
  const showDone = query.get('done') === '1';
  const asg = T('assignments').sort((a, b) => (dueStamp(a.due_date, a.due_time) || '9999').localeCompare(dueStamp(b.due_date, b.due_time) || '9999'));
  const groups = STATUS_ORDER.filter(s => showDone || !['submitted', 'graded'].includes(s)).map(s => [s, asg.filter(a => a.status === s)]).filter(([, l]) => l.length);
  root.innerHTML = str(html`<div class="page"><header class="page-head"><div><h1>מטלות</h1><p class="muted">כל המטלות מכל הקורסים, לפי סטטוס</p></div>
    <div class="actions"><button class="btn btn-primary" data-act="new-asg">+ מטלה</button><a class="btn" href="#/tasks${showDone ? '' : '?done=1'}">${showDone ? 'הסתרת שהושלמו' : 'הצגת שהושלמו'}</a></div></header>
    <section class="card">${groups.length ? groups.map(([s, list]) => html`<h3 class="sub">${STATUS[s]} (${list.length})</h3><ul class="items">${list.map(a => html`<li class="item"><div class="item-main"><a href="#/a/${a.id}" dir="auto">${a.title}</a> ${statusPill(a.status)}
      <div class="item-meta"><bdi>${courseName(a.course_id)}</bdi> · הגשה: ${dueLabel(a.due_date, a.due_time)}${a.planned_date ? html` · <span class="planned">מתוכנן: ${fmtDateTime(a.planned_date, a.planned_time)}</span>` : ''}</div>
      ${nextAction(a) && !['submitted', 'graded'].includes(a.status) ? html`<div class="next-action"><strong>הבא:</strong> <span dir="auto">${nextAction(a)}</span></div>` : ''}</div></li>`)}</ul>`) : empty('אין מטלות פתוחות.')}</section></div>`);
  bind(root, { 'new-asg': () => newAssignment(null) });
}

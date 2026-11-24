import { html, raw, str, KIND_ICON } from '../util.js';
import { S, T, byId, courses, courseName, create, patch, remove, nextAction } from '../store.js';
import { bind, refresh, quickCapture, pickFiles, statusPill, dueLabel, empty, reorder } from '../ui.js';
import { today, nowStamp, dueStamp, isOverdue, addDays, fmtDateTime, relDay, fmtIso } from '../time.js';

const greeting = n => { const h = +n.slice(11, 13); return h < 5 ? 'לילה טוב' : h < 12 ? 'בוקר טוב' : h < 17 ? 'צהריים טובים' : h < 21 ? 'ערב טוב' : 'לילה טוב'; };
const OPEN = a => !['submitted', 'graded'].includes(a.status);

export function dashboard(root) {
  const t = today(), now = nowStamp(), horizon = addDays(t, 14);
  const asg = T('assignments').filter(OPEN);
  const tasks = T('tasks').filter(x => !x.done);
  const overdue = [...asg.filter(a => isOverdue(a.due_date, a.due_time, now)).map(a => ({ type: 'a', row: a, date: a.due_date, time: a.due_time })),
    ...tasks.filter(x => isOverdue(x.due_date, x.due_time, now)).map(x => ({ type: 't', row: x, date: x.due_date, time: x.due_time }))].sort(byDue);
  const upcoming = [...asg.filter(a => a.due_date && !isOverdue(a.due_date, a.due_time, now) && a.due_date <= horizon).map(a => ({ type: 'a', row: a, date: a.due_date, time: a.due_time })),
    ...tasks.filter(x => x.due_date && !isOverdue(x.due_date, x.due_time, now) && x.due_date <= horizon).map(x => ({ type: 't', row: x, date: x.due_date, time: x.due_time }))].sort(byDue);
  const ready = asg.filter(a => a.status === 'ready');
  const exams = T('exams').filter(e => e.date && e.date >= t).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''))).slice(0, 5);
  const undatedExams = T('exams').filter(e => !e.date).length;
  const todays = T('today').filter(x => x.date === t).sort((a, b) => a.sort - b.sort || a.id - b.id);
  const leftovers = T('today').filter(x => x.date < t && !x.done);
  const resume = resumeItems();
  const catchLessons = T('lessons').filter(l => l.catch_up);
  const catchRes = T('resources').filter(r => r.catch_up);
  const flags = T('flags').filter(f => f.status === 'open');
  const noDate = [...asg.filter(a => !a.due_date), ...tasks.filter(x => !x.due_date)];
  const inbox = T('resources').filter(r => r.course_id == null).length;

  const cs = courses();
  const program = S.data.settings.program;
  const focus = overdue[0] ? { label: 'הכי דחוף עכשיו', it: overdue[0] } : ready[0] ? { label: 'מוכן, רק לא הוגש', it: { type: 'a', row: ready[0] } } : upcoming[0] ? { label: 'הדבר הבא', it: upcoming[0] } : null;
  const focusTitle = focus ? focus.it.row.title : resume[0]?.title;
  const focusHref = focus ? (focus.it.type === 'a' ? `#/a/${focus.it.row.id}` : '#/tasks') : resume[0]?.href;

  root.innerHTML = str(html`
  <div class="page">
    <section class="hero">
      <div class="hero-hello"><p class="eyebrow">${program ? html`<bdi>${program}</bdi>` : 'IJOS'}</p><h1 class="hl">${greeting(now)}</h1>
        <p class="hero-date">${fmtDateTime(t)} · שעון ירושלים</p>
        <div class="actions"><button class="btn" data-act="cap" data-kind="task">+ משימה</button><button class="btn" data-act="cap" data-kind="note">+ פתק</button><button class="btn" data-act="file">+ קובץ</button></div></div>
      <div class="focus" aria-labelledby="h-focus">${focusTitle ? html`<p class="eyebrow">${focus ? focus.label : 'להמשיך מאיפה שעצרתי'}</p><h2 id="h-focus" dir="auto">${focusTitle}</h2>
          ${focus ? html`<p class="muted small">${focus.it.row.course_id ? html`<bdi>${courseName(focus.it.row.course_id)}</bdi> · ` : ''}${dueLabel(focus.it.row.due_date, focus.it.row.due_time)}</p>
            ${focus.it.type === 'a' && nextAction(focus.it.row) ? html`<p class="small">הפעולה הבאה: <span dir="auto">${nextAction(focus.it.row)}</span></p>` : ''}` : html`<p class="muted small">${resume[0].next ? html`הצעד הבא: <span dir="auto">${resume[0].next}</span>` : 'נפתח לאחרונה'}</p>`}
          <a class="btn" href="${focusHref}">לפתוח</a>`
        : html`<p class="eyebrow">שקט כאן</p><h2 id="h-focus">אין שום דבר דחוף.</h2><p class="muted small">${cs.length ? 'זמן טוב לסדר חומרים, לחזור על נושא או לכתוב סיכום.' : 'התחילו בהוספת קורס או בטעינת סמסטר דוגמה.'}</p>
          <a class="btn" href="${cs.length ? '#/calendar' : '#/welcome'}">${cs.length ? 'ללוח השנה' : 'להגדרה'}</a>`}</div>
    </section>

    ${cs.length ? html`<ul class="course-strip" aria-label="הקורסים שלי">${cs.filter(c => byId('semesters', c.semester_id)?.status === 'active').map(c => { const p = progress(c.id); return html`<li><a class="course-tile" href="#/course/${c.id}" style="--c:${c.color || 'var(--accent)'}">
      <span class="ring" style="--p:${p.pct};--c:${c.color || 'var(--accent)'}" role="img" aria-label="${p.total ? `${p.done} מתוך ${p.total} מטלות הוגשו` : 'אין מטלות'}">${p.total ? `${p.pct}%` : '–'}</span>
      <span><strong><bdi>${c.name}</bdi></strong><span class="small">${p.total ? `${p.done}/${p.total} מטלות` : 'עוד אין מטלות'}${p.open ? ` · ${p.open} פתוחות` : ''}</span></span></a></li>`; })}</ul>`
    : html`<section class="card empty-hero"><span class="empty-art" aria-hidden="true">🗂️</span><h2>עוד אין קורסים</h2><p class="muted">הוסיפו סמסטר וקורסים, או טענו סמסטר דוגמה כדי לראות איך הכול נראה.</p><div class="actions center"><a class="btn btn-primary" href="#/welcome">הגדרת סמסטר</a></div></section>`}

    ${overdue.length ? html`<section class="card card-danger" aria-labelledby="h-over"><h2 id="h-over" class="card-title">באיחור (${overdue.length})</h2><ul class="items">${overdue.map(itemRow)}</ul></section>` : ''}
    ${ready.length ? html`<section class="card card-warn"><h2 class="card-title">מוכן להגשה, עדיין לא הוגש</h2><ul class="items">${ready.map(a => html`<li class="item"><div class="item-main"><a href="#/a/${a.id}" dir="auto">${a.title}</a><div class="item-meta"><bdi>${courseName(a.course_id)}</bdi> · ${dueLabel(a.due_date, a.due_time)}</div></div><button class="btn btn-sm btn-primary" data-act="submitted" data-id="${a.id}">סימון שהוגש</button></li>`)}</ul></section>` : ''}

    <div class="cols">
      <div>
        <section class="card" aria-labelledby="h-up"><h2 id="h-up" class="card-title">מועדי הגשה ב־14 הימים הקרובים</h2>
          ${upcoming.length ? html`<ul class="items">${upcoming.map(itemRow)}</ul>` : empty('אין הגשות בשבועיים הקרובים. נשימה עמוקה.')}
          ${noDate.length ? html`<details class="small"><summary>${noDate.length} פריטים פתוחים בלי מועד</summary><ul class="items">${noDate.map(x => itemRow({ type: x.status ? 'a' : 't', row: x }))}</ul></details>` : ''}
          <p class="small"><a href="#/calendar">ללוח השנה המלא</a></p>
        </section>
        <section class="card" aria-labelledby="h-ex"><h2 id="h-ex" class="card-title">מבחנים קרובים</h2>
          ${exams.length ? html`<ul class="items">${exams.map(e => html`<li class="item"><div class="item-main"><a href="#/exam/${e.id}" dir="auto">${e.title}</a><div class="item-meta"><bdi>${courseName(e.course_id)}</bdi> · ${fmtDateTime(e.date, e.time)} (${relDay(e.date)})${e.location ? html` · ${e.location}` : ''}</div></div></li>`)}</ul>` : empty('לא הוזנו מבחנים עם תאריך.')}
          ${undatedExams ? html`<p class="small muted">${undatedExams} מבחנים עדיין בלי תאריך.</p>` : ''}
        </section>
      </div>
      <div>
        <section class="card card-accent" aria-labelledby="h-today"><h2 id="h-today" class="card-title">העדיפויות שלי להיום</h2>
          ${todays.length ? html`<ul class="checklist">${todays.map((x, i) => html`<li><label><input type="checkbox" data-change="today-toggle" data-id="${x.id}" ${x.done ? raw('checked') : ''}> <span dir="auto" class="${x.done ? 'done' : ''}">${x.ref_type ? html`<a href="${refHref(x)}">${x.text}</a>` : x.text}</span></label>
            <span class="row-tools"><button class="icon-btn" data-act="today-move" data-id="${x.id}" data-dir="-1" aria-label="למעלה" ${i === 0 ? raw('disabled') : ''}>↑</button><button class="icon-btn" data-act="today-move" data-id="${x.id}" data-dir="1" aria-label="למטה" ${i === todays.length - 1 ? raw('disabled') : ''}>↓</button><button class="icon-btn" data-act="today-del" data-id="${x.id}" aria-label="הסרה">×</button></span></li>`)}</ul>`
            : html`<p class="muted small">1–3 דברים קונקרטיים. אפשר גם ללחוץ "להיום" ליד כל פריט.</p>`}
          ${todays.length >= 5 ? html`<p class="hint">כבר ${todays.length} פריטים. רשימה קצרה קלה יותר לביצוע.</p>` : ''}
          <form class="inline-form" data-submit="today-add"><label class="sr-only" for="today-new">עדיפות חדשה</label><input id="today-new" name="text" dir="auto" placeholder="מה הדבר הבא שחשוב היום?" required><button class="btn btn-sm">הוספה</button></form>
          ${leftovers.length ? html`<p class="small">${leftovers.length} פריטים לא הושלמו בימים קודמים. <button class="btn-link" data-act="carry">להעביר להיום</button> · <button class="btn-link" data-act="drop-old">לנקות</button></p>` : ''}
        </section>
        <section class="card" aria-labelledby="h-resume"><h2 id="h-resume" class="card-title">להמשיך מאיפה שעצרתי</h2>
          ${resume.length ? html`<ul class="items">${resume.map(r => html`<li class="item"><div class="item-main"><a href="${r.href}" dir="auto">${r.icon} ${r.title}</a>
            <div class="item-meta">${r.next ? html`<strong>הצעד הבא:</strong> <span dir="auto">${r.next}</span>` : html`נפתח ${fmtIso(r.at)}`}${r.position ? html` · <span>מיקום: <bdi>${r.position}</bdi></span>` : ''}</div></div>
            <a class="btn btn-sm" href="${r.href}">המשך</a></li>`)}</ul>` : empty('חומרים ומטלות שהתחלתם יחכו לכם כאן, עם הצעד הבא שרשמתם.')}
        </section>
        <section class="card" aria-labelledby="h-catch"><h2 id="h-catch" class="card-title">להשלמה ולחזרה</h2>
          ${catchLessons.length || catchRes.length || flags.length ? html`<ul class="items">
            ${catchLessons.map(l => html`<li class="item"><div class="item-main"><a href="#/lesson/${l.id}">שיעור: ${l.title || 'ללא כותרת'}${l.date ? ` · ${fmtDateTime(l.date)}` : ''}</a><div class="item-meta"><bdi>${courseName(l.course_id)}</bdi></div></div></li>`)}
            ${catchRes.map(r => html`<li class="item"><div class="item-main"><a href="#/r/${r.id}" dir="auto">${KIND_ICON[r.kind]} ${r.title}</a><div class="item-meta"><bdi>${courseName(r.course_id)}</bdi></div></div></li>`)}
            ${flags.slice(0, 6).map(f => html`<li class="item"><div class="item-main"><span class="pill pill-warn">לא ברור</span> <a href="${f.resource_id ? `#/r/${f.resource_id}?panel=unclear` : '#/'}" dir="auto">${f.text}</a><div class="item-meta"><bdi>${courseName(f.course_id)}</bdi></div></div></li>`)}
          </ul>${flags.length > 6 ? html`<p class="small muted">ועוד ${flags.length - 6} נקודות לא ברורות פתוחות.</p>` : ''}` : empty('אין שיעורים או חומרים שסומנו להשלמה.')}
          ${inbox ? html`<p class="small"><strong>${inbox}</strong> קבצים ממתינים לשיוך לקורס. <a href="#/inbox">למיון</a></p>` : ''}
        </section>
      </div>
    </div>
  </div>`);

  bind(root, {
    cap: el => quickCapture(el.dataset.kind),
    file: () => pickFiles({}),
    submitted: async el => { await patch('assignments', el.dataset.id, { status: 'submitted', submitted_at: nowStamp() }); await refresh(); },
    'today-toggle': async el => { await patch('today', el.dataset.id, { done: el.checked }); await refresh(); },
    'today-del': async el => { await remove('today', el.dataset.id); await refresh(); },
    'today-move': el => reorder(todays, +el.dataset.id, +el.dataset.dir, 'today'),
    'today-add': async (f, d) => { await create('today', { date: t, text: d.text.trim(), sort: todays.length + 1 }); await refresh(); document.getElementById('today-new')?.focus(); },
    'to-today': async el => { await create('today', { date: t, text: el.dataset.text, ref_type: el.dataset.type, ref_id: +el.dataset.id, sort: todays.length + 1 }); await refresh(); },
    carry: async () => { for (const x of leftovers) await patch('today', x.id, { date: t }); await refresh(); },
    'drop-old': async () => { for (const x of leftovers) await remove('today', x.id); await refresh(); },
    'task-done': async el => { await patch('tasks', el.dataset.id, { done: true, done_at: new Date().toISOString() }); await refresh(); },
  });
}

const byDue = (a, b) => (dueStamp(a.date, a.time) || '').localeCompare(dueStamp(b.date, b.time) || '');
const refHref = x => x.ref_type === 'assignment' ? `#/a/${x.ref_id}` : x.ref_type === 'resource' ? `#/r/${x.ref_id}` : '#/tasks';

function itemRow({ type, row }) {
  if (type === 'a') {
    const next = nextAction(row);
    return html`<li class="item"><div class="item-main"><a href="#/a/${row.id}" dir="auto">${row.title}</a> ${statusPill(row.status)}
      <div class="item-meta"><bdi>${courseName(row.course_id)}</bdi> · הגשה: ${dueLabel(row.due_date, row.due_time)}${row.planned_date ? html` · <span class="planned">מתוכנן לעבודה: ${fmtDateTime(row.planned_date, row.planned_time)}</span>` : ''}</div>
      <div class="next-action">${next ? html`<strong>הפעולה הבאה:</strong> <span dir="auto">${next}</span>` : html`<a href="#/a/${row.id}" class="muted">להגדיר פעולה הבאה ←</a>`}</div></div>
      <button class="btn btn-sm" data-act="to-today" data-type="assignment" data-id="${row.id}" data-text="${next || row.title}">להיום</button></li>`;
  }
  return html`<li class="item"><div class="item-main"><span dir="auto">${row.title}</span>
    <div class="item-meta">${row.course_id ? html`<bdi>${courseName(row.course_id)}</bdi> · ` : ''}${dueLabel(row.due_date, row.due_time)}${row.origin === 'unclear' ? ' · משימת חזרה' : ''}</div></div>
    <button class="btn btn-sm" data-act="task-done" data-id="${row.id}">בוצע</button><button class="btn btn-sm" data-act="to-today" data-type="task" data-id="${row.id}" data-text="${row.title}">להיום</button></li>`;
}

function progress(cid) {
  const list = T('assignments').filter(a => a.course_id === cid);
  const done = list.filter(a => !OPEN(a)).length;
  return { total: list.length, done, open: list.length - done, pct: list.length ? Math.round(done / list.length * 100) : 0 };
}

function resumeItems() {
  const cutoff = new Date(Date.now() - 5 * 86400000).toISOString();
  return T('activity').filter(a => !a.done && (a.next_step || (a.last_opened_at || '') > cutoff)).map(a => {
    const isRes = a.entity_type === 'resource';
    const row = byId(isRes ? 'resources' : 'assignments', a.entity_id);
    if (!row || row.deleted_at || (!isRes && !OPEN(row))) return null;
    return { href: isRes ? `#/r/${row.id}` : `#/a/${row.id}`, title: row.title, icon: isRes ? KIND_ICON[row.kind] : '📝', next: a.next_step, position: a.position, at: a.last_opened_at };
  }).filter(Boolean).sort((a, b) => (b.next ? 1 : 0) - (a.next ? 1 : 0) || (b.at || '').localeCompare(a.at || '')).slice(0, 6);
}

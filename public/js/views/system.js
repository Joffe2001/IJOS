// Search, trash, backup/restore and settings.
import { html, raw, str, api, toast, dialog, confirmDlg, fmtSize, KIND, KIND_ICON, sourceBadge } from '../util.js';
import { S, all, byId, courseName, reload } from '../store.js';
import { bind, refresh, empty } from '../ui.js';
import { setTheme } from '../app.js';
import { fmtIso } from '../time.js';

const TYPE = { projects: 'פרויקטים', resources: 'חומרים ופתקים', assignments: 'מטלות', exams: 'מבחנים', summary_chapters: 'פרקים בסיכומים', applications: 'יישומים לפרויקטים', topics: 'נושאים', lessons: 'שיעורים', tasks: 'משימות', flags: 'נקודות לא ברורות' };
const FIELD = { title: 'כותרת', name: 'שם', tags: 'תגיות', notes: 'הערות', original_name: 'שם הקובץ', url: 'כתובת', body: 'תוכן הפתק', text_content: 'תוכן הקובץ', body_md: 'תוכן', instructions_md: 'הנחיות', next_action: 'פעולה הבאה', notes_md: 'הערות', draft_md: 'טיוטה', feedback_md: 'משוב', location: 'מיקום', description: 'תיאור', learned: 'מה למדתי', problem: 'בעיה', proposal: 'יישום', benefit: 'תועלת', questions: 'שאלות', acceptance: 'קריטריונים', text: 'טקסט', date: 'תאריך' };
const href = r => ({ resources: `#/r/${r.id}`, assignments: `#/a/${r.id}`, exams: `#/exam/${r.id}`, summary_chapters: `#/summary/${r.course_id}?ch=${r.id}`, applications: `#/app/${r.id}`, projects: '#/apps', topics: `#/topic/${r.id}`, lessons: `#/lesson/${r.id}`, tasks: '#/tasks', flags: '#/' })[r.table];

export async function search(root, _, query) {
  const q = (query.get('q') || '').trim();
  document.getElementById('search-input').value = q;
  const results = q ? await api('GET', '/api/search?q=' + encodeURIComponent(q)) : [];
  const groups = Object.keys(TYPE).map(t => [t, results.filter(r => r.table === t)]).filter(([, l]) => l.length);
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const mark = text => { let parts = [text]; for (const t of terms) parts = parts.flatMap(p => typeof p !== 'string' ? [p] : p.split(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i')).map((x, i) => i % 2 ? html`<mark>${x}</mark>` : x)); return parts; };
  const unsearchable = all('resources').filter(r => !r.deleted_at && ['unsupported', 'failed'].includes(r.text_status)).length;
  root.innerHTML = str(html`<div class="page"><header class="page-head"><div><h1>חיפוש${q ? html`: <bdi>${q}</bdi>` : ''}</h1><p class="muted">${q ? `${results.length} תוצאות` : 'הקלידו בתיבת החיפוש למעלה'}</p></div></header>
    ${groups.map(([t, list]) => html`<section class="card"><h2 class="card-title">${TYPE[t]} (${list.length})</h2><ul class="items">${list.map(r => html`<li class="item"><div class="item-main">
      <a href="${href(r)}" dir="auto">${r.kind ? `${KIND_ICON[r.kind]} ` : ''}${mark(r.title || '')}</a> ${r.source ? sourceBadge(r.source) : ''}
      <div class="item-meta">${r.course_id ? html`<bdi>${courseName(r.course_id)}</bdi> · ` : ''}נמצא ב: ${r.matched.map(f => FIELD[f] || f).join(', ')}</div>
      ${r.snippet && !r.matched.every(f => ['title', 'name'].includes(f)) ? html`<p class="snippet small" dir="auto">…${mark(r.snippet)}…</p>` : ''}</div></li>`)}</ul></section>`)}
    ${q && !results.length ? html`<section class="card">${empty('לא נמצאו תוצאות. נסו מילה קצרה יותר — החיפוש מוצא גם חלקי מילים.')}</section>` : ''}
    <aside class="notice small"><strong>מה נכלל בחיפוש:</strong> כותרות, תגיות, הערות, שמות קבצים, פתקים, סיכומים מרכזיים, מטלות, מבחנים ויישומים, וגם <strong>תוכן</strong> של קבצי Word (DOCX), PowerPoint (PPTX), Excel (XLSX), HTML, טקסט, Markdown וקוד.
      <strong>לא נכלל:</strong> תוכן של קובצי PDF, תמונות ופורמטים ישנים (DOC/PPT/XLS) — הם נמצאים רק לפי כותרת, תגיות והערות.${unsearchable ? ` כרגע ${unsearchable} קבצים כאלה.` : ''}</aside></div>`);
}

const TRASH = ['resources', 'assignments', 'exams', 'tasks', 'applications', 'projects', 'summary_chapters', 'topics', 'lessons', 'folders', 'courses', 'flags', 'semesters'];
const TNAME = { ...TYPE, folders: 'תיקיות', courses: 'קורסים', semesters: 'סמסטרים' };
export function trash(root) {
  const items = TRASH.flatMap(t => all(t).filter(r => r.deleted_at).map(r => ({ ...r, table: t }))).sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
  root.innerHTML = str(html`<div class="page"><header class="page-head"><div><h1>סל מחזור</h1><p class="muted">פריטים שנמחקו נשמרים כאן עד שתרוקנו את הסל. הקבצים עצמם נמחקים רק בריקון.</p></div>
    ${items.length ? html`<div class="actions"><button class="btn danger" data-act="empty">ריקון הסל</button></div>` : ''}</header>
    <section class="card">${items.length ? html`<ul class="items">${items.map(r => html`<li class="item"><div class="item-main"><span dir="auto">${r.kind ? KIND_ICON[r.kind] + ' ' : ''}${r.title || r.name || r.text}</span>
      <div class="item-meta">${TNAME[r.table]}${r.course_id ? html` · <bdi>${courseName(r.course_id)}</bdi>` : ''} · נמחק ${fmtIso(r.deleted_at)}</div></div>
      <button class="btn btn-sm" data-act="restore" data-t="${r.table}" data-id="${r.id}">שחזור</button><button class="btn btn-sm danger" data-act="purge" data-t="${r.table}" data-id="${r.id}">מחיקה לצמיתות</button></li>`)}</ul>` : empty('הסל ריק.')}</section></div>`);
  bind(root, {
    restore: async el => { await api('POST', `/api/rows/${el.dataset.t}/${el.dataset.id}/restore`); toast('שוחזר'); await refresh(); },
    purge: async el => { if (!(await confirmDlg('מחיקה לצמיתות', 'לא יהיה אפשר לשחזר את הפריט (אלא מגיבוי). להמשיך?', 'מחיקה לצמיתות'))) return; await api('DELETE', `/api/rows/${el.dataset.t}/${el.dataset.id}?hard=1`); await refresh(); },
    empty: async () => { if (!(await confirmDlg('ריקון סל המחזור', `${items.length} פריטים יימחקו לצמיתות, כולל קבצים שאינם בשימוש במקום אחר. מומלץ ליצור גיבוי קודם.`, 'ריקון'))) return; await api('POST', '/api/trash/empty'); toast('הסל רוקן'); await refresh(); },
  });
}

export async function settings(root) {
  const backups = await api('GET', '/api/backups').catch(() => []);
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const theme = document.documentElement.dataset.theme;
  const sample = all('semesters').some(x => x.sample) || all('projects').some(x => x.sample && !x.deleted_at);
  root.innerHTML = str(html`<div class="page"><header class="page-head"><div><h1>גיבוי והגדרות</h1></div></header>
    <section class="card"><h2 class="card-title">שלי</h2><div class="form-grid">
      <label>מה אני לומד/ת (מופיע בדף הבית)<input id="program" dir="auto" value="${S.data.settings.program || ''}" placeholder="למשל: מדעי המחשב, תואר ראשון"></label>
      <fieldset><legend>ערכת צבעים</legend><div class="seg" role="group">${[['light', 'בהיר'], ['dark', 'כהה'], ['system', 'אוטומטי']].map(([k, l]) => html`<label class="seg-item"><input type="radio" name="theme" value="${k}" ${theme === k ? raw('checked') : ''} data-change="theme"> ${l}</label>`)}</div></fieldset></div>
      <p class="hint">הבחירה נשמרת בדפדפן הזה. מסמכים מיובאים (HTML, PDF) מוצגים תמיד על רקע בהיר, כמו שנוצרו.</p></section>
    <section class="card"><h2 class="card-title">נתוני דוגמה</h2>${sample
      ? html`<p>טעונים נתוני דוגמה (מסומנים "דוגמה"). המחיקה מסירה רק אותם, ומה שיצרתם בעצמכם נשאר.</p><button class="btn danger" data-act="sample-del">מחיקת נתוני הדוגמה</button>`
      : html`<p class="muted">סמסטר דוגמה עם שני קורסים מומצאים, מטלה, מבחן, פתק ופרויקט. טוב כדי לראות איך הכול עובד.</p><button class="btn" data-act="sample-load">טעינת נתוני דוגמה</button>`}</section>
    <section class="card"><h2 class="card-title">איפה הנתונים נשמרים</h2>
      <p>כל הנתונים נשמרים במחשב שלך, בתיקייה: <bdi dir="ltr" class="mono">${S.data.meta.dataDir}</bdi></p>
      <ul class="small"><li><bdi dir="ltr" class="mono">study.db</bdi>: כל הרשומות (קורסים, פתקים, מטלות, סיכומים…)</li><li><bdi dir="ltr" class="mono">blobs\\</bdi>: עותקים של הקבצים שייבאתם. הקבצים המקוריים במחשב לא משתנים.</li><li><bdi dir="ltr" class="mono">backups\\</bdi>: גיבויים. <bdi dir="ltr" class="mono">backups\\auto\\</bdi>: צילום יומי אוטומטי של מסד הנתונים (14 אחרונים)</li></ul>
      <p class="hint">כדי לשמור על הנתונים גם אם המחשב ייפגע, העתיקו מדי פעם קובץ גיבוי לענן או לדיסק חיצוני.</p></section>
    <section class="card"><h2 class="card-title">גיבוי</h2><p>גיבוי מלא כולל את כל הרשומות ואת כל הקבצים, בקובץ ZIP אחד.</p>
      <button class="btn btn-primary" data-act="backup">יצירת גיבוי והורדה</button> <a class="btn" href="/api/download/notes">ייצוא כל הפתקים והסיכומים כ־Markdown</a>
      ${backups.length ? html`<details><summary>גיבויים שמורים (${backups.length})</summary><ul class="plain small">${backups.map(b => html`<li class="row-between"><bdi dir="ltr" class="mono">${b.name}</bdi> <span>${fmtSize(b.size)} · <a href="/api/download/backup/${encodeURIComponent(b.name)}">הורדה</a></span></li>`)}</ul></details>` : ''}</section>
    <section class="card"><h2 class="card-title">שחזור מגיבוי</h2>
      <p>בחרו קובץ גיבוי (<bdi dir="ltr">.zip</bdi>) או צילום מסד נתונים (<bdi dir="ltr">.db</bdi>). הקובץ ייבדק קודם, ותראו סיכום לפני שמשהו משתנה.</p>
      <input type="file" id="restore-file" accept=".zip,.db" aria-label="קובץ גיבוי"> <div id="restore-out"></div></section>
    <section class="card"><h2 class="card-title">בדיקת קבצים</h2><p>בודק שכל קובץ שמופיע ברשומות קיים בתיקיית הנתונים.</p><button class="btn" data-act="integrity">בדיקה</button><div id="integrity-out"></div></section>
    <section class="card"><h2 class="card-title">תזכורות והתראות: איך זה עובד</h2>
      <ul><li>תזכורות מוצגות <strong>רק כש־IJOS פתוח בדפדפן</strong>: בפס התזכורות למעלה, ואם תאשרו גם כהתראה של מערכת ההפעלה.</li>
        <li>אם האפליקציה או הדפדפן סגורים, לא תופיע התראה. התזכורות שהוחמצו יוצגו בפתיחה הבאה, עד שתסגרו או תדחו אותן.</li>
        <li>הבדיקה מתבצעת כל 30 שניות. כל הזמנים לפי שעון ירושלים.</li></ul>
      <p>התראות דפדפן: <strong>${{ granted: 'מאושרות', denied: 'חסומות (אפשר לשנות בהגדרות האתר בדפדפן)', default: 'לא הוגדרו', unsupported: 'לא נתמכות בדפדפן הזה' }[perm]}</strong>
        ${perm === 'default' ? html`<button class="btn btn-sm" data-act="notif">אישור התראות</button>` : ''}${perm === 'granted' ? html`<button class="btn btn-sm" data-act="test-notif">התראת ניסיון</button>` : ''}</p></section>
    <section class="card"><h2 class="card-title">על המערכת</h2><p class="small"><strong dir="ltr">IJOS</strong> · Ido Joffe's OS · גרסה <bdi dir="ltr">${S.data.meta.version}</bdi> · מבנה נתונים ${S.data.meta.schema}</p><p class="small">פועל מקומית בכתובת <bdi dir="ltr" class="mono">http://127.0.0.1:${S.data.meta.port}</bdi>. אין חשבון, אין ענן ואין שליחת נתונים לשירותים חיצוניים. גודל קובץ מרבי לייבוא: <bdi dir="ltr">${S.data.meta.maxUploadMb} MB</bdi>.</p></section></div>`);
  bind(root, {
    backup: async () => { toast('יוצר גיבוי…'); const b = await api('POST', '/api/backup'); toast(`נוצר גיבוי (${fmtSize(b.size)}, ${b.manifest.files} קבצים)`); location.href = `/api/download/backup/${encodeURIComponent(b.name)}`; },
    notif: async () => { await Notification.requestPermission(); await settings(root); },
    'test-notif': () => new Notification('IJOS', { body: 'כך תיראה תזכורת.', lang: 'he', dir: 'rtl', icon: '/favicon.svg' }),
    theme: async el => { setTheme(el.value); await refresh(); },
    'sample-load': async () => { await api('POST', '/api/sample'); toast('נתוני הדוגמה נטענו'); await reload(); location.hash = '#/'; },
    'sample-del': async () => { if (!(await confirmDlg('מחיקת נתוני הדוגמה', 'כל הקורסים, החומרים והפרויקטים שמסומנים "דוגמה" יימחקו לצמיתות. הנתונים שלכם לא יושפעו.', 'מחיקה'))) return; const r = await api('DELETE', '/api/sample'); toast(`נמחקו נתוני הדוגמה (${r.removed_courses} קורסים)`); await refresh(); },
    integrity: async () => {
      const r = await api('GET', '/api/integrity');
      root.querySelector('#integrity-out').innerHTML = str(r.missing.length ? html`<p class="flag flag-danger">${r.missing.length} קבצים חסרים:</p><ul>${r.missing.map(m => html`<li><a href="#/r/${m.id}">${m.title}</a></li>`)}</ul><p class="hint">אפשר לשחזר מגיבוי, או לפתוח את החומר ולהעלות את הקובץ מחדש.</p>` : html`<p class="flag flag-ok">✓ כל הקבצים קיימים.</p>`);
    },
  });
  root.querySelector('#program').onchange = async e => { await api('PUT', '/api/settings/program', { value: e.target.value.trim() }); toast('נשמר'); await reload(); };
  root.querySelector('#restore-file').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    const out = root.querySelector('#restore-out');
    out.innerHTML = str(html`<p class="loading">בודק את הגיבוי…</p>`);
    try {
      const r = await api('POST', '/api/restore/inspect', f);
      const LBL = { courses: 'קורסים', resources: 'חומרים', assignments: 'מטלות', exams: 'מבחנים', summary_chapters: 'פרקי סיכום', applications: 'יישומים' };
      out.innerHTML = str(html`<div class="notice"><p><strong>הגיבוי תקין.</strong> ${r.created_at ? `נוצר ${fmtIso(r.created_at)}.` : 'צילום מסד נתונים בלבד (ללא קבצים).'}</p>
        <table class="table"><thead><tr><th></th><th>בגיבוי</th><th>כרגע</th></tr></thead><tbody>${Object.keys(LBL).map(k => html`<tr><td>${LBL[k]}</td><td>${r.backup[k]}</td><td>${r.current[k]}</td></tr>`)}</tbody></table>
        ${r.missingFiles.length ? html`<p class="flag flag-danger">${r.missingFiles.length} קבצים שמוזכרים בגיבוי אינם בו ואינם במחשב: ${r.missingFiles.slice(0, 10).join(', ')}${r.missingFiles.length > 10 ? '…' : ''}. הרשומות ישוחזרו, והקבצים יסומנו כחסרים.</p>` : ''}
        <p><strong>השחזור מחליף את כל הרשומות הנוכחיות</strong> במצב שבגיבוי. לפני כן נשמר אוטומטית צילום של המצב הנוכחי (בתיקיית backups), כך שאפשר לחזור. קבצים קיימים לא נמחקים.</p>
        <button class="btn btn-primary" id="restore-apply">שחזור</button> <button class="btn" id="restore-cancel">ביטול</button></div>`);
      out.querySelector('#restore-cancel').onclick = () => { out.innerHTML = ''; e.target.value = ''; };
      out.querySelector('#restore-apply').onclick = async () => {
        const ok = await dialog('אישור שחזור', html`<p>להחליף את הנתונים הנוכחיים במצב מהגיבוי?</p>`, { submit: 'כן, לשחזר' });
        if (!ok) return;
        const res = await api('POST', '/api/restore/apply', { token: r.token });
        toast(`השחזור הושלם. המצב הקודם נשמר כ־${res.safetyBackup}`, { ms: 9000 });
        await reload(); location.hash = '#/';
      };
    } catch (err) { out.innerHTML = str(html`<p class="flag flag-danger">לא ניתן לשחזר: ${err.message}</p>`); }
  };
}

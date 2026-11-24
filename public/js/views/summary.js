// Master course summary: chapters by topic, coverage, versions, AI proposal review, prompt builder.
import { html, raw, str, api, dialog, toast, copyText, options, KIND, KIND_ICON, SOURCE, sourceBadge, confirmDlg } from '../util.js';
import { md, render as mdRender } from '../md.js';
import { S, T, byId, courses, courseName, topicsOf, create, patch, link, full, autosave, reload } from '../store.js';
import { bind, refresh, empty, courseCrumbs, pickResources, reorder, fieldHandlers } from '../ui.js';
import { fmtIso } from '../time.js';

const TEMPLATE = '### הגדרות\n- **מונח** — הגדרה\n\n### הסברים\n\n### דוגמאות\n\n### טעויות נפוצות\n';
const chaptersOf = cid => T('summary_chapters').filter(c => c.course_id === cid).sort((a, b) => a.sort - b.sort || a.id - b.id);
const sourcesOf = chId => S.data.summary_sources.filter(s => s.chapter_id === chId).map(s => byId('resources', s.resource_id)).filter(r => r && !r.deleted_at);
const head = (c, sub) => html`${courseCrumbs(c.id, [['סיכום מרכזי', `#/summary/${c.id}`], ...(sub ? [[sub]] : [])])}`;

export function summary(root, [cid], query) {
  const c = byId('courses', cid);
  if (!c || c.deleted_at) throw new Error('הקורס לא נמצא');
  const chapters = chaptersOf(c.id);
  const editId = Number(query.get('edit')) || null;
  const topics = topicsOf(c.id).filter(t => !t.archived);
  const covered = new Set(chapters.map(ch => ch.topic_id).filter(Boolean));
  const missing = topics.filter(t => !covered.has(t.id));
  const included = new Set(chapters.flatMap(ch => sourcesOf(ch.id).map(r => r.id)));
  const lecturer = T('resources').filter(r => r.course_id === c.id && r.kind !== 'note' && ['lecturer'].includes(r.source));
  const notIncluded = lecturer.filter(r => !included.has(r.id));
  const last = chapters.reduce((m, ch) => ch.updated_at > m ? ch.updated_at : m, '');

  root.innerHTML = str(html`<div class="page page-wide">${head(c)}
    <header class="page-head"><div><h1>סיכום מרכזי · <bdi>${c.name}</bdi></h1><p class="muted">${chapters.length} פרקים${last ? ` · עודכן לאחרונה ${fmtIso(last)}` : ''}</p></div>
      <div class="actions"><button class="btn btn-primary" data-act="new-ch">+ פרק</button><a class="btn" href="#/summary/${c.id}/propose">הצעת עדכון מ־AI</a><button class="btn" data-act="snap">שמירת גרסה</button><a class="btn" href="#/summary/${c.id}/versions">היסטוריית גרסאות</a><a class="btn" href="/api/download/summary/${c.id}">ייצוא Markdown</a></div></header>
    <nav class="tabs" aria-label="אזורי הקורס"><a href="#/course/${c.id}">חזרה לקורס</a><a href="#/summary/${c.id}" aria-current="page">סיכום מרכזי</a></nav>
    <div class="summary-layout">
      <aside class="toc card" aria-label="תוכן עניינים"><h2 class="card-title">תוכן עניינים</h2>
        ${chapters.length ? html`<ol class="toc-list">${chapters.map(ch => html`<li><a href="#/summary/${c.id}?ch=${ch.id}" data-act="goto" data-id="${ch.id}" dir="auto">${ch.title}</a>${mdRender(ch.body_md).headings.filter(h => h.level <= 3).length ? html`<ol>${mdRender(ch.body_md).headings.filter(h => h.level === 3 && !/^(הגדרות|הסברים|דוגמאות|טעויות נפוצות)$/.test(h.text)).slice(0, 8).map(h => html`<li><a href="#/summary/${c.id}?ch=${ch.id}" data-act="goto-h" data-h="${h.id}" data-id="${ch.id}" dir="auto">${h.text}</a></li>`)}</ol>` : ''}</li>`)}</ol>` : html`<p class="muted small">אין פרקים עדיין.</p>`}
        <h2 class="card-title">כיסוי</h2>
        <p class="small"><strong>נושאים:</strong> ${topics.length - missing.length} מתוך ${topics.length} מכוסים</p>
        ${missing.length ? html`<ul class="plain small">${missing.map(t => html`<li>⚠️ <span dir="auto">${t.name}</span> <button class="btn-link small" data-act="ch-topic" data-id="${t.id}">יצירת פרק</button></li>`)}</ul>` : ''}
        <p class="small"><strong>חומרי מרצה:</strong> ${lecturer.length - notIncluded.length} מתוך ${lecturer.length} משויכים לפרקים</p>
        ${notIncluded.length ? html`<details class="small"><summary>חומרים שעדיין לא שויכו (${notIncluded.length})</summary><ul class="plain">${notIncluded.map(r => html`<li><a href="#/r/${r.id}" dir="auto">${r.title}</a></li>`)}</ul></details>` : ''}
        <p class="hint">"כיסוי" מבוסס על השיוך שאתם מגדירים בין פרקים לנושאים ולחומרים — לא על ניתוח התוכן.</p>
      </aside>
      <article class="summary-doc">
        ${chapters.length ? chapters.map((ch, i) => chapterView(c, ch, i, chapters.length, ch.id === editId)) : html`<div class="card">${empty('הסיכום ריק. התחילו מפרק לכל נושא — עם הגדרות, הסברים, דוגמאות וטעויות נפוצות.', html`<button class="btn btn-primary" data-act="new-ch">פרק ראשון</button> ${missing.length ? html`<button class="btn" data-act="all-topics">פרק לכל נושא (${missing.length})</button>` : ''}`)}</div>`}
      </article></div></div>`);

  const handlers = {
    ...fieldHandlers,
    'new-ch': () => newChapter(c, null),
    'ch-topic': el => newChapter(c, +el.dataset.id),
    'all-topics': async () => { for (const t of missing) await create('summary_chapters', { course_id: c.id, topic_id: t.id, title: t.name, body_md: TEMPLATE, sort: 999 }); await refresh(); },
    snap: async () => { await api('POST', `/api/summary/${c.id}/snapshot`, { reason: 'שמירה ידנית' }); toast('הגרסה נשמרה'); await reload(); },
    goto: (el) => document.getElementById(`ch-${el.dataset.id}`)?.scrollIntoView({ behavior: 'smooth' }),
    'goto-h': (el) => (document.getElementById(el.dataset.h) || document.getElementById(`ch-${el.dataset.id}`))?.scrollIntoView({ behavior: 'smooth' }),
    edit: el => { location.hash = `#/summary/${c.id}?edit=${el.dataset.id}&ch=${el.dataset.id}`; },
    done: () => { location.hash = `#/summary/${c.id}?ch=${editId}`; },
    move: el => reorder(chapters, +el.dataset.id, +el.dataset.dir, 'summary_chapters'),
    sources: async el => {
      const ch = byId('summary_chapters', el.dataset.id);
      const ids = await pickResources('מקורות הפרק', T('resources').filter(r => r.course_id === c.id), sourcesOf(ch.id).map(r => r.id), { hint: 'החומרים שעליהם הפרק מבוסס. כך אפשר לחזור למקור ולראות מה עוד לא נכלל.' });
      if (!ids) return;
      const { setLinks } = await import('../ui.js');
      await setLinks('summary_sources', 'chapter_id', ch.id, 'resource_id', ids);
      await refresh();
    },
    'del-ch': async el => { const ch = byId('summary_chapters', el.dataset.id); if (!(await confirmDlg('מחיקת פרק', `למחוק את "${ch.title}"? הפרק יעבור לסל המחזור ונשמרת גם גרסה של הסיכום.`, 'מחיקה'))) return; await api('POST', `/api/summary/${c.id}/snapshot`, { reason: `לפני מחיקת "${ch.title}"` }); await api('DELETE', `/api/rows/summary_chapters/${ch.id}`); await refresh(); },
  };
  bind(root, handlers);
  if (editId) mountEditor(root, byId('summary_chapters', editId));
  const target = Number(query.get('ch'));
  if (target) requestAnimationFrame(() => document.getElementById(`ch-${target}`)?.scrollIntoView());
  if (query.get('newTopic')) { const t = byId('topics', query.get('newTopic')); history.replaceState(null, '', `#/summary/${c.id}`); if (t) newChapter(c, t.id); }
}

function chapterView(c, ch, i, n, editing) {
  const src = sourcesOf(ch.id);
  const topic = ch.topic_id ? byId('topics', ch.topic_id) : null;
  return html`<section class="chapter card" id="ch-${ch.id}" aria-labelledby="cht-${ch.id}">
    <header class="chapter-head"><h2 id="cht-${ch.id}" dir="auto">${ch.title}</h2>
      <span class="row-tools">${editing ? html`<button class="btn btn-sm btn-primary" data-act="done">סיום עריכה</button>` : html`<button class="btn btn-sm" data-act="edit" data-id="${ch.id}">עריכה</button>`}
        <button class="icon-btn" data-act="move" data-id="${ch.id}" data-dir="-1" aria-label="הזזה למעלה" ${i === 0 ? raw('disabled') : ''}>↑</button><button class="icon-btn" data-act="move" data-id="${ch.id}" data-dir="1" aria-label="הזזה למטה" ${i === n - 1 ? raw('disabled') : ''}>↓</button>
        <button class="btn-link small danger" data-act="del-ch" data-id="${ch.id}">מחיקה</button></span></header>
    <p class="chapter-meta small">${topic ? html`נושא: <a href="#/topic/${topic.id}">${topic.name}</a> · ` : ''}עודכן ${fmtIso(ch.updated_at)} · מקורות: ${src.length ? src.map(r => html`<a href="#/r/${r.id}" dir="auto">${KIND_ICON[r.kind]} ${r.title}</a> `) : html`<span class="muted">לא הוגדרו</span> `}<button class="btn-link small" data-act="sources" data-id="${ch.id}">עריכת מקורות</button></p>
    ${editing ? html`<div class="chapter-edit"><div class="form-grid"><label>כותרת<input name="title" value="${ch.title}" dir="auto" data-change="field" data-table="summary_chapters" data-id="${ch.id}"></label>
        <label>נושא<select name="topic_id" data-change="field" data-table="summary_chapters" data-id="${ch.id}" data-nullable data-num><option value="">— ללא —</option>${topicsOf(c.id).map(t => html`<option value="${t.id}" ${t.id === ch.topic_id ? raw('selected') : ''}>${t.name}</option>`)}</select></label></div>
      <div class="split-edit"><textarea id="ch-editor" class="md-input" dir="auto" aria-label="תוכן הפרק (Markdown)">${ch.body_md}</textarea><div class="prose" id="ch-preview">${raw(md(ch.body_md))}</div></div>
      <p class="hint">נשמר אוטומטית. גרסה קודמת נשמרת בהיסטוריה (לכל היותר פעם בחצי שעה של עריכה, ובכל "שמירת גרסה").</p></div>`
      : html`<div class="prose">${raw(md(ch.body_md, { shift: 1 }) || '<p class="muted">הפרק ריק.</p>')}</div>`}</section>`;
}
function mountEditor(root, ch) {
  const ta = root.querySelector('#ch-editor'), pv = root.querySelector('#ch-preview');
  if (!ta) return;
  const s = autosave({ table: 'summary_chapters', id: ch.id, field: 'body_md', base: ch });
  ta.oninput = () => { s.set(ta.value); pv.innerHTML = md(ta.value); };
  ta.focus();
}
async function newChapter(c, topicId) {
  const t = topicId ? byId('topics', topicId) : null;
  const v = await dialog('פרק חדש בסיכום', html`<label>כותרת<input name="title" value="${t?.name || ''}" dir="auto" required autofocus></label>
    <label>נושא<select name="topic_id"><option value="">— ללא —</option>${topicsOf(c.id).map(x => html`<option value="${x.id}" ${x.id === topicId ? raw('selected') : ''}>${x.name}</option>`)}</select></label>
    <label class="check"><input type="checkbox" name="tpl" checked> להתחיל מתבנית (הגדרות, הסברים, דוגמאות, טעויות נפוצות)</label>`);
  if (!v) return;
  const ch = await create('summary_chapters', { course_id: c.id, title: v.title.trim(), topic_id: v.topic_id ? +v.topic_id : null, body_md: v.tpl ? TEMPLATE : '', sort: chaptersOf(c.id).length + 1 });
  location.hash = `#/summary/${c.id}?edit=${ch.id}&ch=${ch.id}`;
  await reload();
}

// ---------------- versions ----------------
export async function versions(root, [cid], query) {
  const c = byId('courses', cid);
  const list = T('summary_versions').filter(v => v.course_id === c.id).sort((a, b) => b.id - a.id);
  const sel = Number(query.get('v')) || null;
  const v = sel ? await full('summary_versions', sel) : null;
  const snap = v ? JSON.parse(v.snapshot) : null;
  root.innerHTML = str(html`<div class="page">${head(c, 'היסטוריית גרסאות')}
    <header class="page-head"><div><h1>היסטוריית גרסאות · <bdi>${c.name}</bdi></h1><p class="muted">גרסה נשמרת לפני כל קבלת הצעה, מחיקת פרק ושחזור, וגם במהלך עריכה (לכל היותר פעם בחצי שעה).</p></div></header>
    <div class="grid-sidebar"><section class="card"><ul class="plain">${list.map(x => html`<li><a href="#/summary/${c.id}/versions?v=${x.id}" ${x.id === sel ? raw('aria-current="true"') : ''}>${fmtIso(x.created_at)}</a> <span class="muted small">${x.reason}</span></li>`)}</ul>${list.length ? '' : empty('אין עדיין גרסאות שמורות.')}</section>
      <section class="card">${snap ? html`<div class="row-between"><h2 class="card-title">גרסה מ־${fmtIso(v.created_at)} (${snap.chapters.length} פרקים)</h2><button class="btn btn-primary" data-act="restore">שחזור הגרסה הזו</button></div>
        <p class="hint">שחזור מחליף את הסיכום הנוכחי בגרסה הזו. המצב הנוכחי נשמר קודם כגרסה נפרדת, כך שאפשר לחזור אליו.</p>
        ${snap.chapters.map(ch => html`<h2 dir="auto">${ch.title}</h2><div class="prose">${raw(md(ch.body_md, { shift: 1 }))}</div>`)}` : html`<p class="muted">בחרו גרסה כדי לצפות בה.</p>`}</section></div></div>`);
  bind(root, { restore: async () => { await api('POST', `/api/summary-versions/${sel}/restore`); toast('הגרסה שוחזרה'); await reload(); location.hash = `#/summary/${c.id}`; } });
}

// ---------------- prompt building (no AI provider: copy/paste flow) ----------------
// Extension point: a future provider integration would send buildPrompt(...).text and feed the reply into the same review flow.
const PER_ITEM = 15000;
export async function buildPrompt({ task, question, resources, course, chapter }) {
  const parts = [], attach = [];
  for (const r0 of resources) {
    const r = await full('resources', r0.id);
    const text = r.kind === 'note' ? r.body : r.text_content;
    const headLine = `### ${r.title}\n(סוג: ${KIND[r.kind]} · מקור: ${SOURCE[r.source]}${r.original_name ? ` · קובץ: ${r.original_name}` : ''})`;
    if (text?.trim()) parts.push(`${headLine}\n\n${text.length > PER_ITEM ? text.slice(0, PER_ITEM) + '\n[…קוצר — הטקסט המלא בקובץ המקורי]' : text}`);
    else { parts.push(`${headLine}\n\n[התוכן לא נכלל — הקובץ מצורף בנפרד]`); attach.push(r); }
    if (text && text.length > PER_ITEM) attach.push(r);
  }
  const intro = {
    explain: 'הסבר לי את החומר הבא בעברית פשוטה, צעד אחר צעד, עם דוגמה אחת לפחות.',
    summarize: 'כתוב סיכום לימודי מסודר של החומר הבא.',
    practice: 'כתוב 8 שאלות תרגול מגוונות על החומר הבא, ואחריהן פתרונות מלאים בנפרד.',
    check: 'בדוק את הסיכום/ההערות שלי מול חומרי המקור. ציין טעויות, חוסרים וניסוחים לא מדויקים — אל תכתוב סיכום חדש.',
    update: `הצע עדכונים לסיכום המרכזי של הקורס${chapter ? ` (פרק: "${chapter.title}")` : ''} על סמך חומרי המקור.`,
  }[task];
  const format = task === 'update' || task === 'summarize'
    ? 'פורמט התשובה: Markdown בלבד. כל פרק מתחיל בכותרת "## שם הפרק". בתוך כל פרק השתמש בתתי־כותרות "### הגדרות", "### הסברים", "### דוגמאות", "### טעויות נפוצות" לפי הצורך. מונחים מוגדרים כתוב כ־**מונח** — הגדרה. נוסחאות בתחביר LaTeX בין $…$. קוד בבלוקים עם ```. אל תמציא עובדות שאינן בחומר; אם משהו לא ברור מהמקור — כתוב זאת במפורש.'
    : 'פורמט התשובה: Markdown, עברית, קוד ונוסחאות בתחביר רגיל ($…$ ל־LaTeX). אל תמציא עובדות שאינן בחומר.';
  const current = chapter ? `\n\n## הטקסט הנוכחי של הפרק (לא למחוק תוכן נכון; לסמן מה להוסיף או לתקן)\n\n${chapter.body_md}` : '';
  const text = `קורס: ${course?.name || '—'}\n\n${intro}\n${question ? `\nהשאלה/הבקשה שלי: ${question}\n` : ''}\n${format}${current}\n\n## חומרי מקור\n\n${parts.join('\n\n---\n\n')}${attach.length ? `\n\n## קבצים שאצרף בנפרד\n${attach.map(r => `- ${r.original_name || r.title}`).join('\n')}` : ''}`;
  return { text, attach };
}

export function promptBuilder(root, _, query) {
  const cid = Number(query.get('course')) || null;
  const list = cid ? T('resources').filter(r => r.course_id === cid) : [];
  root.innerHTML = str(html`<div class="page"><header class="page-head"><div><h1>עבודה עם AI</h1><p class="muted">IJOS לא מחובר ל־ChatGPT או ל־Claude ואין לו גישה לשיחות שלכם. כאן מכינים פרומפט מסודר להעתקה, ומייבאים את התשובה עם רישום המקור.</p></div></header>
    <form class="card" data-submit="build"><h2 class="card-title">1. בחירת חומרים ובקשה</h2>
      <div class="form-grid"><label>קורס<select name="course" data-change="course"><option value="">— בחרו קורס —</option>${courses().map(c => html`<option value="${c.id}" ${c.id === cid ? raw('selected') : ''}>${c.name}</option>`)}</select></label>
        <label>מה לבקש<select name="task">${options({ explain: 'הסבר של החומר', summarize: 'סיכום', practice: 'שאלות תרגול', check: 'בדיקת הסיכום שלי מול המקור', update: 'הצעת עדכון לסיכום המרכזי' })}</select></label></div>
      <label>שאלה או הבהרה (לא חובה)<textarea name="question" rows="2" dir="auto" placeholder="למשל: לא הבנתי את ההבדל בין for ל־while"></textarea></label>
      ${cid ? html`<fieldset><legend>חומרים לכלול</legend>${list.length ? html`<ul class="pick-list">${list.map(r => html`<li><label><input type="checkbox" name="r${r.id}"> ${KIND_ICON[r.kind]} <span dir="auto">${r.title}</span> ${sourceBadge(r.source)} <span class="muted small">${r.kind === 'note' || r.text_status === 'extracted' ? 'הטקסט ייכלל' : 'יש לצרף את הקובץ בנפרד'}</span></label></li>`)}</ul>` : html`<p class="muted">אין חומרים בקורס.</p>`}</fieldset>` : html`<p class="muted">בחרו קורס כדי לראות את החומרים.</p>`}
      <button class="btn btn-primary" ${cid ? '' : raw('disabled')}>הכנת פרומפט</button></form>
    <div id="prompt-out"></div>
    <form class="card" data-submit="import"><h2 class="card-title">2. ייבוא התשובה</h2>
      <p class="small muted">הדביקו את התשובה שקיבלתם. היא תישמר כחומר נפרד, מסומן לפי המקור (ולא כחומר מרצה או כטקסט שלכם).</p>
      <div class="form-grid"><label>כותרת<input name="title" dir="auto" required placeholder="למשל: הסבר — לולאות"></label><label>מקור<select name="source">${options({ chatgpt: 'ChatGPT', claude: 'Claude', other: 'כלי AI אחר' })}</select></label>
        <label>קורס<select name="course_id">${courses().map(c => html`<option value="${c.id}" ${c.id === cid ? raw('selected') : ''}>${c.name}</option>`)}</select></label></div>
      <label>התשובה (Markdown או טקסט)<textarea name="body" rows="8" dir="auto" required></textarea></label>
      <p class="hint">קיבלתם קובץ HTML? ייבאו אותו כקובץ רגיל ובחרו מקור ChatGPT/Claude. רוצים לשלב בסיכום המרכזי? השתמשו ב"הצעת עדכון מ־AI" בעמוד הסיכום.</p>
      <button class="btn btn-primary">שמירה</button></form></div>`);
  let lastSources = [];
  bind(root, {
    course: el => { location.hash = `#/ai${el.value ? `?course=${el.value}` : ''}`; },
    build: async (f, d) => {
      const res = list.filter(r => d['r' + r.id]);
      if (!res.length) return toast('בחרו לפחות חומר אחד', { error: true });
      lastSources = res.map(r => r.id);
      const { text, attach } = await buildPrompt({ task: d.task, question: d.question, resources: res, course: byId('courses', cid) });
      const out = root.querySelector('#prompt-out');
      out.innerHTML = str(html`<section class="card"><h2 class="card-title">הפרומפט מוכן</h2>
        ${attach.length ? html`<aside class="notice notice-warn"><strong>צרפו בנפרד לשיחה את הקבצים הבאים</strong> (התוכן שלהם לא נכלל בטקסט${attach.some(r => r.text_status === 'extracted') ? ' או שקוצר' : ''}):<ul>${attach.map(r => html`<li><bdi>${r.original_name || r.title}</bdi> — <a href="/files/${r.id}?download=1">הורדה</a></li>`)}</ul></aside>` : html`<p class="small">כל החומרים שנבחרו נכללו בטקסט.</p>`}
        <textarea class="prompt-box" rows="12" readonly dir="auto" aria-label="הפרומפט">${text}</textarea>
        <button class="btn btn-primary" data-act="copy">העתקה ללוח</button> <span class="muted small">${text.length.toLocaleString('he-IL')} תווים</span></section>`);
      out.querySelector('[data-act=copy]').onclick = async () => { toast(await copyText(text) ? 'הועתק ללוח — הדביקו ב־ChatGPT או ב־Claude' : 'לא ניתן להעתיק אוטומטית; סמנו והעתיקו ידנית'); };
    },
    import: async (f, d) => {
      const r = await create('resources', { title: d.title.trim(), kind: 'note', role: 'summary', source: d.source, course_id: +d.course_id, body: d.body });
      for (const sid of lastSources) await link('resource_relations', { resource_id: r.id, related_id: sid });
      toast('התשובה נשמרה כחומר מסומן AI');
      location.hash = `#/r/${r.id}`;
    },
  });
}

// ---------------- AI proposal review ----------------
const norm = s => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 1);
const jaccard = (a, b) => { const A = new Set(norm(a)), B = new Set(norm(b)); if (!A.size || !B.size) return 0; let n = 0; for (const x of A) if (B.has(x)) n++; return n / (A.size + B.size - n); };
const paras = t => t.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 40 && !/^#/.test(p));
export function splitSections(text) {
  const out = [];
  let cur = null;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const m = /^#{1,2}\s+(.+)$/.exec(line);
    if (m) { cur = { title: m[1].trim(), body: [] }; out.push(cur); continue; }
    if (!cur) { if (!line.trim()) continue; cur = { title: 'הצעה', body: [] }; out.push(cur); }
    cur.body.push(line);
  }
  return out.map(s => ({ title: s.title, body: s.body.join('\n').trim() })).filter(s => s.body || s.title !== 'הצעה');
}
export function definitions(text) {
  const out = {};
  for (const line of text.split('\n')) { const m = /\*\*([^*]{2,60})\*\*\s*[—:\-–]\s*(.+)/.exec(line); if (m) out[m[1].trim().toLowerCase()] = m[2].trim(); }
  return out;
}
// Line diff (LCS). ponytail: O(n·m) — fine for chapter-sized text.
export function lineDiff(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  const dp = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) { out.push([' ', A[i]]); i++; j++; }
    else if (j < B.length && (i >= A.length || dp[i][j + 1] >= dp[i + 1][j])) out.push(['+', B[j++]]);
    else out.push(['-', A[i++]]);
  }
  return out;
}
export function analyze(sections, chapters) {
  return sections.map(sec => {
    let match = chapters.find(ch => ch.title.trim().toLowerCase() === sec.title.trim().toLowerCase());
    if (!match) { const best = chapters.map(ch => [ch, jaccard(ch.title, sec.title)]).sort((a, b) => b[1] - a[1])[0]; if (best && best[1] >= 0.5) match = best[0]; }
    const overlaps = [];
    for (const p of paras(sec.body)) for (const ch of chapters) for (const q of paras(ch.body_md)) { const s = jaccard(p, q); if (s >= 0.45) overlaps.push({ chapter: ch, score: s, text: p.slice(0, 140) }); }
    const defs = definitions(sec.body), conflicts = [];
    for (const ch of chapters) { const cd = definitions(ch.body_md); for (const [term, d] of Object.entries(defs)) if (cd[term] && cd[term] !== d && jaccard(cd[term], d) < 0.6) conflicts.push({ term, chapter: ch, mine: cd[term], theirs: d }); }
    return { ...sec, match, overlaps: overlaps.sort((a, b) => b.score - a.score).slice(0, 4), conflicts };
  });
}

export async function propose(root, [cid], query) {
  const c = byId('courses', cid);
  const chapters = chaptersOf(c.id);
  const pid = Number(query.get('p')) || null;
  if (!pid) {
    const res = T('resources').filter(r => r.course_id === c.id);
    root.innerHTML = str(html`<div class="page">${head(c, 'הצעת עדכון')}
      <header class="page-head"><div><h1>הצעת עדכון לסיכום המרכזי</h1><p class="muted">שלושה שלבים: בחירת מקורות והעתקת פרומפט → הדבקת התשובה → בדיקה ואישור של כל שינוי. שום דבר לא נדרס בלי אישור.</p></div></header>
      <form class="card" data-submit="build"><h2 class="card-title">1. מקורות ופרומפט</h2>
        <label>פרק יעד<select name="chapter"><option value="">כל הסיכום / פרקים חדשים</option>${chapters.map(ch => html`<option value="${ch.id}">${ch.title}</option>`)}</select></label>
        <ul class="pick-list">${res.map(r => html`<li><label><input type="checkbox" name="r${r.id}"> ${KIND_ICON[r.kind]} <span dir="auto">${r.title}</span> ${sourceBadge(r.source)}</label></li>`)}</ul>
        <button class="btn">הכנת פרומפט</button><div id="prompt-out"></div></form>
      <form class="card" data-submit="analyze"><h2 class="card-title">2. התשובה שהתקבלה</h2>
        <label>מקור<select name="origin">${options({ chatgpt: 'ChatGPT', claude: 'Claude', other: 'אחר', me: 'כתבתי בעצמי' })}</select></label>
        <label>הטקסט המוצע (Markdown, פרק לכל "## כותרת")<textarea name="body" rows="10" dir="auto" required></textarea></label>
        <button class="btn btn-primary">3. מעבר לבדיקה</button></form>
      ${T('proposals').filter(p => p.course_id === c.id && p.status === 'open').length ? html`<section class="card"><h2 class="card-title">הצעות שממתינות לבדיקה</h2><ul class="plain">${T('proposals').filter(p => p.course_id === c.id && p.status === 'open').map(p => html`<li><a href="#/summary/${c.id}/propose?p=${p.id}">${SOURCE[p.origin] || 'אחר'} · ${fmtIso(p.created_at)}</a></li>`)}</ul></section>` : ''}</div>`);
    let sources = [];
    bind(root, {
      build: async (f, d) => {
        const sel = res.filter(r => d['r' + r.id]);
        if (!sel.length) return toast('בחרו לפחות מקור אחד', { error: true });
        sources = sel.map(r => r.id);
        const { text, attach } = await buildPrompt({ task: 'update', resources: sel, course: c, chapter: d.chapter ? byId('summary_chapters', d.chapter) : null });
        const out = root.querySelector('#prompt-out');
        out.innerHTML = str(html`${attach.length ? html`<aside class="notice notice-warn"><strong>צרפו בנפרד:</strong> ${attach.map(r => html`<bdi>${r.original_name || r.title}</bdi> (<a href="/files/${r.id}?download=1">הורדה</a>) `)}</aside>` : ''}<textarea class="prompt-box" rows="8" readonly dir="auto" aria-label="פרומפט">${text}</textarea><button type="button" class="btn btn-primary" id="copy-p">העתקה ללוח</button>`);
        out.querySelector('#copy-p').onclick = async () => toast(await copyText(text) ? 'הועתק ללוח' : 'סמנו והעתיקו ידנית');
      },
      analyze: async (f, d) => {
        const p = await create('proposals', { course_id: c.id, body_md: d.body, origin: d.origin, source_ids: sources });
        await reload(); location.hash = `#/summary/${c.id}/propose?p=${p.id}`;
      },
    });
    return;
  }
  const p = await full('proposals', pid);
  const sections = analyze(splitSections(p.body_md), chapters);
  const srcIds = JSON.parse(p.source_ids || '[]');
  const originLabel = SOURCE[p.origin] || 'אחר';
  root.innerHTML = str(html`<div class="page page-wide">${head(c, 'בדיקת הצעה')}
    <header class="page-head"><div><h1>בדיקת הצעה מ־${originLabel}</h1><p class="muted">${sections.length} קטעים · ${fmtIso(p.created_at)} · ${p.status === 'open' ? 'ממתין לבדיקה' : p.status === 'accepted' ? 'הוחל' : 'נדחה'}</p></div></header>
    <aside class="notice">הבדיקות למטה הן <strong>השוואה טקסטואלית אוטומטית</strong> (דמיון מילים ומונחים מודגשים), לא הבנת תוכן. "סתירה אפשרית" = אותו מונח מוגדר בניסוח שונה — כדאי לבדוק בעצמכם.</aside>
    <form data-submit="apply">${sections.map((s, i) => html`<section class="card proposal">
      <header class="row-between"><h2 class="card-title" dir="auto">${s.title}</h2>
        <label>פעולה <select name="a${i}">
          <option value="new" ${s.match ? '' : raw('selected')}>הוספה כפרק חדש</option>
          ${chapters.map(ch => html`<option value="append:${ch.id}" ${s.match?.id === ch.id ? raw('selected') : ''}>הוספה לסוף "${ch.title}"</option><option value="replace:${ch.id}">החלפת התוכן של "${ch.title}"</option>`)}
          <option value="skip">דילוג</option></select></label></header>
      ${s.conflicts.map(x => html`<p class="flag flag-danger">⚠️ סתירה אפשרית: <strong>${x.term}</strong> מוגדר בפרק "<span dir="auto">${x.chapter.title}</span>" כ־"<span dir="auto">${x.mine}</span>" ובהצעה כ־"<span dir="auto">${x.theirs}</span>".</p>`)}
      ${s.overlaps.map(x => html`<p class="flag">↔ חפיפה אפשרית (${Math.round(x.score * 100)}% מילים משותפות) עם פרק "<span dir="auto">${x.chapter.title}</span>": <span class="muted" dir="auto">${x.text}…</span></p>`)}
      <div class="compare"><div><h3 class="sub">ההצעה</h3><div class="prose">${raw(md(s.body))}</div></div>
        <div><h3 class="sub">${s.match ? html`שינויים מול "${s.match.title}"` : 'אין פרק תואם'}</h3>${s.match ? html`<pre class="diff" dir="auto">${lineDiff(s.match.body_md, s.body).map(([k, l]) => html`<span class="d${k === '+' ? 'add' : k === '-' ? 'del' : 'eq'}">${k === ' ' ? ' ' : k} ${l}\n</span>`)}</pre><p class="hint">"+" שורות שיתווספו אם תבחרו החלפה · "−" שורות שיימחקו בהחלפה. בהוספה לסוף לא נמחק דבר.</p>` : html`<p class="muted small">ייווצר פרק חדש.</p>`}</div></div></section>`)}
      ${p.status === 'open' ? html`<div class="toolbar sticky-actions"><button class="btn btn-primary">החלת הפעולות שנבחרו</button><button type="button" class="btn" data-act="reject">דחיית כל ההצעה</button><span class="hint">לפני ההחלה נשמרת גרסה של הסיכום הנוכחי.</span></div>` : ''}</form></div>`);
  bind(root, {
    reject: async () => { await patch('proposals', p.id, { status: 'rejected' }); toast('ההצעה נדחתה'); location.hash = `#/summary/${c.id}`; },
    apply: async (f, d) => {
      await api('POST', `/api/summary/${c.id}/snapshot`, { reason: `לפני קבלת הצעה מ־${originLabel}` });
      const titles = srcIds.map(id => byId('resources', id)?.title).filter(Boolean);
      const stamp = `\n\n> מקור: ${originLabel} · ${new Date().toLocaleDateString('he-IL')}${titles.length ? ` · על בסיס: ${titles.join(', ')}` : ''}`;
      let n = 0;
      for (const [i, s] of sections.entries()) {
        const [act, chId] = String(d['a' + i]).split(':');
        if (act === 'skip') continue;
        let target;
        if (act === 'new') target = await create('summary_chapters', { course_id: c.id, title: s.title, body_md: s.body + stamp, sort: chaptersOf(c.id).length + n + 1 });
        else {
          const ch = await full('summary_chapters', +chId);
          target = await patch('summary_chapters', ch.id, { body_md: act === 'append' ? `${ch.body_md.trimEnd()}\n\n${s.body}${stamp}` : s.body + stamp });
        }
        for (const rid of srcIds) await link('summary_sources', { chapter_id: target.id, resource_id: rid });
        n++;
      }
      await patch('proposals', p.id, { status: 'accepted' });
      toast(`הוחלו ${n} שינויים. הגרסה הקודמת שמורה בהיסטוריה.`);
      await reload(); location.hash = `#/summary/${c.id}`;
    },
  });
}

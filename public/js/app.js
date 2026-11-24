import { html, raw, str, $, errorToast, hasUnsaved, toast } from './util.js';
import { S, reload, T, courses, byId, dueReminders, resetSavers } from './store.js';
import { quickCapture, importFiles, reminderBar } from './ui.js';
import * as home from './views/home.js';
import * as course from './views/course.js';
import * as ws from './views/workspace.js';
import * as work from './views/work.js';
import * as summary from './views/summary.js';
import * as apps from './views/apps.js';
import * as sys from './views/system.js';
import * as onboard from './views/onboard.js';

const routes = [
  [/^\/$/, home.dashboard],
  [/^\/welcome$/, onboard.welcome],
  [/^\/inbox$/, course.inbox],
  [/^\/semester\/(\d+)$/, course.semester],
  [/^\/course\/(\d+)(?:\/(\w+))?$/, course.course],
  [/^\/topic\/(\d+)$/, course.topic],
  [/^\/lesson\/(\d+)$/, course.lesson],
  [/^\/r\/(\d+)$/, ws.workspace],
  [/^\/a\/(\d+)$/, work.assignment],
  [/^\/exam\/(\d+)$/, work.exam],
  [/^\/calendar$/, work.calendar],
  [/^\/tasks$/, work.tasks],
  [/^\/summary\/(\d+)$/, summary.summary],
  [/^\/summary\/(\d+)\/propose$/, summary.propose],
  [/^\/summary\/(\d+)\/versions$/, summary.versions],
  [/^\/ai$/, summary.promptBuilder],
  [/^\/apps$/, apps.list],
  [/^\/app\/(\d+)$/, apps.edit],
  [/^\/search$/, sys.search],
  [/^\/trash$/, sys.trash],
  [/^\/settings$/, sys.settings],
];

export function currentRoute() {
  const h = location.hash.slice(1) || '/';
  const [path, qs] = h.split('?');
  return { path, query: new URLSearchParams(qs || '') };
}

let lastPath = null;
export async function render({ keepScroll = false } = {}) {
  const main = $('#main');
  const { path, query } = currentRoute();
  const scroll = keepScroll ? main.scrollTop : 0;
  const winScroll = keepScroll ? window.scrollY : 0;
  renderSidebar();
  // Navigation: flush pending autosaves, then render from fresh server state (local, a few ms).
  if (!keepScroll) { await resetSavers().catch(() => {}); if (lastPath !== null) await reload().catch(() => {}); }
  // First launch: no semesters yet and onboarding not finished. Send to the welcome flow (it can be skipped).
  if (path === '/' && !T('semesters').length && S.data.settings.onboarded !== '1') { location.replace('#/welcome'); return; }
  const r = routes.find(([re]) => re.test(path));
  try {
    main.onclick = main.onchange = main.oninput = main.onsubmit = main.onkeydown = null;
    if (!r) { main.innerHTML = str(html`<div class="empty"><h1>העמוד לא נמצא</h1><a href="#/">חזרה לדף הבית</a></div>`); return; }
    await r[1](main, r[0].exec(path).slice(1), query);
  } catch (e) {
    console.error(e);
    main.innerHTML = str(html`<div class="empty error-state"><h1>לא הצלחנו להציג את העמוד</h1><p>${e.message}</p><button class="btn" data-reload>טעינה מחדש</button></div>`);
    main.onclick = ev => { if (ev.target.closest('[data-reload]')) location.reload(); };
  }
  if (keepScroll) { main.scrollTop = scroll; window.scrollTo(0, winScroll); }
  if (path !== lastPath && !keepScroll) { window.scrollTo(0, 0); if (lastPath !== null) main.focus({ preventScroll: true }); } // first load: leave focus at the top so Tab reaches the skip link
  lastPath = path;
  reminderBar();
}
// Reload data from server and re-render current page, keeping scroll position.
export async function refresh() { await resetSavers().catch(() => {}); await reload(); await render({ keepScroll: true }); }

function renderSidebar() {
  const sb = $('#sidebar');
  const { path } = currentRoute();
  const inbox = T('resources').filter(r => r.course_id == null).length;
  const active = (re) => re.test(path) ? raw('aria-current="page"') : '';
  const sems = T('semesters').sort((a, b) => a.sort - b.sort);
  const showAll = localStorage.getItem('show-all-semesters') === '1';
  const visible = sems.filter(s => s.status === 'active' || showAll);
  const theme = document.documentElement.dataset.theme;
  sb.innerHTML = str(html`
    <a class="brand" href="#/" aria-label="IJOS, דף הבית">${raw(LOGO)}<span class="brand-text"><span class="brand-name" dir="ltr">IJOS</span><span class="brand-tag">כל התואר. מקום אחד.</span></span></a>
    <nav class="nav" aria-label="עמודים">
      <a href="#/" ${active(/^\/$/)}><span class="nav-ico" aria-hidden="true">⌂</span>בית</a>
      <a href="#/inbox" ${active(/^\/inbox/)}><span class="nav-ico" aria-hidden="true">⇣</span>לא ממוין ${inbox ? html`<span class="count">${inbox}</span>` : ''}</a>
      <a href="#/calendar" ${active(/^\/calendar/)}><span class="nav-ico" aria-hidden="true">▦</span>לוח שנה ומועדים</a>
      <a href="#/tasks" ${active(/^\/tasks/)}><span class="nav-ico" aria-hidden="true">✓</span>משימות ומטלות</a>
      <a href="#/apps" ${active(/^\/apps?/)}><span class="nav-ico" aria-hidden="true">✦</span>יישומים לפרויקטים</a>
      <a href="#/ai" ${active(/^\/ai/)}><span class="nav-ico" aria-hidden="true">⌘</span>עבודה עם AI</a>
    </nav>
    ${visible.map(s => html`<section class="nav-sem">
      <h2 class="nav-head"><a href="#/semester/${s.id}" ${active(new RegExp(`^/semester/${s.id}$`))}>${byId('years', s.year_id)?.name} · ${s.name}</a>${s.status !== 'active' ? html` <span class="muted small">(${s.status === 'planned' ? 'עתידי' : 'הסתיים'})</span>` : ''}</h2>
      <ul class="nav-courses">${courses().filter(c => c.semester_id === s.id).map(c => html`<li><a href="#/course/${c.id}" ${active(new RegExp(`^/(course|summary)/${c.id}(/|$)`))}><span class="dot" style="--c:${c.color || 'var(--accent)'}"></span><bdi>${c.name}</bdi></a></li>`)}</ul>
    </section>`)}
    ${sems.length > visible.length || showAll ? html`<button type="button" class="btn-link small" id="toggle-sems">${showAll ? 'הצגת הסמסטר הפעיל בלבד' : `הצגת כל הסמסטרים (${sems.length})`}</button>` : ''}
    ${!sems.length ? html`<a class="nav-add" href="#/welcome">+ הגדרת סמסטר ראשון</a>` : ''}
    <nav class="nav nav-foot" aria-label="מערכת">
      <a href="#/trash" ${active(/^\/trash/)}><span class="nav-ico" aria-hidden="true">♻</span>סל מחזור</a>
      <a href="#/settings" ${active(/^\/settings/)}><span class="nav-ico" aria-hidden="true">⚙</span>גיבוי והגדרות</a>
    </nav>
    <div class="theme-switch" role="group" aria-label="ערכת צבעים">${[['light', 'בהיר'], ['dark', 'כהה'], ['system', 'אוטומטי']].map(([k, l]) => html`<button type="button" data-theme-set="${k}" aria-pressed="${theme === k}">${l}</button>`)}</div>`);
  sb.querySelectorAll('[data-theme-set]').forEach(b => { b.onclick = () => { setTheme(b.dataset.themeSet); renderSidebar(); }; });
  const t = $('#toggle-sems');
  if (t) t.onclick = () => { localStorage.setItem('show-all-semesters', showAll ? '0' : '1'); renderSidebar(); };
}

export const LOGO = `<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#16151d" stroke="#3a3748"/><rect x="9" y="33" width="46" height="13" rx="4" fill="#d7f04a" transform="rotate(-8 32 39.5)"/><rect x="17" y="13" width="8.5" height="31" rx="2.5" fill="#fff"/><path d="M33 13h8.5v24.5c0 6.4-4.6 10.5-10.6 10.5H29v-8h1.6c1.6 0 2.4-.9 2.4-2.6z" fill="#fff"/><circle cx="50" cy="16" r="4.5" fill="#8f82ff"/></svg>`;
export function setTheme(t) { document.documentElement.dataset.theme = t; localStorage.setItem('ijos-theme', t); }

// ---- global wiring ----
async function boot() {
  try { await reload(); } catch (e) {
    $('#main').innerHTML = str(html`<div class="empty error-state"><h1>אין חיבור ל־IJOS</h1><p>החלון השחור של IJOS כנראה נסגר. הפעילו אותו שוב (start-ijos.cmd) ולחצו על ניסיון חוזר.</p><button class="btn" data-reload>ניסיון חוזר</button></div>`);
    $('[data-reload]').onclick = () => location.reload();
    return;
  }
  await render();
  window.addEventListener('hashchange', () => render());
  $('#search-form').onsubmit = e => { e.preventDefault(); location.hash = '#/search?q=' + encodeURIComponent($('#search-input').value.trim()); };
  $('#capture-btn').onclick = () => quickCapture();
  $('#nav-toggle').onclick = () => { const open = document.body.classList.toggle('nav-open'); $('#nav-toggle').setAttribute('aria-expanded', open); };
  $('#sidebar').addEventListener('click', e => { if (e.target.closest('a')) document.body.classList.remove('nav-open'); });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#search-input').focus(); $('#search-input').select(); }
    if (e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); quickCapture(); }
  });
  window.addEventListener('beforeunload', e => { if (hasUnsaved()) { e.preventDefault(); e.returnValue = ''; } });
  // Drag & drop import anywhere (not onto text fields)
  let depth = 0;
  const overlay = $('#drop-overlay');
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', e => { if (hasFiles(e)) { depth++; overlay.hidden = false; } });
  window.addEventListener('dragleave', e => { if (hasFiles(e) && --depth <= 0) { depth = 0; overlay.hidden = true; } });
  window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth = 0; overlay.hidden = true;
    const m = /^\/(?:course|summary)\/(\d+)/.exec(currentRoute().path);
    importFiles([...e.dataTransfer.files], { course_id: m ? +m[1] : null });
  });
  // Reminders: checked every 30 s while this tab is open.
  setInterval(() => reminderBar(true), 30000);
  reminderBar(true);
  if (S.data.meta && !sessionStorage.getItem('greeted') && dueReminders().length) toast(`יש ${dueReminders().length} תזכורות שהגיע זמנן`);
  sessionStorage.setItem('greeted', '1');
}
window.addEventListener('error', e => errorToast(e.error));
window.addEventListener('unhandledrejection', e => errorToast(e.reason));
boot();

import { esc } from './md.js';
export { esc };

// Tagged template: interpolations are escaped unless wrapped with raw(). Arrays are joined.
const RAW = Symbol('raw');
export const raw = s => ({ [RAW]: String(s ?? '') });
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += val(v) + strings[i + 1]; });
  return raw(out);
}
const val = v => v == null || v === false ? '' : Array.isArray(v) ? v.map(val).join('') : v[RAW] !== undefined ? v[RAW] : esc(v);
export const str = h => h[RAW] ?? String(h);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---- API ----
export class ApiError extends Error { constructor(status, body) { super(body?.error || `HTTP ${status}`); this.status = status; this.body = body; } }
export async function api(method, url, body, headers = {}) {
  const isRaw = body instanceof Blob || body instanceof ArrayBuffer;
  const res = await fetch(url, {
    method, headers: { 'x-ijos': '1', ...(body && !isRaw ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body == null ? undefined : isRaw ? body : JSON.stringify(body),
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

// ---- save status (header indicator) ----
let saving = 0, failed = 0;
export function saveStatus(delta, error) {
  saving += delta;
  if (error === true) failed++;
  if (error === false && failed) failed--;
  const el = document.getElementById('save-status');
  if (!el) return;
  el.dataset.state = failed ? 'error' : saving > 0 ? 'saving' : 'ok';
  el.textContent = failed ? 'שגיאה בשמירה — מנסה שוב' : saving > 0 ? 'שומר…' : 'הכול נשמר';
}
export const hasUnsaved = () => saving > 0 || failed > 0;

// ---- toast ----
export function toast(msg, opts = {}) {
  const box = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = 'toast' + (opts.error ? ' toast-error' : '');
  t.setAttribute('role', opts.error ? 'alert' : 'status');
  t.innerHTML = str(html`<span>${msg}</span>${opts.action ? html`<button type="button" class="btn-link">${opts.action.label}</button>` : ''}<button type="button" class="icon-btn" aria-label="סגירה">×</button>`);
  const close = () => t.remove();
  t.querySelector('.icon-btn').onclick = close;
  if (opts.action) t.querySelector('.btn-link').onclick = () => { opts.action.run(); close(); };
  box.append(t);
  setTimeout(close, opts.ms || (opts.action ? 9000 : 4000));
}
export const errorToast = e => toast(e?.message ? `שגיאה: ${e.message}` : 'משהו השתבש', { error: true });

// ---- dialogs (native <dialog>, keyboard accessible) ----
export function dialog(title, body, { submit = 'שמירה', wide = false, onSubmit, onMount, cancel = 'ביטול' } = {}) {
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.className = 'dlg' + (wide ? ' dlg-wide' : '');
    d.innerHTML = str(html`<form method="dialog" class="dlg-form"><header class="dlg-head"><h2>${title}</h2><button type="button" class="icon-btn" data-x aria-label="סגירה">×</button></header>
      <div class="dlg-body">${body}</div>
      <footer class="dlg-foot">${submit ? html`<button class="btn btn-primary" value="ok">${submit}</button>` : ''}<button type="button" class="btn" data-x>${cancel}</button></footer></form>`);
    document.body.append(d);
    const form = d.querySelector('form');
    const done = v => { d.close(); d.remove(); resolve(v); };
    d.querySelectorAll('[data-x]').forEach(b => b.onclick = () => done(null));
    d.addEventListener('cancel', e => { e.preventDefault(); done(null); });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      form.querySelectorAll('input[type=checkbox][name]').forEach(c => { data[c.name] = c.checked; });
      form.querySelectorAll('select[multiple][name]').forEach(s => { data[s.name] = [...s.selectedOptions].map(o => o.value); });
      if (onSubmit) {
        try { const r = await onSubmit(data, d); if (r === false) return; done(r ?? data); } catch (err) { errorToast(err); }
      } else done(data);
    });
    d.showModal();
    onMount?.(d);
    (d.querySelector('[autofocus]') || d.querySelector('input,textarea,select'))?.focus();
  });
}
export const confirmDlg = (title, text, submit = 'אישור') => dialog(title, html`<p>${text}</p>`, { submit }).then(Boolean);

// ---- misc ----
export const debounce = (fn, ms) => { let t; const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; f.flush = () => {}; return f; };
export const fmtSize = n => n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;
export const parseTags = t => { try { return JSON.parse(t || '[]'); } catch { return []; } };
export function download(url) { const a = document.createElement('a'); a.href = url; a.download = ''; document.body.append(a); a.click(); a.remove(); }
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok; }
}

// ---- labels ----
export const KIND = { pdf: 'PDF', slides: 'מצגת', doc: 'מסמך Word', sheet: 'גיליון Excel', html: 'סיכום HTML', image: 'תמונה', text: 'טקסט', md: 'Markdown', code: 'קוד', link: 'קישור', note: 'פתק', other: 'קובץ' };
export const KIND_ICON = { pdf: '📕', slides: '📊', doc: '📄', sheet: '📗', html: '🌐', image: '🖼️', text: '📃', md: '📝', code: '⌨️', link: '🔗', note: '✏️', other: '📦' };
export const ROLE = { material: 'חומר לימוד', summary: 'סיכום', exercise: 'תרגול', assignment: 'מטלה', solution: 'פתרון', syllabus: 'סילבוס', notes: 'הערות', other: 'אחר' };
export const SOURCE = { lecturer: 'מרצה / קורס', me: 'שלי', chatgpt: 'ChatGPT', claude: 'Claude', other: 'מקור אחר' };
export const SOURCE_CLASS = { lecturer: 'src-lecturer', me: 'src-me', chatgpt: 'src-ai', claude: 'src-ai', other: 'src-other' };
export const STATUS = { not_started: 'טרם התחלתי', in_progress: 'בעבודה', ready: 'מוכן להגשה', submitted: 'הוגש', graded: 'נבדק' };
export const STATUS_ORDER = ['not_started', 'in_progress', 'ready', 'submitted', 'graded'];
export const sourceBadge = s => html`<span class="badge ${SOURCE_CLASS[s] || 'src-other'}">${s === 'chatgpt' || s === 'claude' ? 'AI · ' : ''}${SOURCE[s] || SOURCE.other}</span>`;
export const options = (map, sel) => Object.entries(map).map(([k, v]) => html`<option value="${k}" ${String(k) === String(sel ?? '') ? raw('selected') : ''}>${v}</option>`);

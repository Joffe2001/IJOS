// Client cache of /api/state (all records except heavy text). Mutations go to the server, then reload.
import { api, saveStatus, ApiError, dialog, html, toast } from './util.js';
import { nowStamp, dueStamp, addMinutes } from './time.js';

export const S = { data: null };
const listeners = new Set();
export const onChange = fn => listeners.add(fn);

export async function reload() {
  S.data = await api('GET', '/api/state');
  return S.data;
}
const live = rows => rows.filter(r => !r.deleted_at);
export const T = name => live(S.data?.[name] || []);
export const all = name => S.data?.[name] || [];
export const byId = (name, id) => (S.data?.[name] || []).find(r => r.id === Number(id));

// ---- mutations ----
// New rows go into the local cache at once, so navigating to them works before the next reload.
export const create = async (t, d) => { const row = await api('POST', `/api/rows/${t}`, d); S.data?.[t]?.push(row); return row; };
export const patch = (t, id, d) => api('PATCH', `/api/rows/${t}/${id}`, d);
export const remove = (t, id) => api('DELETE', `/api/rows/${t}/${id}`);
export const restore = (t, id) => api('POST', `/api/rows/${t}/${id}/restore`);
export const link = (t, row) => api('POST', `/api/join/${t}`, row);
export const unlink = (t, row) => api('DELETE', `/api/join/${t}`, row);
export const full = (t, id) => api('GET', `/api/rows/${t}/${id}`);

// ---- derived helpers ----
export const courses = () => T('courses').filter(c => !c.archived).sort((a, b) => a.sort - b.sort || a.id - b.id);
export const activeSemester = () => T('semesters').find(s => s.status === 'active');
export const courseName = id => byId('courses', id)?.name || 'לא ממוין';
export const topicsOf = courseId => T('topics').filter(t => t.course_id === courseId).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'he'));
export const resTopics = rid => S.data.resource_topics.filter(x => x.resource_id === rid).map(x => byId('topics', x.topic_id)).filter(t => t && !t.deleted_at);
export const related = rid => S.data.resource_relations.filter(x => x.resource_id === rid || x.related_id === rid)
  .map(x => byId('resources', x.resource_id === rid ? x.related_id : x.resource_id)).filter(r => r && !r.deleted_at);
export const checklistOf = (type, id) => S.data.checklist.filter(c => c.owner_type === type && c.owner_id === id).sort((a, b) => a.sort - b.sort || a.id - b.id);
export const remindersOf = (type, id) => S.data.reminders.filter(r => r.target_type === type && r.target_id === id && r.status !== 'dismissed').sort((a, b) => a.remind_at.localeCompare(b.remind_at));
export const activityOf = (type, id) => S.data.activity.find(a => a.entity_type === type && a.entity_id === Number(id));
export const setting = k => S.data.settings?.[k];

// Next concrete action for an assignment: explicit next_action, else first open checklist item.
export function nextAction(a) {
  if (a.next_action?.trim()) return a.next_action.trim();
  const item = checklistOf('assignment', a.id).find(c => !c.done);
  return item ? item.text : '';
}

// Reminder target metadata (title + due) used by reminders and calendar. Other targets (e.g. tasks from older versions) are never shown.
export function targetInfo(type, id) {
  const row = byId(type === 'assignment' ? 'assignments' : type === 'exam' ? 'exams' : null, id);
  if (!row || row.deleted_at) return null;
  if (type === 'exam') return { row, title: row.title, date: row.date, time: row.time, href: `#/exam/${id}` };
  return { row, title: row.title, date: row.due_date, time: row.due_time, href: `#/a/${id}` };
}
// When a due date changes, move reminders that were defined relative to it.
export async function syncReminders(type, id) {
  const info = targetInfo(type, id);
  if (!info) return;
  const due = dueStamp(info.date, info.time || '09:00');
  for (const r of remindersOf(type, id)) {
    if (r.offset_minutes == null || !due) continue;
    const at = addMinutes(due, -r.offset_minutes);
    if (at !== r.remind_at) await patch('reminders', r.id, { remind_at: at, status: 'pending' });
  }
}
export const dueReminders = () => S.data.reminders.filter(r => r.status === 'pending' && r.remind_at <= nowStamp() && targetInfo(r.target_type, r.target_id));

// Record "opened" for resume lists.
export async function touch(type, id, extra = {}) {
  const a = activityOf(type, id);
  const data = { last_opened_at: new Date().toISOString(), ...extra };
  const row = a ? await patch('activity', a.id, data) : await create('activity', { entity_type: type, entity_id: Number(id), ...data });
  const list = S.data.activity;
  const i = list.findIndex(x => x.id === row.id);
  if (i >= 0) list[i] = row; else list.push(row);
  return row;
}

// ---- autosave: debounced PATCH with conflict detection and a local safety copy while unsaved ----
// base: the row object (shared by all autosaved fields of that row, so their updated_at stays in sync).
const savers = new Set();
export const flushAll = () => Promise.all([...savers].map(s => s.flush()));
export function autosave({ table, id, field, base, onSaved, delay = 700 }) {
  let timer = null, pendingValue = null, inflight = false, errored = false;
  const ref = base;
  const key = `draft:${table}:${id}:${field}`;
  const flush = async () => {
    clearTimeout(timer);
    if (pendingValue === null || inflight) return;
    const value = pendingValue;
    pendingValue = null;
    inflight = true;
    saveStatus(1);
    try {
      const row = await patch(table, id, { [field]: value, _base: ref.updated_at });
      ref.updated_at = row.updated_at;
      if (pendingValue === null) localStorage.removeItem(key);
      if (errored) { errored = false; saveStatus(0, false); }
      onSaved?.(row);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) await conflict(value, e.body.current);
      else {
        if (pendingValue === null) pendingValue = value;
        if (!errored) { errored = true; saveStatus(0, true); }
        timer = setTimeout(flush, 5000);
      }
    } finally { inflight = false; saveStatus(-1); }
    if (pendingValue !== null && !errored) flush();
  };
  async function conflict(mine, server) {
    const choice = await dialog('הטקסט השתנה בחלון אחר', html`<p>הטקסט נשמר בינתיים ממקום אחר (למשל לשונית נוספת). כדי לא לדרוס עבודה, בחרו מה לעשות:</p>
      <label class="radio"><input type="radio" name="c" value="mine" checked> לשמור את הגרסה שלי (הגרסה האחרת תישמר בהיסטוריית הגרסאות)</label>
      <label class="radio"><input type="radio" name="c" value="theirs"> לטעון את הגרסה האחרת (הטקסט שלי יועתק ללוח)</label>`, { submit: 'המשך' });
    if (choice?.c === 'theirs') { await navigator.clipboard?.writeText(mine).catch(() => {}); toast('הטקסט שלך הועתק ללוח'); location.reload(); return; }
    ref.updated_at = server.updated_at;
    pendingValue = mine;
  }
  const api_ = {
    set(value) { pendingValue = value; localStorage.setItem(key, value); clearTimeout(timer); timer = setTimeout(flush, delay); },
    flush() { clearTimeout(timer); return flush(); },
    draft: () => localStorage.getItem(key),
    clearDraft: () => localStorage.removeItem(key),
  };
  savers.add(api_);
  return api_;
}
// Savers of the previous page are flushed and dropped on navigation.
export async function resetSavers() { await flushAll(); savers.clear(); }

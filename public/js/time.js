// All user-facing scheduling uses Asia/Jerusalem wall-clock strings: date 'YYYY-MM-DD', time 'HH:MM', stamp 'YYYY-MM-DDTHH:MM'.
export const TZ = 'Asia/Jerusalem';
const partsFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function epochToStamp(ms) {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
const asUtc = stamp => { const [d, t = '00:00'] = stamp.split('T'); const [y, m, dd] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number); return Date.UTC(y, m - 1, dd, h, mi); };
// Jerusalem wall clock -> epoch ms (handles DST by re-checking the offset at the result).
export function stampToEpoch(stamp) {
  const guess = asUtc(stamp);
  let ms = guess - (asUtc(epochToStamp(guess)) - guess);
  const off2 = asUtc(epochToStamp(ms)) - ms;
  return guess - off2;
}
export const nowStamp = (ms = Date.now()) => epochToStamp(ms);
export const today = (ms = Date.now()) => nowStamp(ms).slice(0, 10);
export const addMinutes = (stamp, min) => epochToStamp(stampToEpoch(stamp) + min * 60000);
export const addDays = (date, n) => { const d = new Date(asUtc(date) + n * 86400000); return d.toISOString().slice(0, 10); };
// Deadline moment: a date without time counts until the end of that day.
export const dueStamp = (date, time) => date ? `${date}T${time || '23:59'}` : null;
export const daysBetween = (a, b) => Math.round((asUtc(b) - asUtc(a)) / 86400000);
export const isOverdue = (date, time, now = nowStamp()) => !!date && dueStamp(date, time) < now;

const dateFmt = new Intl.DateTimeFormat('he-IL', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
const dateFmtY = new Intl.DateTimeFormat('he-IL', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
export function fmtDate(date, withYear = false) {
  if (!date) return '';
  return (withYear ? dateFmtY : dateFmt).format(new Date(asUtc(date) + 12 * 3600000));
}
export const fmtDateTime = (date, time) => date ? fmtDate(date) + (time ? ` · ${time}` : '') : '';
export const fmtStamp = stamp => stamp ? fmtDateTime(stamp.slice(0, 10), stamp.slice(11, 16)) : '';
export function relDay(date, now = today()) {
  if (!date) return '';
  const d = daysBetween(now, date);
  if (d === 0) return 'היום';
  if (d === 1) return 'מחר';
  if (d === -1) return 'אתמול';
  return d > 0 ? `בעוד ${d} ימים` : `לפני ${-d} ימים`;
}
// ISO (UTC, internal timestamps) -> readable Jerusalem time
export const fmtIso = iso => iso ? fmtStamp(epochToStamp(Date.parse(iso))) : '';

import test from 'node:test';
import assert from 'node:assert/strict';
import { epochToStamp, stampToEpoch, addMinutes, dueStamp, isOverdue, daysBetween, relDay, addDays } from '../public/js/time.js';

test('Jerusalem conversions round-trip across DST', () => {
  // Winter (UTC+2) and summer (UTC+3)
  assert.equal(epochToStamp(Date.UTC(2026, 0, 15, 10, 0)), '2026-01-15T12:00');
  assert.equal(epochToStamp(Date.UTC(2026, 6, 15, 10, 0)), '2026-07-15T13:00');
  assert.equal(stampToEpoch('2026-01-15T12:00'), Date.UTC(2026, 0, 15, 10, 0));
  assert.equal(stampToEpoch('2026-07-15T13:00'), Date.UTC(2026, 6, 15, 10, 0));
  // Reminder one day before a deadline just after the autumn DST change keeps wall-clock time
  assert.equal(addMinutes('2026-10-26T09:00', -24 * 60), '2026-10-25T09:00');
});

test('deadlines without time count until end of day', () => {
  assert.equal(dueStamp('2026-12-01', null), '2026-12-01T23:59');
  assert.equal(dueStamp(null, '10:00'), null);
  assert.equal(isOverdue('2026-12-01', null, '2026-12-01T22:00'), false);
  assert.equal(isOverdue('2026-12-01', '10:00', '2026-12-01T10:01'), true);
  assert.equal(isOverdue(null, null, '2030-01-01T00:00'), false, 'tasks without a date are never overdue');
});

test('day arithmetic', () => {
  assert.equal(daysBetween('2026-11-24', '2026-12-01'), 7);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(relDay('2026-11-25', '2026-11-24'), 'מחר');
  assert.equal(relDay('2026-11-20', '2026-11-24'), 'לפני 4 ימים');
});

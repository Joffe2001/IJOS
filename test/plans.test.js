import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANS, matchPlan } from '../public/js/plans.js';

test('plans: well-formed, and the Ono plan is the first semester only, with its 25 credits', () => {
  assert.equal(new Set(PLANS.map(p => p.id)).size, PLANS.length);
  for (const p of PLANS) {
    assert.ok(p.name && p.school && p.source);
    for (const s of p.years.flatMap(y => y.semesters)) {
      assert.equal(new Set(s.courses.map(c => c[0])).size, s.courses.length, `duplicate course in ${s.name}`);
      for (const [name, credits] of s.courses) assert.ok(name.trim() && (credits === null || credits > 0), name);
    }
  }
  const sum = s => s.courses.reduce((n, c) => n + (c[1] ?? 0), 0);
  assert.deepEqual(PLANS.find(p => p.id === 'ono-ba-mis').years.flatMap(y => y.semesters).map(sum), [25]);
});

test('plans: matching finds existing years, semesters and courses by name and never flags the rest', () => {
  const plan = PLANS[0];
  const fresh = matchPlan(plan, { years: [], semesters: [], courses: [] });
  assert.ok(fresh.every(g => !g.year && !g.sem && !g.busy && g.courses.every(c => !c.exists)));
  assert.equal(new Set(fresh.flatMap(g => g.courses.map(c => c.id))).size, fresh.flatMap(g => g.courses).length, 'course ids are unique');

  // The student typed the year with a plain apostrophe, has one course from the plan and one of their own.
  const years = [{ id: 7, name: "שנה א'" }];
  const [a] = matchPlan(plan, {
    years, semesters: [{ id: 3, year_id: 7, name: 'סמסטר א׳' }],
    courses: [{ id: 1, semester_id: 3, name: 'משפט  עסקי' }, { id: 2, semester_id: 3, name: 'קורס משלי' }],
  });
  assert.equal(a.year.id, 7);
  assert.equal(a.sem.id, 3);
  assert.equal(a.busy, true);
  assert.deepEqual(a.courses.filter(c => c.exists).map(c => c.name), ['משפט עסקי']);

  // A same-named semester under another year is not a match, and its courses do not count.
  const [b] = matchPlan(plan, { years, semesters: [{ id: 4, year_id: 99, name: 'סמסטר א׳' }], courses: [{ id: 5, semester_id: 4, name: 'משפט עסקי' }] });
  assert.equal(b.year.id, 7);
  assert.equal(b.sem, undefined);
  assert.ok(!b.busy && b.courses.every(c => !c.exists));
});

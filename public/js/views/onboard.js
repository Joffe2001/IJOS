// First-run onboarding: program → year + semester → courses → materials (or skip). Everything stays editable later.
import { html, raw, str, api, toast } from '../util.js';
import { S, T, create, reload, activeSemester } from '../store.js';
import { bind, pickFiles } from '../ui.js';
import { LOGO } from '../app.js';
import { PLANS, matchPlan } from '../plans.js';

export const PALETTE = ['#4f3df0', '#e2562f', '#1d9a6c', '#d6409f', '#2f7de2', '#c98a00', '#7a4fd6', '#0f8f9e'];
const done = () => api('PUT', '/api/settings/onboarded', { value: '1' });
const logoHead = () => html`<div class="onboard-logo">${raw(LOGO)}<div><p class="eyebrow" dir="ltr">IJOS · Ido Joffe's OS</p><p class="muted small" style="margin:0">הכול נשמר רק במחשב שלך. בלי חשבון ובלי ענן.</p></div></div>`;

export function welcome(root, _, query) {
  const step = Number(query.get('step')) || 1;
  const sem = T('semesters').find(s => s.id === Number(query.get('sem')));
  const stepper = html`<ol class="steps" aria-label="שלב ${step} מתוך 3">${[1, 2, 3].map(i => html`<li class="${i <= step ? 'on' : ''}"></li>`)}</ol>`;
  const head = logoHead();

  if (step === 1) {
    root.innerHTML = str(html`<div class="onboard">${head}<h1>כל התואר. מקום אחד.</h1>
      <p class="hero-date">חומרים, פתקים, מטלות ומבחנים, מסודרים לפי סמסטר וקורס. בואו נגדיר את ההתחלה. זה לוקח דקה.</p>${stepper}
      <form class="card" data-submit="create">
        <div class="form-grid one"><label>מה אתם לומדים? (לא חובה)<input name="program" dir="auto" value="${S.data.settings.program || ''}" placeholder="למשל: מדעי המחשב, תואר ראשון"></label></div>
        <div class="form-grid"><label>שנה<input name="year" dir="auto" required value="שנה א׳"></label><label>סמסטר<input name="semester" dir="auto" required value="סמסטר א׳"></label></div>
        <div class="actions"><button class="btn btn-primary">המשך לקורסים</button></div>
      </form>
      <div class="choice">
        <button type="button" data-act="plan"><strong>תוכנית לימודים מוכנה</strong><span class="small muted">הסמסטרים, הקורסים ונקודות הזכות נוצרים בשבילכם. כרגע: ${PLANS.map(p => html`<bdi>${p.name}, ${p.school}</bdi>`)}.</span></button>
        <button type="button" data-act="sample"><strong>רק להציץ קודם</strong><span class="small muted">טעינת סמסטר דוגמה עם שני קורסים מומצאים. מסומן "דוגמה", ונמחק בלחיצה אחת בהגדרות.</span></button>
        <button type="button" data-act="skip"><strong>לדלג ולהתחיל ריק</strong><span class="small muted">אפשר להוסיף סמסטר וקורסים מאוחר יותר מעמוד הבית.</span></button>
      </div></div>`);
    bind(root, {
      create: async (f, d) => {
        if (d.program.trim()) await api('PUT', '/api/settings/program', { value: d.program.trim() });
        const y = await create('years', { name: d.year.trim(), sort: T('years').length + 1 });
        const s = await create('semesters', { year_id: y.id, name: d.semester.trim(), status: 'active', sort: T('semesters').length + 1 });
        location.hash = `#/welcome?step=2&sem=${s.id}`;
      },
      plan: () => { location.hash = '#/plan'; },
      sample: async () => { await api('POST', '/api/sample'); await done(); await reload(); toast('נטען סמסטר דוגמה. כל מה שמסומן "דוגמה" מומצא.'); location.hash = '#/'; },
      skip: async () => { await done(); await reload(); location.hash = '#/'; },
    });
    return;
  }

  if (step === 2) {
    if (!sem) { location.replace('#/welcome'); return; }
    const row = i => html`<div class="row"><label>שם הקורס<input name="name" dir="auto" placeholder="${i === 0 ? 'למשל: מבוא לסטטיסטיקה' : ''}" ${i === 0 ? raw('required autofocus') : ''}></label>
      <label>נק״ז<input name="credits" type="number" step="0.5" min="0" inputmode="decimal"></label><label>צבע<input name="color" type="color" value="${PALETTE[i % PALETTE.length]}"></label><span></span></div>`;
    root.innerHTML = str(html`<div class="onboard">${head}<h1>אילו קורסים יש לכם?</h1>
      <p class="hero-date"><bdi>${sem.name}</bdi>. כתבו את הקורסים שאתם יודעים עליהם עכשיו. נקודות זכות לא חובה, ואפשר לשנות הכול אחר כך.</p>${stepper}
      <form class="card" data-submit="courses"><div class="course-rows" id="rows">${[0, 1, 2].map(row)}</div>
        <button type="button" class="btn btn-sm" data-act="more">+ עוד קורס</button>
        <div class="actions" style="margin-top:1rem"><button class="btn btn-primary">שמירה והמשך</button><a class="btn" href="#/welcome?step=3&sem=${sem.id}">אוסיף קורסים אחר כך</a></div></form></div>`);
    let n = 3;
    bind(root, {
      more: () => { root.querySelector('#rows').insertAdjacentHTML('beforeend', str(row(n++))); root.querySelector('#rows .row:last-child input').focus(); },
      courses: async f => {
        const rows = [...f.querySelectorAll('.row')].map(r => ({ name: r.querySelector('[name=name]').value.trim(), credits: r.querySelector('[name=credits]').value, color: r.querySelector('[name=color]').value })).filter(r => r.name);
        for (const [i, r] of rows.entries()) await create('courses', { semester_id: sem.id, name: r.name, credits: r.credits === '' ? null : Number(r.credits), color: r.color, sort: i + 1 });
        location.hash = `#/welcome?step=3&sem=${sem.id}`;
      },
    });
    return;
  }

  // step 3: materials
  root.innerHTML = str(html`<div class="onboard">${head}<h1>יש כבר חומרים?</h1>
    <p class="hero-date">מצגות, סיכומים, קבצי Word ו־Excel, PDF וקבצי HTML. הקבצים המקוריים לא זזים ולא משתנים: IJOS שומר עותק משלו.</p>${stepper}
    <div class="choice">
      <button type="button" data-act="files"><strong>ייבוא קבצים</strong><span class="small muted">בוחרים קבצים, ואז משייכים אותם לקורס. אפשר גם לגרור קבצים לכל מקום בחלון.</span></button>
      <button type="button" data-act="finish"><strong>מתחילים ריק</strong><span class="small muted">אפשר לייבא בכל רגע מכל קורס, או דרך "+ הוספה מהירה".</span></button>
    </div></div>`);
  bind(root, {
    files: async () => { await done(); await reload(); location.hash = '#/'; pickFiles({}); },
    finish: async () => { await done(); await reload(); toast('מוכנים. בהצלחה בסמסטר!'); location.hash = '#/'; },
  });
}

// Ready-made degree plan: tick the courses to add. It only adds. Existing years, semesters and courses are matched by name and left alone.
export function plan(root) {
  const p = PLANS[0]; // ponytail: one plan today. Add a chooser here when a second plan lands in plans.js.
  const match = () => matchPlan(p, { years: T('years'), semesters: T('semesters'), courses: T('courses') });
  const fresh = !T('semesters').length;
  root.innerHTML = str(html`<div class="onboard">${fresh ? logoHead() : ''}<h1>תוכנית לימודים מוכנה</h1>
    <p class="hero-date"><bdi>${p.name}</bdi> · <bdi>${p.school}</bdi>. סמנו מה להוסיף. שום דבר קיים לא משתנה, ואפשר לערוך ולמחוק הכול אחר כך.</p>
    <form class="card" data-submit="apply">
      ${match().map(g => html`<fieldset><legend><bdi>${g.yearName}</bdi> · <bdi>${g.name}</bdi></legend>
        ${g.busy ? html`<p class="hint">בסמסטר הזה כבר יש לכם קורסים, אז שום דבר לא מסומן מראש. סמנו רק מה שחסר.</p>` : ''}
        ${g.courses.map(c => html`<label class="check"><input type="checkbox" name="c" value="${c.id}" ${raw(c.exists ? 'disabled' : g.busy ? '' : 'checked')}> <bdi>${c.name}</bdi>
          <span class="muted small">${c.exists ? 'כבר קיים' : c.credits == null ? 'לא נספר בנק״ז' : `${c.credits} נק״ז`}</span></label>`)}</fieldset>`)}
      <p class="hint">${p.source}</p>
      <p class="hint">סמסטר חדש מסומן כפעיל אם עוד אין לכם סמסטר פעיל, ואחרת כ"עתידי". אפשר לשנות בעמוד הסמסטר.</p>
      <div class="actions"><button class="btn btn-primary">הוספת הקורסים המסומנים</button><a class="btn" href="${fresh ? '#/welcome' : '#/'}">ביטול</a></div>
    </form></div>`);
  bind(root, {
    apply: async f => {
      const picked = new Set([...f.querySelectorAll('[name=c]:checked')].map(i => i.value));
      const btn = f.querySelector('button');
      btn.disabled = true; // a second click must not add everything twice
      let first, n = 0;
      try {
        for (let i = 0; i < match().length; i++) {
          const g = match()[i]; // matched again each round: the year created for one semester is reused by the next
          const add = g.courses.filter(c => picked.has(c.id) && !c.exists);
          if (!add.length) continue;
          const year = g.year || await create('years', { name: g.yearName, sort: T('years').length + 1 });
          const sem = g.sem || await create('semesters', { year_id: year.id, name: g.name, status: activeSemester() ? 'planned' : 'active', sort: T('semesters').length + 1 });
          const base = T('courses').filter(c => c.semester_id === sem.id).length;
          for (const [k, c] of add.entries()) await create('courses', { semester_id: sem.id, name: c.name, credits: c.credits, counts_credits: c.credits != null, color: PALETTE[(base + k) % PALETTE.length], sort: base + k + 1 });
          first ??= sem; n += add.length;
        }
      } finally { btn.disabled = false; }
      if (!n) { toast('לא סומן אף קורס חדש'); return; }
      if (!S.data.settings.program) await api('PUT', '/api/settings/program', { value: p.name });
      await done(); await reload();
      toast(`נוספו ${n} קורסים. שמות, צבעים ונקודות זכות אפשר לשנות בכל רגע.`);
      location.hash = `#/semester/${first.id}`;
    },
  });
}

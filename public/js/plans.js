// Ready-made degree plans: years → semesters → courses as [name, credits]. credits null = not counted towards the degree.
// Applying a plan only adds what the student ticks; it never changes or removes existing records.
// To add your degree: copy an entry, keep the shape, and say in `source` which published document it follows.
export const PLANS = [{
  id: 'ono-ba-mis',
  name: 'מנהל עסקים, התמחות במערכות מידע (B.A)',
  school: 'הקריה האקדמית אונו',
  source: 'לפי מאזן הלימודים שפורסם לשנת תשפ״ז. התוכנית כפופה לשינויים, אז כדאי להשוות למערכת השעות שלכם.',
  years: [{
    name: 'שנה א׳',
    // Course names and credits exactly as printed in the published document. Only the first semester is included.
    semesters: [{
      name: 'סמסטר א׳',
      courses: [['מתמטיקה למנע״ס + תרגול', 5.5], ['אוריינות אקדמית', 3], ['מבוא לתכנות עם JS + תרגול', 5], ['מבוא למערכות מידע', 3],
        ['יישומי אקסל למנהלים ולניתוח נתונים + תרגול', 3.5], ['משפט עסקי', 3], ['מחוייבות קהילתית', 2], ['אנגלית טרום בסיסי א׳+ב׳', null]],
    }],
  }],
}];

// Names match on letters and digits only, so "שנה א'" and "שנה א׳" are the same year.
const key = s => String(s).normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();

// One entry per plan semester: where it lands in the student's data (if it exists already) and which of its courses are already there.
export function matchPlan(plan, { years, semesters, courses }) {
  return plan.years.flatMap((y, yi) => {
    const year = years.find(r => key(r.name) === key(y.name));
    return y.semesters.map((s, si) => {
      const sem = year && semesters.find(r => r.year_id === year.id && key(r.name) === key(s.name));
      const have = sem ? courses.filter(c => c.semester_id === sem.id) : [];
      return { yearName: y.name, name: s.name, year, sem, busy: have.length > 0,
        courses: s.courses.map(([name, credits], ci) => ({ id: `${yi}.${si}.${ci}`, name, credits, exists: have.some(c => key(c.name) === key(name)) })) };
    });
  });
}

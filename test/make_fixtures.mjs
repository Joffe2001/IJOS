// Writes small ORIGINAL synthetic study files (no real course material) for the UI walkthrough and screenshots.
// Usage: node test/make_fixtures.mjs <out-dir>
import fs from 'node:fs';
import path from 'node:path';
import { writeZip } from '../server/zip.js';

const out = process.argv[2];
if (!out) { console.error('usage: node test/make_fixtures.mjs <out-dir>'); process.exit(1); }
fs.mkdirSync(out, { recursive: true });
const w = (name, data) => fs.writeFileSync(path.join(out, name), data);
const zip = (name, entries) => writeZip(path.join(out, name), entries.map(([n, d]) => ({ name: n, data: Buffer.from(d) })));

w('סיכום יסודות התכנות.html', `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>סיכום יסודות התכנות</title>
<style>body{font-family:system-ui;max-width:760px;margin:2rem auto;line-height:1.7;padding:0 1rem}h1{color:#4f3df0}code{background:#eee;padding:0 .3em}</style></head>
<body><h1>סיכום יסודות התכנות</h1><p>משתנה שומר ערך. לולאת <code>for</code> חוזרת על קוד מספר פעמים.</p>
<ul><li>let — משתנה שאפשר לשנות</li><li>const — ערך קבוע</li></ul><p id="t">טוען…</p>
<script>document.getElementById('t').textContent = 'הסקריפט של הסיכום רץ בתוך ארגז חול.';</script></body></html>`);

// Minimal valid 2-page PDF (text not extracted by IJOS: demonstrates the disclosed limitation).
const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 7 0 R >> >> >>', null,
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>', null,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
const stream = t => { const s = `BT /F1 18 Tf 30 120 Td (${t}) Tj ET`; return `<< /Length ${s.length} >>\nstream\n${s}\nendstream`; };
objs[3] = stream('Practice set 2 - page 1'); objs[5] = stream('Question 3 - page 2');
let pdf = '%PDF-1.4\n'; const offs = [];
objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
const xref = pdf.length;
pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
w('מטלה תרגול 2.pdf', pdf);

w('exercise1.js', `// תרגיל 1: סכום מספרים זוגיים\nfunction sumEven(nums) {\n  let total = 0;\n  for (const n of nums) if (n % 2 === 0) total += n;\n  return total;\n}\nconsole.log(sumEven([1, 2, 3, 4])); // 6\n`);

const slide = lines => `<p:sld><p:cSld><p:spTree>${lines.map(l => `<p:sp><p:txBody><a:p><a:r><a:t>${l}</a:t></a:r></a:p></p:txBody></p:sp>`).join('')}</p:spTree></p:cSld></p:sld>`;
zip('מודל חמשת הכוחות - מצגת.pptx', [
  ['ppt/slides/slide1.xml', slide(['מודל חמשת הכוחות של פורטר', 'ניתוח תחרותיות בענף'])],
  ['ppt/slides/slide2.xml', slide(['איום מתחרים חדשים', 'כוח המיקוח של ספקים', 'כוח המיקוח של לקוחות'])],
  ['ppt/slides/slide3.xml', slide(['איום מוצרים תחליפיים', 'עוצמת התחרות בענף'])],
]);
w('information_systems_summary.html', `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>מערכות מידע: סיכום</title><link rel="stylesheet" href="https://fonts.example.com/x.css"></head>
<body><h1>מערכות מידע בארגון</h1><p>מערכת מידע = אנשים, תהליכים, נתונים וטכנולוגיה.</p></body></html>`);
w('סיכום אחוזים.html', `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>אחוזים</title></head><body><h1>אחוזים</h1><p>שינוי באחוזים = (חדש − ישן) ÷ ישן × 100</p></body></html>`);
zip('תרגול שיעור 2.xlsx', [
  ['xl/workbook.xml', '<workbook><sheets><sheet name="מכירות" sheetId="1"/></sheets></workbook>'],
  ['xl/sharedStrings.xml', '<sst><si><t>חודש</t></si><si><t>הכנסות</t></si><si><t>ינואר</t></si><si><t>פברואר</t></si></sst>'],
  ['xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1200</v></c></row><row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>1350</v></c></row><row r="4"><c r="B4"><f>SUM(B2:B3)</f><v>2550</v></c></row></sheetData></worksheet>'],
]);
zip('מבוא.docx', [['word/document.xml', '<w:document><w:body><w:p><w:r><w:t>מבוא: מה זה מערכת מידע?</w:t></w:r></w:p><w:p><w:r><w:t>דוגמה: מערכת הזמנות במסעדה קטנה.</w:t></w:r></w:p></w:body></w:document>']]);
console.log('fixtures written to', out);

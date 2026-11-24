import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { writeZip, readZip } from '../server/zip.js';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../server/db.js';
import http from 'node:http';
import { spawn } from 'node:child_process';

const H = { 'x-ijos': '1' };
async function start(dataDir) {
  const { server } = createApp({ dataDir, port: 0 });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body, headers = {}) => {
    const raw = body instanceof Buffer;
    const res = await fetch(base + url, { method, headers: { ...H, ...(raw ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body == null ? undefined : raw ? body : JSON.stringify(body) });
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };
  return { server, base, call, stop: () => new Promise(r => server.close(r)) };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ijos-test-'));
const docx = () => { // minimal valid DOCX for extraction
  const f = path.join(tmp(), 'x.docx');
  writeZip(f, [{ name: 'word/document.xml', data: Buffer.from('<w:document><w:body><w:p><w:r><w:t>מודל פורטר וחמשת הכוחות</w:t></w:r></w:p></w:body></w:document>') }]);
  return fs.readFileSync(f);
};

test('clean first launch: no personal data, no courses, onboarding pending', async () => {
  const app = await start(tmp());
  const s = (await app.call('GET', '/api/state')).body;
  for (const t of ['years', 'semesters', 'courses', 'resources', 'assignments', 'exams', 'projects', 'applications']) assert.equal(s[t].length, 0, `${t} empty`);
  assert.equal(s.settings.onboarded, undefined);
  assert.equal(s.meta.schema, 3);
  assert.equal((await app.call('GET', '/api/health')).body.app, 'ijos');
  await app.stop();
});

test('upload, dedupe, versions, persistence across restart, trash GC', async () => {
  const dir = tmp();
  let app = await start(dir);
  const up = await app.call('POST', '/api/upload?name=' + encodeURIComponent('מבוא לקורס.docx') + '&source=lecturer', docx());
  assert.equal(up.body.resource.original_name, 'מבוא לקורס.docx', 'Hebrew name with spaces kept');
  assert.equal(up.body.resource.text_status, 'extracted');
  const dup = await app.call('POST', '/api/upload?name=copy.docx', docx());
  assert.equal(dup.body.duplicates.length, 1, 'identical file is reported');
  assert.equal(fs.readdirSync(path.join(dir, 'blobs')).flatMap(d => fs.readdirSync(path.join(dir, 'blobs', d))).length, 1, 'stored once');
  const search = await app.call('GET', '/api/search?q=' + encodeURIComponent('פורטר'));
  assert.ok(search.body.some(r => r.matched.includes('text_content')));
  const note = (await app.call('POST', '/api/rows/resources', { title: 'פתק', kind: 'note', body: 'גרסה 1' })).body;
  await app.call('PATCH', `/api/rows/resources/${note.id}`, { body: 'גרסה 2' });
  const versions = (await app.call('GET', `/api/versions/${note.id}`)).body;
  assert.equal(versions[0].body, 'גרסה 1', 'previous note text kept');
  await app.stop();

  app = await start(dir); // restart
  const s = (await app.call('GET', '/api/state')).body;
  assert.equal(s.resources.length, 3);
  const full = (await app.call('GET', `/api/rows/resources/${note.id}`)).body;
  assert.equal(full.body, 'גרסה 2');
  const file = await app.call('GET', `/files/${up.body.resource.id}?download=1`);
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-disposition'), /attachment/);
  // soft delete keeps file; empty trash removes only unreferenced blobs
  await app.call('DELETE', `/api/rows/resources/${up.body.resource.id}`);
  await app.call('POST', '/api/trash/empty');
  assert.equal((await app.call('GET', `/files/${dup.body.resource.id}`)).status, 200, 'blob still used by the duplicate');
  await app.call('DELETE', `/api/rows/resources/${dup.body.resource.id}`);
  await app.call('POST', '/api/trash/empty');
  assert.equal(fs.readdirSync(path.join(dir, 'blobs')).flatMap(d => fs.readdirSync(path.join(dir, 'blobs', d))).length, 0);
  await app.stop();
});

test('autosave conflict: stale base is rejected, never silently overwritten', async () => {
  const app = await start(tmp());
  const n = (await app.call('POST', '/api/rows/resources', { title: 'n', kind: 'note', body: 'a' })).body;
  const ok = await app.call('PATCH', `/api/rows/resources/${n.id}`, { body: 'b', _base: n.updated_at });
  assert.equal(ok.status, 200);
  const stale = await app.call('PATCH', `/api/rows/resources/${n.id}`, { body: 'c', _base: n.updated_at });
  assert.equal(stale.status, 409);
  assert.equal((await app.call('GET', `/api/rows/resources/${n.id}`)).body.body, 'b');
  await app.stop();
});

test('request guards and HTML isolation headers', async () => {
  const app = await start(tmp());
  assert.equal((await app.call('POST', '/api/rows/tasks', { title: 'x' }, { 'x-ijos': '' })).status, 403, 'missing custom header');
  assert.equal((await app.call('POST', '/api/rows/tasks', { title: 'x' }, { Origin: 'http://evil.example' })).status, 403, 'foreign origin');
  const html = Buffer.from('<html><body><script>fetch("/api/state")</script><link href="https://cdn.example/x.css" rel="stylesheet"></body></html>');
  const r = (await app.call('POST', '/api/upload?name=s.html&source=chatgpt', html)).body.resource;
  const res = await app.call('GET', `/files/${r.id}`);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /sandbox allow-scripts/);
  assert.doesNotMatch(csp, /allow-same-origin/);
  assert.match(csp, /connect-src 'none'/);
  const prev = (await app.call('GET', `/api/preview/${r.id}`)).body;
  assert.deepEqual(prev.deps, ['cdn.example']);
  assert.equal((await app.call('GET', '/api/rows/blobs/1')).status, 404, 'internal tables not exposed');
  await app.stop();
});

test('backup → change → restore with validation and safety snapshot', async () => {
  const dir = tmp();
  const app = await start(dir);
  await app.call('POST', '/api/upload?name=a.docx&course_id=1', docx());
  await app.call('POST', '/api/rows/assignments', { title: 'מטלה 1', course_id: 1 });
  const b = (await app.call('POST', '/api/backup')).body;
  assert.equal(b.manifest.files, 1);
  const zip = (await app.call('GET', `/api/download/backup/${encodeURIComponent(b.name)}`)).body;
  await app.call('POST', '/api/rows/assignments', { title: 'מטלה 2 (אחרי הגיבוי)', course_id: 1 });
  // invalid file is rejected without changes
  const bad = await app.call('POST', '/api/restore/inspect', Buffer.from('not a zip'));
  assert.equal(bad.status, 400);
  const insp = (await app.call('POST', '/api/restore/inspect', zip)).body;
  assert.equal(insp.backup.assignments, 1);
  assert.equal(insp.current.assignments, 2);
  assert.deepEqual(insp.missingFiles, []);
  const done = (await app.call('POST', '/api/restore/apply', { token: insp.token })).body;
  assert.ok(fs.existsSync(path.join(dir, 'backups', done.safetyBackup)), 'pre-restore snapshot exists');
  const s = (await app.call('GET', '/api/state')).body;
  assert.deepEqual(s.assignments.map(a => a.title), ['מטלה 1']);
  // restoring into an empty data folder brings the files back
  const app2 = await start(tmp());
  const i2 = (await app2.call('POST', '/api/restore/inspect', zip)).body;
  await app2.call('POST', '/api/restore/apply', { token: i2.token });
  const r = (await app2.call('GET', '/api/state')).body.resources[0];
  assert.equal((await app2.call('GET', `/files/${r.id}`)).status, 200);
  assert.equal((await app2.call('GET', '/api/integrity')).body.missing.length, 0);
  await app.stop(); await app2.stop();
});

// ---------- upgrade path ----------
// Builds a schema-1 database the way the pre-IJOS app left it (no projects table, fixed `target` per application).
function makeV1(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'study.db');
  const db = openDb(file);
  db.exec(`DROP TABLE projects; DROP TABLE application_projects; DROP TABLE summary_folders; ALTER TABLE summary_chapters DROP COLUMN folder_id;
    ALTER TABLE years DROP COLUMN sample; ALTER TABLE semesters DROP COLUMN sample; ALTER TABLE courses DROP COLUMN sample; ALTER TABLE courses DROP COLUMN color; ALTER TABLE courses DROP COLUMN icon;
    DELETE FROM settings; PRAGMA user_version=1;`);
  const t = new Date().toISOString();
  db.prepare('INSERT INTO years (id, name, created_at, updated_at) VALUES (1, ?, ?, ?)').run('שנה א', t, t);
  db.prepare("INSERT INTO semesters (id, year_id, name, status, created_at, updated_at) VALUES (1, 1, ?, 'active', ?, ?)").run('סמסטר א', t, t);
  for (let i = 1; i <= 6; i++) db.prepare('INSERT INTO courses (id, semester_id, name, credits, created_at, updated_at) VALUES (?, 1, ?, 3, ?, ?)').run(i, `קורס ${i}`, t, t);
  const app = db.prepare('INSERT INTO applications (title, target, target_other, created_at, updated_at) VALUES (?,?,?,?,?)');
  app.run('a', 'both', '', t, t); app.run('b', 'tori', '', t, t); app.run('c', 'other', 'Side gig', t, t);
  db.prepare('INSERT INTO resources (title, kind, body, created_at, updated_at) VALUES (?,?,?,?,?)').run('פתק ישן', 'note', 'תוכן שחייב לשרוד', t, t);
  db.prepare('INSERT INTO summary_chapters (course_id, title, body_md, created_at, updated_at) VALUES (1,?,?,?,?)').run('סיכום ישן', 'פרק שחייב לשרוד', t, t);
  db.close();
  return file;
}

test('existing-user upgrade: schema 1 to 3 keeps every record, turns fixed targets into projects, old summary chapters become summaries', async () => {
  const dir = tmp();
  makeV1(dir);
  const app = await start(dir);
  const s = (await app.call('GET', '/api/state')).body;
  assert.equal(s.meta.schema, 3);
  assert.equal(s.courses.length, 6, 'courses preserved');
  assert.equal(s.resources[0].title, 'פתק ישן');
  assert.equal((await app.call('GET', `/api/rows/resources/${s.resources[0].id}`)).body.body, 'תוכן שחייב לשרוד');
  assert.deepEqual(s.projects.map(p => p.name).sort(), ['ReSeGo', 'Side gig', 'Tori']);
  const names = id => s.application_projects.filter(x => x.application_id === id).map(x => s.projects.find(p => p.id === x.project_id).name).sort();
  const byTitle = t => s.applications.find(a => a.title === t).id;
  assert.deepEqual(names(byTitle('a')), ['ReSeGo', 'Tori']);
  assert.deepEqual(names(byTitle('b')), ['Tori']);
  assert.deepEqual(names(byTitle('c')), ['Side gig']);
  assert.equal(s.settings.onboarded, '1', 'existing users skip onboarding');
  assert.ok(s.summary_chapters.some(x => x.title === 'סיכום ישן' && x.folder_id === null), 'old chapter is a top-level summary');
  assert.deepEqual(s.summary_folders, []);
  await app.stop();
  const again = await start(dir); // migration runs once
  assert.equal((await again.call('GET', '/api/state')).body.projects.length, 3);
  await again.stop();
});

test('a database from a newer app version is refused, not modified', () => {
  const dir = tmp(); const file = path.join(dir, 'study.db');
  const db = new DatabaseSync(file); db.exec('PRAGMA user_version=99'); db.close();
  assert.throws(() => createApp({ dataDir: dir, port: 0 }), /newer than this app/);
  const check = new DatabaseSync(file); assert.equal(check.prepare('PRAGMA user_version').get().user_version, 99); check.close();
});

// ---------- management ----------
test('projects: create, rename, archive, link ideas, brief names them; sample data loads and removes only itself', async () => {
  const app = await start(tmp());
  const mine = (await app.call('POST', '/api/rows/projects', { name: 'האפליקציה שלי' })).body;
  const idea = (await app.call('POST', '/api/rows/applications', { title: 'טבלת הזמנות', learned: 'מפתח זר' })).body;
  await app.call('POST', '/api/join/application_projects', { application_id: idea.id, project_id: mine.id });
  await app.call('PATCH', `/api/rows/projects/${mine.id}`, { name: 'Booker' });
  await app.call('PATCH', `/api/rows/projects/${mine.id}`, { archived: 1 });
  const brief = (await app.call('GET', `/api/download/brief/${idea.id}`)).body.toString('utf8');
  assert.match(brief, /Target project: Booker/);
  assert.match(brief, /proposal, not a decision/);
  assert.match(brief, /## What I learned\n\nמפתח זר/);

  assert.equal((await app.call('POST', '/api/sample')).status, 200);
  assert.equal((await app.call('POST', '/api/sample')).status, 409, 'not loaded twice');
  let s = (await app.call('GET', '/api/state')).body;
  assert.ok(s.courses.length === 2 && s.courses.every(c => c.sample === 1 && c.name.startsWith('דוגמה')), 'sample courses clearly labelled');
  assert.ok(s.assignments.length && s.exams.length && s.resources.length, 'sample has content');
  await app.call('DELETE', '/api/sample');
  s = (await app.call('GET', '/api/state')).body;
  assert.equal(s.projects.length, 1, 'own project survives');
  assert.equal(s.applications.length, 1, 'own idea survives');
  assert.equal(s.assignments.length + s.exams.length + s.resources.length + s.courses.length + s.semesters.length + s.topics.length + s.checklist.length, 0, 'sample content removed');
  await app.stop();
});

test('assignment states: ready is not submitted; dates stay exactly as entered (Jerusalem wall clock)', async () => {
  const app = await start(tmp());
  const a = (await app.call('POST', '/api/rows/assignments', { title: 'עבודה', status: 'ready', due_date: '2020-01-01' })).body;
  assert.equal(a.status, 'ready');
  assert.equal(a.submitted_at, null, 'ready has no submission date');
  const sub = (await app.call('PATCH', `/api/rows/assignments/${a.id}`, { status: 'submitted', submitted_at: '2020-01-01T23:30' })).body;
  assert.equal(sub.submitted_at, '2020-01-01T23:30');
  const r = (await app.call('POST', '/api/rows/reminders', { target_type: 'assignment', target_id: a.id, remind_at: '2020-01-01T09:00' })).body;
  const snoozed = (await app.call('PATCH', `/api/rows/reminders/${r.id}`, { remind_at: '2020-01-02T08:15', status: 'pending' })).body;
  assert.equal(snoozed.remind_at, '2020-01-02T08:15', 'stored exactly as chosen, no UTC shift');
  const exam = (await app.call('POST', '/api/rows/exams', { title: 'מבחן', date: null, location: 'אולם 1' })).body;
  assert.equal(exam.date, null, 'unknown date stays unknown');
  await app.stop();
});

// ---------- security ----------
const rawRequest = (port, opts) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, ...opts }, res => { res.resume(); resolve(res.statusCode); });
  req.on('error', reject); req.end(opts.body);
});

test('other websites cannot read or change data (Host, Origin, Sec-Fetch-Site, custom header)', async () => {
  const app = await start(tmp());
  const port = app.server.address().port;
  assert.equal(await rawRequest(port, { path: '/api/state', headers: { Host: 'evil.example:' + port } }), 403, 'DNS rebinding host');
  assert.equal(await rawRequest(port, { path: '/api/state', headers: { 'Sec-Fetch-Site': 'cross-site' } }), 403, 'cross-site read');
  assert.equal(await rawRequest(port, { path: '/files/1', headers: { 'Sec-Fetch-Site': 'same-site' } }), 403, 'same-site (other localhost port) file read');
  assert.equal(await rawRequest(port, { path: '/api/state', headers: { 'Sec-Fetch-Site': 'same-origin' } }), 200);
  assert.equal(await rawRequest(port, { path: '/api/state', headers: { 'Sec-Fetch-Site': 'none' } }), 200, 'typed URL');
  assert.equal(await rawRequest(port, { method: 'POST', path: '/api/backup', headers: { 'Content-Type': 'text/plain' } }), 403, 'simple form POST lacks the header');
  assert.equal(await rawRequest(port, { method: 'POST', path: '/api/backup', headers: { 'x-ijos': '1', Origin: 'http://localhost:3000' } }), 403, 'other local origin');
  assert.equal(await rawRequest(port, { path: '/..%2f..%2fserver%2fapp.js' }), 404, 'static path traversal');
  assert.equal(await rawRequest(port, { path: '/js/..%5c..%5c..%5cserver.js' }), 404, 'backslash traversal');
  await app.stop();
});

test('filenames cannot escape the data folder; size limit leaves nothing behind', async () => {
  const dir = tmp();
  const { server } = createApp({ dataDir: dir, port: 0, maxUploadMb: 1 });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const up = (name, body) => fetch(`${base}/api/upload?name=${encodeURIComponent(name)}`, { method: 'POST', headers: H, body });
  assert.equal((await (await up('..\\..\\..\\evil.txt', Buffer.from('x'))).json()).resource.original_name, 'evil.txt');
  assert.equal((await (await up('CON.txt', Buffer.from('y'))).json()).resource.original_name, '_CON.txt');
  assert.equal((await (await up('a<b>:"c|d?.md', Buffer.from('z'))).json()).resource.original_name, 'a_b___c_d_.md');
  const files = fs.readdirSync(dir, { recursive: true }).map(String);
  assert.ok(!files.some(f => /evil|CON|a_b/.test(f)), 'stored by hash, never by name');
  assert.ok(!fs.existsSync(path.join(dir, '..', 'evil.txt')));
  const big = await up('big.bin', Buffer.alloc(1.5 * 1048576));
  assert.equal(big.status, 413);
  assert.match((await big.json()).error, /גדול מדי/);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'tmp')).filter(f => f !== 'open'), [], 'no partial file kept');
  await new Promise(r => server.close(r));
});

test('Markdown, titles and previews never emit executable HTML', async () => {
  const { render } = await import('../public/js/md.js');
  const out = render('<img src=x onerror=alert(1)> [x](javascript:alert(1)) **<script>alert(1)</script>**').html;
  assert.doesNotMatch(out, /<img|<script|href="javascript:/i);
  const app = await start(tmp());
  const x = (await app.call('POST', '/api/upload?name=' + encodeURIComponent('<svg onload=alert(1)>.docx'), docx())).body.resource;
  const prev = (await app.call('GET', `/api/preview/${x.id}`)).body;
  assert.doesNotMatch(JSON.stringify(prev), /<svg|onload/i, 'Office preview is plain text');
  await app.stop();
});

// ---------- restore failures ----------
test('invalid, corrupted or tampered restores fail clearly and leave current data untouched', async () => {
  const app = await start(tmp());
  await app.call('POST', '/api/rows/assignments', { title: 'חייב לשרוד' });
  const zipOf = entries => { const f = path.join(tmp(), 'b.zip'); writeZip(f, entries); return fs.readFileSync(f); };
  const manifest = Buffer.from(JSON.stringify({ app: 'ijos', schema: 2 }));
  const cases = {
    'wrong app': zipOf([{ name: 'manifest.json', data: Buffer.from('{"app":"other"}') }, { name: 'study.db', data: Buffer.from('x') }]),
    'garbage database': zipOf([{ name: 'manifest.json', data: manifest }, { name: 'study.db', data: Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(2000, 7)]) }]),
    'truncated zip': zipOf([{ name: 'manifest.json', data: manifest }]).subarray(0, 40),
    'empty': Buffer.alloc(0),
  };
  for (const [name, body] of Object.entries(cases)) {
    const r = await app.call('POST', '/api/restore/inspect', body);
    assert.equal(r.status, 400, name);
    assert.ok(r.body.error, name + ' has a message');
  }
  assert.equal((await app.call('POST', '/api/restore/apply', { token: 'made-up' })).status, 400, 'unknown token');
  // tampered blob + hostile entry names in an otherwise valid backup
  await app.call('POST', '/api/upload?name=a.docx', docx());
  const b = (await app.call('POST', '/api/backup')).body;
  const good = (await app.call('GET', `/api/download/backup/${encodeURIComponent(b.name)}`)).body;
  const gf = path.join(tmp(), 'g.zip'); fs.writeFileSync(gf, good);
  const z = readZip(gf); const entries = z.names.map(n => ({ name: n, data: n.startsWith('blobs/') ? Buffer.from('tampered') : z.read(n) })); z.close();
  entries.push({ name: '../../escape.txt', data: Buffer.from('nope') }, { name: 'blobs/../../escape2', data: Buffer.from('nope') });
  const target = tmp();
  const app2 = await start(target);
  const insp = (await app2.call('POST', '/api/restore/inspect', zipOf(entries))).body;
  await app2.call('POST', '/api/restore/apply', { token: insp.token });
  assert.equal((await app2.call('GET', '/api/integrity')).body.missing.length, 1, 'tampered file reported missing, not trusted');
  assert.ok(!fs.existsSync(path.join(target, '..', 'escape.txt')) && !fs.existsSync(path.join(target, 'escape2')));
  const s = (await app.call('GET', '/api/state')).body;
  assert.ok(s.assignments.some(a => a.title === 'חייב לשרוד'), 'original instance untouched');
  await app.stop(); await app2.stop();
});

test('backups made before the rename (app "study-os", schema 1) restore and migrate', async () => {
  const src = tmp(); makeV1(src);
  const f = path.join(tmp(), 'old.zip');
  writeZip(f, [{ name: 'manifest.json', data: Buffer.from(JSON.stringify({ app: 'study-os', schema: 1 })) }, { name: 'study.db', data: fs.readFileSync(path.join(src, 'study.db')) }]);
  const app = await start(tmp());
  const insp = (await app.call('POST', '/api/restore/inspect', fs.readFileSync(f))).body;
  assert.equal(insp.schema, 1);
  await app.call('POST', '/api/restore/apply', { token: insp.token });
  const s = (await app.call('GET', '/api/state')).body;
  assert.equal(s.courses.length, 6);
  assert.equal(s.projects.length, 3);
  await app.stop();
});

// ---------- startup ----------
test('port used by another program: clear message, exit code 2; IJOS already running: reused', async () => {
  const other = http.createServer((q, r) => r.end('hello')); await new Promise(r => other.listen(0, '127.0.0.1', r));
  const run = port => new Promise(resolve => {
    const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: path.join(import.meta.dirname, '..'), env: { ...process.env, IJOS_PORT: String(port), IJOS_DATA: tmp() } });
    let out = ''; p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
    const t = setTimeout(() => p.kill(), 8000);
    p.on('exit', code => { clearTimeout(t); resolve({ code, out }); });
  });
  const busy = await run(other.address().port);
  assert.equal(busy.code, 2, busy.out);
  assert.match(busy.out, /used by another program/);
  assert.match(busy.out, /IJOS_PORT=4322/);
  other.close();
  const app = await start(tmp());
  const again = await run(app.server.address().port);
  assert.equal(again.code, 0, again.out);
  assert.match(again.out, /IJOS כבר פועל/);
  await app.stop();
});

test('course sharing: export one course, classmate imports it as a new course without personal progress', async () => {
  const a = await start(tmp());
  await a.call('POST', '/api/sample');
  let s = (await a.call('GET', '/api/state')).body;
  const c = s.courses[0];
  const asg = s.assignments.find(x => x.course_id === c.id);
  await a.call('PATCH', `/api/rows/assignments/${asg.id}`, { status: 'submitted', grade: '95', draft_md: 'הטיוטה הפרטית שלי' });
  const up = (await a.call('POST', `/api/upload?name=${encodeURIComponent('הרצאה 1.docx')}&course_id=${c.id}&source=lecturer`, docx())).body.resource;
  await a.call('POST', '/api/rows/applications', { title: 'רעיון פרטי', course_id: c.id });
  const noNotes = await a.call('GET', `/api/download/share/${c.id}?notes=0&mine=1&deadlines=1`);
  assert.equal(noNotes.status, 200);
  assert.match(decodeURIComponent(noNotes.headers.get('content-disposition')), /IJOS - /);
  const zf = path.join(tmp(), 'share.zip'); fs.writeFileSync(zf, noNotes.body);
  const z = readZip(zf); const data = JSON.parse(z.read('course.json').toString('utf8')); z.close();
  const json = JSON.stringify(data);
  assert.ok(!json.includes('הטיוטה הפרטית שלי') && !json.includes('"95"') && !json.includes('רעיון פרטי') && !json.includes('submitted'), 'no drafts, grades, statuses or ideas');
  assert.ok(data.resources.every(r => r.kind !== 'note'), 'notes left out when not chosen');
  assert.deepEqual(Object.keys(data.course).sort(), ['color', 'credits', 'icon', 'lecturer', 'name', 'syllabus'], 'only the course fields that still exist');
  assert.ok(!('chapters' in data) && !('summary_folders' in data) && !('summary_sources' in data), 'no summaries');

  const b = await start(tmp());
  await b.call('POST', '/api/rows/years', { name: 'שנה א׳' });
  const sem = (await b.call('POST', '/api/rows/semesters', { year_id: 1, name: 'סמסטר א׳', status: 'active' })).body;
  const mineB = (await b.call('POST', '/api/rows/courses', { semester_id: sem.id, name: 'הקורס שלי' })).body;
  const bad = await b.call('POST', '/api/share/inspect', Buffer.from('not a zip'));
  assert.equal(bad.status, 400);
  const ins = await b.call('POST', '/api/share/inspect', noNotes.body);
  assert.equal(ins.status, 200); assert.equal(ins.body.course, c.name);
  const app = await b.call('POST', '/api/share/apply', { token: ins.body.token, semester_id: sem.id, name: 'מבוא לבסיסי נתונים (מדנה)' });
  assert.equal(app.status, 200);
  const t = (await b.call('GET', '/api/state')).body;
  const nc = t.courses.find(x => x.id === app.body.course.id);
  assert.ok(nc && nc.semester_id === sem.id && nc.sample === 0 && nc.name === 'מבוא לבסיסי נתונים (מדנה)');
  assert.ok(t.courses.find(x => x.id === mineB.id), 'existing course untouched');
  const res = t.resources.filter(r => r.course_id === nc.id);
  const file = res.find(r => r.original_name === 'הרצאה 1.docx');
  assert.ok(file && file.text_status === 'extracted', 'file arrives and is searchable');
  assert.equal((await b.call('GET', `/files/${file.id}`)).body.length, docx().length);
  assert.ok(t.assignments.filter(x => x.course_id === nc.id).every(x => x.status === 'not_started' && !x.grade && !x.draft_md), 'assignments start fresh');
  assert.ok(t.topics.filter(x => x.course_id === nc.id).length > 0, 'topics imported');
  assert.equal(t.applications.length, 0);
  assert.equal((await b.call('POST', '/api/share/apply', { token: ins.body.token, semester_id: sem.id })).status, 400, 'token single use');
  await a.stop(); await b.stop();
});

test('file references stay inside the data folder; risky files are never opened by the OS; zip bombs refused', async () => {
  const dir = tmp();
  const app = await start(dir);
  const up = (await app.call('POST', '/api/upload?name=run.cmd', Buffer.from('echo hi'))).body.resource;
  assert.equal((await app.call('POST', `/api/open/${up.id}`)).status, 400, 'script not handed to the shell');
  await app.call('PATCH', `/api/rows/resources/${up.id}`, { blob_sha: '../../../evil', title: 'x' });
  const after = (await app.call('GET', `/api/rows/resources/${up.id}`)).body;
  assert.equal(after.blob_sha, up.blob_sha, 'row API cannot repoint files'); assert.equal(after.title, 'x');
  // backup whose DB points outside the blob store
  const b = (await app.call('POST', '/api/backup')).body;
  const src = path.join(dir, 'backups', b.name), z = readZip(src);
  const db = path.join(tmp(), 's.db'); fs.writeFileSync(db, z.read('study.db')); z.close();
  const d = new DatabaseSync(db); d.exec("UPDATE resources SET blob_sha='../../outside'"); d.close();
  const evil = path.join(tmp(), 'e.zip'); writeZip(evil, [{ name: 'manifest.json', data: Buffer.from('{"app":"ijos","schema":2}') }, { name: 'study.db', file: db }]);
  const r = await app.call('POST', '/api/restore/inspect', fs.readFileSync(evil));
  assert.equal(r.status, 400); assert.match(r.body.error, /הפניה לא תקינה/);
  // 50 MB of zeros declared as 10 bytes
  const bomb = path.join(tmp(), 'bomb.zip'); writeZip(bomb, [{ name: 'manifest.json', data: Buffer.alloc(50 * 1048576) }]);
  const buf = fs.readFileSync(bomb); const cd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); buf.writeUInt32LE(10, cd + 24);
  const bz = path.join(tmp(), 'b2.zip'); fs.writeFileSync(bz, buf);
  const zz = readZip(bz); assert.throws(() => zz.read('manifest.json')); zz.close();
  await app.stop();
});

test('a share file from the released version (summaries, summary folders, old course fields) imports cleanly and ignores those parts', async () => {
  const app = await start(tmp());
  await app.call('POST', '/api/rows/years', { name: 'א' }); await app.call('POST', '/api/rows/semesters', { year_id: 1, name: 'א' });
  const old = {
    course: { name: 'קורס ישן', code: '10111', credits: 4, lecturer: 'ד״ר כהן', lecturer_contact: 'a@b.c', office_hours: 'ב׳ 10:00', grading: '[{"name":"מבחן","weight":70}]', info_md: '# הנחיות', color: '#e2562f', icon: 'ק', syllabus: null },
    topics: [{ id: 1, name: 'לולאות', sort: 1 }], lessons: [], folders: [],
    resources: [{ id: 7, kind: 'note', title: 'פתק', body: 'גוף', source: 'me' }],
    resource_topics: [{ resource_id: 7, topic_id: 1 }], resource_relations: [],
    chapters: [{ id: 3, topic_id: 1, folder_id: 9, title: 'סיכום', body_md: 'תוכן הסיכום', sort: 1 }],
    summary_folders: [{ id: 9, parent_id: null, name: 'לקראת המבחן', sort: 1 }],
    summary_sources: [{ chapter_id: 3, resource_id: 7 }],
    assignments: [], exams: [],
  };
  const f = path.join(tmp(), 'old.zip');
  writeZip(f, [{ name: 'manifest.json', data: Buffer.from(JSON.stringify({ app: 'ijos', kind: 'course', format: 1, counts: { chapters: 1 } })) }, { name: 'course.json', data: Buffer.from(JSON.stringify(old)) }]);
  const ins = await app.call('POST', '/api/share/inspect', fs.readFileSync(f));
  assert.equal(ins.status, 200);
  const res = await app.call('POST', '/api/share/apply', { token: ins.body.token, semester_id: 1 });
  assert.equal(res.status, 200);
  const st = (await app.call('GET', '/api/state')).body;
  const nc = st.courses.find(c => c.id === res.body.course.id);
  assert.ok(nc.name === 'קורס ישן' && nc.lecturer === 'ד״ר כהן' && nc.color === '#e2562f' && nc.icon === 'ק' && nc.credits === 4, 'kept fields imported');
  assert.ok(nc.code === '' && nc.lecturer_contact === '' && nc.office_hours === '' && nc.grading === '[]' && nc.info_md === '', 'removed fields ignored');
  assert.equal(st.summary_chapters.length + st.summary_folders.length + st.summary_sources.length, 0, 'summaries ignored');
  const note = st.resources.find(r => r.course_id === nc.id);
  assert.equal(note.title, 'פתק');
  assert.ok(st.resource_topics.some(x => x.resource_id === note.id), 'the rest of the course still imports');
  await app.stop();
});

test('folder loops are refused or broken; zip metadata entries are size-capped', async () => {
  const app = await start(tmp());
  await app.call('POST', '/api/rows/years', { name: 'א' }); await app.call('POST', '/api/rows/semesters', { year_id: 1, name: 'א' });
  const c = (await app.call('POST', '/api/rows/courses', { semester_id: 1, name: 'ק' })).body;
  const a = (await app.call('POST', '/api/rows/summary_folders', { course_id: c.id, name: 'a' })).body;
  const b = (await app.call('POST', '/api/rows/summary_folders', { course_id: c.id, name: 'b', parent_id: a.id })).body;
  assert.equal((await app.call('PATCH', `/api/rows/summary_folders/${a.id}`, { parent_id: b.id })).status, 400, 'cannot move a folder into its child');
  // shared course whose folders point at each other
  const f = path.join(tmp(), 'loop.zip');
  writeZip(f, [{ name: 'manifest.json', data: Buffer.from('{"app":"ijos","kind":"course","format":1}') }, { name: 'course.json', data: Buffer.from(JSON.stringify({ course: { name: 'לולאה' }, resources: [], summary_folders: [{ id: 1, parent_id: 2, name: 'x' }, { id: 2, parent_id: 1, name: 'y' }], folders: [{ id: 5, parent_id: 5, name: 'self' }] })) }]);
  const tok = (await app.call('POST', '/api/share/inspect', fs.readFileSync(f))).body.token;
  const nc = (await app.call('POST', '/api/share/apply', { token: tok, semester_id: 1 })).body.course;
  const st = (await app.call('GET', '/api/state')).body;
  assert.equal(st.summary_folders.filter(x => x.course_id === nc.id).length, 0, 'summary folders from old files are ignored');
  assert.ok(st.folders.filter(x => x.course_id === nc.id).every(x => x.parent_id === null));
  // manifest declared larger than 1 MB is refused before inflating
  const big = path.join(tmp(), 'big.zip'); writeZip(big, [{ name: 'manifest.json', data: Buffer.alloc(2 * 1048576, 32) }, { name: 'course.json', data: Buffer.from('{}') }]);
  assert.equal((await app.call('POST', '/api/share/inspect', fs.readFileSync(big))).status, 400);
  await app.stop();
});

// IJOS local server: JSON API + static UI + file storage. Binds to 127.0.0.1 only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openDb, tableColumns, now, SCHEMA_VERSION } from './db.js';
import { readZip, writeZip } from './zip.js';
import { extract, kindOf, mimeOf, extOf, externalDeps } from './extract.js';

const PUBLIC = path.join(import.meta.dirname, '..', 'public');
const STATIC_MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png' };
// Heavy columns are fetched per row, not in /api/state.
const HEAVY = { resources: ['text_content', 'body'], resource_versions: ['body'], summary_versions: ['snapshot'], proposals: ['body_md'] };
const JOINS = ['resource_topics', 'resource_relations', 'assignment_topics', 'assignment_resources', 'exam_topics', 'exam_resources', 'summary_sources', 'application_projects'];
export const APP_VERSION = '1.0.0-rc.1';
// Display/download name only: files are stored by hash, so a name never becomes a path. Still strip separators, control chars and Windows-reserved forms.
export const safeName = raw => {
  let n = String(raw || '').split(/[\\/]/).pop().replace(/[\x00-\x1f<>:"|?*]/g, '_').replace(/[. ]+$/, '').trim().slice(0, 200);
  if (!n || /^\.+$/.test(n)) n = 'file';
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(n)) n = '_' + n;
  return n;
};
const PRIVATE = ['blobs', 'sqlite_sequence'];
const VERSION_GAP_MS = 30 * 60 * 1000;

export function createApp({ dataDir, port, maxUploadMb = 1024 }) {
  const dirs = { blobs: path.join(dataDir, 'blobs'), tmp: path.join(dataDir, 'tmp'), backups: path.join(dataDir, 'backups'), auto: path.join(dataDir, 'backups', 'auto'), open: path.join(dataDir, 'tmp', 'open') };
  Object.values(dirs).forEach(d => fs.mkdirSync(d, { recursive: true }));
  const dbFile = path.join(dataDir, 'study.db');
  let db = openDb(dbFile);
  let cols = tableColumns(db);

  const SHA = /^[0-9a-f]{64}$/;
  const blobPath = sha => { if (!SHA.test(sha)) throw httpErr(400, 'invalid file reference'); return path.join(dirs.blobs, sha.slice(0, 2), sha); }; // sha comes from the DB, which a restore can replace
  const q = (sql, ...a) => db.prepare(sql).all(...a);
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  let txDepth = 0; // nested tx() calls join the outer transaction
  const tx = fn => { if (txDepth) return fn(); txDepth++; db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } finally { txDepth--; } };
  const userTable = t => cols[t] && !PRIVATE.includes(t) && !JOINS.includes(t);
  const getRow = (t, id) => one(`SELECT * FROM ${t} WHERE id=?`, id);

  function insert(t, data) {
    const c = cols[t], row = {};
    for (const k of Object.keys(data)) if (c.includes(k) && k !== 'id') row[k] = norm(data[k]);
    if (c.includes('created_at')) row.created_at = now();
    if (c.includes('updated_at')) row.updated_at = row.created_at;
    const keys = Object.keys(row);
    const id = run(`INSERT INTO ${t} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map(k => row[k])).lastInsertRowid;
    return getRow(t, Number(id));
  }
  const norm = v => typeof v === 'boolean' ? Number(v) : (v !== null && typeof v === 'object') ? JSON.stringify(v) : v;

  function update(t, id, data) {
    const prev = getRow(t, id);
    if (!prev) throw httpErr(404, 'not found');
    if (data._base && prev.updated_at && data._base !== prev.updated_at) throw httpErr(409, 'changed elsewhere', { current: prev });
    const set = {};
    for (const k of Object.keys(data)) if (cols[t].includes(k) && !['id', 'created_at', 'updated_at'].includes(k)) set[k] = norm(data[k]);
    if (!Object.keys(set).length) return prev;
    // Version history: keep earlier note text, at most one snapshot per 30 minutes of editing.
    if (t === 'resources' && 'body' in set && prev.body && set.body !== prev.body) {
      const last = one('SELECT created_at FROM resource_versions WHERE resource_id=? AND body IS NOT NULL ORDER BY id DESC LIMIT 1', id);
      if (!last || Date.now() - Date.parse(last.created_at) > VERSION_GAP_MS) run('INSERT INTO resource_versions (resource_id, body, label, created_at) VALUES (?,?,?,?)', id, prev.body, 'שמירה אוטומטית', now());
    }
    if (t === 'resources' && 'body' in set) set.text_content = set.body;
    if (cols[t].includes('updated_at')) set.updated_at = now();
    const keys = Object.keys(set);
    run(`UPDATE ${t} SET ${keys.map(k => k + '=?').join(',')} WHERE id=?`, ...keys.map(k => set[k]), id);
    return getRow(t, id);
  }

  function state() {
    const out = {};
    for (const t of Object.keys(cols)) {
      if (PRIVATE.includes(t)) continue;
      const pick = cols[t].filter(c => !(HEAVY[t] || []).includes(c));
      out[t] = q(`SELECT ${pick.join(',')} FROM ${t}`);
    }
    out.settings = Object.fromEntries(out.settings.map(s => [s.key, s.value]));
    out.meta = { dataDir, schema: SCHEMA_VERSION, port, version: APP_VERSION, maxUploadMb };
    return out;
  }

  // ---- files ----
  // Streams the request body to a temp file while hashing. Over-limit or aborted uploads leave nothing behind.
  async function receiveFile(req) {
    const tmp = path.join(dirs.tmp, crypto.randomUUID());
    const hash = crypto.createHash('sha256');
    const max = maxUploadMb * 1048576;
    let size = 0;
    if (Number(req.headers['content-length'] || 0) > max) { req.resume(); throw httpErr(413, `הקובץ גדול מדי (מעל ${maxUploadMb} MB)`); }
    try {
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(tmp);
        const fail = e => { req.unpipe(out); out.destroy(); req.resume(); reject(e); };
        req.on('data', c => { hash.update(c); size += c.length; if (size > max) fail(httpErr(413, `הקובץ גדול מדי (מעל ${maxUploadMb} MB)`)); });
        req.on('aborted', () => fail(httpErr(400, 'ההעלאה הופסקה')));
        req.on('error', fail); out.on('error', fail); out.on('finish', resolve);
        req.pipe(out);
      });
    } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
    return { tmp, sha: hash.digest('hex'), size };
  }
  function storeBlob({ tmp, sha, size }) {
    const dest = blobPath(sha);
    if (fs.existsSync(dest)) fs.rmSync(tmp);
    else { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.renameSync(tmp, dest); }
    run('INSERT OR IGNORE INTO blobs (sha, size, created_at) VALUES (?,?,?)', sha, size, now());
    return dest;
  }

  async function upload(req, p) {
    const name = safeName(p.get('name'));
    const got = await receiveFile(req);
    const file = storeBlob(got);
    const ex = extract(file, name, () => fs.readFileSync(file));
    const versionOf = Number(p.get('resource_id')) || null;
    if (versionOf) {
      const r = getRow('resources', versionOf);
      if (!r) throw httpErr(404, 'resource not found');
      tx(() => {
        run('INSERT INTO resource_versions (resource_id, blob_sha, original_name, label, created_at) VALUES (?,?,?,?,?)', r.id, r.blob_sha, r.original_name, 'גרסה קודמת', now());
        update('resources', r.id, { blob_sha: got.sha, original_name: name, mime: mimeOf(name), kind: kindOf(name), text_content: ex.text, text_status: ex.status });
      });
      return { resource: getRow('resources', r.id), duplicates: [] };
    }
    const duplicates = q('SELECT id, title, course_id FROM resources WHERE blob_sha=? AND deleted_at IS NULL', got.sha);
    const num = k => Number(p.get(k)) || null;
    const resource = tx(() => {
      const r = insert('resources', {
        title: p.get('title') || name.replace(/\.[^.]+$/, ''), kind: kindOf(name), role: p.get('role') || 'material', source: p.get('source') || 'other',
        course_id: num('course_id'), folder_id: num('folder_id'), lesson_id: num('lesson_id'), blob_sha: got.sha, original_name: name, mime: mimeOf(name),
        text_content: ex.text, text_status: ex.status,
      });
      for (const tid of (p.get('topic_ids') || '').split(',').map(Number).filter(Boolean)) run('INSERT OR IGNORE INTO resource_topics VALUES (?,?)', r.id, tid);
      return r;
    });
    delete resource.text_content;
    return { resource, duplicates };
  }

  function fileFor(id, versionId) {
    const r = getRow('resources', id);
    if (!r) throw httpErr(404, 'not found');
    const v = versionId ? one('SELECT * FROM resource_versions WHERE id=? AND resource_id=?', versionId, id) : null;
    const sha = v ? v.blob_sha : r.blob_sha, name = v ? v.original_name : r.original_name;
    if (!sha) throw httpErr(404, 'no file');
    const file = blobPath(sha);
    if (!fs.existsSync(file)) throw httpErr(410, 'file missing', { missing: true });
    return { r, file, name };
  }

  function serveFile(res, id, p) {
    const { r, file, name } = fileFor(id, Number(p.get('v')) || null);
    const download = p.get('download') === '1';
    const ext = extOf(name);
    const headers = {
      'Content-Type': download ? 'application/octet-stream' : mimeOf(name) + (mimeOf(name).startsWith('text/') ? '; charset=utf-8' : ''),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`,
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    };
    if (!download && (ext === 'html' || ext === 'htm' || ext === 'svg')) {
      // Isolation for imported HTML: opaque origin (sandbox without allow-same-origin), no network, no forms.
      const scripts = p.has('scripts') ? p.get('scripts') === '1' : !!r.html_scripts;
      const ext = p.has('external') ? p.get('external') === '1' : !!r.html_external;
      const net = ext ? ' https:' : '';
      headers['Content-Security-Policy'] = [`sandbox${scripts ? ' allow-scripts' : ''} allow-popups allow-popups-to-escape-sandbox`, "default-src 'none'",
        `script-src 'unsafe-inline'${net}`, `style-src 'unsafe-inline' data:${net}`, `img-src data: blob:${net}`, `font-src data:${net}`, `media-src data:${net}`,
        "connect-src 'none'", "form-action 'none'", "base-uri 'none'", "frame-src 'none'"].join('; ');
    } else if (!download && ext !== 'pdf') headers['Content-Security-Policy'] = "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'";
    res.writeHead(200, { ...headers, 'Content-Length': fs.statSync(file).size });
    fs.createReadStream(file).pipe(res);
  }

  const fileSafe = b => { const { blob_sha, original_name, mime, ...rest } = b || {}; return rest; }; // file fields change only through upload/version routes
  const OPENABLE = new Set(['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'txt', 'md', 'rtf', 'odt', 'ods', 'odp', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'mp3', 'mp4', 'm4a', 'wav', 'webm', 'zip', 'java', 'c', 'cpp', 'sql', 'json', 'ipynb']);
  function openExternal(id) {
    const { file, name } = fileFor(id);
    const dir = path.join(dirs.open, `${id}-${Date.now()}`);
    if (!OPENABLE.has(extOf(safeName(name)))) throw httpErr(400, 'מטעמי אבטחה IJOS לא פותחת סוג קובץ זה בתוכנה. אפשר להוריד אותו ולפתוח ידנית.');
    fs.mkdirSync(dir, { recursive: true });
    const safe = safeName(name);
    const copy = path.join(dir, safe);
    fs.copyFileSync(file, copy);
    const cmd = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    spawn(cmd, [copy], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true, copy };
  }

  // ---- search: plain substring match (works with Hebrew prefixes), all terms must appear ----
  function search(qs) {
    const terms = qs.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const sets = [
      ['resources', 'title', ['title', 'tags', 'notes', 'original_name', 'url', 'body', 'text_content']],
      ['assignments', 'title', ['title', 'instructions_md', 'next_action', 'notes_md', 'draft_md', 'feedback_md']],
      ['exams', 'title', ['title', 'location', 'notes_md']],
      ['applications', 'title', ['title', 'learned', 'problem', 'proposal', 'benefit', 'questions', 'acceptance', 'next_action']],
      ['topics', 'name', ['name', 'description']],
      ['lessons', 'title', ['title', 'notes_md', 'date']],
    ];
    const out = [];
    for (const [t, titleCol, fields] of sets) {
      for (const row of q(`SELECT * FROM ${t} WHERE deleted_at IS NULL`)) {
        const hay = fields.map(f => String(row[f] ?? '').toLowerCase());
        if (!terms.every(term => hay.some(h => h.includes(term)))) continue;
        const matched = fields.filter((f, i) => terms.some(term => hay[i].includes(term)));
        const f = matched[0], text = String(row[f] ?? ''), at = text.toLowerCase().indexOf(terms.find(term => text.toLowerCase().includes(term)));
        out.push({ table: t, id: row.id, title: row[titleCol], course_id: row.course_id ?? null, kind: row.kind, source: row.source, text_status: row.text_status,
          matched, snippet: text.slice(Math.max(0, at - 60), at + 140).replace(/\s+/g, ' ') });
      }
    }
    return out.slice(0, 200);
  }

  // ---- export ----
  const mdName = s => String(s || 'untitled').replace(/[\\/:*?"<>|\n]/g, '_').slice(0, 80);
  function exportAllMd() {
    const file = path.join(dirs.tmp, `ijos-notes-${stamp()}.zip`);
    const entries = [];
    const courseName = id => mdName(getRow('courses', id)?.name || 'לא ממוין');
    for (const n of q("SELECT * FROM resources WHERE kind='note' AND deleted_at IS NULL")) entries.push({ name: `${courseName(n.course_id)}/notes/${n.id}-${mdName(n.title)}.md`, data: Buffer.from(`# ${n.title}\n\n${n.body || ''}`) });
    for (const a of q('SELECT * FROM applications WHERE deleted_at IS NULL')) entries.push({ name: `applications/${a.id}-${mdName(a.title)}.md`, data: Buffer.from(briefMd(a)) });
    writeZip(file, entries);
    return file;
  }
  function briefMd(a) {
    const course = getRow('courses', a.course_id)?.name, topic = getRow('topics', a.topic_id)?.name, r = a.resource_id ? getRow('resources', a.resource_id) : null;
    const notes = r ? [r, ...q('SELECT x.* FROM resource_relations l JOIN resources x ON x.id = CASE WHEN l.resource_id=? THEN l.related_id ELSE l.resource_id END WHERE (l.resource_id=? OR l.related_id=?) AND x.deleted_at IS NULL', r.id, r.id, r.id)] : [];
    const projects = q('SELECT p.name FROM application_projects ap JOIN projects p ON p.id = ap.project_id WHERE ap.application_id=? AND p.deleted_at IS NULL ORDER BY p.sort, p.id', a.id).map(x => x.name);
    const target = projects.join(' + ') || '(no project selected)';
    const sec = (h, v) => v && String(v).trim() ? `## ${h}\n\n${v}\n\n` : `## ${h}\n\n_(לא מולא)_\n\n`;
    return `# Implementation brief: ${a.title}\n\n` +
      `> Learning-derived idea for **${target}**. It is a proposal, not a decision: validate it against the real codebase, data and users before implementing.\n\n` +
      `- Target project: ${target}\n- Status: ${a.status}\n- Course: ${course || '—'}\n- Topic: ${topic || '—'}\n- Exported: ${new Date().toISOString().slice(0, 10)}\n\n` +
      sec('What I learned', a.learned) + sec('Problem / opportunity', a.problem) + sec('Proposed application', a.proposal) + sec('Expected benefit', a.benefit) +
      sec('Assumptions and open questions to validate', a.questions) + sec('Acceptance criteria', a.acceptance) + sec('Next action', a.next_action) +
      (notes.length ? `## Supporting learning notes\n\n` + notes.map(n => `### ${n.title} (${n.source})\n\n${(n.body || n.notes || '').trim().slice(0, 4000) || '_(file: ' + (n.original_name || n.url || '') + ' — attach separately if needed)_'}\n`).join('\n') : '');
  }

  // ---- backup / restore ----
  const localNow = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jerusalem' }); // 'YYYY-MM-DD HH:MM:SS'
  const stamp = () => localNow().slice(0, 16).replace(/[ :]/g, '-');
  function snapshotDb(file) { if (fs.existsSync(file)) fs.rmSync(file); db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`); }
  function backup() {
    const dbCopy = path.join(dirs.tmp, `backup-${Date.now()}.db`);
    snapshotDb(dbCopy);
    try {
      const shas = q('SELECT sha FROM blobs').map(b => b.sha).filter(s => fs.existsSync(blobPath(s)));
      const counts = Object.fromEntries(['courses', 'resources', 'assignments', 'exams', 'applications'].map(t => [t, one(`SELECT COUNT(*) n FROM ${t}`).n]));
      const manifest = { app: 'ijos', app_version: APP_VERSION, schema: SCHEMA_VERSION, created_at: now(), files: shas.length, counts };
      const out = path.join(dirs.backups, `ijos-backup-${stamp()}.zip`);
      writeZip(out, [{ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) }, { name: 'study.db', file: dbCopy }, ...shas.map(s => ({ name: `blobs/${s}`, file: blobPath(s) }))]);
      return { name: path.basename(out), size: fs.statSync(out).size, manifest };
    } finally { fs.rmSync(dbCopy, { force: true }); }
  }
  function autoSnapshot() {
    const day = localNow().slice(0, 10), file = path.join(dirs.auto, `study-${day}.db`);
    if (!fs.existsSync(file)) snapshotDb(file);
    fs.readdirSync(dirs.auto).filter(f => f.endsWith('.db')).sort().slice(0, -14).forEach(f => fs.rmSync(path.join(dirs.auto, f)));
  }

  const pending = new Map();
  async function restoreInspect(req) {
    const got = await receiveFile(req);
    const token = crypto.randomUUID(), dbTmp = path.join(dirs.tmp, `restore-${token}.db`);
    let zip = null, manifest = null;
    try {
      const head = Buffer.alloc(16); const fd = fs.openSync(got.tmp, 'r'); fs.readSync(fd, head, 0, 16, 0); fs.closeSync(fd);
      if (head.toString('latin1', 0, 15) === 'SQLite format 3') fs.renameSync(got.tmp, dbTmp);
      else {
        zip = readZip(got.tmp);
        if (!zip.has('manifest.json') || !zip.has('study.db')) throw httpErr(400, 'הקובץ אינו גיבוי של IJOS (חסרים manifest.json או study.db)');
        manifest = JSON.parse(zip.read('manifest.json', 1048576).toString('utf8'));
        if (!['ijos', 'study-os'].includes(manifest.app)) throw httpErr(400, 'הקובץ אינו גיבוי של IJOS'); // 'study-os' = backups made before the rename
        fs.writeFileSync(dbTmp, zip.read('study.db'));
      }
      const tdb = new DatabaseSync(dbTmp, { readOnly: true });
      try {
        if (tdb.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw httpErr(400, 'מסד הנתונים בגיבוי פגום');
        const ver = tdb.prepare('PRAGMA user_version').get().user_version;
        if (ver > SCHEMA_VERSION) throw httpErr(400, 'הגיבוי נוצר בגרסה חדשה יותר של האפליקציה');
        const refs = tdb.prepare("SELECT blob_sha s FROM resources WHERE blob_sha IS NOT NULL UNION SELECT blob_sha FROM resource_versions WHERE blob_sha IS NOT NULL UNION SELECT sha FROM blobs").all();
        if (refs.some(r => !SHA.test(String(r.s)))) throw httpErr(400, 'הגיבוי פגום: הפניה לא תקינה לקובץ');
        const tables = new Set(tdb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
        for (const t of ['years', 'courses', 'resources']) if (!tables.has(t)) throw httpErr(400, 'מבנה הנתונים בגיבוי אינו תקין');
        const count = t => tables.has(t) ? tdb.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n : 0;
        const shas = [...new Set(tdb.prepare('SELECT blob_sha s FROM resources WHERE blob_sha IS NOT NULL UNION SELECT blob_sha FROM resource_versions WHERE blob_sha IS NOT NULL').all().map(r => r.s))];
        const missing = shas.filter(s => !(zip?.has(`blobs/${s}`)) && !fs.existsSync(blobPath(s)));
        const names = Object.fromEntries(tdb.prepare('SELECT blob_sha, title FROM resources').all().map(r => [r.blob_sha, r.title]));
        const keys = ['courses', 'resources', 'assignments', 'exams', 'applications'];
        pending.set(token, { zipFile: zip ? got.tmp : null, dbTmp });
        return { token, kind: zip ? 'full' : 'database-only', created_at: manifest?.created_at || null, schema: ver,
          backup: Object.fromEntries(keys.map(k => [k, count(k)])), current: Object.fromEntries(keys.map(k => [k, one(`SELECT COUNT(*) n FROM ${k}`).n])),
          missingFiles: missing.map(s => names[s] || s) };
      } finally { tdb.close(); }
    } catch (e) {
      fs.rmSync(dbTmp, { force: true }); fs.rmSync(got.tmp, { force: true });
      throw e.status ? e : httpErr(400, 'לא ניתן לקרוא את קובץ הגיבוי: ' + e.message);
    } finally { zip?.close(); }
  }
  function restoreApply(token) {
    const p = pending.get(token);
    if (!p) throw httpErr(400, 'פג תוקף הבדיקה — העלה את הגיבוי שוב');
    const safety = path.join(dirs.backups, `pre-restore-${stamp()}.db`);
    snapshotDb(safety);
    if (p.zipFile) {
      const zip = readZip(p.zipFile);
      try {
        for (const n of zip.names.filter(n => /^blobs\/[0-9a-f]{64}$/.test(n))) {
          const sha = n.slice(6);
          if (fs.existsSync(blobPath(sha))) continue;
          const data = zip.read(n);
          if (crypto.createHash('sha256').update(data).digest('hex') !== sha) continue; // corrupted entry: skip, reported as missing file in UI
          fs.mkdirSync(path.dirname(blobPath(sha)), { recursive: true });
          fs.writeFileSync(blobPath(sha), data);
          run('INSERT OR IGNORE INTO blobs (sha, size, created_at) VALUES (?,?,?)', sha, data.length, now());
        }
      } finally { zip.close(); }
    }
    // Swap databases: copy next to the live file, then rename over it. Any failure rolls back to the safety snapshot.
    const staged = dbFile + '.restoring';
    fs.copyFileSync(p.dbTmp, staged);
    db.close();
    try {
      for (const s of ['-wal', '-shm']) fs.rmSync(dbFile + s, { force: true });
      fs.renameSync(staged, dbFile);
      db = openDb(dbFile); cols = tableColumns(db);
    } catch (e) {
      try { db.close(); } catch { /* not open */ }
      for (const s of ['-wal', '-shm']) fs.rmSync(dbFile + s, { force: true });
      fs.copyFileSync(safety, dbFile);
      db = openDb(dbFile); cols = tableColumns(db);
      fs.rmSync(staged, { force: true });
      throw httpErr(500, 'השחזור נכשל והנתונים הקודמים הוחזרו: ' + e.message);
    }
    // blobs table must know every file on disk (restored DB may predate some uploads)
    for (const s of q('SELECT blob_sha s FROM resources WHERE blob_sha IS NOT NULL UNION SELECT blob_sha FROM resource_versions WHERE blob_sha IS NOT NULL'))
      if (fs.existsSync(blobPath(s.s))) run('INSERT OR IGNORE INTO blobs (sha, size, created_at) VALUES (?,?,?)', s.s, fs.statSync(blobPath(s.s)).size, now());
    fs.rmSync(p.dbTmp, { force: true }); if (p.zipFile) fs.rmSync(p.zipFile, { force: true });
    pending.delete(token);
    return { ok: true, safetyBackup: path.basename(safety) };
  }

  function integrity() {
    const missing = q('SELECT id, title, blob_sha FROM resources WHERE blob_sha IS NOT NULL AND deleted_at IS NULL').filter(r => !fs.existsSync(blobPath(r.blob_sha)));
    return { missing: missing.map(r => ({ id: r.id, title: r.title })) };
  }

  // Permanent delete (from trash) + cleanup of link rows and unreferenced files.
  function hardDelete(t, id) {
    tx(() => {
      run(`DELETE FROM ${t} WHERE id=?`, id);
      const links = { resources: [['resource_topics', 'resource_id'], ['resource_relations', 'resource_id'], ['resource_relations', 'related_id'], ['assignment_resources', 'resource_id'], ['exam_resources', 'resource_id'], ['summary_sources', 'resource_id'], ['resource_versions', 'resource_id']],
        assignments: [['assignment_topics', 'assignment_id'], ['assignment_resources', 'assignment_id']], exams: [['exam_topics', 'exam_id'], ['exam_resources', 'exam_id']],
        topics: [['resource_topics', 'topic_id'], ['assignment_topics', 'topic_id'], ['exam_topics', 'topic_id']], summary_chapters: [['summary_sources', 'chapter_id']], applications: [['application_projects', 'application_id']], projects: [['application_projects', 'project_id']] }[t] || [];
      for (const [lt, c] of links) run(`DELETE FROM ${lt} WHERE ${c}=?`, id);
      if (['assignments', 'exams'].includes(t)) run('DELETE FROM checklist WHERE owner_type=? AND owner_id=?', t.slice(0, -1), id);
      if (['assignments', 'exams', 'tasks'].includes(t)) run('DELETE FROM reminders WHERE target_type=? AND target_id=?', t.slice(0, -1), id);
    });
    if (!txDepth) gcBlobs(); // never delete files before the outer transaction commits
  }
  function gcBlobs() {
    const used = new Set(q('SELECT blob_sha s FROM resources WHERE blob_sha IS NOT NULL UNION SELECT blob_sha FROM resource_versions WHERE blob_sha IS NOT NULL').map(r => r.s));
    for (const b of q('SELECT sha FROM blobs')) if (!used.has(b.sha) && SHA.test(b.sha)) { fs.rmSync(blobPath(b.sha), { force: true }); run('DELETE FROM blobs WHERE sha=?', b.sha); }
  }
  // The last four belong to features that no longer have a screen. Rows deleted back then must still go when the trash is emptied.
  const TRASHABLE = ['courses', 'topics', 'folders', 'lessons', 'resources', 'assignments', 'exams', 'applications', 'projects', 'semesters', 'tasks', 'summary_chapters', 'summary_folders', 'flags'];
  function emptyTrash() { for (const t of TRASHABLE) for (const r of q(`SELECT id FROM ${t} WHERE deleted_at IS NOT NULL`)) hardDelete(t, r.id); }

  // ---- HTTP ----
  // ---- course sharing: one course → .zip a classmate can import as a NEW course. Personal progress never leaves. ----
  // Included: course name, credits, lecturer, colour, icon, topics, lessons, folders, files and links; optionally my notes, files I made, deadlines.
  // Never included: assignment status, drafts, grades, feedback, submissions, reminders, activity, project ideas.
  // Files from older versions may also carry summaries and other course fields: import ignores them.
  const SHARE_FORMAT = 1;
  const pick = (row, keys) => Object.fromEntries(keys.map(k => [k, row[k] ?? null]));
  function shareExport(cid, o) {
    const c = getRow('courses', cid);
    if (!c || c.deleted_at) throw httpErr(404, 'הקורס לא נמצא');
    const live = t => q(`SELECT * FROM ${t} WHERE course_id=? AND deleted_at IS NULL`, cid);
    const resources = live('resources').filter(r => (r.kind === 'note' ? o.notes : true) && (r.source === 'me' && r.kind !== 'note' ? o.mine : true) && (!r.blob_sha || fs.existsSync(blobPath(r.blob_sha))));
    const rids = new Set(resources.map(r => r.id));
    const topics = live('topics'), tids = new Set(topics.map(t => t.id));
    const inR = (t, a, b) => q(`SELECT * FROM ${t}`).filter(x => rids.has(x[a]) && (b === 'topic' ? tids.has(x.topic_id) : rids.has(x[b])));
    const data = {
      course: { ...pick(c, ['name', 'credits', 'lecturer', 'color', 'icon']), syllabus: rids.has(c.syllabus_resource_id) ? c.syllabus_resource_id : null },
      folders: live('folders').map(f => pick(f, ['id', 'parent_id', 'name', 'sort'])),
      topics: topics.map(t => pick(t, ['id', 'name', 'description', 'sort'])),
      lessons: live('lessons').map(l => ({ ...pick(l, ['id', 'title', 'date', 'kind', 'sort']), notes_md: o.notes ? l.notes_md : '' })),
      resources: resources.map(r => ({ ...pick(r, ['id', 'folder_id', 'lesson_id', 'title', 'kind', 'role', 'source', 'url', 'blob_sha', 'original_name', 'tags', 'sort']), body: r.kind === 'note' ? r.body : null, notes: o.notes ? r.notes : '' })),
      resource_topics: inR('resource_topics', 'resource_id', 'topic'),
      resource_relations: inR('resource_relations', 'resource_id', 'related_id'),
      assignments: o.deadlines ? live('assignments').map(a => pick(a, ['id', 'title', 'instructions_md', 'due_date', 'due_time'])) : [],
      exams: o.deadlines ? live('exams').map(e => pick(e, ['id', 'title', 'date', 'time', 'location'])) : [],
    };
    const aIds = new Set(data.assignments.map(x => x.id)), eIds = new Set(data.exams.map(x => x.id));
    data.assignment_topics = q('SELECT * FROM assignment_topics').filter(x => aIds.has(x.assignment_id) && tids.has(x.topic_id));
    data.assignment_resources = q("SELECT * FROM assignment_resources WHERE role IN ('instructions','attachment')").filter(x => aIds.has(x.assignment_id) && rids.has(x.resource_id));
    data.exam_topics = q('SELECT * FROM exam_topics').filter(x => eIds.has(x.exam_id) && tids.has(x.topic_id));
    const shas = [...new Set(resources.map(r => r.blob_sha).filter(Boolean))];
    const counts = { topics: data.topics.length, lessons: data.lessons.length, files: shas.length, resources: resources.length, notes: resources.filter(r => r.kind === 'note').length, assignments: data.assignments.length, exams: data.exams.length };
    const manifest = { app: 'ijos', kind: 'course', format: SHARE_FORMAT, app_version: APP_VERSION, exported_at: now(), course: c.name, counts };
    const file = path.join(dirs.tmp, `share-${crypto.randomUUID()}.zip`);
    writeZip(file, [{ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) }, { name: 'course.json', data: Buffer.from(JSON.stringify(data)) }, ...shas.map(s => ({ name: `blobs/${s}`, file: blobPath(s) }))]);
    return { file, name: `IJOS - ${mdName(c.name)}.zip` };
  }

  // A folder whose parent chain loops back on itself is moved to the top level (imported data is untrusted).
  function breakCycles(table, cid) {
    const parent = new Map(q(`SELECT id, parent_id FROM ${table} WHERE course_id=?`, cid).map(r => [r.id, r.parent_id]));
    for (const id of parent.keys()) {
      const seen = new Set([id]);
      for (let p = parent.get(id); p != null; p = parent.get(p)) {
        if (seen.has(p) || !parent.has(p)) { run(`UPDATE ${table} SET parent_id=NULL WHERE id=?`, id); parent.set(id, null); break; }
        seen.add(p);
      }
    }
  }
  async function shareInspect(req) {
    const got = await receiveFile(req);
    try {
      const zip = readZip(got.tmp);
      try {
        if (!zip.has('manifest.json') || !zip.has('course.json')) throw httpErr(400, 'זה לא קובץ שיתוף קורס של IJOS');
        const m = JSON.parse(zip.read('manifest.json', 1048576).toString('utf8'));
        if (m.app !== 'ijos' || m.kind !== 'course') throw httpErr(400, 'זה לא קובץ שיתוף קורס של IJOS');
        if (m.format > SHARE_FORMAT) throw httpErr(400, 'הקובץ נוצר בגרסה חדשה יותר של IJOS. עדכנו את IJOS ונסו שוב.');
        const d = JSON.parse(zip.read('course.json', 64 * 1048576).toString('utf8'));
        if (!d.course?.name || !Array.isArray(d.resources)) throw httpErr(400, 'קובץ השיתוף פגום');
        // Every file must be present and match its fingerprint, otherwise nothing is imported.
        for (const s of new Set(d.resources.map(r => r.blob_sha).filter(Boolean))) {
          if (!/^[0-9a-f]{64}$/.test(s) || !zip.has(`blobs/${s}`)) throw httpErr(400, 'קובץ השיתוף פגום: חסר בו קובץ');
          if (crypto.createHash('sha256').update(zip.read(`blobs/${s}`)).digest('hex') !== s) throw httpErr(400, 'קובץ השיתוף פגום: קובץ לא תקין');
        }
        const token = crypto.randomUUID();
        pending.set(token, { share: got.tmp });
        return { token, course: String(d.course.name), exported_at: m.exported_at || null, counts: m.counts || {} };
      } finally { zip.close(); }
    } catch (e) {
      fs.rmSync(got.tmp, { force: true });
      throw e.status ? e : httpErr(400, 'לא ניתן לקרוא את קובץ השיתוף: ' + e.message);
    }
  }

  function shareApply(token, semesterId, name) {
    const p = pending.get(token);
    if (!p?.share) throw httpErr(400, 'פג תוקף הבדיקה. בחרו את הקובץ שוב.');
    const sem = getRow('semesters', semesterId);
    if (!sem || sem.deleted_at) throw httpErr(400, 'בחרו סמסטר');
    const zip = readZip(p.share);
    try {
      const d = JSON.parse(zip.read('course.json', 64 * 1048576).toString('utf8'));
      const shas = [...new Set(d.resources.map(r => r.blob_sha).filter(Boolean))];
      for (const s of shas) if (!fs.existsSync(blobPath(s))) { fs.mkdirSync(path.dirname(blobPath(s)), { recursive: true }); fs.writeFileSync(blobPath(s), zip.read(`blobs/${s}`)); }
      const str = v => v == null ? '' : String(v);
      const course = tx(() => {
        for (const s of shas) run('INSERT OR IGNORE INTO blobs (sha, size, created_at) VALUES (?,?,?)', s, fs.statSync(blobPath(s)).size, now());
        const c = d.course;
        const cid = insert('courses', { semester_id: sem.id, name: str(name || c.name).slice(0, 200), credits: Number.isFinite(c.credits) ? c.credits : null, lecturer: str(c.lecturer),
          color: /^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : '', icon: str(c.icon).slice(0, 4), sort: one('SELECT COUNT(*) n FROM courses WHERE semester_id=?', sem.id).n + 1 }).id;
        const map = { f: {}, t: {}, l: {}, r: {}, a: {}, e: {} };
        const list = k => Array.isArray(d[k]) ? d[k] : [];
        for (const t of list('topics')) map.t[t.id] = insert('topics', { course_id: cid, name: str(t.name) || 'נושא', description: str(t.description), sort: Number(t.sort) || 0 }).id;
        for (const l of list('lessons')) map.l[l.id] = insert('lessons', { course_id: cid, title: str(l.title), date: l.date ? str(l.date) : null, kind: str(l.kind) || 'lecture', notes_md: str(l.notes_md), sort: Number(l.sort) || 0 }).id;
        const folders = list('folders');
        for (const f of folders) map.f[f.id] = insert('folders', { course_id: cid, name: str(f.name) || 'תיקייה', sort: Number(f.sort) || 0 }).id;
        for (const f of folders) if (map.f[f.parent_id]) run('UPDATE folders SET parent_id=? WHERE id=?', map.f[f.parent_id], map.f[f.id]);
        breakCycles('folders', cid);
        for (const r of list('resources')) {
          const sha = r.blob_sha && shas.includes(r.blob_sha) ? r.blob_sha : null;
          const fname = sha ? safeName(r.original_name) : null;
          const ex = sha ? extract(blobPath(sha), fname, () => fs.readFileSync(blobPath(sha))) : null;
          const kind = sha ? kindOf(fname) : r.kind === 'link' ? 'link' : 'note';
          map.r[r.id] = insert('resources', { course_id: cid, folder_id: map.f[r.folder_id] || null, lesson_id: map.l[r.lesson_id] || null, title: str(r.title).slice(0, 300) || 'חומר', kind, role: str(r.role) || 'material',
            source: str(r.source) || 'other', url: kind === 'link' && /^https?:\/\//i.test(r.url || '') ? r.url : null, blob_sha: sha, original_name: fname, mime: sha ? mimeOf(fname) : null,
            body: kind === 'note' ? str(r.body) : null, tags: typeof r.tags === 'string' ? r.tags : '[]', notes: str(r.notes), text_content: kind === 'note' ? str(r.body) : ex?.text ?? null, text_status: ex?.status || 'none',
            html_scripts: 0, html_external: 0, sort: Number(r.sort) || 0 }).id; // shared HTML starts with its scripts off; the user can switch them on
        }
        const link = (t, a, b) => { for (const x of list(t)) if (a[1][x[a[0]]] && b[1][x[b[0]]]) run(`INSERT OR IGNORE INTO ${t} (${a[0]}, ${b[0]}) VALUES (?,?)`, a[1][x[a[0]]], b[1][x[b[0]]]); };
        link('resource_topics', ['resource_id', map.r], ['topic_id', map.t]);
        link('resource_relations', ['resource_id', map.r], ['related_id', map.r]);
        for (const a of list('assignments')) map.a[a.id] = insert('assignments', { course_id: cid, title: str(a.title) || 'מטלה', instructions_md: str(a.instructions_md), due_date: a.due_date ? str(a.due_date) : null, due_time: a.due_time ? str(a.due_time) : null, status: 'not_started' }).id;
        link('assignment_topics', ['assignment_id', map.a], ['topic_id', map.t]);
        for (const x of list('assignment_resources')) if (map.a[x.assignment_id] && map.r[x.resource_id]) run('INSERT OR IGNORE INTO assignment_resources (assignment_id, resource_id, role) VALUES (?,?,?)', map.a[x.assignment_id], map.r[x.resource_id], x.role === 'instructions' ? 'instructions' : 'attachment');
        for (const e of list('exams')) map.e[e.id] = insert('exams', { course_id: cid, title: str(e.title) || 'מבחן', date: e.date ? str(e.date) : null, time: e.time ? str(e.time) : null, location: str(e.location) }).id;
        link('exam_topics', ['exam_id', map.e], ['topic_id', map.t]);
        if (map.r[c.syllabus]) run('UPDATE courses SET syllabus_resource_id=? WHERE id=?', map.r[c.syllabus], cid);
        return getRow('courses', cid);
      });
      return { course };
    } finally { zip.close(); pending.delete(token); fs.rmSync(p.share, { force: true }); }
  }

  // ---- optional sample setup (synthetic, clearly labelled, removable in one click) ----
  function loadSample() {
    if (q('SELECT id FROM years WHERE sample=1 AND deleted_at IS NULL').length) throw httpErr(409, 'נתוני הדוגמה כבר טעונים');
    return tx(() => {
      const S = { sample: 1 };
      const year = insert('years', { ...S, name: 'שנת דוגמה' });
      const sem = insert('semesters', { ...S, year_id: year.id, name: 'סמסטר דוגמה', status: 'active', notes: 'נתוני דוגמה סינתטיים להתנסות. אפשר למחוק הכול בלחיצה אחת בהגדרות.' });
      const c1 = insert('courses', { ...S, semester_id: sem.id, name: 'דוגמה: מבוא לבסיסי נתונים', credits: 4, color: '#e2562f', icon: '🗄️' });
      const c2 = insert('courses', { ...S, semester_id: sem.id, name: 'דוגמה: סטטיסטיקה למתחילים', credits: 3, color: '#2f7de2', icon: '📊' });
      const t1 = insert('topics', { course_id: c1.id, name: 'ישויות וקשרים' });
      insert('topics', { course_id: c1.id, name: 'נרמול' });
      insert('topics', { course_id: c2.id, name: 'ממוצע וחציון' });
      const l1 = insert('lessons', { course_id: c1.id, date: addDaysIso(-7), title: 'שיעור 1: מה זה מודל נתונים' });
      const note = insert('resources', { title: 'פתק דוגמה: קשר אחד-לרבים', kind: 'note', role: 'summary', source: 'me', course_id: c1.id, lesson_id: l1.id,
        body: '## קשר אחד-לרבים\n\nלקוח אחד יכול לבצע **הרבה** הזמנות, אבל כל הזמנה שייכת ללקוח אחד.\n\n```sql\nSELECT c.name, COUNT(o.id) AS orders\nFROM customers c LEFT JOIN orders o ON o.customer_id = c.id\nGROUP BY c.id;\n```\n\nנוסחה לדוגמה: $\bar{x} = \frac{1}{n}\sum x_i$' });
      run('UPDATE resources SET text_content=body WHERE id=?', note.id);
      run('INSERT INTO resource_topics (resource_id, topic_id) VALUES (?,?)', note.id, t1.id);
      const a = insert('assignments', { course_id: c1.id, title: 'דוגמה: תרגיל מודל ERD', status: 'in_progress', due_date: addDaysIso(5), instructions_md: 'מטלת דוגמה. שרטטו מודל ללקוחות והזמנות.' });
      run('INSERT INTO assignment_topics (assignment_id, topic_id) VALUES (?,?)', a.id, t1.id);
      for (const [i, text] of ['לקרוא את הפתק', 'לשרטט ישויות', 'לבדוק נרמול'].entries()) insert('checklist', { owner_type: 'assignment', owner_id: a.id, text, done: i === 0 ? 1 : 0, sort: i });
      insert('exams', { course_id: c1.id, title: 'דוגמה: בוחן אמצע', date: addDaysIso(20), time: '10:00', location: 'אולם דוגמה' });
      return { ok: true, semester_id: sem.id };
    });
  }
  function removeSample() {
    const courses = q('SELECT c.id FROM courses c JOIN semesters s ON s.id=c.semester_id WHERE s.sample=1 OR c.sample=1').map(r => r.id);
    tx(() => {
      for (const cid of courses) {
        for (const t of ['resources', 'assignments', 'exams', 'applications', 'topics', 'lessons', 'folders', 'summary_chapters', 'summary_folders', 'tasks']) if (cols[t]?.includes('course_id')) for (const r of q(`SELECT id FROM ${t} WHERE course_id=?`, cid)) hardDelete(t, r.id);
        hardDelete('courses', cid);
      }
      for (const t of ['projects', 'semesters', 'years']) for (const r of q(`SELECT id FROM ${t} WHERE sample=1`)) hardDelete(t, r.id);
    });
    gcBlobs();
    return { ok: true, removed_courses: courses.length };
  }
  const addDaysIso = n => { const d = new Date(Date.now() + n * 864e5); return d.toLocaleString('sv-SE', { timeZone: 'Asia/Jerusalem' }).slice(0, 10); };

  const routes = [
    ['GET', /^\/api\/health$/, () => ({ app: 'ijos', version: APP_VERSION, schema: SCHEMA_VERSION })],
    ['GET', /^\/api\/state$/, () => state()],
    ['POST', /^\/api\/sample$/, () => loadSample()],
    ['DELETE', /^\/api\/sample$/, () => removeSample()],
    ['GET', /^\/api\/rows\/(\w+)\/(\d+)$/, (m) => { if (!userTable(m[1])) throw httpErr(404, 'unknown'); return getRow(m[1], +m[2]) || (() => { throw httpErr(404, 'not found'); })(); }],
    ['POST', /^\/api\/rows\/(\w+)$/, (m, b) => { if (!userTable(m[1])) throw httpErr(404, 'unknown'); return insert(m[1], fileSafe(b)); }],
    ['PATCH', /^\/api\/rows\/(\w+)\/(\d+)$/, (m, b) => { if (!userTable(m[1])) throw httpErr(404, 'unknown'); if (['folders', 'summary_folders'].includes(m[1]) && b?.parent_id != null) { for (let p = Number(b.parent_id), n = 0; p; p = getRow(m[1], p)?.parent_id, n++) if (p === +m[2] || n > 100) throw httpErr(400, 'אי אפשר להעביר תיקייה לתוך עצמה'); } return update(m[1], +m[2], fileSafe(b)); }],
    ['DELETE', /^\/api\/rows\/(\w+)\/(\d+)$/, (m, b, p) => {
      const [t, id] = [m[1], +m[2]];
      if (!userTable(t)) throw httpErr(404, 'unknown');
      if (cols[t].includes('deleted_at') && p.get('hard') !== '1') return update(t, id, { deleted_at: now() });
      hardDelete(t, id); return { ok: true };
    }],
    ['POST', /^\/api\/rows\/(\w+)\/(\d+)\/restore$/, (m) => { if (!userTable(m[1])) throw httpErr(404, 'unknown'); return update(m[1], +m[2], { deleted_at: null }); }],
    ['POST', /^\/api\/join\/(\w+)$/, (m, b) => {
      if (!JOINS.includes(m[1])) throw httpErr(404, 'unknown');
      const keys = Object.keys(b).filter(k => cols[m[1]].includes(k));
      run(`INSERT OR REPLACE INTO ${m[1]} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map(k => b[k]));
      return { ok: true };
    }],
    ['DELETE', /^\/api\/join\/(\w+)$/, (m, b) => {
      if (!JOINS.includes(m[1])) throw httpErr(404, 'unknown');
      const keys = Object.keys(b).filter(k => cols[m[1]].includes(k) && k !== 'role');
      if (!keys.length) throw httpErr(400, 'no keys');
      run(`DELETE FROM ${m[1]} WHERE ${keys.map(k => k + '=?').join(' AND ')}`, ...keys.map(k => b[k]));
      return { ok: true };
    }],
    ['PUT', /^\/api\/settings\/([\w.-]+)$/, (m, b) => { run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', m[1], String(b.value ?? '')); return { ok: true }; }],
    ['GET', /^\/api\/preview\/(\d+)$/, (m) => { const { file, name } = fileFor(+m[1]); const ex = extract(file, name, () => fs.readFileSync(file)); return { ...ex.preview, status: ex.status, deps: ['html', 'htm'].includes(extOf(name)) ? externalDeps(fs.readFileSync(file, 'utf8')) : [] }; }],
    ['POST', /^\/api\/open\/(\d+)$/, (m) => openExternal(+m[1])],
    ['GET', /^\/api\/search$/, (m, b, p) => search(p.get('q') || '')],
    ['GET', /^\/api\/versions\/(\d+)$/, (m) => q('SELECT * FROM resource_versions WHERE resource_id=? ORDER BY id DESC', +m[1])],
    ['POST', /^\/api\/versions\/(\d+)\/restore$/, (m) => {
      const v = getRow('resource_versions', +m[1]); if (!v) throw httpErr(404, 'not found');
      const r = getRow('resources', v.resource_id);
      return tx(() => {
        run('INSERT INTO resource_versions (resource_id, blob_sha, original_name, body, label, created_at) VALUES (?,?,?,?,?,?)', r.id, v.blob_sha ? r.blob_sha : null, v.blob_sha ? r.original_name : null, v.body != null ? r.body : null, 'לפני שחזור', now());
        if (v.blob_sha) { const f = blobPath(v.blob_sha); const ex = fs.existsSync(f) ? extract(f, v.original_name, () => fs.readFileSync(f)) : { text: null, status: 'failed' }; run('UPDATE resources SET blob_sha=?, original_name=?, mime=?, kind=?, text_content=?, text_status=?, updated_at=? WHERE id=?', v.blob_sha, v.original_name, mimeOf(v.original_name), kindOf(v.original_name), ex.text, ex.status, now(), r.id); }
        if (v.body != null) run('UPDATE resources SET body=?, text_content=?, updated_at=? WHERE id=?', v.body, v.body, now(), r.id);
        return getRow('resources', r.id);
      });
    }],
    ['POST', /^\/api\/backup$/, () => backup()],
    ['GET', /^\/api\/backups$/, () => fs.readdirSync(dirs.backups).filter(f => /\.(zip|db)$/.test(f)).map(f => ({ name: f, size: fs.statSync(path.join(dirs.backups, f)).size })).sort((a, b) => b.name.localeCompare(a.name))
      .concat(fs.readdirSync(dirs.auto).filter(f => f.endsWith('.db')).sort().reverse().map(f => ({ name: 'auto/' + f, size: fs.statSync(path.join(dirs.auto, f)).size })))],
    ['POST', /^\/api\/restore\/inspect$/, null, restoreInspect],
    ['POST', /^\/api\/restore\/apply$/, (m, b) => restoreApply(b.token)],
    ['GET', /^\/api\/integrity$/, () => integrity()],
    ['POST', /^\/api\/trash\/empty$/, () => { emptyTrash(); return { ok: true }; }],
    ['POST', /^\/api\/upload$/, null, upload],
    ['POST', /^\/api\/share\/inspect$/, null, shareInspect],
    ['POST', /^\/api\/share\/apply$/, (m, b) => shareApply(b.token, Number(b.semester_id), b.name)],
  ];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.searchParams;
    try {
      // DNS-rebinding + cross-site protection: local host only; mutations need a custom header (forces CORS preflight, which we never grant).
      const host = req.headers.host || '';
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return send(res, 403, { error: 'forbidden host' });
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        if (req.headers['x-ijos'] !== '1') return send(res, 403, { error: 'missing header' });
        const origin = req.headers.origin;
        if (origin && origin !== `http://${host}`) return send(res, 403, { error: 'bad origin' });
      }
      // Browsers label every request with Sec-Fetch-Site. Only the app itself (same-origin) or a typed URL / bookmark (none) may read data or files.
      const site = req.headers['sec-fetch-site'];
      if (site && !['same-origin', 'none'].includes(site) && /^\/(api|files)\//.test(url.pathname)) return send(res, 403, { error: 'cross-site request blocked' });
      let m;
      if ((req.method === 'GET' || req.method === 'HEAD') && (m = /^\/files\/(\d+)$/.exec(url.pathname))) return serveFile(res, +m[1], p);
      if (req.method === 'GET' && (m = /^\/api\/download\/(resource|brief|notes|backup|share)(?:\/(.+))?$/.exec(url.pathname))) return download(res, m[1], m[2], p);
      for (const [method, re, fn, raw] of routes) {
        if (req.method !== method || !(m = re.exec(url.pathname))) continue;
        if (raw) return send(res, 200, await raw(req, p));
        const body = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) ? await readJson(req) : {};
        return send(res, 200, fn(m, body, p));
      }
      if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
      return serveStatic(res, url.pathname);
    } catch (e) {
      if (!e.status) console.error(e);
      if (!res.headersSent) send(res, e.status || 500, { error: e.message, ...(e.extra || {}) });
      else res.end();
    }
  });

  function download(res, kind, arg, p) {
    let name, data, file;
    if (kind === 'resource') { const r = getRow('resources', +arg); name = `${mdName(r.title)}.md`; data = `# ${r.title}\n\n${r.body || ''}`; }
    else if (kind === 'brief') { const a = getRow('applications', +arg); name = `implementation-brief-${mdName(a.title)}.md`; data = briefMd(a); }
    else if (kind === 'notes') { file = exportAllMd(); name = path.basename(file); }
    else if (kind === 'share') ({ file, name } = shareExport(+arg, { notes: p.get('notes') === '1', mine: p.get('mine') === '1', deadlines: p.get('deadlines') === '1' }));
    else if (kind === 'backup') { const n = decodeURIComponent(arg || ''); file = n.startsWith('auto/') ? path.join(dirs.auto, path.basename(n)) : path.join(dirs.backups, path.basename(n)); name = path.basename(file); if (!fs.existsSync(file)) throw httpErr(404, 'not found'); }
    const headers = { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'Cache-Control': 'no-store' };
    if (file) { res.writeHead(200, { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': fs.statSync(file).size }); const s = fs.createReadStream(file); s.pipe(res); if (kind === 'notes' || kind === 'share') s.on('close', () => fs.rmSync(file, { force: true })); }
    else { res.writeHead(200, { ...headers, 'Content-Type': 'text/markdown; charset=utf-8' }); res.end(data); }
  }

  function serveStatic(res, pathname) {
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    const file = path.resolve(PUBLIC, rel);
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': STATIC_MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
      ...(file.endsWith('index.html') ? { 'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; frame-src 'self'; object-src 'self'; connect-src 'self'" } : {}) });
    fs.createReadStream(file).pipe(res);
  }

  autoSnapshot();
  const timer = setInterval(() => { try { autoSnapshot(); } catch (e) { console.error('auto snapshot failed', e.message); } }, 6 * 3600 * 1000);
  server.on('close', () => { clearInterval(timer); try { db.close(); } catch { /* already closed */ } });
  return { server, get db() { return db; } };
}

function httpErr(status, message, extra) { const e = new Error(message); e.status = status; e.extra = extra; return e; }
function send(res, status, obj) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj ?? null)); }
function readJson(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.setEncoding('utf8');
    req.on('data', c => { s += c; if (s.length > 50e6) reject(httpErr(413, 'too large')); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(httpErr(400, 'bad json')); } });
    req.on('error', reject);
  });
}

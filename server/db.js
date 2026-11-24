// SQLite storage (built into Node 22.13+/24 as node:sqlite). One file: <data folder>/study.db
import { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 2;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS years (id INTEGER PRIMARY KEY, name TEXT NOT NULL, sort INTEGER DEFAULT 0, archived INTEGER DEFAULT 0, deleted_at TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS semesters (id INTEGER PRIMARY KEY, year_id INTEGER NOT NULL, name TEXT NOT NULL, status TEXT DEFAULT 'planned', notes TEXT DEFAULT '', sort INTEGER DEFAULT 0, deleted_at TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS courses (id INTEGER PRIMARY KEY, semester_id INTEGER NOT NULL, name TEXT NOT NULL, code TEXT DEFAULT '', credits REAL, counts_credits INTEGER DEFAULT 1, optional INTEGER DEFAULT 0,
  lecturer TEXT DEFAULT '', lecturer_contact TEXT DEFAULT '', office_hours TEXT DEFAULT '', grading TEXT DEFAULT '[]', info_md TEXT DEFAULT '', syllabus_resource_id INTEGER,
  sort INTEGER DEFAULT 0, archived INTEGER DEFAULT 0, deleted_at TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS folders (id INTEGER PRIMARY KEY, course_id INTEGER NOT NULL, parent_id INTEGER, name TEXT NOT NULL, sort INTEGER DEFAULT 0, archived INTEGER DEFAULT 0, deleted_at TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS topics (id INTEGER PRIMARY KEY, course_id INTEGER NOT NULL, name TEXT NOT NULL, description TEXT DEFAULT '', sort INTEGER DEFAULT 0, archived INTEGER DEFAULT 0, deleted_at TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS lessons (id INTEGER PRIMARY KEY, course_id INTEGER NOT NULL, title TEXT DEFAULT '', date TEXT, kind TEXT DEFAULT 'lecture', notes_md TEXT DEFAULT '', catch_up INTEGER DEFAULT 0, sort INTEGER DEFAULT 0, deleted_at TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS blobs (sha TEXT PRIMARY KEY, size INTEGER, created_at TEXT);
CREATE TABLE IF NOT EXISTS resources (id INTEGER PRIMARY KEY, course_id INTEGER, folder_id INTEGER, lesson_id INTEGER, title TEXT NOT NULL, kind TEXT NOT NULL, role TEXT DEFAULT 'material',
  source TEXT DEFAULT 'other', url TEXT, blob_sha TEXT, original_name TEXT, mime TEXT, body TEXT, tags TEXT DEFAULT '[]', notes TEXT DEFAULT '',
  text_content TEXT, text_status TEXT DEFAULT 'none', html_scripts INTEGER DEFAULT 1, html_external INTEGER DEFAULT 0, catch_up INTEGER DEFAULT 0, sort INTEGER DEFAULT 0,
  deleted_at TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS resource_versions (id INTEGER PRIMARY KEY, resource_id INTEGER NOT NULL, blob_sha TEXT, original_name TEXT, body TEXT, label TEXT DEFAULT '', created_at TEXT);
CREATE TABLE IF NOT EXISTS resource_topics (resource_id INTEGER NOT NULL, topic_id INTEGER NOT NULL, PRIMARY KEY (resource_id, topic_id));
CREATE TABLE IF NOT EXISTS resource_relations (resource_id INTEGER NOT NULL, related_id INTEGER NOT NULL, PRIMARY KEY (resource_id, related_id));
CREATE TABLE IF NOT EXISTS flags (id INTEGER PRIMARY KEY, resource_id INTEGER, course_id INTEGER, text TEXT NOT NULL, location TEXT DEFAULT '', status TEXT DEFAULT 'open', task_id INTEGER, deleted_at TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, course_id INTEGER, title TEXT NOT NULL, notes TEXT DEFAULT '', due_date TEXT, due_time TEXT, planned_date TEXT, planned_time TEXT,
  done INTEGER DEFAULT 0, done_at TEXT, origin TEXT DEFAULT 'manual', ref_type TEXT, ref_id INTEGER, deleted_at TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS assignments (id INTEGER PRIMARY KEY, course_id INTEGER, title TEXT NOT NULL, status TEXT DEFAULT 'not_started', instructions_md TEXT DEFAULT '',
  due_date TEXT, due_time TEXT, planned_date TEXT, planned_time TEXT, next_action TEXT DEFAULT '', notes_md TEXT DEFAULT '', draft_md TEXT DEFAULT '',
  grade TEXT DEFAULT '', feedback_md TEXT DEFAULT '', submitted_at TEXT, confirmation TEXT DEFAULT '', deleted_at TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS assignment_topics (assignment_id INTEGER NOT NULL, topic_id INTEGER NOT NULL, PRIMARY KEY (assignment_id, topic_id));
CREATE TABLE IF NOT EXISTS assignment_resources (assignment_id INTEGER NOT NULL, resource_id INTEGER NOT NULL, role TEXT DEFAULT 'attachment', PRIMARY KEY (assignment_id, resource_id));
CREATE TABLE IF NOT EXISTS checklist (id INTEGER PRIMARY KEY, owner_type TEXT NOT NULL, owner_id INTEGER NOT NULL, text TEXT NOT NULL, done INTEGER DEFAULT 0, sort INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS exams (id INTEGER PRIMARY KEY, course_id INTEGER, title TEXT NOT NULL, date TEXT, time TEXT, location TEXT DEFAULT '', notes_md TEXT DEFAULT '', grade TEXT DEFAULT '', deleted_at TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS exam_topics (exam_id INTEGER NOT NULL, topic_id INTEGER NOT NULL, PRIMARY KEY (exam_id, topic_id));
CREATE TABLE IF NOT EXISTS exam_resources (exam_id INTEGER NOT NULL, resource_id INTEGER NOT NULL, PRIMARY KEY (exam_id, resource_id));
CREATE TABLE IF NOT EXISTS reminders (id INTEGER PRIMARY KEY, target_type TEXT NOT NULL, target_id INTEGER NOT NULL, remind_at TEXT NOT NULL, offset_minutes INTEGER, label TEXT DEFAULT '', status TEXT DEFAULT 'pending', created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS today (id INTEGER PRIMARY KEY, date TEXT NOT NULL, text TEXT NOT NULL, ref_type TEXT, ref_id INTEGER, done INTEGER DEFAULT 0, sort INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS summary_chapters (id INTEGER PRIMARY KEY, course_id INTEGER NOT NULL, topic_id INTEGER, title TEXT NOT NULL, body_md TEXT DEFAULT '', sort INTEGER DEFAULT 0, deleted_at TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS summary_sources (chapter_id INTEGER NOT NULL, resource_id INTEGER NOT NULL, PRIMARY KEY (chapter_id, resource_id));
CREATE TABLE IF NOT EXISTS summary_versions (id INTEGER PRIMARY KEY, course_id INTEGER NOT NULL, snapshot TEXT NOT NULL, reason TEXT DEFAULT '', created_at TEXT);
CREATE TABLE IF NOT EXISTS proposals (id INTEGER PRIMARY KEY, course_id INTEGER NOT NULL, body_md TEXT NOT NULL, origin TEXT DEFAULT 'other', source_ids TEXT DEFAULT '[]', status TEXT DEFAULT 'open', created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS applications (id INTEGER PRIMARY KEY, course_id INTEGER, topic_id INTEGER, resource_id INTEGER, title TEXT NOT NULL, learned TEXT DEFAULT '', target TEXT DEFAULT 'both', target_other TEXT DEFAULT '',
  problem TEXT DEFAULT '', proposal TEXT DEFAULT '', benefit TEXT DEFAULT '', questions TEXT DEFAULT '', acceptance TEXT DEFAULT '', next_action TEXT DEFAULT '', status TEXT DEFAULT 'idea',
  deleted_at TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, last_opened_at TEXT, position TEXT DEFAULT '', scroll REAL, next_step TEXT DEFAULT '', done INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT, UNIQUE(entity_type, entity_id));
CREATE INDEX IF NOT EXISTS idx_res_course ON resources(course_id);
CREATE INDEX IF NOT EXISTS idx_res_blob ON resources(blob_sha);
`;

export const now = () => new Date().toISOString();

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=OFF; PRAGMA busy_timeout=3000;');
  const v = db.prepare('PRAGMA user_version').get().user_version;
  if (v > SCHEMA_VERSION) { db.close(); throw new Error(`Database schema ${v} is newer than this app (${SCHEMA_VERSION})`); }
  db.exec(SCHEMA);
  if (v < 2) migrateTo2(db, v === 0);
  return db;
}

const hasCol = (db, t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some(x => x.name === c);
const addCol = (db, t, def) => { if (!hasCol(db, t, def.split(' ')[0])) db.exec(`ALTER TABLE ${t} ADD COLUMN ${def}`); };

// v2: configurable projects (instead of fixed targets), course identity, sample-data flags. A fresh database starts empty (onboarding).
function migrateTo2(db, fresh) {
  db.exec('BEGIN');
  try {
    for (const t of ['years', 'semesters', 'courses']) addCol(db, t, 'sample INTEGER DEFAULT 0');
    addCol(db, 'courses', "color TEXT DEFAULT ''");
    addCol(db, 'courses', "icon TEXT DEFAULT ''");
    db.exec(`CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', color TEXT DEFAULT '', archived INTEGER DEFAULT 0, sample INTEGER DEFAULT 0, sort INTEGER DEFAULT 0, deleted_at TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE IF NOT EXISTS application_projects (application_id INTEGER NOT NULL, project_id INTEGER NOT NULL, PRIMARY KEY (application_id, project_id));`);
    if (!fresh) {
      // v1 stored a fixed target per application ('resego' | 'tori' | 'both' | 'other'). Turn the ones in use into editable projects.
      const t = now();
      const ids = {};
      const project = name => ids[name] ??= Number(db.prepare('INSERT INTO projects (name, sort, created_at, updated_at) VALUES (?,?,?,?)').run(name, Object.keys(ids).length + 1, t, t).lastInsertRowid);
      const link = db.prepare('INSERT OR IGNORE INTO application_projects (application_id, project_id) VALUES (?,?)');
      for (const a of db.prepare('SELECT id, target, target_other FROM applications').all()) {
        const names = a.target === 'resego' ? ['ReSeGo'] : a.target === 'tori' ? ['Tori'] : a.target === 'both' ? ['ReSeGo', 'Tori'] : [a.target_other?.trim() || 'פרויקט אחר'];
        for (const n of names) link.run(a.id, project(n));
      }
      db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('onboarded', '1')").run();
    }
    db.exec('PRAGMA user_version=2');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Column whitelist per table, read from the live schema (guards dynamic SQL).
export function tableColumns(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  const out = {};
  for (const t of tables) out[t] = db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
  return out;
}

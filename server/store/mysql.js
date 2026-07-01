// MySQL storage adapter (production / Hostinger VPS). Implements the same async
// interface as the JSON adapter. Credentials come from env (server/.env) — never hard-coded.
import mysql from 'mysql2/promise';

const J = (v) => JSON.stringify(v ?? null);

// row mappers: DB snake_case <-> app camelCase
const toQuestion = (r) => ({ id: r.id, question: r.question, options: r.options, answerIndex: r.answer_index, topic: r.topic, difficulty: r.difficulty, explanation: r.explanation, domain: r.domain || '', norm: r.norm });
const toStudent = (r) => ({ id: r.id, registrationNumber: r.registration_number, name: r.name, branch: r.branch, section: r.section, domain: r.domain || '', active: r.active === undefined ? true : !!r.active, createdAt: r.created_at });
const toAttempt = (r) => ({ id: r.id, studentId: r.student_id, questionIds: r.question_ids, answers: r.answers, score: r.score, total: r.total, status: r.status, reason: r.reason, violations: r.violations ?? 0, startedAt: r.started_at, submittedAt: r.submitted_at });

export async function makeMysqlDb() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 25,
    queueLimit: 0,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  const q = async (sql, params) => (await pool.query(sql, params))[0];

  async function init() {
    await q(`CREATE TABLE IF NOT EXISTS questions (
      id VARCHAR(64) PRIMARY KEY, question TEXT NOT NULL, options JSON NOT NULL,
      answer_index INT NOT NULL, topic VARCHAR(190), difficulty VARCHAR(16),
      explanation TEXT, domain VARCHAR(64) DEFAULT '', norm VARCHAR(512), UNIQUE KEY uq_norm (norm),
      INDEX ix_domain (domain)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    try { await q("ALTER TABLE questions ADD COLUMN domain VARCHAR(64) DEFAULT ''"); }
    catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }
    await q(`CREATE TABLE IF NOT EXISTS students (
      id VARCHAR(64) PRIMARY KEY, registration_number VARCHAR(64) NOT NULL,
      name VARCHAR(190) NOT NULL, branch VARCHAR(64), section VARCHAR(64), domain VARCHAR(64) DEFAULT '',
      active TINYINT NOT NULL DEFAULT 1,
      created_at VARCHAR(32), UNIQUE KEY uq_reg (registration_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    // migrate older tables that predate these columns
    try { await q('ALTER TABLE students ADD COLUMN active TINYINT NOT NULL DEFAULT 1'); }
    catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }
    try { await q("ALTER TABLE students ADD COLUMN domain VARCHAR(64) DEFAULT ''"); }
    catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }
    await q(`CREATE TABLE IF NOT EXISTS attempts (
      id VARCHAR(64) PRIMARY KEY, student_id VARCHAR(64) NOT NULL,
      question_ids JSON NOT NULL, answers JSON NOT NULL, score INT NULL, total INT NOT NULL,
      status VARCHAR(16) NOT NULL, reason VARCHAR(64), violations INT NOT NULL DEFAULT 0,
      started_at VARCHAR(32), submitted_at VARCHAR(32) NULL,
      INDEX ix_student (student_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    try { await q('ALTER TABLE attempts ADD COLUMN violations INT NOT NULL DEFAULT 0'); }
    catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }
    await q(`CREATE TABLE IF NOT EXISTS settings (
      k VARCHAR(64) PRIMARY KEY, v JSON
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  }

  const COL = { answers: 'answers', score: 'score', status: 'status', submittedAt: 'submitted_at', reason: 'reason', violations: 'violations' };

  return {
    driver: 'mysql',
    init,
    pool,

    questions: {
      all: async () => (await q('SELECT * FROM questions')).map(toQuestion),
      count: async () => (await q('SELECT COUNT(*) n FROM questions'))[0].n,
      addMany: async (items) => {
        if (!items.length) return (await q('SELECT COUNT(*) n FROM questions'))[0].n;
        const rows = items.map((i) => [i.id, i.question, J(i.options), i.answerIndex, i.topic, i.difficulty, i.explanation, i.domain || '', i.norm]);
        await q('INSERT IGNORE INTO questions (id, question, options, answer_index, topic, difficulty, explanation, domain, norm) VALUES ?', [rows]);
        return (await q('SELECT COUNT(*) n FROM questions'))[0].n;
      },
      clear: async () => { await q('DELETE FROM questions'); },
      clearDomain: async (domain) => {
        // match on normalized domain (so "Java Core" == "JavaCore")
        const all = await q('SELECT id, domain FROM questions');
        const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const ids = all.filter((r) => norm(r.domain) === norm(domain)).map((r) => r.id);
        if (ids.length) await q('DELETE FROM questions WHERE id IN (?)', [ids]);
        return ids.length;
      },
      normSet: async () => new Set((await q('SELECT norm FROM questions')).map((r) => r.norm)),
      assignDomain: async (domain, onlyUntagged = true) => {
        const r = onlyUntagged
          ? await q("UPDATE questions SET domain=? WHERE domain='' OR domain IS NULL", [domain])
          : await q('UPDATE questions SET domain=?', [domain]);
        return r.affectedRows || 0;
      },
    },

    students: {
      all: async () => (await q('SELECT * FROM students ORDER BY created_at')).map(toStudent),
      count: async () => (await q('SELECT COUNT(*) n FROM students'))[0].n,
      get: async (id) => { const r = await q('SELECT * FROM students WHERE id=?', [id]); return r[0] ? toStudent(r[0]) : null; },
      byRegNo: async (rn) => { const r = await q('SELECT * FROM students WHERE registration_number=?', [rn]); return r[0] ? toStudent(r[0]) : null; },
      add: async (s) => { await q('INSERT INTO students (id, registration_number, name, branch, section, domain, active, created_at) VALUES (?,?,?,?,?,?,1,?)', [s.id, s.registrationNumber, s.name, s.branch, s.section, s.domain || '', s.createdAt]); return s; },
      update: async (id, patch) => {
        const map = { name: 'name', branch: 'branch', section: 'section', domain: 'domain', active: 'active' };
        const sets = [], vals = [];
        for (const [k, v] of Object.entries(patch)) { if (!map[k]) continue; sets.push(`${map[k]}=?`); vals.push(k === 'active' ? (v ? 1 : 0) : v); }
        if (sets.length) { vals.push(id); await q(`UPDATE students SET ${sets.join(', ')} WHERE id=?`, vals); }
        const r = await q('SELECT * FROM students WHERE id=?', [id]);
        return r[0] ? toStudent(r[0]) : null;
      },
      importMany: async (rows) => {
        if (!rows.length) return { added: 0, updated: 0, total: (await q('SELECT COUNT(*) n FROM students'))[0].n };
        const regs = rows.map((r) => r.registrationNumber);
        const existing = new Set((await q('SELECT registration_number FROM students WHERE registration_number IN (?)', [regs])).map((r) => r.registration_number));
        const values = rows.map((r) => [r.id, r.registrationNumber, r.name, r.branch, r.section, r.domain || '', 1, r.createdAt]);
        await q(`INSERT INTO students (id, registration_number, name, branch, section, domain, active, created_at) VALUES ?
                 ON DUPLICATE KEY UPDATE name=VALUES(name), branch=VALUES(branch), section=VALUES(section), domain=VALUES(domain)`, [values]);
        const added = rows.filter((r) => !existing.has(r.registrationNumber)).length;
        return { added, updated: rows.length - added, total: (await q('SELECT COUNT(*) n FROM students'))[0].n };
      },
    },

    attempts: {
      all: async () => (await q('SELECT * FROM attempts')).map(toAttempt),
      get: async (id) => { const r = await q('SELECT * FROM attempts WHERE id=?', [id]); return r[0] ? toAttempt(r[0]) : null; },
      add: async (a) => {
        await q('INSERT INTO attempts (id, student_id, question_ids, answers, score, total, status, reason, violations, started_at, submitted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          [a.id, a.studentId, J(a.questionIds), J(a.answers), a.score, a.total, a.status, a.reason, a.violations || 0, a.startedAt, a.submittedAt]);
        return a;
      },
      update: async (id, patch) => {
        const sets = [], vals = [];
        for (const [k, v] of Object.entries(patch)) {
          if (!COL[k]) continue;
          sets.push(`${COL[k]}=?`);
          vals.push(k === 'answers' ? J(v) : v);
        }
        if (sets.length) { vals.push(id); await q(`UPDATE attempts SET ${sets.join(', ')} WHERE id=?`, vals); }
        const r = await q('SELECT * FROM attempts WHERE id=?', [id]);
        return r[0] ? toAttempt(r[0]) : null;
      },
      remove: async (id) => { await q('DELETE FROM attempts WHERE id=?', [id]); },
      clearAll: async () => { await q('DELETE FROM attempts'); },
      byStudent: async (studentId) => (await q('SELECT * FROM attempts WHERE student_id=?', [studentId])).map(toAttempt),
    },

    settings: {
      get: async (key) => { const r = await q('SELECT v FROM settings WHERE k=?', [key]); return r[0] ? r[0].v : null; },
      set: async (key, val) => { await q('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v=VALUES(v)', [key, J(val)]); return val; },
    },
  };
}

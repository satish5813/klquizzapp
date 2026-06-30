// MySQL storage adapter (production / Hostinger VPS). Implements the same async
// interface as the JSON adapter. Credentials come from env (server/.env) — never hard-coded.
import mysql from 'mysql2/promise';

const J = (v) => JSON.stringify(v ?? null);

// row mappers: DB snake_case <-> app camelCase
const toQuestion = (r) => ({ id: r.id, question: r.question, options: r.options, answerIndex: r.answer_index, topic: r.topic, difficulty: r.difficulty, explanation: r.explanation, norm: r.norm });
const toStudent = (r) => ({ id: r.id, registrationNumber: r.registration_number, name: r.name, branch: r.branch, section: r.section, createdAt: r.created_at });
const toAttempt = (r) => ({ id: r.id, studentId: r.student_id, questionIds: r.question_ids, answers: r.answers, score: r.score, total: r.total, status: r.status, reason: r.reason, startedAt: r.started_at, submittedAt: r.submitted_at });

export async function makeMysqlDb() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  const q = async (sql, params) => (await pool.query(sql, params))[0];

  async function init() {
    await q(`CREATE TABLE IF NOT EXISTS questions (
      id VARCHAR(64) PRIMARY KEY, question TEXT NOT NULL, options JSON NOT NULL,
      answer_index INT NOT NULL, topic VARCHAR(190), difficulty VARCHAR(16),
      explanation TEXT, norm VARCHAR(512), UNIQUE KEY uq_norm (norm)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await q(`CREATE TABLE IF NOT EXISTS students (
      id VARCHAR(64) PRIMARY KEY, registration_number VARCHAR(64) NOT NULL,
      name VARCHAR(190) NOT NULL, branch VARCHAR(64), section VARCHAR(64),
      created_at VARCHAR(32), UNIQUE KEY uq_reg (registration_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await q(`CREATE TABLE IF NOT EXISTS attempts (
      id VARCHAR(64) PRIMARY KEY, student_id VARCHAR(64) NOT NULL,
      question_ids JSON NOT NULL, answers JSON NOT NULL, score INT NULL, total INT NOT NULL,
      status VARCHAR(16) NOT NULL, reason VARCHAR(64), started_at VARCHAR(32), submitted_at VARCHAR(32) NULL,
      INDEX ix_student (student_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await q(`CREATE TABLE IF NOT EXISTS settings (
      k VARCHAR(64) PRIMARY KEY, v JSON
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  }

  const COL = { answers: 'answers', score: 'score', status: 'status', submittedAt: 'submitted_at', reason: 'reason' };

  return {
    driver: 'mysql',
    init,
    pool,

    questions: {
      all: async () => (await q('SELECT * FROM questions')).map(toQuestion),
      count: async () => (await q('SELECT COUNT(*) n FROM questions'))[0].n,
      addMany: async (items) => {
        if (!items.length) return (await q('SELECT COUNT(*) n FROM questions'))[0].n;
        const rows = items.map((i) => [i.id, i.question, J(i.options), i.answerIndex, i.topic, i.difficulty, i.explanation, i.norm]);
        await q('INSERT IGNORE INTO questions (id, question, options, answer_index, topic, difficulty, explanation, norm) VALUES ?', [rows]);
        return (await q('SELECT COUNT(*) n FROM questions'))[0].n;
      },
      clear: async () => { await q('DELETE FROM questions'); },
      normSet: async () => new Set((await q('SELECT norm FROM questions')).map((r) => r.norm)),
    },

    students: {
      all: async () => (await q('SELECT * FROM students ORDER BY created_at')).map(toStudent),
      count: async () => (await q('SELECT COUNT(*) n FROM students'))[0].n,
      get: async (id) => { const r = await q('SELECT * FROM students WHERE id=?', [id]); return r[0] ? toStudent(r[0]) : null; },
      byRegNo: async (rn) => { const r = await q('SELECT * FROM students WHERE registration_number=?', [rn]); return r[0] ? toStudent(r[0]) : null; },
      add: async (s) => { await q('INSERT INTO students (id, registration_number, name, branch, section, created_at) VALUES (?,?,?,?,?,?)', [s.id, s.registrationNumber, s.name, s.branch, s.section, s.createdAt]); return s; },
      importMany: async (rows) => {
        if (!rows.length) return { added: 0, updated: 0, total: await (async () => (await q('SELECT COUNT(*) n FROM students'))[0].n)() };
        const regs = rows.map((r) => r.registrationNumber);
        const existing = new Set((await q('SELECT registration_number FROM students WHERE registration_number IN (?)', [regs])).map((r) => r.registration_number));
        const values = rows.map((r) => [r.id, r.registrationNumber, r.name, r.branch, r.section, r.createdAt]);
        await q(`INSERT INTO students (id, registration_number, name, branch, section, created_at) VALUES ?
                 ON DUPLICATE KEY UPDATE name=VALUES(name), branch=VALUES(branch), section=VALUES(section)`, [values]);
        const added = rows.filter((r) => !existing.has(r.registrationNumber)).length;
        return { added, updated: rows.length - added, total: (await q('SELECT COUNT(*) n FROM students'))[0].n };
      },
    },

    attempts: {
      all: async () => (await q('SELECT * FROM attempts')).map(toAttempt),
      get: async (id) => { const r = await q('SELECT * FROM attempts WHERE id=?', [id]); return r[0] ? toAttempt(r[0]) : null; },
      add: async (a) => {
        await q('INSERT INTO attempts (id, student_id, question_ids, answers, score, total, status, reason, started_at, submitted_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [a.id, a.studentId, J(a.questionIds), J(a.answers), a.score, a.total, a.status, a.reason, a.startedAt, a.submittedAt]);
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
      byStudent: async (studentId) => (await q('SELECT * FROM attempts WHERE student_id=?', [studentId])).map(toAttempt),
    },

    settings: {
      get: async (key) => { const r = await q('SELECT v FROM settings WHERE k=?', [key]); return r[0] ? r[0].v : null; },
      set: async (key, val) => { await q('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v=VALUES(v)', [key, J(val)]); return val; },
    },
  };
}

// MySQL storage adapter (production / Hostinger VPS). Implements the same async
// interface as the JSON adapter. Credentials come from env (server/.env) — never hard-coded.
import mysql from 'mysql2/promise';

const J = (v) => JSON.stringify(v ?? null);

// row mappers: DB snake_case <-> app camelCase
const toQuestion = (r) => ({ id: r.id, question: r.question, options: r.options, answerIndex: r.answer_index, topic: r.topic, difficulty: r.difficulty, explanation: r.explanation, domain: r.domain || '', norm: r.norm });
const toStudent = (r) => ({ id: r.id, registrationNumber: r.registration_number, name: r.name, branch: r.branch, section: r.section, domain: r.domain || '', empId: r.emp_id || '', room: r.room || '', facultyName: r.faculty_name || '', active: r.active === undefined ? true : !!r.active, createdAt: r.created_at });
const toAttempt = (r) => ({ id: r.id, studentId: r.student_id, questionIds: r.question_ids, answers: r.answers, score: r.score, total: r.total, status: r.status, reason: r.reason, violations: r.violations ?? 0, autoSubmitted: !!r.auto_submitted, durationMin: r.duration_min || null, ip: r.ip || '', sessionId: r.session_id || '', lastSeen: r.last_seen || null, startedAt: r.started_at, submittedAt: r.submitted_at });

export async function makeMysqlDb() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    // Per-worker pool. With the cluster (3 workers) the total is DB_POOL * workers,
    // so keep DB_POOL * workers safely under MySQL's max_connections (default 151).
    // Default 20 → ~60 total across 3 workers. Raise DB_POOL (and MySQL
    // max_connections) if a load test shows connection queueing.
    connectionLimit: Number(process.env.DB_POOL || 20),
    queueLimit: 0,
    enableKeepAlive: true,
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
    for (const alter of [
      "ALTER TABLE students ADD COLUMN emp_id VARCHAR(32) DEFAULT ''",       // invigilating faculty
      "ALTER TABLE students ADD COLUMN room VARCHAR(32) DEFAULT ''",         // exam room
      "ALTER TABLE students ADD COLUMN faculty_name VARCHAR(190) DEFAULT ''",
    ]) { try { await q(alter); } catch (e) { if (!/duplicate column/i.test(e.message)) throw e; } }
    try { await q('ALTER TABLE students ADD INDEX ix_emp (emp_id)'); } catch (e) { if (!/duplicate key name/i.test(e.message)) throw e; }
    await q(`CREATE TABLE IF NOT EXISTS attempts (
      id VARCHAR(64) PRIMARY KEY, student_id VARCHAR(64) NOT NULL,
      question_ids JSON NOT NULL, answers JSON NOT NULL, score INT NULL, total INT NOT NULL,
      status VARCHAR(16) NOT NULL, reason VARCHAR(64), violations INT NOT NULL DEFAULT 0,
      auto_submitted TINYINT NOT NULL DEFAULT 0, duration_min INT NULL, ip VARCHAR(64) DEFAULT '',
      session_id VARCHAR(64) DEFAULT '', last_seen VARCHAR(32) NULL,
      started_at VARCHAR(32), submitted_at VARCHAR(32) NULL,
      INDEX ix_student (student_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    for (const alter of [
      'ALTER TABLE attempts ADD COLUMN violations INT NOT NULL DEFAULT 0',
      "ALTER TABLE attempts ADD COLUMN session_id VARCHAR(64) DEFAULT ''",
      'ALTER TABLE attempts ADD COLUMN last_seen VARCHAR(32) NULL',
      'ALTER TABLE attempts ADD COLUMN auto_submitted TINYINT NOT NULL DEFAULT 0',
      'ALTER TABLE attempts ADD COLUMN duration_min INT NULL',
      "ALTER TABLE attempts ADD COLUMN ip VARCHAR(64) DEFAULT ''",
    ]) { try { await q(alter); } catch (e) { if (!/duplicate column/i.test(e.message)) throw e; } }
    await q(`CREATE TABLE IF NOT EXISTS settings (
      k VARCHAR(64) PRIMARY KEY, v JSON
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await q(`CREATE TABLE IF NOT EXISTS tickets (
      id VARCHAR(64) PRIMARY KEY, registration_number VARCHAR(64), name VARCHAR(190),
      message TEXT, status VARCHAR(16) DEFAULT 'open', created_at VARCHAR(32),
      INDEX ix_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await q(`CREATE TABLE IF NOT EXISTS login_events (
      id VARCHAR(64) PRIMARY KEY, registration_number VARCHAR(64), name VARCHAR(190),
      ip VARCHAR(64), ok TINYINT DEFAULT 1, reason VARCHAR(32), created_at VARCHAR(32),
      INDEX ix_reg (registration_number), INDEX ix_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await q(`CREATE TABLE IF NOT EXISTS attendance_postings (
      session_id VARCHAR(64) NOT NULL DEFAULT '', emp_id VARCHAR(32) NOT NULL,
      section VARCHAR(64), room VARCHAR(32), faculty_name VARCHAR(190),
      present INT DEFAULT 0, absent INT DEFAULT 0, total INT DEFAULT 0, marks JSON, posted_at VARCHAR(32),
      PRIMARY KEY (session_id, emp_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    // migrate a pre-existing single-key (emp_id) table to the session-scoped composite key
    try { await q("ALTER TABLE attendance_postings ADD COLUMN session_id VARCHAR(64) NOT NULL DEFAULT ''"); }
    catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }
    try { await q('ALTER TABLE attendance_postings DROP PRIMARY KEY, ADD PRIMARY KEY (session_id, emp_id)'); }
    catch (e) { /* already the composite key */ }
  }
  const toTicket = (r) => ({ id: r.id, registrationNumber: r.registration_number, name: r.name, message: r.message, status: r.status, createdAt: r.created_at });
  const toLogin = (r) => ({ id: r.id, registrationNumber: r.registration_number, name: r.name, ip: r.ip || '', ok: !!r.ok, reason: r.reason || '', createdAt: r.created_at });
  const toPosting = (r) => ({ sessionId: r.session_id || '', empId: r.emp_id, section: r.section || '', room: r.room || '', facultyName: r.faculty_name || '', present: r.present ?? 0, absent: r.absent ?? 0, total: r.total ?? 0, marks: r.marks || {}, postedAt: r.posted_at });

  const COL = { answers: 'answers', score: 'score', status: 'status', submittedAt: 'submitted_at', reason: 'reason', violations: 'violations', autoSubmitted: 'auto_submitted', durationMin: 'duration_min', ip: 'ip', sessionId: 'session_id', lastSeen: 'last_seen' };

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
      get: async (id) => { const r = await q('SELECT * FROM questions WHERE id=?', [id]); return r[0] ? toQuestion(r[0]) : null; },
      update: async (id, patch) => {
        const map = { question: 'question', options: 'options', answerIndex: 'answer_index', topic: 'topic', difficulty: 'difficulty', explanation: 'explanation', domain: 'domain' };
        const sets = [], vals = [];
        for (const [k, v] of Object.entries(patch)) { if (!map[k]) continue; sets.push(`${map[k]}=?`); vals.push(k === 'options' ? J(v) : v); }
        if (sets.length) { vals.push(id); await q(`UPDATE questions SET ${sets.join(', ')} WHERE id=?`, vals); }
        const r = await q('SELECT * FROM questions WHERE id=?', [id]);
        return r[0] ? toQuestion(r[0]) : null;
      },
      clearDomain: async (domain) => {
        // match on normalized domain (so "Java Core" == "JavaCore")
        const all = await q('SELECT id, domain FROM questions');
        const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const ids = all.filter((r) => norm(r.domain) === norm(domain)).map((r) => r.id);
        if (ids.length) await q('DELETE FROM questions WHERE id IN (?)', [ids]);
        return ids.length;
      },
      renameDomain: async (from, to) => {
        const all = await q('SELECT id, domain FROM questions');
        const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const ids = all.filter((r) => norm(r.domain) === norm(from)).map((r) => r.id);
        if (ids.length) await q('UPDATE questions SET domain=? WHERE id IN (?)', [to, ids]);
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
      byEmpId: async (empId) => (await q('SELECT * FROM students WHERE emp_id=? ORDER BY registration_number', [String(empId)])).map(toStudent),
      add: async (s) => { await q('INSERT INTO students (id, registration_number, name, branch, section, domain, emp_id, room, faculty_name, active, created_at) VALUES (?,?,?,?,?,?,?,?,?,1,?)', [s.id, s.registrationNumber, s.name, s.branch, s.section, s.domain || '', s.empId || '', s.room || '', s.facultyName || '', s.createdAt]); return s; },
      update: async (id, patch) => {
        const map = { name: 'name', branch: 'branch', section: 'section', domain: 'domain', active: 'active' };
        const sets = [], vals = [];
        for (const [k, v] of Object.entries(patch)) { if (!map[k]) continue; sets.push(`${map[k]}=?`); vals.push(k === 'active' ? (v ? 1 : 0) : v); }
        if (sets.length) { vals.push(id); await q(`UPDATE students SET ${sets.join(', ')} WHERE id=?`, vals); }
        const r = await q('SELECT * FROM students WHERE id=?', [id]);
        return r[0] ? toStudent(r[0]) : null;
      },
      // Delete every student in a domain (and their attempts). Used to purge load-test data.
      removeByDomain: async (domain) => {
        await q('DELETE a FROM attempts a JOIN students s ON a.student_id = s.id WHERE s.domain = ?', [domain]);
        const r = await q('DELETE FROM students WHERE domain = ?', [domain]);
        return r.affectedRows || 0;
      },
      importMany: async (rows) => {
        if (!rows.length) return { added: 0, updated: 0, total: (await q('SELECT COUNT(*) n FROM students'))[0].n };
        const regs = rows.map((r) => r.registrationNumber);
        const existing = new Set((await q('SELECT registration_number FROM students WHERE registration_number IN (?)', [regs])).map((r) => r.registration_number));
        const values = rows.map((r) => [r.id, r.registrationNumber, r.name, r.branch, r.section, r.domain || '', r.empId || '', r.room || '', r.facultyName || '', 1, r.createdAt]);
        await q(`INSERT INTO students (id, registration_number, name, branch, section, domain, emp_id, room, faculty_name, active, created_at) VALUES ?
                 ON DUPLICATE KEY UPDATE name=VALUES(name), branch=VALUES(branch), section=VALUES(section), domain=VALUES(domain), emp_id=VALUES(emp_id), room=VALUES(room), faculty_name=VALUES(faculty_name)`, [values]);
        const added = rows.filter((r) => !existing.has(r.registrationNumber)).length;
        return { added, updated: rows.length - added, total: (await q('SELECT COUNT(*) n FROM students'))[0].n };
      },
    },

    attempts: {
      all: async () => (await q('SELECT * FROM attempts')).map(toAttempt),
      get: async (id) => { const r = await q('SELECT * FROM attempts WHERE id=?', [id]); return r[0] ? toAttempt(r[0]) : null; },
      add: async (a) => {
        await q('INSERT INTO attempts (id, student_id, question_ids, answers, score, total, status, reason, violations, auto_submitted, duration_min, ip, session_id, last_seen, started_at, submitted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [a.id, a.studentId, J(a.questionIds), J(a.answers), a.score, a.total, a.status, a.reason, a.violations || 0, a.autoSubmitted ? 1 : 0, a.durationMin || null, a.ip || '', a.sessionId || '', a.lastSeen || null, a.startedAt, a.submittedAt]);
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

    tickets: {
      all: async () => (await q('SELECT * FROM tickets ORDER BY created_at DESC')).map(toTicket),
      add: async (t) => { await q('INSERT INTO tickets (id, registration_number, name, message, status, created_at) VALUES (?,?,?,?,?,?)', [t.id, t.registrationNumber, t.name, t.message, t.status, t.createdAt]); return t; },
      update: async (id, patch) => { if ('status' in patch) await q('UPDATE tickets SET status=? WHERE id=?', [patch.status, id]); const r = await q('SELECT * FROM tickets WHERE id=?', [id]); return r[0] ? toTicket(r[0]) : null; },
    },

    loginEvents: {
      add: async (e) => { await q('INSERT INTO login_events (id, registration_number, name, ip, ok, reason, created_at) VALUES (?,?,?,?,?,?,?)', [e.id, e.registrationNumber, e.name, e.ip, e.ok ? 1 : 0, e.reason || '', e.createdAt]); return e; },
      recent: async (limit = 500) => (await q('SELECT * FROM login_events ORDER BY created_at DESC LIMIT ?', [Number(limit) || 500])).map(toLogin),
      all: async () => (await q('SELECT * FROM login_events')).map(toLogin),
    },

    attendance: {
      bySession: async (sessionId) => (await q('SELECT * FROM attendance_postings WHERE session_id=?', [String(sessionId)])).map(toPosting),
      byEmp: async (sessionId, empId) => { const r = await q('SELECT * FROM attendance_postings WHERE session_id=? AND emp_id=?', [String(sessionId), String(empId)]); return r[0] ? toPosting(r[0]) : null; },
      byEmpAll: async (empId) => (await q('SELECT * FROM attendance_postings WHERE emp_id=?', [String(empId)])).map(toPosting),
      set: async (rec) => {
        await q(`INSERT INTO attendance_postings (session_id, emp_id, section, room, faculty_name, present, absent, total, marks, posted_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE section=VALUES(section), room=VALUES(room), faculty_name=VALUES(faculty_name),
                 present=VALUES(present), absent=VALUES(absent), total=VALUES(total), marks=VALUES(marks), posted_at=VALUES(posted_at)`,
          [rec.sessionId, rec.empId, rec.section, rec.room, rec.facultyName, rec.present, rec.absent, rec.total, J(rec.marks), rec.postedAt]);
        return rec;
      },
      removeByEmp: async (sessionId, empId) => { const r = await q('DELETE FROM attendance_postings WHERE session_id=? AND emp_id=?', [String(sessionId), String(empId)]); return r.affectedRows || 0; },
      removeSession: async (sessionId) => { await q('DELETE FROM attendance_postings WHERE session_id=?', [String(sessionId)]); },
    },
  };
}

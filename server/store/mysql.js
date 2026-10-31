// MySQL storage adapter (production / Hostinger VPS). Implements the same async
// interface as the JSON adapter. Credentials come from env (server/.env) — never hard-coded.
import mysql from 'mysql2/promise';

const J = (v) => JSON.stringify(v ?? null);

// row mappers: DB snake_case <-> app camelCase
const toQuestion = (r) => ({ id: r.id, question: r.question, options: r.options, answerIndex: r.answer_index, topic: r.topic, difficulty: r.difficulty, explanation: r.explanation, domain: r.domain || '', norm: r.norm });
const toStudent = (r) => ({ id: r.id, registrationNumber: r.registration_number, name: r.name, branch: r.branch, section: r.section, domain: r.domain || '', empId: r.emp_id || '', room: r.room || '', facultyName: r.faculty_name || '', active: r.active === undefined ? true : !!r.active, createdAt: r.created_at });
const toAttempt = (r) => ({ id: r.id, studentId: r.student_id, questionIds: r.question_ids, answers: r.answers, score: r.score, total: r.total, status: r.status, reason: r.reason, violations: r.violations ?? 0, autoSubmitted: !!r.auto_submitted, durationMin: r.duration_min || null, ip: r.ip || '', sessionId: r.session_id || '', lastSeen: r.last_seen || null, startedAt: r.started_at, submittedAt: r.submitted_at, domain: r.domain || '', round: r.round_no || 1 });

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
      // An attempt belongs to ONE exam = (domain, round) so a student can sit many exams over time.
      "ALTER TABLE attempts ADD COLUMN domain VARCHAR(64) DEFAULT ''",
      'ALTER TABLE attempts ADD COLUMN round_no INT NOT NULL DEFAULT 1',
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
    // ---- Hackathon Review System ----
    await q(`CREATE TABLE IF NOT EXISTS review_batches (
      id VARCHAR(64) PRIMARY KEY, section VARCHAR(64), batch_no VARCHAR(32), emp_id VARCHAR(32),
      faculty_name VARCHAR(190), room VARCHAR(32), project TEXT, ps VARCHAR(64), members JSON,
      INDEX ix_emp (emp_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await q(`CREATE TABLE IF NOT EXISTS review_scores (
      id VARCHAR(64) PRIMARY KEY, review_id VARCHAR(64), batch_id VARCHAR(64), reg VARCHAR(64),
      present TINYINT DEFAULT 1, scores JSON, total INT DEFAULT 0, by_emp VARCHAR(32), posted_at VARCHAR(32),
      UNIQUE KEY uq_rbr (review_id, batch_id, reg), INDEX ix_review (review_id), INDEX ix_batch (batch_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    // ---- Programs: titled events with their own roster, sessions and room-wise attendance/review ----
    await q(`CREATE TABLE IF NOT EXISTS programs (
      id VARCHAR(64) PRIMARY KEY, title VARCHAR(255) NOT NULL, created_at VARCHAR(32)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await q(`CREATE TABLE IF NOT EXISTS program_students (
      id VARCHAR(64) PRIMARY KEY, program_id VARCHAR(64) NOT NULL, reg VARCHAR(64) NOT NULL, name VARCHAR(190),
      branch VARCHAR(64), section VARCHAR(64), room VARCHAR(64), emp_id VARCHAR(32), faculty_name VARCHAR(190),
      batch_no VARCHAR(32), project TEXT, ps VARCHAR(64),
      UNIQUE KEY uq_prog_reg (program_id, reg), INDEX ix_prog (program_id), INDEX ix_emp (emp_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await q(`CREATE TABLE IF NOT EXISTS program_sessions (
      id VARCHAR(64) PRIMARY KEY, program_id VARCHAR(64) NOT NULL, kind VARCHAR(16) NOT NULL, name VARCHAR(190),
      session_date VARCHAR(16), start_time VARCHAR(8), end_time VARCHAR(8), open_rooms JSON, created_at VARCHAR(32),
      INDEX ix_prog (program_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await q(`CREATE TABLE IF NOT EXISTS program_attendance (
      session_id VARCHAR(64) NOT NULL, room VARCHAR(64) NOT NULL, program_id VARCHAR(64), room_label VARCHAR(64),
      emp_id VARCHAR(32), faculty_name VARCHAR(190), marks JSON, present INT DEFAULT 0, absent INT DEFAULT 0,
      total INT DEFAULT 0, posted_at VARCHAR(32),
      PRIMARY KEY (session_id, room), INDEX ix_prog (program_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await q(`CREATE TABLE IF NOT EXISTS program_scores (
      session_id VARCHAR(64) NOT NULL, reg VARCHAR(64) NOT NULL, program_id VARCHAR(64), room VARCHAR(64),
      present TINYINT DEFAULT 1, scores JSON, total INT DEFAULT 0, by_emp VARCHAR(32), posted_at VARCHAR(32),
      PRIMARY KEY (session_id, reg), INDEX ix_prog (program_id), INDEX ix_room (session_id, room)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    // Faculty can be named (1–5 per room) rather than Emp IDs; batches get a reviewer.
    for (const alter of [
      'ALTER TABLE program_students ADD COLUMN faculty_list JSON',
      "ALTER TABLE program_students ADD COLUMN course_code VARCHAR(32) DEFAULT ''",
      "ALTER TABLE program_students ADD COLUMN course_name VARCHAR(255) DEFAULT ''",
      "ALTER TABLE program_students ADD COLUMN reviewer VARCHAR(190) DEFAULT ''",
      // sessions that open and close their rooms on their own date and times
      'ALTER TABLE program_sessions ADD COLUMN auto_sched TINYINT NOT NULL DEFAULT 0',
      "ALTER TABLE program_sessions ADD COLUMN auto_state VARCHAR(16) NOT NULL DEFAULT ''",
    ]) { try { await q(alter); } catch (e) { if (!/duplicate column/i.test(e.message)) throw e; } }
    await q('ALTER TABLE program_attendance MODIFY emp_id VARCHAR(190)');
    await q('ALTER TABLE program_scores MODIFY by_emp VARCHAR(190)');
    // Faculty directory (name → email / Emp ID) and OTP + session records for faculty sign-in.
    await q(`CREATE TABLE IF NOT EXISTS faculty_directory (
      fkey VARCHAR(190) PRIMARY KEY, name VARCHAR(190), email VARCHAR(190), emp_id VARCHAR(32), updated_at VARCHAR(32),
      INDEX ix_email (email), INDEX ix_emp (emp_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await q(`CREATE TABLE IF NOT EXISTS faculty_auth (
      id VARCHAR(64) PRIMARY KEY, fkey VARCHAR(190) NOT NULL, kind VARCHAR(16) NOT NULL, secret_hash VARCHAR(128) NOT NULL,
      expires_at VARCHAR(32), attempts INT DEFAULT 0, created_at VARCHAR(32),
      INDEX ix_fk (fkey, kind), INDEX ix_hash (secret_hash)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    // the university's course-wise project register (faculty pick a team's project from it)
    await q(`CREATE TABLE IF NOT EXISTS course_projects (
      id VARCHAR(64) PRIMARY KEY, course_code VARCHAR(32) NOT NULL, course_name VARCHAR(255),
      project_id VARCHAR(64), title VARCHAR(500), domain VARCHAR(190),
      INDEX ix_course (course_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    // ---- certification exams: courses, case studies, question bank, papers, attempts ----
    await q(`CREATE TABLE IF NOT EXISTS cert_courses (
      code VARCHAR(32) PRIMARY KEY, name VARCHAR(255), cert_name VARCHAR(255), department VARCHAR(190),
      coordinator VARCHAR(190), syllabus MEDIUMTEXT, outcomes JSON, active TINYINT DEFAULT 1, created_at VARCHAR(32)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await q(`CREATE TABLE IF NOT EXISTS cert_cases (
      id VARCHAR(64) PRIMARY KEY, course_code VARCHAR(32) NOT NULL, title VARCHAR(255),
      scenario MEDIUMTEXT, exhibits JSON, topic VARCHAR(190), difficulty VARCHAR(16), created_at VARCHAR(32),
      INDEX ix_course (course_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await q(`CREATE TABLE IF NOT EXISTS cert_questions (
      id VARCHAR(64) PRIMARY KEY, course_code VARCHAR(32) NOT NULL, case_id VARCHAR(64) DEFAULT '',
      type VARCHAR(12) NOT NULL DEFAULT 'single', question MEDIUMTEXT NOT NULL, options JSON NOT NULL,
      answers JSON NOT NULL, marks INT DEFAULT 1, topic VARCHAR(190), difficulty VARCHAR(16),
      explanation MEDIUMTEXT, norm VARCHAR(512), created_at VARCHAR(32),
      UNIQUE KEY uq_cert_norm (norm), INDEX ix_cq_course (course_code), INDEX ix_cq_case (case_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await q(`CREATE TABLE IF NOT EXISTS cert_papers (
      id VARCHAR(64) PRIMARY KEY, course_code VARCHAR(32) NOT NULL, name VARCHAR(255),
      duration_min INT DEFAULT 60, pass_mark INT DEFAULT 70, blueprint JSON, rules JSON,
      created_at VARCHAR(32), updated_at VARCHAR(32), INDEX ix_cp_course (course_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await q(`CREATE TABLE IF NOT EXISTS cert_exams (
      id VARCHAR(64) PRIMARY KEY, paper_id VARCHAR(64) NOT NULL, course_code VARCHAR(32) NOT NULL,
      title VARCHAR(255), start_at VARCHAR(32), end_at VARCHAR(32), status VARCHAR(16) DEFAULT 'scheduled',
      audience JSON, created_at VARCHAR(32), INDEX ix_ce_course (course_code), INDEX ix_ce_start (start_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await q(`CREATE TABLE IF NOT EXISTS cert_attempts (
      id VARCHAR(64) PRIMARY KEY, exam_id VARCHAR(64) NOT NULL, reg VARCHAR(64) NOT NULL,
      name VARCHAR(190), branch VARCHAR(64), section VARCHAR(64),
      items JSON, answers JSON, marked JSON, score INT NULL, total INT NOT NULL DEFAULT 0,
      status VARCHAR(16) NOT NULL DEFAULT 'in_progress', reason VARCHAR(64) DEFAULT '',
      integrity INT DEFAULT 100, flags JSON, ip VARCHAR(64) DEFAULT '', session_id VARCHAR(64) DEFAULT '',
      started_at VARCHAR(32), last_seen VARCHAR(32), submitted_at VARCHAR(32),
      UNIQUE KEY uq_exam_reg (exam_id, reg), INDEX ix_ca_exam (exam_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await q(`CREATE TABLE IF NOT EXISTS cert_events (
      id BIGINT AUTO_INCREMENT PRIMARY KEY, attempt_id VARCHAR(64) NOT NULL, at VARCHAR(32),
      kind VARCHAR(32), seconds INT DEFAULT 0, item INT DEFAULT -1, detail JSON,
      INDEX ix_cev_attempt (attempt_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    // latest shared-screen frame per attempt (overwritten, so storage stays small)
    await q(`CREATE TABLE IF NOT EXISTS cert_snaps (
      attempt_id VARCHAR(64) PRIMARY KEY, image MEDIUMTEXT, at VARCHAR(32), reason VARCHAR(32) DEFAULT '', count INT DEFAULT 0
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
  const toBatch = (r) => ({ id: r.id, section: r.section || '', batchNo: r.batch_no || '', empId: r.emp_id || '', facultyName: r.faculty_name || '', room: r.room || '', project: r.project || '', ps: r.ps || '', members: r.members || [] });
  const toScore = (r) => ({ id: r.id, reviewId: r.review_id, batchId: r.batch_id, reg: r.reg, present: !!r.present, scores: r.scores || {}, total: r.total ?? 0, byEmp: r.by_emp || '', postedAt: r.posted_at });
  const toProgram = (r) => ({ id: r.id, title: r.title, createdAt: r.created_at });
  const toPStudent = (r) => ({ id: r.id, programId: r.program_id, reg: r.reg, courseCode: r.course_code || '', courseName: r.course_name || '', name: r.name || '', branch: r.branch || '', section: r.section || '', room: r.room || '', empId: r.emp_id || '', facultyName: r.faculty_name || '', facultyList: Array.isArray(r.faculty_list) ? r.faculty_list : [], batchNo: r.batch_no || '', reviewer: r.reviewer || '', project: r.project || '', ps: r.ps || '' });
  const toCCourse = (r) => ({ code: r.code, name: r.name || '', certName: r.cert_name || '', department: r.department || '', coordinator: r.coordinator || '', syllabus: r.syllabus || '', outcomes: Array.isArray(r.outcomes) ? r.outcomes : [], active: !!r.active, createdAt: r.created_at });
  const toCCase = (r) => ({ id: r.id, courseCode: r.course_code, title: r.title || '', scenario: r.scenario || '', exhibits: Array.isArray(r.exhibits) ? r.exhibits : [], topic: r.topic || '', difficulty: r.difficulty || '', createdAt: r.created_at });
  const toCQuestion = (r) => ({ id: r.id, courseCode: r.course_code, caseId: r.case_id || '', type: r.type || 'single', question: r.question, options: r.options || [], answers: Array.isArray(r.answers) ? r.answers : [], marks: r.marks ?? 1, topic: r.topic || '', difficulty: r.difficulty || '', explanation: r.explanation || '', norm: r.norm, createdAt: r.created_at });
  const toCPaper = (r) => ({ id: r.id, courseCode: r.course_code, name: r.name || '', durationMin: r.duration_min ?? 60, passMark: r.pass_mark ?? 70, blueprint: Array.isArray(r.blueprint) ? r.blueprint : [], rules: r.rules || {}, createdAt: r.created_at, updatedAt: r.updated_at });
  const toCExam = (r) => ({ id: r.id, paperId: r.paper_id, courseCode: r.course_code, title: r.title || '', startAt: r.start_at || '', endAt: r.end_at || '', status: r.status || 'scheduled', audience: r.audience || {}, createdAt: r.created_at });
  const toCAttempt = (r) => ({ id: r.id, examId: r.exam_id, reg: r.reg, name: r.name || '', branch: r.branch || '', section: r.section || '', items: Array.isArray(r.items) ? r.items : [], answers: r.answers || {}, marked: Array.isArray(r.marked) ? r.marked : [], score: r.score, total: r.total ?? 0, status: r.status, reason: r.reason || '', integrity: r.integrity ?? 100, flags: r.flags || {}, ip: r.ip || '', sessionId: r.session_id || '', startedAt: r.started_at, lastSeen: r.last_seen, submittedAt: r.submitted_at });
  const toCProject = (r) => ({ id: r.id, courseCode: r.course_code, courseName: r.course_name || '', projectId: r.project_id || '', title: r.title || '', domain: r.domain || '' });
  const toFac = (r) => ({ key: r.fkey, name: r.name || '', email: r.email || '', empId: r.emp_id || '', updatedAt: r.updated_at });
  const toAuth = (r) => ({ id: r.id, fkey: r.fkey, kind: r.kind, secretHash: r.secret_hash, expiresAt: r.expires_at, attempts: r.attempts ?? 0, createdAt: r.created_at });
  const toPSession = (r) => ({ id: r.id, programId: r.program_id, kind: r.kind, name: r.name || '', date: r.session_date || '', startTime: r.start_time || '', endTime: r.end_time || '', openRooms: Array.isArray(r.open_rooms) ? r.open_rooms : [], auto: !!r.auto_sched, autoState: r.auto_state || '', createdAt: r.created_at });
  const toPAtt = (r) => ({ sessionId: r.session_id, room: r.room, programId: r.program_id, roomLabel: r.room_label || '', empId: r.emp_id || '', facultyName: r.faculty_name || '', marks: r.marks || {}, present: r.present ?? 0, absent: r.absent ?? 0, total: r.total ?? 0, postedAt: r.posted_at });
  const toPScore = (r) => ({ sessionId: r.session_id, reg: r.reg, programId: r.program_id, room: r.room || '', present: !!r.present, scores: r.scores || {}, total: r.total ?? 0, byEmp: r.by_emp || '', postedAt: r.posted_at });

  const COL = { answers: 'answers', score: 'score', status: 'status', submittedAt: 'submitted_at', reason: 'reason', violations: 'violations', autoSubmitted: 'auto_submitted', durationMin: 'duration_min', ip: 'ip', sessionId: 'session_id', lastSeen: 'last_seen', domain: 'domain', round: 'round_no' };

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
      remove: async (id) => { const r = await q('DELETE FROM questions WHERE id=?', [id]); return r.affectedRows || 0; },
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
      byRegNos: async (rns) => (rns.length ? (await q('SELECT * FROM students WHERE registration_number IN (?)', [rns])).map(toStudent) : []),
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
      // Delete specific students by id (and any attempts they own), in safe chunks.
      removeMany: async (ids) => {
        let n = 0;
        for (let i = 0; i < ids.length; i += 500) {
          const chunk = ids.slice(i, i + 500);
          if (!chunk.length) continue;
          await q('DELETE FROM attempts WHERE student_id IN (?)', [chunk]);
          const r = await q('DELETE FROM students WHERE id IN (?)', [chunk]);
          n += r.affectedRows || 0;
        }
        return n;
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
        await q('INSERT INTO attempts (id, student_id, question_ids, answers, score, total, status, reason, violations, auto_submitted, duration_min, ip, session_id, last_seen, started_at, submitted_at, domain, round_no) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [a.id, a.studentId, J(a.questionIds), J(a.answers), a.score, a.total, a.status, a.reason, a.violations || 0, a.autoSubmitted ? 1 : 0, a.durationMin || null, a.ip || '', a.sessionId || '', a.lastSeen || null, a.startedAt, a.submittedAt, a.domain || '', Number(a.round) || 1]);
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
      all: async () => (await q('SELECT * FROM attendance_postings')).map(toPosting),
      reassign: async (from, to) => { const r = await q('UPDATE attendance_postings SET session_id=? WHERE session_id=?', [String(to), String(from || '')]); return r.affectedRows || 0; },
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

    reviewBatches: {
      all: async () => (await q('SELECT * FROM review_batches')).map(toBatch),
      byEmp: async (empId) => (await q('SELECT * FROM review_batches WHERE emp_id=? ORDER BY CAST(batch_no AS UNSIGNED), batch_no', [String(empId)])).map(toBatch),
      get: async (id) => { const r = await q('SELECT * FROM review_batches WHERE id=?', [id]); return r[0] ? toBatch(r[0]) : null; },
      add: async (b) => { await q('INSERT INTO review_batches (id, section, batch_no, emp_id, faculty_name, room, project, ps, members) VALUES (?,?,?,?,?,?,?,?,?)', [b.id, b.section, b.batchNo, b.empId, b.facultyName, b.room, b.project, b.ps, J(b.members || [])]); return b; },
      update: async (id, p) => {
        const map = { section: 'section', batchNo: 'batch_no', empId: 'emp_id', facultyName: 'faculty_name', room: 'room', project: 'project', ps: 'ps', members: 'members' };
        const sets = [], vals = [];
        for (const [k, v] of Object.entries(p)) { if (!map[k]) continue; sets.push(`${map[k]}=?`); vals.push(k === 'members' ? J(v) : v); }
        if (sets.length) { vals.push(id); await q(`UPDATE review_batches SET ${sets.join(', ')} WHERE id=?`, vals); }
        const r = await q('SELECT * FROM review_batches WHERE id=?', [id]); return r[0] ? toBatch(r[0]) : null;
      },
      remove: async (id) => { await q('DELETE FROM review_batches WHERE id=?', [id]); },
      clear: async () => { await q('DELETE FROM review_batches'); },
    },

    reviewScores: {
      byReview: async (reviewId) => (await q('SELECT * FROM review_scores WHERE review_id=?', [String(reviewId)])).map(toScore),
      byReviewBatch: async (reviewId, batchId) => (await q('SELECT * FROM review_scores WHERE review_id=? AND batch_id=?', [String(reviewId), String(batchId)])).map(toScore),
      set: async (s) => {
        await q(`INSERT INTO review_scores (id, review_id, batch_id, reg, present, scores, total, by_emp, posted_at)
                 VALUES (?,?,?,?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE present=VALUES(present), scores=VALUES(scores), total=VALUES(total), by_emp=VALUES(by_emp), posted_at=VALUES(posted_at)`,
          [s.id, s.reviewId, s.batchId, s.reg, s.present ? 1 : 0, J(s.scores || {}), s.total || 0, s.byEmp || '', s.postedAt]);
        return s;
      },
      removeByBatch: async (reviewId, batchId) => { await q('DELETE FROM review_scores WHERE review_id=? AND batch_id=?', [String(reviewId), String(batchId)]); },
    },

    // ---- Programs ----
    programs: {
      all: async () => (await q('SELECT * FROM programs ORDER BY created_at DESC')).map(toProgram),
      get: async (id) => { const r = await q('SELECT * FROM programs WHERE id=?', [id]); return r[0] ? toProgram(r[0]) : null; },
      add: async (p) => { await q('INSERT INTO programs (id, title, created_at) VALUES (?,?,?)', [p.id, p.title, p.createdAt]); return p; },
      update: async (id, patch) => { if (typeof patch.title === 'string') await q('UPDATE programs SET title=? WHERE id=?', [patch.title, id]); const r = await q('SELECT * FROM programs WHERE id=?', [id]); return r[0] ? toProgram(r[0]) : null; },
      remove: async (id) => {
        await q('DELETE FROM program_scores WHERE program_id=?', [id]);
        await q('DELETE FROM program_attendance WHERE program_id=?', [id]);
        await q('DELETE FROM program_sessions WHERE program_id=?', [id]);
        await q('DELETE FROM program_students WHERE program_id=?', [id]);
        await q('DELETE FROM programs WHERE id=?', [id]);
      },
    },
    programStudents: {
      byProgram: async (pid) => (await q('SELECT * FROM program_students WHERE program_id=? ORDER BY room, reg', [pid])).map(toPStudent),
      byEmp: async (empId) => (await q('SELECT * FROM program_students WHERE emp_id=?', [String(empId)])).map(toPStudent),
      // Upsert by (program, reg). Returns counts for the admin message.
      importMany: async (pid, rows, replace) => {
        if (replace) await q('DELETE FROM program_students WHERE program_id=?', [pid]);
        let added = 0, updated = 0;
        for (let i = 0; i < rows.length; i += 500) {
          const chunk = rows.slice(i, i + 500);
          const existing = new Set((await q('SELECT reg FROM program_students WHERE program_id=? AND reg IN (?)', [pid, chunk.map((r) => r.reg)])).map((r) => r.reg));
          // A re-upload without a Batch column keeps the batches already assigned.
          await q(`INSERT INTO program_students (id, program_id, reg, name, branch, section, room, emp_id, faculty_name, faculty_list, batch_no, project, ps, course_code, course_name) VALUES ?
                   ON DUPLICATE KEY UPDATE name=VALUES(name), branch=VALUES(branch), section=VALUES(section), room=VALUES(room),
                   emp_id=VALUES(emp_id), faculty_name=VALUES(faculty_name), faculty_list=VALUES(faculty_list),
                   batch_no=IF(VALUES(batch_no)='', batch_no, VALUES(batch_no)), project=VALUES(project), ps=VALUES(ps),
                   course_code=VALUES(course_code), course_name=VALUES(course_name)`,
            [chunk.map((r) => [r.id, pid, r.reg, r.name, r.branch, r.section, r.room, r.empId, r.facultyName, J(r.facultyList || []), r.batchNo, r.project, r.ps, r.courseCode || '', r.courseName || ''])]);
          for (const r of chunk) { if (existing.has(r.reg)) updated++; else added++; }
        }
        const total = (await q('SELECT COUNT(*) n FROM program_students WHERE program_id=?', [pid]))[0].n;
        return { added, updated, total };
      },
      // Bulk-set batch number + reviewer: [{ id, reg, batchNo, reviewer }].
      setBatches: async (pid, rows) => {
        for (let i = 0; i < rows.length; i += 500) {
          const chunk = rows.slice(i, i + 500);
          if (!chunk.length) continue;
          await q(`INSERT INTO program_students (id, program_id, reg, batch_no, reviewer) VALUES ?
                   ON DUPLICATE KEY UPDATE batch_no=VALUES(batch_no), reviewer=VALUES(reviewer)`,
            [chunk.map((r) => [r.id, pid, r.reg, r.batchNo, r.reviewer])]);
        }
      },
      // Project titles typed by the reviewing faculty: [{ reg, project }].
      setProjects: async (pid, rows) => {
        for (const r of rows) {
          const ps = String(r.ps || '');
          await q("UPDATE program_students SET project=?, ps=IF(?='', ps, ?) WHERE program_id=? AND reg=?",
            [String(r.project || '').slice(0, 2000), ps, ps, pid, String(r.reg)]);
        }
      },
    },
    // ---- certification exams ----
    certCourses: {
      all: async () => (await q('SELECT * FROM cert_courses ORDER BY code')).map(toCCourse),
      get: async (code) => { const r = await q('SELECT * FROM cert_courses WHERE code=?', [code]); return r[0] ? toCCourse(r[0]) : null; },
      upsert: async (c) => {
        await q(`INSERT INTO cert_courses (code, name, cert_name, department, coordinator, syllabus, outcomes, active, created_at) VALUES (?,?,?,?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE name=IF(VALUES(name)='', name, VALUES(name)), cert_name=IF(VALUES(cert_name)='', cert_name, VALUES(cert_name)),
                 department=IF(VALUES(department)='', department, VALUES(department)), coordinator=IF(VALUES(coordinator)='', coordinator, VALUES(coordinator)),
                 syllabus=IF(VALUES(syllabus)='', syllabus, VALUES(syllabus)), outcomes=VALUES(outcomes), active=VALUES(active)`,
          [c.code, c.name || '', c.certName || '', c.department || '', c.coordinator || '', c.syllabus || '', J(c.outcomes || []), c.active === false ? 0 : 1, c.createdAt || new Date().toISOString()]);
        return c;
      },
      remove: async (code) => { await q('DELETE FROM cert_courses WHERE code=?', [code]); },
    },
    certCases: {
      byCourse: async (code) => (await q('SELECT * FROM cert_cases WHERE course_code=? ORDER BY created_at', [code])).map(toCCase),
      get: async (id) => { const r = await q('SELECT * FROM cert_cases WHERE id=?', [id]); return r[0] ? toCCase(r[0]) : null; },
      upsert: async (c) => {
        await q(`INSERT INTO cert_cases (id, course_code, title, scenario, exhibits, topic, difficulty, created_at) VALUES (?,?,?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE title=VALUES(title), scenario=VALUES(scenario), exhibits=VALUES(exhibits), topic=VALUES(topic), difficulty=VALUES(difficulty)`,
          [c.id, c.courseCode, c.title || '', c.scenario || '', J(c.exhibits || []), c.topic || '', c.difficulty || '', c.createdAt || new Date().toISOString()]);
        return c;
      },
      remove: async (id) => { await q('DELETE FROM cert_questions WHERE case_id=?', [id]); await q('DELETE FROM cert_cases WHERE id=?', [id]); },
    },
    certQuestions: {
      byCourse: async (code) => (await q('SELECT * FROM cert_questions WHERE course_code=? ORDER BY case_id, created_at', [code])).map(toCQuestion),
      byCase: async (caseId) => (await q('SELECT * FROM cert_questions WHERE case_id=? ORDER BY created_at', [caseId])).map(toCQuestion),
      byIds: async (ids) => (ids.length ? (await q('SELECT * FROM cert_questions WHERE id IN (?)', [ids])).map(toCQuestion) : []),
      countByCourse: async (code) => (await q('SELECT COUNT(*) n FROM cert_questions WHERE course_code=?', [code]))[0].n,
      addMany: async (items) => {
        if (!items.length) return 0;
        const rows = items.map((i) => [i.id, i.courseCode, i.caseId || '', i.type || 'single', i.question, J(i.options), J(i.answers), i.marks || 1, i.topic || '', i.difficulty || '', i.explanation || '', i.norm, i.createdAt || new Date().toISOString()]);
        const before = (await q('SELECT COUNT(*) n FROM cert_questions'))[0].n;
        await q('INSERT IGNORE INTO cert_questions (id, course_code, case_id, type, question, options, answers, marks, topic, difficulty, explanation, norm, created_at) VALUES ?', [rows]);
        return (await q('SELECT COUNT(*) n FROM cert_questions'))[0].n - before;
      },
      update: async (id, p) => {
        const sets = []; const vals = [];
        for (const [k, col] of [['question', 'question'], ['type', 'type'], ['marks', 'marks'], ['topic', 'topic'], ['difficulty', 'difficulty'], ['explanation', 'explanation'], ['caseId', 'case_id']]) if (p[k] !== undefined) { sets.push(`${col}=?`); vals.push(p[k]); }
        for (const k of ['options', 'answers']) if (p[k] !== undefined) { sets.push(`${k}=?`); vals.push(J(p[k])); }
        if (!sets.length) return null;
        await q(`UPDATE cert_questions SET ${sets.join(', ')} WHERE id=?`, [...vals, id]);
        const r = await q('SELECT * FROM cert_questions WHERE id=?', [id]);
        return r[0] ? toCQuestion(r[0]) : null;
      },
      remove: async (id) => { await q('DELETE FROM cert_questions WHERE id=?', [id]); },
    },
    certPapers: {
      all: async () => (await q('SELECT * FROM cert_papers ORDER BY course_code, created_at')).map(toCPaper),
      byCourse: async (code) => (await q('SELECT * FROM cert_papers WHERE course_code=? ORDER BY created_at', [code])).map(toCPaper),
      get: async (id) => { const r = await q('SELECT * FROM cert_papers WHERE id=?', [id]); return r[0] ? toCPaper(r[0]) : null; },
      upsert: async (p) => {
        await q(`INSERT INTO cert_papers (id, course_code, name, duration_min, pass_mark, blueprint, rules, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE name=VALUES(name), duration_min=VALUES(duration_min), pass_mark=VALUES(pass_mark),
                 blueprint=VALUES(blueprint), rules=VALUES(rules), updated_at=VALUES(updated_at)`,
          [p.id, p.courseCode, p.name || '', p.durationMin || 60, p.passMark ?? 70, J(p.blueprint || []), J(p.rules || {}), p.createdAt || new Date().toISOString(), new Date().toISOString()]);
        return p;
      },
      remove: async (id) => { await q('DELETE FROM cert_papers WHERE id=?', [id]); },
    },
    certExams: {
      all: async () => (await q('SELECT * FROM cert_exams ORDER BY start_at DESC')).map(toCExam),
      get: async (id) => { const r = await q('SELECT * FROM cert_exams WHERE id=?', [id]); return r[0] ? toCExam(r[0]) : null; },
      upsert: async (e) => {
        await q(`INSERT INTO cert_exams (id, paper_id, course_code, title, start_at, end_at, status, audience, created_at) VALUES (?,?,?,?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE paper_id=VALUES(paper_id), title=VALUES(title), start_at=VALUES(start_at),
                 end_at=VALUES(end_at), status=VALUES(status), audience=VALUES(audience)`,
          [e.id, e.paperId, e.courseCode, e.title || '', e.startAt || '', e.endAt || '', e.status || 'scheduled', J(e.audience || {}), e.createdAt || new Date().toISOString()]);
        return e;
      },
      remove: async (id) => { await q('DELETE FROM cert_exams WHERE id=?', [id]); },
    },
    certAttempts: {
      byExam: async (examId) => (await q('SELECT * FROM cert_attempts WHERE exam_id=? ORDER BY started_at', [examId])).map(toCAttempt),
      get: async (id) => { const r = await q('SELECT * FROM cert_attempts WHERE id=?', [id]); return r[0] ? toCAttempt(r[0]) : null; },
      byExamReg: async (examId, reg) => { const r = await q('SELECT * FROM cert_attempts WHERE exam_id=? AND reg=?', [examId, reg]); return r[0] ? toCAttempt(r[0]) : null; },
      inProgress: async () => (await q("SELECT id, exam_id, started_at FROM cert_attempts WHERE status='in_progress'")).map((r) => ({ id: r.id, examId: r.exam_id, startedAt: r.started_at })),
      add: async (a) => {
        await q(`INSERT INTO cert_attempts (id, exam_id, reg, name, branch, section, items, answers, marked, score, total, status, reason, integrity, flags, ip, session_id, started_at, last_seen, submitted_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [a.id, a.examId, a.reg, a.name || '', a.branch || '', a.section || '', J(a.items || []), J(a.answers || {}), J(a.marked || []), a.score ?? null, a.total || 0, a.status || 'in_progress', a.reason || '', a.integrity ?? 100, J(a.flags || {}), a.ip || '', a.sessionId || '', a.startedAt, a.lastSeen || a.startedAt, a.submittedAt || null]);
        return a;
      },
      update: async (id, p) => {
        const sets = []; const vals = [];
        const map = { score: 'score', total: 'total', status: 'status', reason: 'reason', integrity: 'integrity', ip: 'ip', sessionId: 'session_id', lastSeen: 'last_seen', submittedAt: 'submitted_at', name: 'name' };
        for (const [k, col] of Object.entries(map)) if (p[k] !== undefined) { sets.push(`${col}=?`); vals.push(p[k]); }
        for (const k of ['items', 'answers', 'marked', 'flags']) if (p[k] !== undefined) { sets.push(`${k === 'items' ? 'items' : k}=?`); vals.push(J(p[k])); }
        if (!sets.length) return null;
        await q(`UPDATE cert_attempts SET ${sets.join(', ')} WHERE id=?`, [...vals, id]);
        const r = await q('SELECT * FROM cert_attempts WHERE id=?', [id]);
        return r[0] ? toCAttempt(r[0]) : null;
      },
    },
    certEvents: {
      add: async (attemptId, rows) => {
        if (!rows.length) return 0;
        await q('INSERT INTO cert_events (attempt_id, at, kind, seconds, item, detail) VALUES ?',
          [rows.map((e) => [attemptId, e.at, e.kind, e.seconds || 0, e.item ?? -1, J(e.detail || {})])]);
        return rows.length;
      },
      byAttempt: async (attemptId) => (await q('SELECT * FROM cert_events WHERE attempt_id=? ORDER BY id', [attemptId]))
        .map((r) => ({ at: r.at, kind: r.kind, seconds: r.seconds, item: r.item, detail: r.detail || {} })),
    },
    certSnaps: {
      set: async (attemptId, image, at, reason) => {
        await q('INSERT INTO cert_snaps (attempt_id, image, at, reason, count) VALUES (?,?,?,?,1) ON DUPLICATE KEY UPDATE image=VALUES(image), at=VALUES(at), reason=VALUES(reason), count=count+1', [attemptId, image, at, reason || '']);
      },
      get: async (attemptId) => { const r = await q('SELECT * FROM cert_snaps WHERE attempt_id=?', [attemptId]); return r[0] ? { attemptId, image: r[0].image, at: r[0].at, reason: r[0].reason, count: r[0].count } : null; },
      /** when each attempt last sent a frame (no image data) */
      meta: async (ids) => (ids.length ? (await q('SELECT attempt_id, at, reason, count FROM cert_snaps WHERE attempt_id IN (?)', [ids])) : []).map((r) => ({ attemptId: r.attempt_id, at: r.at, reason: r.reason, count: r.count })),
    },

    // course-wise project register
    courseProjects: {
      all: async () => (await q('SELECT * FROM course_projects ORDER BY course_code, project_id')).map(toCProject),
      byCourses: async (codes) => (codes.length ? (await q('SELECT * FROM course_projects WHERE course_code IN (?) ORDER BY course_code, project_id', [codes])).map(toCProject) : []),
      replaceAll: async (rows) => {
        await q('DELETE FROM course_projects');
        for (let i = 0; i < rows.length; i += 500) {
          const chunk = rows.slice(i, i + 500);
          if (!chunk.length) continue;
          await q('INSERT INTO course_projects (id, course_code, course_name, project_id, title, domain) VALUES ?',
            [chunk.map((r) => [r.id, r.courseCode, r.courseName, r.projectId, r.title, r.domain])]);
        }
        return rows.length;
      },
    },

    facultyDir: {
      all: async () => (await q('SELECT * FROM faculty_directory')).map(toFac),
      get: async (fkey) => { const r = await q('SELECT * FROM faculty_directory WHERE fkey=?', [fkey]); return r[0] ? toFac(r[0]) : null; },
      byEmail: async (email) => { const r = await q('SELECT * FROM faculty_directory WHERE LOWER(email)=LOWER(?) LIMIT 1', [email]); return r[0] ? toFac(r[0]) : null; },
      byEmp: async (empId) => { const r = await q('SELECT * FROM faculty_directory WHERE emp_id=? LIMIT 1', [empId]); return r[0] ? toFac(r[0]) : null; },
      // Upsert; empty incoming fields never wipe stored ones.
      upsert: async (f) => {
        await q(`INSERT INTO faculty_directory (fkey, name, email, emp_id, updated_at) VALUES (?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE name=IF(VALUES(name)='', name, VALUES(name)), email=IF(VALUES(email)='', email, VALUES(email)),
                 emp_id=IF(VALUES(emp_id)='', emp_id, VALUES(emp_id)), updated_at=VALUES(updated_at)`,
          [f.key, f.name || '', f.email || '', f.empId || '', new Date().toISOString()]);
      },
    },
    facultyAuth: {
      add: async (a) => { await q('INSERT INTO faculty_auth (id, fkey, kind, secret_hash, expires_at, attempts, created_at) VALUES (?,?,?,?,?,?,?)', [a.id, a.fkey, a.kind, a.secretHash, a.expiresAt, a.attempts || 0, a.createdAt]); return a; },
      latest: async (fkey, kind) => { const r = await q('SELECT * FROM faculty_auth WHERE fkey=? AND kind=? ORDER BY created_at DESC LIMIT 1', [fkey, kind]); return r[0] ? toAuth(r[0]) : null; },
      countSince: async (fkey, kind, since) => (await q('SELECT COUNT(*) n FROM faculty_auth WHERE fkey=? AND kind=? AND created_at>=?', [fkey, kind, since]))[0].n,
      byHash: async (hash, kind) => { const r = await q('SELECT * FROM faculty_auth WHERE secret_hash=? AND kind=? LIMIT 1', [hash, kind]); return r[0] ? toAuth(r[0]) : null; },
      bumpAttempts: async (id) => { await q('UPDATE faculty_auth SET attempts=attempts+1 WHERE id=?', [id]); },
      remove: async (id) => { await q('DELETE FROM faculty_auth WHERE id=?', [id]); },
      removeKind: async (fkey, kind) => { await q('DELETE FROM faculty_auth WHERE fkey=? AND kind=?', [fkey, kind]); },
      purgeExpired: async (nowIso) => { await q('DELETE FROM faculty_auth WHERE expires_at<?', [nowIso]); },
    },
    programSessions: {
      byProgram: async (pid) => (await q('SELECT * FROM program_sessions WHERE program_id=? ORDER BY created_at', [pid])).map(toPSession),
      get: async (id) => { const r = await q('SELECT * FROM program_sessions WHERE id=?', [id]); return r[0] ? toPSession(r[0]) : null; },
      add: async (s) => { await q('INSERT INTO program_sessions (id, program_id, kind, name, session_date, start_time, end_time, open_rooms, auto_sched, auto_state, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [s.id, s.programId, s.kind, s.name, s.date, s.startTime, s.endTime, J(s.openRooms || []), s.auto ? 1 : 0, s.autoState || '', s.createdAt]); return s; },
      update: async (id, p) => {
        const map = { name: 'name', date: 'session_date', startTime: 'start_time', endTime: 'end_time', openRooms: 'open_rooms', auto: 'auto_sched', autoState: 'auto_state' };
        const sets = [], vals = [];
        for (const [k, v] of Object.entries(p)) { if (!map[k]) continue; sets.push(`${map[k]}=?`); vals.push(k === 'openRooms' ? J(v) : k === 'auto' ? (v ? 1 : 0) : v); }
        if (sets.length) { vals.push(id); await q(`UPDATE program_sessions SET ${sets.join(', ')} WHERE id=?`, vals); }
        const r = await q('SELECT * FROM program_sessions WHERE id=?', [id]); return r[0] ? toPSession(r[0]) : null;
      },
      remove: async (id) => { await q('DELETE FROM program_sessions WHERE id=?', [id]); },
      /** Move the schedule state only if nobody else has (all cluster workers run the scheduler). */
      claimAutoState: async (id, from, to) => (await q('UPDATE program_sessions SET auto_state=? WHERE id=? AND auto_state=?', [to, id, from])).affectedRows === 1,
    },
    programAttendance: {
      bySession: async (sid) => (await q('SELECT * FROM program_attendance WHERE session_id=?', [sid])).map(toPAtt),
      byProgram: async (pid) => (await q('SELECT * FROM program_attendance WHERE program_id=?', [pid])).map(toPAtt),
      get: async (sid, room) => { const r = await q('SELECT * FROM program_attendance WHERE session_id=? AND room=?', [sid, room]); return r[0] ? toPAtt(r[0]) : null; },
      set: async (a) => {
        await q(`INSERT INTO program_attendance (session_id, room, program_id, room_label, emp_id, faculty_name, marks, present, absent, total, posted_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE room_label=VALUES(room_label), emp_id=VALUES(emp_id), faculty_name=VALUES(faculty_name), marks=VALUES(marks),
                 present=VALUES(present), absent=VALUES(absent), total=VALUES(total), posted_at=VALUES(posted_at)`,
          [a.sessionId, a.room, a.programId, a.roomLabel, a.empId, a.facultyName, J(a.marks || {}), a.present, a.absent, a.total, a.postedAt]);
        return a;
      },
      remove: async (sid, room) => { const r = await q('DELETE FROM program_attendance WHERE session_id=? AND room=?', [sid, room]); return r.affectedRows || 0; },
    },
    programScores: {
      bySession: async (sid) => (await q('SELECT * FROM program_scores WHERE session_id=?', [sid])).map(toPScore),
      byProgram: async (pid) => (await q('SELECT * FROM program_scores WHERE program_id=?', [pid])).map(toPScore),
      set: async (s) => {
        await q(`INSERT INTO program_scores (session_id, reg, program_id, room, present, scores, total, by_emp, posted_at)
                 VALUES (?,?,?,?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE room=VALUES(room), present=VALUES(present), scores=VALUES(scores), total=VALUES(total), by_emp=VALUES(by_emp), posted_at=VALUES(posted_at)`,
          [s.sessionId, s.reg, s.programId, s.room, s.present ? 1 : 0, J(s.scores || {}), s.total || 0, s.byEmp || '', s.postedAt]);
        return s;
      },
      removeRoom: async (sid, room) => { const r = await q('DELETE FROM program_scores WHERE session_id=? AND room=?', [sid, room]); return r.affectedRows || 0; },
    },
  };
}

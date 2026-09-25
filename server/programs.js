// ============ Programs: room-wise attendance & hackathon review ============
// A Program is a titled event (e.g. "Skill Palavar – Slot 1", "Hackathon 2026") with its OWN
// Excel roster (student → room → 1..5 faculty), scheduled sessions, and room-wise attendance /
// hackathon review that the admin opens and closes per room.
//  • Faculty are identified by NAME (raw university lists rarely carry Emp IDs); a faculty
//    directory maps a name to an email (+ optional Emp ID) for OTP sign-in.
//  • On upload, review batches are created automatically INSIDE each room (never across rooms),
//    and whole batches are shared evenly among that room's faculty (a batch is never split).
//  • Attendance is room-level (any faculty of the room submits once); review marks are entered
//    only by the batch's assigned reviewer.
// Completely separate from the exam roster, attempts and the legacy attendance sessions.
import crypto from 'node:crypto';
import { sendMail, smtpConfigured, smtpUser } from './mailer.js';

export const roomKey = (r) => String(r || '').trim().toUpperCase().replace(/\s+/g, '') || '(NO ROOM)';
const txt = (v, n = 190) => String(v ?? '').trim().slice(0, n);
const KINDS = ['attendance', 'review'];

// ---- faculty identity ----
const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim();
/** Stable key for a faculty name: titles and punctuation removed ("Dr. GLP. Ashok" = "glpashok"). */
export const facultyKey = (name) => String(name || '').toLowerCase().replace(/\b(dr|mr|mrs|ms|miss|prof|smt)\b\.?/g, ' ').replace(/[^a-z]/g, '');
const PLACEHOLDER = new Set(['na', 'nil', 'none', 'reqd', 'required', 'tbd', 'tba', 'vacant', 'null']);
const isRealName = (n) => { const c = cleanName(n); const k = c.toLowerCase().replace(/[^a-z]/g, ''); return !!c && !PLACEHOLDER.has(k) && facultyKey(c).length >= 2; };
/** Faculty listed on a roster row → [{ key, name }] (deduped). */
function rowFaculty(s) {
  const names = (Array.isArray(s.facultyList) && s.facultyList.length ? s.facultyList : [s.facultyName]).filter(isRealName).map(cleanName);
  const seen = new Set(); const out = [];
  for (const n of names) { const k = facultyKey(n); if (!seen.has(k)) { seen.add(k); out.push({ key: k, name: n }); } }
  return out;
}
const byNatural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

// ---- OTP helpers ----
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const PEPPER = () => process.env.OTP_PEPPER || process.env.ADMIN_TOKEN || 'kl-otp';
const otpHash = (fkey, code) => sha(`${fkey}:${code}:${PEPPER()}`);
const OTP_DEBUG = () => process.env.OTP_DEBUG === '1' && process.env.NODE_ENV !== 'production';
const DEFAULT_MODE = () => (process.env.FACULTY_OTP === 'off' ? 'empid' : 'otp');
const maskEmail = (e) => String(e).replace(/^(.{2}).*(@.*)$/, '$1•••$2');
const OTP_TTL = 10 * 60_000, SESSION_TTL = 12 * 3600_000;

export function registerProgramRoutes(app, { db, requireAdmin, getRubric }) {
  // ---------- how faculty sign in ----------
  // 'otp'   → email OTP (needs SMTP + an email for every faculty)
  // 'empid' → Employee ID only (no email needed; anyone who knows the ID can post)
  let modeCache = { at: 0, v: '' };
  async function loginMode() {
    if (modeCache.v && Date.now() - modeCache.at < 10_000) return modeCache.v;
    const saved = await db.settings.get('faculty_login');
    const v = saved === 'empid' || saved === 'otp' ? saved : DEFAULT_MODE();
    modeCache = { at: Date.now(), v };
    return v;
  }
  const otpOn = async () => (await loginMode()) === 'otp' && (smtpConfigured() || OTP_DEBUG());
  const authInfo = async () => ({ mode: await loginMode(), otp: await otpOn(), smtp: smtpConfigured(), smtpUser: smtpUser() });

  // ---------- rooms & batches ----------
  /** Group a roster into rooms: label, faculty (1..5), students, batches, reviewer load. */
  function roomsOf(students, dir = new Map()) {
    const m = new Map();
    for (const s of students) {
      const k = roomKey(s.room);
      let r = m.get(k);
      if (!r) { r = { room: k, label: txt(s.room) || 'No room', faculty: new Map(), students: 0, batches: new Set(), rev: new Map() }; m.set(k, r); }
      r.students++;
      for (const f of rowFaculty(s)) if (!r.faculty.has(f.key)) r.faculty.set(f.key, { key: f.key, name: f.name, empId: s.empId && f.name === cleanName(s.facultyName) ? s.empId : '' });
      if (s.batchNo) r.batches.add(String(s.batchNo));
      if (s.reviewer) { const v = r.rev.get(s.reviewer) || { batches: new Set(), students: 0 }; v.students++; if (s.batchNo) v.batches.add(String(s.batchNo)); r.rev.set(s.reviewer, v); }
    }
    return [...m.values()].map((r) => ({
      room: r.room, label: r.label, students: r.students, batches: r.batches.size,
      faculty: [...r.faculty.values()].map((f) => { const d = dir.get(f.key); return { ...f, empId: f.empId || d?.empId || '', hasEmail: !!d?.email }; }),
      reviewers: [...r.rev.entries()].map(([key, v]) => ({ key, name: r.faculty.get(key)?.name || key, batches: v.batches.size, students: v.students })),
    })).sort((a, b) => byNatural(a.label, b.label));
  }

  /** Auto-batch INSIDE each room and share whole batches evenly among that room's faculty.
   *  Batch numbers from the file are kept; students without one are grouped `size` at a time. */
  function planBatches(students, size) {
    const n = Math.max(2, Math.min(10, Number(size) || 4));
    const rooms = new Map();
    for (const s of students) { const k = roomKey(s.room); (rooms.get(k) || rooms.set(k, []).get(k)).push(s); }
    const out = [];
    for (const list of rooms.values()) {
      list.sort((a, b) => byNatural(a.reg, b.reg));
      const batches = new Map();
      for (const s of list) if (s.batchNo) (batches.get(s.batchNo) || batches.set(s.batchNo, []).get(s.batchNo)).push(s);
      const loose = list.filter((s) => !s.batchNo);
      if (loose.length) {
        // as many batches as fit ~n each, sizes differing by at most one (30 @4 → 6×4 + 2×3)
        const k = Math.max(1, Math.round(loose.length / n));
        const chunks = []; let at = 0;
        for (let i = 0; i < k; i++) { const len = Math.floor(loose.length / k) + (i < loose.length % k ? 1 : 0); chunks.push(loose.slice(at, at + len)); at += len; }
        let next = Math.max(0, ...[...batches.keys()].map((k) => parseInt(String(k).replace(/\D/g, ''), 10)).filter(Number.isFinite)) + 1;
        for (const c of chunks) { let key; do { key = `B${next++}`; } while (batches.has(key)); batches.set(key, c); }
      }
      // room faculty in first-seen order (Main, Second, Third…)
      const fac = []; const seen = new Set();
      for (const s of list) for (const f of rowFaculty(s)) if (!seen.has(f.key)) { seen.add(f.key); fac.push(f.key); }
      const load = new Map(fac.map((k) => [k, { b: 0, s: 0 }]));
      for (const key of [...batches.keys()].sort(byNatural)) {
        const members = batches.get(key);
        let reviewer = '';
        if (fac.length) {
          reviewer = fac.reduce((best, k) => { const a = load.get(k), b = load.get(best); return a.b < b.b || (a.b === b.b && a.s < b.s) ? k : best; }, fac[0]);
          const l = load.get(reviewer); l.b++; l.s += members.length;
        }
        for (const s of members) out.push({ id: s.id, reg: s.reg, batchNo: String(key), reviewer, changed: s.batchNo !== String(key) || (s.reviewer || '') !== reviewer });
      }
    }
    return out;
  }
  async function rebuildBatches(pid, size) {
    const students = await db.programStudents.byProgram(pid);
    const plan = planBatches(students, size);
    const changed = plan.filter((p) => p.changed);
    if (changed.length) await db.programStudents.setBatches(pid, changed);
    return { batches: new Set(plan.map((p) => `${roomKey(students.find((s) => s.id === p.id)?.room)}|${p.batchNo}`)).size, reassigned: changed.length };
  }
  const batchSizeOf = async (pid) => Number(await db.settings.get(`program_batch_size:${pid}`)) || 4;

  const critMaxOf = (rubric) => { const m = {}; rubric.tables.forEach((t, ti) => t.criteria.forEach((c, ci) => { m[`t${ti}_c${ci}`] = c.max; })); return m; };
  const gradeOf = (p) => (p == null ? '' : p >= 85 ? 'Outstanding' : p >= 70 ? 'Good' : p >= 50 ? 'Average' : 'Needs Improvement');
  // batched students first (teams already reviewed), then those still waiting for a batch
  const byBatch = (a, b) => (!!b.batchNo - !!a.batchNo) || byNatural(a.batchNo, b.batchNo) || byNatural(a.reg, b.reg);
  const dirMap = async () => new Map((await db.facultyDir.all()).map((f) => [f.key, f]));
  async function loadSession(req, res) {
    const session = await db.programSessions.get(req.params.sid);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return null; }
    const program = await db.programs.get(session.programId);
    if (!program) { res.status(404).json({ error: 'Program not found' }); return null; }
    return { session, program };
  }
  /** Per-room status for a session (attendance posting or review progress). */
  async function roomStatus(session, students, dir) {
    const rooms = roomsOf(students, dir);
    const open = new Set(session.openRooms || []);
    if (session.kind === 'attendance') {
      const posts = new Map((await db.programAttendance.bySession(session.id)).map((p) => [p.room, p]));
      return rooms.map((r) => { const p = posts.get(r.room); return { ...r, open: open.has(r.room), posted: !!p, present: p ? p.present : 0, absent: p ? p.absent : 0, postedAt: p?.postedAt || null, postedBy: p ? p.facultyName : null }; });
    }
    const scores = await db.programScores.bySession(session.id);
    const agg = new Map();
    for (const s of scores) { const a = agg.get(s.room) || { scored: 0, present: 0, sum: 0, last: '' }; a.scored++; if (s.present) { a.present++; a.sum += s.total || 0; } if (s.postedAt > a.last) a.last = s.postedAt; agg.set(s.room, a); }
    return rooms.map((r) => { const a = agg.get(r.room) || { scored: 0, present: 0, sum: 0, last: '' }; return { ...r, open: open.has(r.room), scored: a.scored, present: a.present, avg: a.present ? Math.round((a.sum / a.present) * 10) / 10 : 0, postedAt: a.last || null, posted: a.scored > 0 && a.scored >= r.students }; });
  }

  // =============== ADMIN ===============
  app.get('/api/admin/programs', requireAdmin, async (_req, res) => {
    const out = [];
    for (const p of await db.programs.all()) {
      const [students, sessions] = await Promise.all([db.programStudents.byProgram(p.id), db.programSessions.byProgram(p.id)]);
      const open = (k) => sessions.filter((s) => s.kind === k).reduce((n, s) => n + (s.openRooms || []).length, 0);
      out.push({ ...p, students: students.length, rooms: roomsOf(students).length, attendanceSessions: sessions.filter((s) => s.kind === 'attendance').length, reviewSessions: sessions.filter((s) => s.kind === 'review').length, openRooms: open('attendance') + open('review'), openAttendance: open('attendance'), openReview: open('review'), batchSize: await batchSizeOf(p.id) });
    }
    res.json({ programs: out, auth: await authInfo() });
  });

  app.post('/api/admin/programs', requireAdmin, async (req, res) => {
    const title = txt(req.body?.title, 255);
    if (!title) return res.status(400).json({ error: 'Enter a program title.' });
    const p = { id: crypto.randomUUID(), title, createdAt: new Date().toISOString() };
    await db.programs.add(p); res.json(p);
  });
  app.post('/api/admin/programs/:id', requireAdmin, async (req, res) => {
    const title = txt(req.body?.title, 255);
    if (!title) return res.status(400).json({ error: 'Enter a program title.' });
    const p = await db.programs.update(req.params.id, { title });
    if (!p) return res.status(404).json({ error: 'Program not found' });
    res.json(p);
  });
  // Data protection: a program that already holds attendance or review marks can't be deleted.
  app.post('/api/admin/programs/:id/delete', requireAdmin, async (req, res) => {
    const p = await db.programs.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Program not found' });
    const [att, sc] = await Promise.all([db.programAttendance.byProgram(p.id), db.programScores.byProgram(p.id)]);
    if (att.length || sc.length) return res.status(403).json({ error: 'This program already has attendance or review marks, so it is kept permanently.' });
    await db.programs.remove(p.id); res.json({ ok: true });
  });

  /** Upload roster rows → upsert → build room batches + reviewers → remember faculty emails. */
  app.post('/api/admin/programs/:id/students/import', requireAdmin, async (req, res) => {
    const p = await db.programs.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Program not found' });
    const raw = Array.isArray(req.body?.students) ? req.body.students : null;
    if (!raw) return res.status(400).json({ error: 'Body must be { students: [...] }' });
    const seen = new Set(); const rows = []; let skipped = 0;
    for (const s of raw) {
      const reg = txt(s.reg ?? s.registrationNumber, 64); const name = txt(s.name);
      if (!reg || !name || seen.has(reg)) { skipped++; continue; }
      seen.add(reg);
      const faculty = (Array.isArray(s.faculty) ? s.faculty : [s.facultyName]).filter(isRealName).map((n) => txt(cleanName(n)));
      rows.push({ id: crypto.randomUUID(), reg, name, branch: txt(s.branch, 64), section: txt(s.section, 64), room: txt(s.room, 64), empId: txt(s.empId, 32), facultyName: faculty[0] || '', facultyList: faculty, batchNo: txt(s.batchNo, 32), project: txt(s.project, 2000), ps: txt(s.ps, 64), courseCode: txt(s.courseCode, 32).toUpperCase(), courseName: txt(s.courseName, 255) });
      // a roster that carries a faculty email / Emp ID fills the directory (for OTP sign-in)
      if (faculty[0] && (txt(s.facultyEmail) || txt(s.empId))) await db.facultyDir.upsert({ key: facultyKey(faculty[0]), name: faculty[0], email: txt(s.facultyEmail).toLowerCase(), empId: txt(s.empId, 32) });
    }
    if (!rows.length) return res.status(400).json({ error: 'No valid rows (each needs a registration number and a name).' });
    const size = Math.max(2, Math.min(10, Number(req.body?.batchSize) || await batchSizeOf(p.id)));
    await db.settings.set(`program_batch_size:${p.id}`, size);
    const r = await db.programStudents.importMany(p.id, rows, !!req.body?.replace);
    // batches are normally formed live by the faculty during the review; autoBatch=true
    // pre-splits each room into groups of `size` instead.
    if (req.body?.autoBatch) await rebuildBatches(p.id, size);
    const all = await db.programStudents.byProgram(p.id);
    const rooms = roomsOf(all);
    res.json({ ...r, skipped, batchSize: size, batches: new Set(all.filter((s) => s.batchNo).map((s) => `${roomKey(s.room)}|${s.batchNo}`)).size, rooms: rooms.length, roomsWithoutFaculty: rooms.filter((x) => !x.faculty.length).map((x) => x.label) });
  });

  /** Batches: { clear: true } empties them (faculty then form batches live during the review),
   *  otherwise they are rebuilt in groups of `batchSize` (reset=true re-does the auto ones). */
  app.post('/api/admin/programs/:id/batches', requireAdmin, async (req, res) => {
    const p = await db.programs.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Program not found' });
    const size = Math.max(2, Math.min(10, Number(req.body?.batchSize) || await batchSizeOf(p.id)));
    await db.settings.set(`program_batch_size:${p.id}`, size);
    if (req.body?.clear || req.body?.reset) {
      const all = await db.programStudents.byProgram(p.id);
      const wipe = req.body?.clear ? all.filter((s) => s.batchNo || s.reviewer) : all.filter((s) => /^B\d+$/.test(s.batchNo));
      if (wipe.length) await db.programStudents.setBatches(p.id, wipe.map((s) => ({ id: s.id, reg: s.reg, batchNo: '', reviewer: '' })));
      if (req.body?.clear) return res.json({ batchSize: size, batches: 0, cleared: wipe.length });
    }
    res.json({ batchSize: size, ...(await rebuildBatches(p.id, size)) });
  });

  app.get('/api/admin/programs/:id/students', requireAdmin, async (req, res) => res.json({ students: await db.programStudents.byProgram(req.params.id) }));

  /** Faculty of a program with their rooms, review load and registered email. */
  app.get('/api/admin/programs/:id/faculty', requireAdmin, async (req, res) => {
    const students = await db.programStudents.byProgram(req.params.id);
    const dir = await dirMap();
    const m = new Map();
    for (const r of roomsOf(students, dir)) {
      for (const f of r.faculty) {
        const e = m.get(f.key) || { key: f.key, name: f.name, rooms: [], students: 0, batches: 0, reviewStudents: 0, email: dir.get(f.key)?.email || '', empId: dir.get(f.key)?.empId || f.empId || '' };
        e.rooms.push(r.label); e.students += r.students;
        const rv = r.reviewers.find((x) => x.key === f.key); if (rv) { e.batches += rv.batches; e.reviewStudents += rv.students; }
        m.set(f.key, e);
      }
    }
    res.json({ faculty: [...m.values()].sort((a, b) => byNatural(a.rooms[0], b.rooms[0]) || a.name.localeCompare(b.name)), auth: await authInfo() });
  });

  /** Save faculty emails / Emp IDs: { rows: [{ name | key, email, empId }] } (matched by name). */
  app.post('/api/admin/faculty', requireAdmin, async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    let saved = 0; const invalid = [];
    for (const r of rows) {
      const name = cleanName(r.name); const key = txt(r.key) || facultyKey(name);
      const email = txt(r.email).toLowerCase();
      if (!key) continue;
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { invalid.push(`${name || key}: ${email}`); continue; }
      await db.facultyDir.upsert({ key, name, email, empId: txt(r.empId, 32) }); saved++;
    }
    res.json({ saved, invalid });
  });

  /** Switch how faculty sign in: { mode: 'otp' | 'empid' }. */
  app.post('/api/admin/faculty-login', requireAdmin, async (req, res) => {
    const mode = req.body?.mode === 'empid' ? 'empid' : 'otp';
    await db.settings.set('faculty_login', mode);
    modeCache = { at: 0, v: '' };
    res.json(await authInfo());
  });

  /** Upload the course-wise project register: { rows: [{ courseCode, courseName, projectId, title, domain }] }.
   *  Faculty then pick a team's project from the list for their room's certification course. */
  app.post('/api/admin/course-projects', requireAdmin, async (req, res) => {
    const raw = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!raw) return res.status(400).json({ error: 'Body must be { rows: [...] }' });
    const seen = new Set(); const rows = [];
    for (const r of raw) {
      const courseCode = txt(r.courseCode, 32).toUpperCase(); const title = txt(r.title, 500);
      if (!courseCode || !title) continue;
      const projectId = txt(r.projectId, 64);
      const key = `${courseCode}|${projectId || title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ id: crypto.randomUUID(), courseCode, courseName: txt(r.courseName, 255), projectId, title, domain: txt(r.domain, 190) });
    }
    if (!rows.length) return res.status(400).json({ error: 'No valid rows (each needs a course code and a project title).' });
    await db.courseProjects.replaceAll(rows);
    const byCourse = {};
    for (const r of rows) byCourse[r.courseCode] = (byCourse[r.courseCode] || 0) + 1;
    res.json({ total: rows.length, courses: Object.entries(byCourse).map(([code, n]) => ({ code, name: rows.find((r) => r.courseCode === code).courseName, projects: n })) });
  });

  /** The stored project register, with how many of each course's projects a program can use. */
  app.get('/api/admin/course-projects', requireAdmin, async (req, res) => {
    const all = await db.courseProjects.all();
    const byCourse = new Map();
    for (const r of all) { const e = byCourse.get(r.courseCode) || { code: r.courseCode, name: r.courseName, projects: 0 }; e.projects++; byCourse.set(r.courseCode, e); }
    let used = [];
    if (req.query.programId) {
      const students = await db.programStudents.byProgram(String(req.query.programId));
      const m = new Map();
      for (const s of students) {
        const code = (s.courseCode || '').toUpperCase(); if (!code) continue;
        const e = m.get(code) || { code, name: s.courseName || '', students: 0, rooms: new Set() };
        e.students++; e.rooms.add(roomKey(s.room)); m.set(code, e);
      }
      used = [...m.values()].map((e) => ({ ...e, rooms: [...e.rooms].sort(byNatural), projects: byCourse.get(e.code)?.projects || 0 })).sort((a, b) => byNatural(a.code, b.code));
    }
    res.json({ total: all.length, courses: [...byCourse.values()].sort((a, b) => byNatural(a.code, b.code)), used });
  });

  /** Send a test email to check the SMTP setup. */
  app.post('/api/admin/smtp/test', requireAdmin, async (req, res) => {
    const to = txt(req.body?.to);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: 'Enter a valid email address.' });
    try { await sendMail({ to, subject: 'KL QuizApp — test email', text: 'Email sending works. Faculty will receive their sign-in codes from this address.' }); res.json({ ok: true }); }
    catch (e) { res.status(502).json({ error: e.message }); }
  });

  app.get('/api/admin/programs/:id/sessions', requireAdmin, async (req, res) => {
    const kind = String(req.query.kind || '');
    const all = await db.programSessions.byProgram(req.params.id);
    res.json({ sessions: KINDS.includes(kind) ? all.filter((s) => s.kind === kind) : all });
  });
  app.post('/api/admin/programs/:id/sessions', requireAdmin, async (req, res) => {
    const p = await db.programs.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Program not found' });
    const kind = String(req.body?.kind || '');
    if (!KINDS.includes(kind)) return res.status(400).json({ error: 'kind must be attendance or review' });
    const count = (await db.programSessions.byProgram(p.id)).filter((s) => s.kind === kind).length;
    const s = { id: crypto.randomUUID(), programId: p.id, kind, name: txt(req.body?.name) || (kind === 'review' ? `Review ${count + 1}` : `Session ${count + 1}`), date: txt(req.body?.date, 16), startTime: txt(req.body?.startTime, 8), endTime: txt(req.body?.endTime, 8), openRooms: [], createdAt: new Date().toISOString() };
    await db.programSessions.add(s); res.json(s);
  });
  app.post('/api/admin/program-sessions/:sid', requireAdmin, async (req, res) => {
    const patch = {};
    for (const [k, n] of [['name', 190], ['date', 16], ['startTime', 8], ['endTime', 8]]) if (typeof req.body?.[k] === 'string') patch[k] = txt(req.body[k], n);
    const s = await db.programSessions.update(req.params.sid, patch);
    if (!s) return res.status(404).json({ error: 'Session not found' });
    res.json(s);
  });
  app.post('/api/admin/program-sessions/:sid/delete', requireAdmin, async (req, res) => {
    const ctx = await loadSession(req, res); if (!ctx) return;
    const has = ctx.session.kind === 'attendance' ? (await db.programAttendance.bySession(ctx.session.id)).length : (await db.programScores.bySession(ctx.session.id)).length;
    if (has) return res.status(403).json({ error: 'This session already has submitted data and is kept permanently.' });
    await db.programSessions.remove(ctx.session.id); res.json({ ok: true });
  });

  /** Room board for one session — the room cards. */
  app.get('/api/admin/program-sessions/:sid/board', requireAdmin, async (req, res) => {
    const ctx = await loadSession(req, res); if (!ctx) return;
    const students = await db.programStudents.byProgram(ctx.program.id);
    const rooms = await roomStatus(ctx.session, students, await dirMap());
    const summary = { rooms: rooms.length, open: rooms.filter((r) => r.open).length, posted: rooms.filter((r) => r.posted).length, students: students.length, present: rooms.reduce((n, r) => n + (r.present || 0), 0), absent: rooms.reduce((n, r) => n + (r.absent || 0), 0), scored: rooms.reduce((n, r) => n + (r.scored || 0), 0), noFaculty: rooms.filter((r) => !r.faculty.length).length };
    const maxTotal = ctx.session.kind === 'review' ? Object.values(critMaxOf(await getRubric())).reduce((n, v) => n + v, 0) : 0;
    res.json({ program: ctx.program, session: ctx.session, rooms, summary, maxTotal });
  });

  /** Open or close rooms: { open: true|false, rooms: ['C121', ...] | 'ALL' }. */
  app.post('/api/admin/program-sessions/:sid/rooms', requireAdmin, async (req, res) => {
    const ctx = await loadSession(req, res); if (!ctx) return;
    const all = roomsOf(await db.programStudents.byProgram(ctx.program.id)).map((r) => r.room);
    const target = req.body?.rooms === 'ALL' ? all : (Array.isArray(req.body?.rooms) ? req.body.rooms.map(roomKey).filter((r) => all.includes(r)) : []);
    if (!target.length) return res.status(400).json({ error: 'No matching rooms.' });
    const open = new Set(ctx.session.openRooms || []);
    for (const r of target) { if (req.body?.open) open.add(r); else open.delete(r); }
    const s = await db.programSessions.update(ctx.session.id, { openRooms: [...open] });
    res.json({ ok: true, openRooms: s.openRooms });
  });

  /** One room's detail: students + attendance mark or review scores (with batch + reviewer). */
  app.get('/api/admin/program-sessions/:sid/rooms/:room', requireAdmin, async (req, res) => {
    const ctx = await loadSession(req, res); if (!ctx) return;
    const room = roomKey(req.params.room);
    const students = (await db.programStudents.byProgram(ctx.program.id)).filter((s) => roomKey(s.room) === room).sort(byBatch);
    const info = roomsOf(students, await dirMap())[0] || { faculty: [], reviewers: [] };
    const nameOf = new Map(info.faculty.map((f) => [f.key, f.name]));
    const open = (ctx.session.openRooms || []).includes(room);
    const lite = (s) => ({ ...s, reviewerName: nameOf.get(s.reviewer) || '' });
    if (ctx.session.kind === 'attendance') {
      const p = await db.programAttendance.get(ctx.session.id, room);
      return res.json({ program: ctx.program, session: ctx.session, room, open, faculty: info.faculty, posting: p, students: students.map((s) => ({ ...lite(s), present: p ? !!p.marks[s.reg] : null })) });
    }
    const rubric = await getRubric(); const critMax = critMaxOf(rubric);
    const scores = new Map((await db.programScores.bySession(ctx.session.id)).filter((s) => s.room === room).map((s) => [s.reg, s]));
    res.json({
      program: ctx.program, session: ctx.session, room, open, faculty: info.faculty, reviewers: info.reviewers, rubric, maxTotal: Object.values(critMax).reduce((n, v) => n + v, 0),
      students: students.map((s) => {
        const sc = scores.get(s.reg);
        const outOf = sc ? Object.keys(sc.scores || {}).reduce((n, k) => n + (critMax[k] || 0), 0) : 0;
        const pctv = sc && sc.present && outOf ? Math.round((sc.total / outOf) * 100) : null;
        return { ...lite(s), scored: !!sc, present: sc ? sc.present : null, scores: sc ? sc.scores : {}, total: sc ? sc.total : null, percentage: pctv, grade: gradeOf(pctv) };
      }),
    });
  });

  /** Clear a room's submission so its faculty can post again. */
  app.post('/api/admin/program-sessions/:sid/rooms/:room/revoke', requireAdmin, async (req, res) => {
    const ctx = await loadSession(req, res); if (!ctx) return;
    const room = roomKey(req.params.room);
    const removed = ctx.session.kind === 'attendance' ? await db.programAttendance.remove(ctx.session.id, room) : await db.programScores.removeRoom(ctx.session.id, room);
    res.json({ ok: true, removed });
  });

  /** Flat rows for an Excel export of one session. */
  app.get('/api/admin/program-sessions/:sid/export', requireAdmin, async (req, res) => {
    const ctx = await loadSession(req, res); if (!ctx) return;
    const students = (await db.programStudents.byProgram(ctx.program.id)).sort((a, b) => byNatural(roomKey(a.room), roomKey(b.room)) || byBatch(a, b));
    const facNames = new Map(); for (const s of students) for (const f of rowFaculty(s)) facNames.set(f.key, f.name);
    const roomFac = new Map(roomsOf(students).map((r) => [r.room, r.faculty.map((f) => f.name).join(', ')]));
    if (ctx.session.kind === 'attendance') {
      const posts = new Map((await db.programAttendance.bySession(ctx.session.id)).map((p) => [p.room, p]));
      const rows = students.map((s) => { const p = posts.get(roomKey(s.room)); return { 'Reg No': s.reg, Name: s.name, Branch: s.branch, Section: s.section, Room: s.room, Faculty: roomFac.get(roomKey(s.room)) || '', Status: p ? (p.marks[s.reg] ? 'Present' : 'Absent') : 'Not posted', 'Posted by': p?.facultyName || '', 'Posted at': p ? new Date(p.postedAt).toLocaleString('en-IN') : '' }; });
      return res.json({ program: ctx.program, session: ctx.session, rows });
    }
    const rubric = await getRubric(); const critMax = critMaxOf(rubric);
    const flat = []; rubric.tables.forEach((t, ti) => t.criteria.forEach((c, ci) => flat.push({ key: `t${ti}_c${ci}`, label: c.label, max: c.max })));
    const scores = new Map((await db.programScores.bySession(ctx.session.id)).map((s) => [s.reg, s]));
    const rows = students.map((s) => {
      const sc = scores.get(s.reg);
      const outOf = sc ? Object.keys(sc.scores || {}).reduce((n, k) => n + (critMax[k] || 0), 0) : 0;
      const pctv = sc && sc.present && outOf ? Math.round((sc.total / outOf) * 100) : null;
      const row = { 'Reg No': s.reg, Name: s.name, Room: s.room, Batch: s.batchNo, Reviewer: facNames.get(s.reviewer) || '', Project: s.project, PS: s.ps, Present: sc ? (sc.present ? 'Present' : 'Absent') : 'Not scored' };
      for (const c of flat) row[`${c.label} (/${c.max})`] = sc ? (sc.scores?.[c.key] ?? '') : '';
      row.Total = sc ? sc.total : ''; row['%'] = pctv ?? ''; row.Grade = gradeOf(pctv);
      return row;
    });
    res.json({ program: ctx.program, session: ctx.session, rows });
  });

  // =============== FACULTY SIGN-IN (email OTP) ===============
  /** Resolve an email / Emp ID to a faculty { key, name }. */
  async function findFaculty(id) {
    const raw = txt(id); if (!raw) return null;
    if (raw.includes('@')) { const f = await db.facultyDir.byEmail(raw); return f ? { key: f.key, name: f.name, email: f.email } : null; }
    const d = await db.facultyDir.byEmp(raw);
    if (d) return { key: d.key, name: d.name, email: d.email };
    const rows = await db.programStudents.byEmp(raw); // rosters that carry Emp IDs
    const name = rows.find((r) => r.facultyName)?.facultyName;
    return name ? { key: facultyKey(name), name, email: '' } : null;
  }
  /** Who is calling? With OTP on: a signed-in session token; otherwise the email / Emp ID sent. */
  async function authFaculty(req, res) {
    if (await otpOn()) {
      const tok = String(req.headers['x-faculty-token'] || '');
      const s = tok ? await db.facultyAuth.byHash(sha(tok), 'session') : null;
      if (!s || s.expiresAt < new Date().toISOString()) { res.status(401).json({ error: 'Please sign in with the OTP sent to your email.', reauth: true }); return null; }
      const d = await db.facultyDir.get(s.fkey);
      return { key: s.fkey, name: d?.name || '' };
    }
    const f = await findFaculty(req.body?.id ?? req.body?.empId);
    if (!f) { res.status(404).json({ error: 'No faculty found for this email / Employee ID. Please contact the coordinator.' }); return null; }
    return f;
  }

  app.get('/api/faculty/auth-mode', async (_req, res) => res.json({ otp: await otpOn(), mode: await loginMode() }));

  app.post('/api/faculty/otp/request', async (req, res) => {
    if (!(await otpOn())) return res.status(400).json({ error: 'OTP sign-in is not enabled.' });
    const f = await findFaculty(req.body?.id);
    if (!f) return res.status(404).json({ error: 'No faculty is registered with this email / Employee ID. Please contact the coordinator.' });
    const email = (await db.facultyDir.get(f.key))?.email || f.email;
    if (!email) return res.status(400).json({ error: 'No email is registered for you yet. Please contact the coordinator.' });
    const now = Date.now();
    const last = await db.facultyAuth.latest(f.key, 'otp');
    if (last && now - Date.parse(last.createdAt) < 60_000) return res.status(429).json({ error: 'An OTP was just sent. Please check your email or wait a minute.' });
    if (await db.facultyAuth.countSince(f.key, 'otp', new Date(now - 3600_000).toISOString()) >= 6) return res.status(429).json({ error: 'Too many OTP requests. Please try again later.' });
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const rec = { id: crypto.randomUUID(), fkey: f.key, kind: 'otp', secretHash: otpHash(f.key, code), expiresAt: new Date(now + OTP_TTL).toISOString(), attempts: 0, createdAt: new Date(now).toISOString() };
    await db.facultyAuth.add(rec);
    if (!OTP_DEBUG()) {
      try {
        await sendMail({
          to: email, subject: `${code} is your KL sign-in code`,
          text: `Dear ${f.name || 'Faculty'},\n\nYour sign-in code for KL attendance / hackathon review is ${code}.\nIt is valid for 10 minutes. Do not share it with anyone.\n\n— KL Skill Development`,
          html: `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#0f172a">Dear ${String(f.name || 'Faculty').replace(/</g, '&lt;')},<br><br>Your sign-in code for KL attendance / hackathon review is<div style="font-size:30px;font-weight:800;letter-spacing:6px;margin:14px 0;color:#0f766e">${code}</div>It is valid for <b>10 minutes</b>. Do not share it with anyone.<br><br>— KL Skill Development</div>`,
        });
      } catch (e) { await db.facultyAuth.remove(rec.id); return res.status(502).json({ error: `Could not send the OTP email: ${e.message}` }); }
    }
    res.json({ ok: true, to: maskEmail(email), ...(OTP_DEBUG() ? { debugCode: code } : {}) });
  });

  app.post('/api/faculty/otp/verify', async (req, res) => {
    if (!(await otpOn())) return res.status(400).json({ error: 'OTP sign-in is not enabled.' });
    const f = await findFaculty(req.body?.id);
    if (!f) return res.status(404).json({ error: 'No faculty is registered with this email / Employee ID.' });
    const code = txt(req.body?.code, 12).replace(/\D/g, '');
    const last = await db.facultyAuth.latest(f.key, 'otp');
    if (!last || last.expiresAt < new Date().toISOString()) return res.status(400).json({ error: 'This OTP has expired. Please request a new one.' });
    if (last.attempts >= 5) return res.status(429).json({ error: 'Too many wrong attempts. Please request a new OTP.' });
    const a = Buffer.from(otpHash(f.key, code)), b = Buffer.from(last.secretHash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { await db.facultyAuth.bumpAttempts(last.id); return res.status(400).json({ error: `Incorrect OTP. ${Math.max(0, 4 - last.attempts)} attempt(s) left.` }); }
    await db.facultyAuth.removeKind(f.key, 'otp');
    const token = crypto.randomBytes(32).toString('hex');
    await db.facultyAuth.add({ id: crypto.randomUUID(), fkey: f.key, kind: 'session', secretHash: sha(token), expiresAt: new Date(Date.now() + SESSION_TTL).toISOString(), attempts: 0, createdAt: new Date().toISOString() });
    db.facultyAuth.purgeExpired(new Date().toISOString()).catch(() => {});
    res.json({ token, faculty: { name: f.name, email: maskEmail((await db.facultyDir.get(f.key))?.email || '') } });
  });

  app.post('/api/faculty/logout', async (req, res) => {
    const tok = String(req.headers['x-faculty-token'] || '');
    if (tok) { const s = await db.facultyAuth.byHash(sha(tok), 'session'); if (s) await db.facultyAuth.remove(s.id); }
    res.json({ ok: true });
  });

  // =============== FACULTY: rooms, attendance, review ===============
  /** Room cards for this faculty across programs. Attendance: rooms they're listed in.
   *  Review: rooms where they are the assigned reviewer of at least one batch. */
  app.post('/api/faculty/program/login', async (req, res) => {
    const me = await authFaculty(req, res); if (!me) return;
    const kind = KINDS.includes(req.body?.kind) ? req.body.kind : 'attendance';
    const cards = [];
    for (const program of await db.programs.all()) {
      const sessions = (await db.programSessions.byProgram(program.id)).filter((s) => s.kind === kind);
      if (!sessions.length) continue;
      const roster = await db.programStudents.byProgram(program.id);
      const mine = new Map(); // room -> its students (a room's faculty handle the whole room)
      for (const r of roomsOf(roster)) {
        const inRoom = roster.filter((s) => roomKey(s.room) === r.room);
        if (r.faculty.some((f) => f.key === me.key) || inRoom.some((s) => s.reviewer === me.key)) mine.set(r.room, inRoom);
      }
      if (!mine.size) continue;
      for (const session of sessions) {
        const status = new Map((await roomStatus(session, roster)).map((r) => [r.room, r]));
        const scored = kind === 'review' ? new Set((await db.programScores.bySession(session.id)).map((s) => s.reg)) : null;
        for (const [room, list] of mine) {
          const r = status.get(room);
          const myScored = scored ? list.filter((s) => scored.has(s.reg)).length : 0;
          cards.push({ programId: program.id, programTitle: program.title, sessionId: session.id, sessionName: session.name, date: session.date, startTime: session.startTime, endTime: session.endTime, room, label: r.label, students: list.length, batches: new Set(list.filter((s) => s.batchNo).map((s) => s.batchNo)).size, open: r.open, posted: kind === 'attendance' ? r.posted : myScored > 0 && myScored >= list.length, present: r.present || 0, absent: r.absent || 0, scored: myScored, postedAt: r.postedAt });
        }
      }
    }
    cards.sort((a, b) => (b.open - a.open) || String(b.date).localeCompare(String(a.date)) || byNatural(a.label, b.label));
    if (!cards.length && !(await db.programs.all()).length) return res.status(404).json({ error: 'No programs yet.' });
    res.json({ faculty: { name: me.name }, kind, cards });
  });

  /** Verify this faculty may act on the room. A room's faculty see all of its students —
   *  for a review they group them into batches themselves as the teams present. */
  async function facultyRoom(req, res) {
    const me = await authFaculty(req, res); if (!me) return null;
    const room = roomKey(req.body?.room);
    const session = await db.programSessions.get(String(req.body?.sessionId || ''));
    if (!session) { res.status(400).json({ error: 'Missing session.' }); return null; }
    const students = (await db.programStudents.byProgram(session.programId)).filter((s) => roomKey(s.room) === room).sort(byBatch);
    const info = roomsOf(students)[0];
    const mine = session.kind === 'review' && students.some((s) => s.reviewer === me.key);
    if (!info?.faculty.some((f) => f.key === me.key) && !mine) { res.status(403).json({ error: 'This room is not assigned to you.' }); return null; }
    return { me, room, session, program: await db.programs.get(session.programId), students, label: info?.label || room, open: (session.openRooms || []).includes(room) };
  }

  app.post('/api/faculty/program/room', async (req, res) => {
    const c = await facultyRoom(req, res); if (!c) return;
    const base = { program: c.program, session: { id: c.session.id, name: c.session.name, kind: c.session.kind, date: c.session.date, startTime: c.session.startTime, endTime: c.session.endTime }, room: c.room, label: c.label, open: c.open };
    const lite = (s) => ({ reg: s.reg, name: s.name, branch: s.branch, section: s.section, batchNo: s.batchNo, project: s.project, ps: s.ps, courseCode: s.courseCode || '', courseName: s.courseName || '' });
    if (c.session.kind === 'attendance') {
      const p = await db.programAttendance.get(c.session.id, c.room);
      return res.json({ ...base, posting: p ? { postedAt: p.postedAt, present: p.present, absent: p.absent, total: p.total, by: p.facultyName } : null, students: c.students.map((s) => ({ ...lite(s), present: p ? !!p.marks[s.reg] : null })) });
    }
    const rubric = await getRubric(); const critMax = critMaxOf(rubric);
    const scores = new Map((await db.programScores.bySession(c.session.id)).filter((s) => s.room === c.room).map((s) => [s.reg, s]));
    // the project register for this room's certification course(s)
    const codes = [...new Set(c.students.map((s) => (s.courseCode || '').toUpperCase()).filter(Boolean))];
    const projects = codes.length ? await db.courseProjects.byCourses(codes) : [];
    const courses = codes.map((code) => ({ code, name: c.students.find((s) => (s.courseCode || '').toUpperCase() === code)?.courseName || '' }));
    res.json({
      ...base, rubric, courses, projects: projects.map((p) => ({ projectId: p.projectId, title: p.title, domain: p.domain, courseCode: p.courseCode })),
      maxTotal: Object.values(critMax).reduce((n, v) => n + v, 0),
      students: c.students.map((s) => { const sc = scores.get(s.reg); return { ...lite(s), scored: !!sc, present: sc ? sc.present : true, scores: sc ? sc.scores : {}, total: sc ? sc.total : 0 }; }),
    });
  });

  /** Submit attendance for the whole room — once per session (admin can revoke to redo). */
  app.post('/api/faculty/program/attendance', async (req, res) => {
    const c = await facultyRoom(req, res); if (!c) return;
    if (c.session.kind !== 'attendance') return res.status(400).json({ error: 'This is not an attendance session.' });
    if (!c.open) return res.status(403).json({ error: 'Attendance for this room is not open. Please ask the coordinator to open it.' });
    const existing = await db.programAttendance.get(c.session.id, c.room);
    if (existing) return res.status(409).json({ error: `Attendance for this room was already submitted${existing.facultyName ? ` by ${existing.facultyName}` : ''} — it is locked. Ask the coordinator to revoke it if a change is needed.` });
    const marks = (req.body?.marks && typeof req.body.marks === 'object') ? req.body.marks : {};
    const clean = {}; let present = 0;
    for (const s of c.students) { const p = !!marks[s.reg]; clean[s.reg] = p; if (p) present++; }
    const rec = { sessionId: c.session.id, room: c.room, programId: c.session.programId, roomLabel: c.label, empId: c.me.key, facultyName: c.me.name, marks: clean, present, absent: c.students.length - present, total: c.students.length, postedAt: new Date().toISOString() };
    await db.programAttendance.set(rec);
    res.json({ ok: true, present, absent: rec.absent, total: rec.total, postedAt: rec.postedAt });
  });

  /** Save review marks for the room (re-savable while the room is open). Rows may also carry
   *  the batch number and project title the faculty typed — students sharing a batch number
   *  in this room form one team, and the team's project title is copied to all its members. */
  app.post('/api/faculty/program/review', async (req, res) => {
    const c = await facultyRoom(req, res); if (!c) return;
    if (c.session.kind !== 'review') return res.status(400).json({ error: 'This is not a review session.' });
    if (!c.open) return res.status(403).json({ error: 'Review for this room is not open. Please ask the coordinator to open it.' });
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const critMax = critMaxOf(await getRubric());
    const mine = new Set(c.students.map((s) => s.reg));
    const now = new Date().toISOString(); let saved = 0; const projects = []; const batches = new Map();
    for (const r of rows) {
      const reg = txt(r.reg, 64); if (!mine.has(reg)) continue;
      if (typeof r.project === 'string') projects.push({ reg, project: txt(r.project, 2000), ps: txt(r.projectId, 64) });
      if (typeof r.batchNo === 'string') batches.set(reg, txt(r.batchNo, 32).toUpperCase());
      const scores = {};
      for (const [k, v] of Object.entries(r.scores || {})) { if (critMax[k] == null) continue; const n = Math.round(Number(v)); if (!isNaN(n) && n >= 0) scores[k] = Math.min(n, critMax[k]); }
      const present = r.present !== false;
      await db.programScores.set({ sessionId: c.session.id, reg, programId: c.session.programId, room: c.room, present, scores: present ? scores : {}, total: present ? Object.values(scores).reduce((n, v) => n + v, 0) : 0, byEmp: c.me.key, postedAt: now });
      saved++;
    }
    // batch numbers typed during the review (the faculty who typed them becomes the reviewer)
    const byId = new Map(c.students.map((s) => [s.reg, s]));
    const newBatch = [...batches.entries()].filter(([reg, b]) => (byId.get(reg).batchNo || '') !== b)
      .map(([reg, b]) => ({ id: byId.get(reg).id, reg, batchNo: b, reviewer: b ? c.me.key : '' }));
    if (newBatch.length) await db.programStudents.setBatches(c.session.programId, newBatch);
    // one project title per team: copy it to every member of the same batch in this room
    const teamProject = new Map();
    for (const p of projects) { const b = batches.get(p.reg) ?? byId.get(p.reg).batchNo; if (b && p.project) teamProject.set(b, { project: p.project, ps: p.ps }); }
    for (const s of c.students) {
      const b = batches.get(s.reg) ?? s.batchNo;
      if (!b || !teamProject.has(b)) continue;
      const t = teamProject.get(b);
      const own = projects.find((p) => p.reg === s.reg);
      if (!own) projects.push({ reg: s.reg, ...t });
      else if (!own.project) Object.assign(own, t); // a blank member keeps the team's title
    }
    const changed = projects.filter((p) => (byId.get(p.reg)?.project || '') !== p.project || (p.ps && (byId.get(p.reg)?.ps || '') !== p.ps));
    if (changed.length) await db.programStudents.setProjects(c.session.programId, changed);
    res.json({ ok: true, saved, batched: newBatch.length, postedAt: now });
  });
}

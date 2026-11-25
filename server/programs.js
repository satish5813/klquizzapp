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

/** The coordinator's program details (course, academic year, plan…), merged over what is stored. */
function cleanMeta(m, cur = {}) {
  const out = { ...cur };
  if (!m || typeof m !== 'object') return out;
  for (const [k, n] of [['courseCode', 32], ['courseName', 255], ['academicYear', 16], ['semester', 32], ['department', 190], ['venue', 190], ['startDate', 16], ['endDate', 16], ['status', 16], ['notes', 2000]]) if (typeof m[k] === 'string') out[k] = txt(m[k], n);
  if (out.courseCode) out.courseCode = out.courseCode.toUpperCase();
  for (const [k, lo, hi] of [['reviews', 0, 10], ['attendanceCount', 0, 20], ['batchSize', 2, 10], ['step', 0, 20]]) if (m[k] !== undefined && Number.isFinite(Number(m[k]))) out[k] = Math.max(lo, Math.min(hi, Math.round(Number(m[k]))));
  if (typeof m.autoBatch === 'boolean') out.autoBatch = m.autoBatch;
  if (m.rubric && typeof m.rubric === 'object') out.rubric = m.rubric;
  return out;
}

// ---- OTP helpers ----
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const PEPPER = () => process.env.OTP_PEPPER || process.env.ADMIN_TOKEN || 'kl-otp';
const otpHash = (fkey, code) => sha(`${fkey}:${code}:${PEPPER()}`);
const OTP_DEBUG = () => process.env.OTP_DEBUG === '1' && process.env.NODE_ENV !== 'production';
const DEFAULT_MODE = () => (process.env.FACULTY_OTP === 'off' ? 'empid' : 'otp');
const maskEmail = (e) => String(e).replace(/^(.{2}).*(@.*)$/, '$1•••$2');
const OTP_TTL = 10 * 60_000, SESSION_TTL = 12 * 3600_000;

export function registerProgramRoutes(app, { db, requireAdmin, getRubric, normalizeRubric = (r) => r }) {
  // ---------- who may manage a program ----------
  // The admin (x-admin-token) manages every program. A course coordinator (x-cc-token, signed in
  // by email OTP) manages only the programs they created. Route params :id (program) and :sid
  // (session) are checked against the coordinator's ownership.
  async function ccOf(req) {
    const tok = String(req.headers['x-cc-token'] || '');
    if (!tok) return null;
    const s = await db.facultyAuth.byHash(sha(tok), 'ccsess');
    if (!s || s.expiresAt < new Date().toISOString()) return null;
    const cc = await db.ccAccounts.get(String(s.fkey).replace(/^cc:/, ''));
    return cc && cc.active ? cc : null;
  }
  const progGuard = async (req, res, next) => {
    try {
      if (req.headers['x-admin-token']) return requireAdmin(req, res, next);
      const cc = await ccOf(req);
      if (!cc) return res.status(401).json({ error: 'Please sign in again.', reauth: true });
      req.cc = cc;
      let pid = '';
      if (req.params.sid) { const s = await db.programSessions.get(req.params.sid); if (!s) return res.status(404).json({ error: 'Session not found' }); pid = s.programId; }
      else if (req.params.id) pid = req.params.id;
      if (pid) {
        const p = await db.programs.get(pid);
        if (!p) return res.status(404).json({ error: 'Program not found' });
        if ((p.ownerCc || '') !== cc.id) return res.status(403).json({ error: 'This hackathon belongs to another coordinator.' });
      }
      next();
    } catch (e) { res.status(500).json({ error: e.message }); }
  };
  /** A program's own rubric if its coordinator set one, otherwise the global review rubric. */
  async function rubricFor(pid) {
    const p = pid ? await db.programs.get(pid) : null;
    const r = p?.meta?.rubric;
    return r && Array.isArray(r.tables) && r.tables.some((t) => (t.criteria || []).length) ? normalizeRubric(r) : getRubric();
  }
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

  // ---------- automatic open / close ----------
  // A session with `auto` on opens ALL its rooms at its start time and closes them at its end
  // time (Indian time), and emails the program's faculty REMIND_MS before it opens. Each step
  // happens once (autoState '' → reminded → opened → closed), so the admin can still open or
  // close single rooms by hand in between. Every cluster worker runs the tick; the database
  // claim lets exactly one of them perform each step.
  const REMIND_MS = 5 * 60_000;
  const HHMM = /^(\d{1,2}):(\d{2})$/;
  function windowOf(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date || '') || !HHMM.test(s.startTime || '') || !HHMM.test(s.endTime || '')) return null;
    const at = (t) => Date.parse(`${s.date}T${t.padStart(5, '0')}:00+05:30`);
    const start = at(s.startTime); let end = at(s.endTime);
    if (end <= start) end += 86_400_000; // runs past midnight
    return Number.isFinite(start) ? { start, end } : null;
  }
  const clock = (t) => { const [, h, m] = HHMM.exec(t); const n = Number(h); return `${n % 12 || 12}:${m} ${n < 12 ? 'AM' : 'PM'}`; };
  const longDate = (d) => new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });

  /** The faculty site lives on the API's own host; remember it from an admin request for emails. */
  function rememberPublicUrl(req) {
    const host = req.get('x-forwarded-host') || req.get('host');
    if (!host || /^(localhost|127\.)/.test(host)) return;
    const url = `${(req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0]}://${host}`;
    db.settings.set('public_url', url).catch(() => {});
  }
  const publicUrl = async () => process.env.PUBLIC_URL || (await db.settings.get('public_url')) || '';

  async function sendReminders(program, s) {
    if (!smtpConfigured()) { console.log(`[schedule] no SMTP — reminder for "${s.name}" skipped`); return 0; }
    const dir = await dirMap();
    const emails = new Set();
    for (const r of roomsOf(await db.programStudents.byProgram(program.id), dir)) for (const f of r.faculty) { const e = dir.get(f.key)?.email; if (e) emails.add(e.trim().toLowerCase()); }
    if (!emails.size) return 0;
    const base = await publicUrl();
    const link = base ? `${base}/${s.kind === 'review' ? 'hackathon-review' : 'attendance'}` : '';
    const what = s.kind === 'review' ? 'Hackathon review' : 'Attendance';
    const subject = `${what} opens at ${clock(s.startTime)} — ${program.title} · ${s.name}`;
    const text = [
      'Dear Faculty,', '',
      `${what} for ${program.title} — ${s.name} opens in 5 minutes.`, '',
      `Date: ${longDate(s.date)}`,
      `Window: ${clock(s.startTime)} to ${clock(s.endTime)} (rooms close automatically at ${clock(s.endTime)})`, '',
      link ? `Open: ${link}` : '',
      'Sign in with your Emp ID or KL email, enter the code sent to your email, and you will see your room(s).',
      s.kind === 'attendance' ? 'Mark Present for each student and submit once per room.' : 'Enter the batch number and marks for each team, then save.', '',
      'KL Skill Development',
    ].filter((l) => l !== null).join('\n');
    // Microsoft 365 allows ~30 messages a minute, so send one message per 40 faculty in Bcc.
    const list = [...emails]; let sent = 0;
    for (let i = 0; i < list.length; i += 40) {
      await sendMail({ to: smtpUser(), bcc: list.slice(i, i + 40), subject, text });
      sent += Math.min(40, list.length - i);
    }
    return sent;
  }

  async function scheduleTick(now = Date.now()) {
    for (const program of await db.programs.all()) {
      for (const s of await db.programSessions.byProgram(program.id)) {
        if (!s.auto) continue;
        const w = windowOf(s); if (!w) continue;
        const st = s.autoState || '';
        if (now >= w.end) {
          if (st === 'closed' || !(await db.programSessions.claimAutoState(s.id, st, 'closed'))) continue;
          if (st === 'opened') { await db.programSessions.update(s.id, { openRooms: [] }); console.log(`[schedule] closed all rooms · ${program.title} · ${s.name}`); }
        } else if (now >= w.start) {
          if (st === 'opened' || !(await db.programSessions.claimAutoState(s.id, st, 'opened'))) continue;
          const rooms = roomsOf(await db.programStudents.byProgram(program.id)).map((r) => r.room);
          const fresh = await db.programSessions.get(s.id);
          await db.programSessions.update(s.id, { openRooms: [...new Set([...(fresh?.openRooms || []), ...rooms])] });
          console.log(`[schedule] opened ${rooms.length} room(s) · ${program.title} · ${s.name}`);
        } else if (now >= w.start - REMIND_MS && st === '') {
          if (!(await db.programSessions.claimAutoState(s.id, '', 'reminded'))) continue;
          sendReminders(program, s)
            .then((n) => console.log(`[schedule] reminder sent to ${n} faculty · ${program.title} · ${s.name}`))
            .catch((e) => console.error('[schedule] reminder failed:', e.message));
        }
      }
    }
  }
  setInterval(() => scheduleTick().catch((e) => console.error('[schedule]', e.message)), 20_000).unref?.();
  setTimeout(() => scheduleTick().catch((e) => console.error('[schedule]', e.message)), 3_000).unref?.();

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
  app.get('/api/admin/programs', progGuard, async (req, res) => {
    const out = [];
    const ccNames = new Map((await db.ccAccounts.all()).map((c) => [c.id, c.name]));
    for (const p of await db.programs.all()) {
      if (req.cc && (p.ownerCc || '') !== req.cc.id) continue;
      p.ownerName = ccNames.get(p.ownerCc) || '';
      const [students, sessions] = await Promise.all([db.programStudents.byProgram(p.id), db.programSessions.byProgram(p.id)]);
      const open = (k) => sessions.filter((s) => s.kind === k).reduce((n, s) => n + (s.openRooms || []).length, 0);
      out.push({ ...p, students: students.length, rooms: roomsOf(students).length, attendanceSessions: sessions.filter((s) => s.kind === 'attendance').length, reviewSessions: sessions.filter((s) => s.kind === 'review').length, openRooms: open('attendance') + open('review'), openAttendance: open('attendance'), openReview: open('review'), batchSize: await batchSizeOf(p.id) });
    }
    res.json({ programs: out, auth: await authInfo() });
  });

  app.post('/api/admin/programs', progGuard, async (req, res) => {
    const title = txt(req.body?.title, 255);
    if (!title) return res.status(400).json({ error: 'Enter a program title.' });
    const p = { id: crypto.randomUUID(), title, createdAt: new Date().toISOString(), ownerCc: req.cc?.id || '', meta: cleanMeta(req.body?.meta, {}) };
    await db.programs.add(p); res.json(p);
  });
  app.post('/api/admin/programs/:id', progGuard, async (req, res) => {
    const cur = await db.programs.get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Program not found' });
    const title = req.body?.title === undefined ? cur.title : txt(req.body.title, 255);
    if (!title) return res.status(400).json({ error: 'Enter a program title.' });
    const patch = { title };
    if (req.body?.meta && typeof req.body.meta === 'object') patch.meta = cleanMeta(req.body.meta, cur.meta || {});
    res.json(await db.programs.update(req.params.id, patch));
  });
  /** One program with its course details, schedule plan and rubric (the coordinator's dashboard). */
  app.get('/api/admin/programs/:id', progGuard, async (req, res) => {
    const p = await db.programs.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Program not found' });
    const [students, sessions, projects] = await Promise.all([db.programStudents.byProgram(p.id), db.programSessions.byProgram(p.id), db.programProjects.byProgram(p.id)]);
    const rooms = roomsOf(students, await dirMap());
    res.json({ program: { ownerCc: '', meta: {}, ...p }, rubric: await rubricFor(p.id), batchSize: await batchSizeOf(p.id), students: students.length, rooms, sessions, projects: projects.length, auth: await authInfo() });
  });
  // Data protection: a program that already holds attendance or review marks can't be deleted.
  app.post('/api/admin/programs/:id/delete', progGuard, async (req, res) => {
    const p = await db.programs.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Program not found' });
    const [att, sc] = await Promise.all([db.programAttendance.byProgram(p.id), db.programScores.byProgram(p.id)]);
    if (att.length || sc.length) return res.status(403).json({ error: 'This program already has attendance or review marks, so it is kept permanently.' });
    await db.programs.remove(p.id); res.json({ ok: true });
  });

  /** Upload roster rows → upsert → build room batches + reviewers → remember faculty emails. */
  app.post('/api/admin/programs/:id/students/import', progGuard, async (req, res) => {
    const p = await db.programs.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Program not found' });
    const raw = Array.isArray(req.body?.students) ? req.body.students : null;
    if (!raw) return res.status(400).json({ error: 'Body must be { students: [...] }' });
    const seen = new Set(); const rows = []; let skipped = 0; const warnings = []; const cache = new Map();
    for (const s of raw) {
      const reg = txt(s.reg ?? s.registrationNumber, 64); const name = txt(cleanName(s.name));
      if (!reg || !name || seen.has(reg)) { skipped++; continue; }
      seen.add(reg);
      // faculty may come as names, or as { name, empId, email } — those are matched to the
      // faculty's existing record (by Emp ID, then email) so nobody ends up with two records
      const faculty = [];
      for (const f of (Array.isArray(s.faculty) ? s.faculty : [s.facultyName])) {
        const n = await resolveFaculty(f, req, warnings, cache);
        if (n && !faculty.some((x) => facultyKey(x) === facultyKey(n))) faculty.push(n);
      }
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
    res.json({ ...r, skipped, batchSize: size, batches: new Set(all.filter((s) => s.batchNo).map((s) => `${roomKey(s.room)}|${s.batchNo}`)).size, rooms: rooms.length, roomsWithoutFaculty: rooms.filter((x) => !x.faculty.length).map((x) => x.label), warnings: [...new Set(warnings)].slice(0, 50) });
  });

  /** A faculty entry (name or { name, empId, email }) → the name of their ONE directory record.
   *  Matches an existing record by Emp ID, then email, then name; creates one only if none fits.
   *  A coordinator may fill a missing email but not replace one that is already registered. */
  async function resolveFaculty(f, req, warnings, cache = new Map()) {
    const o = typeof f === 'string' ? { name: f } : (f && typeof f === 'object' ? f : {});
    const name = cleanName(o.name), empId = txt(o.empId, 32), email = txt(o.email).toLowerCase();
    const ck = `${facultyKey(name)}|${empId}|${email}`;
    if (cache.has(ck)) return cache.get(ck);
    let out = '';
    let d = empId ? await db.facultyDir.byEmp(empId) : null;
    if (!d && email) d = await db.facultyDir.byEmail(email);
    if (d) {
      out = d.name || name;
      const patch = { key: d.key, name: '', email: '', empId: '' };
      if (email && email !== String(d.email || '').toLowerCase()) {
        if (!req.cc || !d.email) patch.email = email;
        else warnings.push(`${out}: kept the email already registered (${maskEmail(d.email)}). Ask the admin to change it.`);
      }
      if (empId && !d.empId) patch.empId = empId;
      if (patch.email || patch.empId) await db.facultyDir.upsert(patch);
      if (name && facultyKey(name) !== d.key) warnings.push(`"${name}" is registered as "${out}" (Emp ${d.empId || empId || '—'}); the registered name is used.`);
    } else if (isRealName(name)) {
      out = name;
      const ex = await db.facultyDir.get(facultyKey(name));
      if (!ex) { if (email || empId) await db.facultyDir.upsert({ key: facultyKey(name), name, email, empId }); }
      else {
        if (ex.empId && empId && ex.empId !== empId) warnings.push(`${name}: another faculty with this name has Emp ${ex.empId}. Check the Emp ID ${empId}.`);
        const patch = { key: ex.key, name: '', email: !ex.email ? email : '', empId: !ex.empId ? empId : '' };
        if (patch.email || patch.empId) await db.facultyDir.upsert(patch);
      }
    }
    out = txt(cleanName(out));
    cache.set(ck, out);
    return out;
  }

  /** Batches: { clear: true } empties them (faculty then form batches live during the review),
   *  otherwise they are rebuilt in groups of `batchSize` (reset=true re-does the auto ones). */
  app.post('/api/admin/programs/:id/batches', progGuard, async (req, res) => {
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

  app.get('/api/admin/programs/:id/students', progGuard, async (req, res) => res.json({ students: await db.programStudents.byProgram(req.params.id) }));

  /** Faculty of a program with their rooms, review load and registered email. */
  app.get('/api/admin/programs/:id/faculty', progGuard, async (req, res) => {
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

  app.get('/api/admin/programs/:id/sessions', progGuard, async (req, res) => {
    const kind = String(req.query.kind || '');
    const all = await db.programSessions.byProgram(req.params.id);
    res.json({ sessions: KINDS.includes(kind) ? all.filter((s) => s.kind === kind) : all });
  });
  app.post('/api/admin/programs/:id/sessions', progGuard, async (req, res) => {
    const p = await db.programs.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Program not found' });
    const kind = String(req.body?.kind || '');
    if (!KINDS.includes(kind)) return res.status(400).json({ error: 'kind must be attendance or review' });
    const count = (await db.programSessions.byProgram(p.id)).filter((s) => s.kind === kind).length;
    const s = { id: crypto.randomUUID(), programId: p.id, kind, name: txt(req.body?.name) || (kind === 'review' ? `Review ${count + 1}` : `Session ${count + 1}`), date: txt(req.body?.date, 16), startTime: txt(req.body?.startTime, 8), endTime: txt(req.body?.endTime, 8), openRooms: [], auto: !!req.body?.auto, autoState: '', createdAt: new Date().toISOString() };
    rememberPublicUrl(req);
    await db.programSessions.add(s); res.json(s);
  });
  app.post('/api/admin/program-sessions/:sid', progGuard, async (req, res) => {
    const cur = await db.programSessions.get(req.params.sid);
    if (!cur) return res.status(404).json({ error: 'Session not found' });
    const patch = {};
    for (const [k, n] of [['name', 190], ['date', 16], ['startTime', 8], ['endTime', 8]]) if (typeof req.body?.[k] === 'string') patch[k] = txt(req.body[k], n);
    if (typeof req.body?.auto === 'boolean') patch.auto = req.body.auto;
    // A new time (or switching auto on) re-arms the schedule; a session already opened by it
    // stays opened so rooms the admin closed by hand are not reopened.
    if (['date', 'startTime', 'endTime', 'auto'].some((k) => k in patch && patch[k] !== cur[k])) {
      const w = windowOf({ ...cur, ...patch }), now = Date.now();
      if (!w || now < w.start) patch.autoState = '';
      else if (now < w.end) patch.autoState = cur.autoState === 'opened' ? 'opened' : '';
    }
    rememberPublicUrl(req);
    res.json(await db.programSessions.update(cur.id, patch));
  });

  /** Schedule overview for the admin: every session's window and what the scheduler will do next. */
  app.get('/api/admin/program-schedule', progGuard, async (req, res) => {
    const now = Date.now(), out = [];
    for (const p of await db.programs.all()) if (!req.cc || (p.ownerCc || '') === req.cc.id) for (const s of await db.programSessions.byProgram(p.id)) {
      const w = windowOf(s);
      out.push({ programId: p.id, programTitle: p.title, id: s.id, kind: s.kind, name: s.name, date: s.date, startTime: s.startTime, endTime: s.endTime, auto: s.auto, autoState: s.autoState, openRooms: (s.openRooms || []).length, start: w ? new Date(w.start).toISOString() : null, end: w ? new Date(w.end).toISOString() : null, phase: !w ? 'no-time' : now < w.start ? 'upcoming' : now < w.end ? 'live' : 'over' });
    }
    out.sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')));
    res.json({ now: new Date(now).toISOString(), remindMinutes: REMIND_MS / 60_000, email: smtpConfigured(), sessions: out });
  });
  app.post('/api/admin/program-sessions/:sid/delete', progGuard, async (req, res) => {
    const ctx = await loadSession(req, res); if (!ctx) return;
    const has = ctx.session.kind === 'attendance' ? (await db.programAttendance.bySession(ctx.session.id)).length : (await db.programScores.bySession(ctx.session.id)).length;
    if (has) return res.status(403).json({ error: 'This session already has submitted data and is kept permanently.' });
    await db.programSessions.remove(ctx.session.id); res.json({ ok: true });
  });

  /** Room board for one session — the room cards. */
  app.get('/api/admin/program-sessions/:sid/board', progGuard, async (req, res) => {
    const ctx = await loadSession(req, res); if (!ctx) return;
    const students = await db.programStudents.byProgram(ctx.program.id);
    const rooms = await roomStatus(ctx.session, students, await dirMap());
    const summary = { rooms: rooms.length, open: rooms.filter((r) => r.open).length, posted: rooms.filter((r) => r.posted).length, students: students.length, present: rooms.reduce((n, r) => n + (r.present || 0), 0), absent: rooms.reduce((n, r) => n + (r.absent || 0), 0), scored: rooms.reduce((n, r) => n + (r.scored || 0), 0), noFaculty: rooms.filter((r) => !r.faculty.length).length };
    const maxTotal = ctx.session.kind === 'review' ? Object.values(critMaxOf(await rubricFor(ctx.program.id))).reduce((n, v) => n + v, 0) : 0;
    res.json({ program: ctx.program, session: ctx.session, rooms, summary, maxTotal });
  });

  /** Open or close rooms: { open: true|false, rooms: ['C121', ...] | 'ALL' }. */
  app.post('/api/admin/program-sessions/:sid/rooms', progGuard, async (req, res) => {
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
  app.get('/api/admin/program-sessions/:sid/rooms/:room', progGuard, async (req, res) => {
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
    const rubric = await rubricFor(ctx.program.id); const critMax = critMaxOf(rubric);
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
  app.post('/api/admin/program-sessions/:sid/rooms/:room/revoke', progGuard, async (req, res) => {
    const ctx = await loadSession(req, res); if (!ctx) return;
    const room = roomKey(req.params.room);
    const removed = ctx.session.kind === 'attendance' ? await db.programAttendance.remove(ctx.session.id, room) : await db.programScores.removeRoom(ctx.session.id, room);
    res.json({ ok: true, removed });
  });

  /** Everything about one program in a single payload: attendance per session, review marks per
   *  round, and per student / room / certification course summaries — the reports the admin
   *  downloads once the hackathon is over. */
  app.get('/api/admin/programs/:id/report', progGuard, async (req, res) => {
    const program = await db.programs.get(req.params.id);
    if (!program) return res.status(404).json({ error: 'Program not found' });
    const students = (await db.programStudents.byProgram(program.id)).sort((a, b) => byNatural(roomKey(a.room), roomKey(b.room)) || byBatch(a, b));
    const sessions = (await db.programSessions.byProgram(program.id)).sort((a, b) => String(a.date || a.createdAt).localeCompare(String(b.date || b.createdAt)));
    const att = sessions.filter((s) => s.kind === 'attendance');
    const rev = sessions.filter((s) => s.kind === 'review');
    const rubric = await rubricFor(program.id); const critMax = critMaxOf(rubric);
    const crit = []; rubric.tables.forEach((t, ti) => t.criteria.forEach((c, ci) => crit.push({ key: `t${ti}_c${ci}`, label: c.label, max: c.max })));
    const maxTotal = crit.reduce((n, c) => n + c.max, 0);

    // attendance: session → room → posting
    const posts = new Map();
    for (const s of att) posts.set(s.id, new Map((await db.programAttendance.bySession(s.id)).map((p) => [p.room, p])));
    // review: session → reg → score
    const marks = new Map();
    for (const s of rev) marks.set(s.id, new Map((await db.programScores.bySession(s.id)).map((m) => [m.reg, m])));
    const facNames = new Map(); for (const s of students) for (const f of rowFaculty(s)) facNames.set(f.key, f.name);
    const roomFac = new Map(roomsOf(students).map((r) => [r.room, r.faculty.map((f) => f.name).join(', ')]));

    const rows = students.map((s) => {
      const room = roomKey(s.room);
      const attendance = {}; let present = 0, posted = 0;
      for (const a of att) {
        const p = posts.get(a.id).get(room);
        if (!p) { attendance[a.id] = ''; continue; }
        posted++; const here = !!p.marks[s.reg]; if (here) present++;
        attendance[a.id] = here ? 'P' : 'A';
      }
      const scores = {}; const totals = [];
      for (const r of rev) {
        const m = marks.get(r.id).get(s.reg);
        if (!m) { scores[r.id] = null; continue; }
        const outOf = Object.keys(m.scores || {}).reduce((n, k) => n + (critMax[k] || 0), 0);
        const pct = m.present && outOf ? Math.round((m.total / outOf) * 100) : null;
        scores[r.id] = { present: m.present, total: m.present ? m.total : 0, pct, grade: gradeOf(pct), scores: m.scores || {}, by: facNames.get(m.byEmp) || '' };
        if (m.present) totals.push(m.total);
      }
      const best = totals.length ? Math.max(...totals) : null;
      const avg = totals.length ? Math.round((totals.reduce((n, v) => n + v, 0) / totals.length) * 10) / 10 : null;
      const avgPct = avg != null && maxTotal ? Math.round((avg / maxTotal) * 100) : null;
      return {
        reg: s.reg, name: s.name, branch: s.branch, section: s.section, room: s.room || '', roomKey: room,
        courseCode: s.courseCode || '', courseName: s.courseName || '', batchNo: s.batchNo || '', project: s.project || '', ps: s.ps || '',
        reviewer: facNames.get(s.reviewer) || '', faculty: roomFac.get(room) || '',
        attendance, present, posted, attendancePct: posted ? Math.round((present / posted) * 100) : null,
        scores, best, avg, avgPct, grade: gradeOf(avgPct), scored: totals.length, reviewed: Object.values(scores).filter(Boolean).length,
      };
    });

    // group summaries (per certification course, per room, per session)
    const group = (keyOf, labelOf) => {
      const m = new Map();
      for (const r of rows) {
        const k = keyOf(r); if (k == null) continue;
        const e = m.get(k) || { key: k, label: labelOf(r), students: 0, present: 0, posted: 0, reviewed: 0, marked: 0, totalSum: 0, best: [], grades: { Outstanding: 0, Good: 0, Average: 0, 'Needs Improvement': 0 } };
        e.students++; e.present += r.present; e.posted += r.posted;
        if (r.reviewed) e.reviewed++;
        // averages and grades come from the students actually marked, not the ones marked absent
        if (r.avg != null) { e.marked++; e.totalSum += r.avg; e.best.push(r.best || 0); if (e.grades[r.grade] != null) e.grades[r.grade]++; }
        m.set(k, e);
      }
      return [...m.values()].map((e) => ({
        key: e.key, label: e.label, students: e.students,
        attendancePct: e.posted ? Math.round((e.present / e.posted) * 100) : null,
        scored: e.reviewed, marked: e.marked, avgMarks: e.marked ? Math.round((e.totalSum / e.marked) * 10) / 10 : null,
        avgPct: e.marked && maxTotal ? Math.round((e.totalSum / e.marked / maxTotal) * 100) : null,
        topMarks: e.best.length ? Math.max(...e.best) : null, grades: e.grades,
      })).sort((a, b) => byNatural(a.key, b.key));
    };

    const perSession = [
      ...att.map((s) => {
        const map = posts.get(s.id);
        const mine = rows.filter((r) => map.has(r.roomKey));
        const present = mine.reduce((n, r) => n + (r.attendance[s.id] === 'P' ? 1 : 0), 0);
        return { id: s.id, kind: 'attendance', name: s.name, date: s.date, startTime: s.startTime, endTime: s.endTime, rooms: roomsOf(students).length, roomsPosted: map.size, students: students.length, covered: mine.length, present, absent: mine.length - present, pct: mine.length ? Math.round((present / mine.length) * 100) : null };
      }),
      ...rev.map((s) => {
        const map = marks.get(s.id);
        const scored = [...map.values()];
        const marked = scored.filter((m) => m.present);
        return { id: s.id, kind: 'review', name: s.name, date: s.date, startTime: s.startTime, endTime: s.endTime, students: students.length, scored: scored.length, present: marked.length, absent: scored.length - marked.length, avgMarks: marked.length ? Math.round((marked.reduce((n, m) => n + m.total, 0) / marked.length) * 10) / 10 : null, maxTotal, batches: new Set(students.filter((x) => x.batchNo).map((x) => `${roomKey(x.room)}|${x.batchNo}`)).size };
      }),
    ];

    const reviewedRows = rows.filter((r) => r.reviewed);
    const markedRows = rows.filter((r) => r.avg != null);
    res.json({
      program, generatedAt: new Date().toISOString(), maxTotal, criteria: crit,
      sessions: { attendance: att.map((s) => ({ id: s.id, name: s.name, date: s.date, startTime: s.startTime, endTime: s.endTime })), review: rev.map((s) => ({ id: s.id, name: s.name, date: s.date, startTime: s.startTime, endTime: s.endTime })) },
      students: rows, perSession,
      courses: group((r) => r.courseCode || '(no course)', (r) => r.courseName || ''),
      rooms: group((r) => r.roomKey, (r) => r.faculty),
      branches: group((r) => r.branch || '(none)', () => ''),
      summary: {
        students: rows.length, rooms: new Set(rows.map((r) => r.roomKey)).size, courses: new Set(rows.map((r) => r.courseCode).filter(Boolean)).size,
        batches: new Set(students.filter((s) => s.batchNo).map((s) => `${roomKey(s.room)}|${s.batchNo}`)).size,
        attendanceSessions: att.length, reviewRounds: rev.length,
        present: rows.reduce((n, r) => n + r.present, 0), posted: rows.reduce((n, r) => n + r.posted, 0),
        attendancePct: rows.reduce((n, r) => n + r.posted, 0) ? Math.round((rows.reduce((n, r) => n + r.present, 0) / rows.reduce((n, r) => n + r.posted, 0)) * 100) : null,
        scored: reviewedRows.length, marked: markedRows.length, absentInReview: reviewedRows.length - markedRows.length,
        avgMarks: markedRows.length ? Math.round((markedRows.reduce((n, r) => n + (r.avg || 0), 0) / markedRows.length) * 10) / 10 : null,
        maxTotal, grades: markedRows.reduce((g, r) => ({ ...g, [r.grade]: (g[r.grade] || 0) + 1 }), {}),
      },
    });
  });

  /** Flat rows for an Excel export of one session. */
  app.get('/api/admin/program-sessions/:sid/export', progGuard, async (req, res) => {
    const ctx = await loadSession(req, res); if (!ctx) return;
    const students = (await db.programStudents.byProgram(ctx.program.id)).sort((a, b) => byNatural(roomKey(a.room), roomKey(b.room)) || byBatch(a, b));
    const facNames = new Map(); for (const s of students) for (const f of rowFaculty(s)) facNames.set(f.key, f.name);
    const roomFac = new Map(roomsOf(students).map((r) => [r.room, r.faculty.map((f) => f.name).join(', ')]));
    if (ctx.session.kind === 'attendance') {
      const posts = new Map((await db.programAttendance.bySession(ctx.session.id)).map((p) => [p.room, p]));
      const rows = students.map((s) => { const p = posts.get(roomKey(s.room)); return { 'Reg No': s.reg, Name: s.name, Branch: s.branch, Section: s.section, Room: s.room, Faculty: roomFac.get(roomKey(s.room)) || '', Status: p ? (p.marks[s.reg] ? 'Present' : 'Absent') : 'Not posted', 'Posted by': p?.facultyName || '', 'Posted at': p ? new Date(p.postedAt).toLocaleString('en-IN') : '' }; });
      return res.json({ program: ctx.program, session: ctx.session, rows });
    }
    const rubric = await rubricFor(ctx.program.id); const critMax = critMaxOf(rubric);
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

  // =============== COURSE COORDINATORS (sub-admins) ===============
  const ccPublic = (c) => ({ id: c.id, name: c.name, email: c.email, empId: c.empId, department: c.department, active: c.active, createdAt: c.createdAt });
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  app.get('/api/admin/coordinators', requireAdmin, async (_req, res) => {
    const owned = new Map();
    for (const p of await db.programs.all()) if (p.ownerCc) owned.set(p.ownerCc, [...(owned.get(p.ownerCc) || []), p.title]);
    res.json({ coordinators: (await db.ccAccounts.all()).map((c) => ({ ...ccPublic(c), programs: owned.get(c.id) || [] })), auth: await authInfo() });
  });
  app.post('/api/admin/coordinators', requireAdmin, async (req, res) => {
    const id = txt(req.body?.id, 64);
    const cur = id ? await db.ccAccounts.get(id) : null;
    if (id && !cur) return res.status(404).json({ error: 'Coordinator not found' });
    const name = cleanName(req.body?.name), email = txt(req.body?.email).toLowerCase(), empId = txt(req.body?.empId, 32);
    if (!name) return res.status(400).json({ error: 'Enter the coordinator\'s name.' });
    if (!EMAIL.test(email)) return res.status(400).json({ error: 'Enter a valid email — the sign-in code is sent there.' });
    const byMail = await db.ccAccounts.byEmail(email);
    if (byMail && byMail.id !== id) return res.status(409).json({ error: `${byMail.name} already uses this email.` });
    if (empId) { const byEmp = await db.ccAccounts.byEmp(empId); if (byEmp && byEmp.id !== id) return res.status(409).json({ error: `${byEmp.name} already uses Emp ID ${empId}.` }); }
    const c = { id: id || crypto.randomUUID(), name, email, empId, department: txt(req.body?.department, 190), active: req.body?.active === undefined ? (cur ? cur.active : true) : !!req.body.active, createdAt: cur?.createdAt || new Date().toISOString() };
    await db.ccAccounts.upsert(c);
    if (!c.active) await db.facultyAuth.removeKind(`cc:${c.id}`, 'ccsess'); // switching off signs them out
    res.json(ccPublic(c));
  });
  app.post('/api/admin/coordinators/:id/delete', requireAdmin, async (req, res) => {
    const c = await db.ccAccounts.get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Coordinator not found' });
    const owns = (await db.programs.all()).filter((p) => p.ownerCc === c.id);
    if (owns.length) return res.status(409).json({ error: `${c.name} runs ${owns.length} hackathon(s). Switch the login off instead, or move the hackathons to another coordinator first.` });
    await db.facultyAuth.removeKind(`cc:${c.id}`, 'ccsess');
    await db.ccAccounts.remove(c.id); res.json({ ok: true });
  });
  /** Admin: hand a program to a coordinator (or back to the admin with ccId ''). */
  app.post('/api/admin/programs/:id/owner', requireAdmin, async (req, res) => {
    const ccId = txt(req.body?.ccId, 64);
    if (ccId && !(await db.ccAccounts.get(ccId))) return res.status(404).json({ error: 'Coordinator not found' });
    const p = await db.programs.update(req.params.id, { ownerCc: ccId });
    if (!p) return res.status(404).json({ error: 'Program not found' });
    res.json(p);
  });

  // ---- coordinator sign-in: Emp ID / email → 6-digit code by email → session token ----
  async function findCc(id) {
    const raw = txt(id); if (!raw) return null;
    return raw.includes('@') ? db.ccAccounts.byEmail(raw) : db.ccAccounts.byEmp(raw);
  }
  app.post('/api/cc/otp/request', async (req, res) => {
    const c = await findCc(req.body?.id);
    if (!c) return res.status(404).json({ error: 'No coordinator login with this Emp ID / email. Please contact the admin.' });
    if (!c.active) return res.status(403).json({ error: 'This coordinator login is switched off. Please contact the admin.' });
    if (!smtpConfigured() && !OTP_DEBUG()) return res.status(503).json({ error: 'Email is not set up on the server yet. Please contact the admin.' });
    const fkey = `cc:${c.id}`, now = Date.now();
    const last = await db.facultyAuth.latest(fkey, 'ccotp');
    if (last && now - Date.parse(last.createdAt) < 60_000) return res.status(429).json({ error: 'A code was just sent. Please check your email or wait a minute.' });
    if (await db.facultyAuth.countSince(fkey, 'ccotp', new Date(now - 3600_000).toISOString()) >= 6) return res.status(429).json({ error: 'Too many code requests. Please try again later.' });
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const rec = { id: crypto.randomUUID(), fkey, kind: 'ccotp', secretHash: otpHash(fkey, code), expiresAt: new Date(now + OTP_TTL).toISOString(), attempts: 0, createdAt: new Date(now).toISOString() };
    await db.facultyAuth.add(rec);
    if (!OTP_DEBUG()) {
      try {
        await sendMail({
          to: c.email, subject: `${code} is your KL Coordinator sign-in code`,
          text: `Dear ${c.name},\n\nYour sign-in code for the KL Hackathon Coordinator console is ${code}.\nIt is valid for 10 minutes. Do not share it with anyone.\n\n— KL Skill Development`,
          html: `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#0f172a">Dear ${String(c.name).replace(/</g, '&lt;')},<br><br>Your sign-in code for the <b>KL Hackathon Coordinator console</b> is<div style="font-size:30px;font-weight:800;letter-spacing:6px;margin:14px 0;color:#4338ca">${code}</div>It is valid for <b>10 minutes</b>. Do not share it with anyone.<br><br>— KL Skill Development</div>`,
        });
      } catch (e) { await db.facultyAuth.remove(rec.id); return res.status(502).json({ error: `Could not send the code: ${e.message}` }); }
    }
    res.json({ ok: true, to: maskEmail(c.email), ...(OTP_DEBUG() ? { debugCode: code } : {}) });
  });
  app.post('/api/cc/otp/verify', async (req, res) => {
    const c = await findCc(req.body?.id);
    if (!c || !c.active) return res.status(404).json({ error: 'No active coordinator login with this Emp ID / email.' });
    const fkey = `cc:${c.id}`;
    const code = txt(req.body?.code, 12).replace(/\D/g, '');
    const last = await db.facultyAuth.latest(fkey, 'ccotp');
    if (!last || last.expiresAt < new Date().toISOString()) return res.status(400).json({ error: 'This code has expired. Please request a new one.' });
    if (last.attempts >= 5) return res.status(429).json({ error: 'Too many wrong attempts. Please request a new code.' });
    const a = Buffer.from(otpHash(fkey, code)), b = Buffer.from(last.secretHash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { await db.facultyAuth.bumpAttempts(last.id); return res.status(400).json({ error: `Incorrect code. ${Math.max(0, 4 - last.attempts)} attempt(s) left.` }); }
    await db.facultyAuth.removeKind(fkey, 'ccotp');
    const token = crypto.randomBytes(32).toString('hex');
    await db.facultyAuth.add({ id: crypto.randomUUID(), fkey, kind: 'ccsess', secretHash: sha(token), expiresAt: new Date(Date.now() + SESSION_TTL).toISOString(), attempts: 0, createdAt: new Date().toISOString() });
    db.facultyAuth.purgeExpired(new Date().toISOString()).catch(() => {});
    rememberPublicUrl(req);
    res.json({ token, coordinator: ccPublic(c) });
  });
  app.get('/api/cc/me', async (req, res) => {
    const c = await ccOf(req);
    if (!c) return res.status(401).json({ error: 'Please sign in again.', reauth: true });
    res.json({ coordinator: ccPublic(c), auth: await authInfo(), facultyUrl: await publicUrl() });
  });
  app.post('/api/cc/logout', async (req, res) => {
    const tok = String(req.headers['x-cc-token'] || '');
    if (tok) { const s = await db.facultyAuth.byHash(sha(tok), 'ccsess'); if (s) await db.facultyAuth.remove(s.id); }
    res.json({ ok: true });
  });

  // =============== PROGRAM EDITING (admin or the owning coordinator) ===============
  /** Re-share a program's existing batches among each room's faculty (whole batches, evenly). */
  async function reshareReviewers(pid) {
    const batched = (await db.programStudents.byProgram(pid)).filter((s) => s.batchNo);
    const changed = planBatches(batched, await batchSizeOf(pid)).filter((p) => p.changed);
    if (changed.length) await db.programStudents.setBatches(pid, changed);
    return changed.length;
  }
  const roomFacultyOf = (students, room) => { const r = roomsOf(students.filter((s) => roomKey(s.room) === roomKey(room)))[0]; return r ? r.faculty.map((f) => f.name) : []; };
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => typeof o?.[k] === 'string').map((k) => [k, k === 'courseCode' ? txt(o[k], 32).toUpperCase() : txt(o[k], k === 'project' ? 2000 : 190)]));

  /** Add one student (faculty = that room's faculty). */
  app.post('/api/admin/programs/:id/student-add', progGuard, async (req, res) => {
    const pid = req.params.id;
    const reg = txt(req.body?.reg, 64), name = txt(cleanName(req.body?.name));
    if (!reg || !name) return res.status(400).json({ error: 'Enter the registration number and name.' });
    const all = await db.programStudents.byProgram(pid);
    if (all.some((s) => String(s.reg) === reg)) return res.status(409).json({ error: `${reg} is already in this hackathon.` });
    const room = txt(req.body?.room, 64);
    const faculty = room ? roomFacultyOf(all, room) : [];
    const like = all.find((s) => roomKey(s.room) === roomKey(room)) || all[0] || {};
    const row = { id: crypto.randomUUID(), reg, name, branch: txt(req.body?.branch, 64) || like.branch || '', section: txt(req.body?.section, 64) || like.section || '', room, empId: '', facultyName: faculty[0] || '', facultyList: faculty, batchNo: txt(req.body?.batchNo, 32).toUpperCase(), project: '', ps: '', courseCode: txt(req.body?.courseCode, 32).toUpperCase() || like.courseCode || '', courseName: txt(req.body?.courseName, 255) || like.courseName || '' };
    await db.programStudents.importMany(pid, [row], false);
    if (row.batchNo) await reshareReviewers(pid);
    res.json({ ok: true, student: row });
  });
  /** Edit one student. Moving to another room gives them that room's faculty automatically. */
  app.post('/api/admin/programs/:id/student/:reg', progGuard, async (req, res) => {
    const pid = req.params.id, reg = txt(req.params.reg, 64);
    const all = await db.programStudents.byProgram(pid);
    const cur = all.find((s) => String(s.reg) === reg);
    if (!cur) return res.status(404).json({ error: 'Student not found in this hackathon.' });
    const patch = pick(req.body, ['name', 'branch', 'section', 'room', 'batchNo', 'project', 'ps', 'courseCode', 'courseName']);
    if (patch.batchNo !== undefined) patch.batchNo = patch.batchNo.toUpperCase();
    if (patch.batchNo === '') patch.reviewer = ''; // out of a batch → nobody reviews them as a team
    let moved = false;
    if (patch.room !== undefined && roomKey(patch.room) !== roomKey(cur.room)) {
      const faculty = roomFacultyOf(all, patch.room);
      patch.facultyList = faculty; patch.facultyName = faculty[0] || '';
      // a batch, its reviewer and its project belong to one room
      if (patch.batchNo === undefined) patch.batchNo = '';
      patch.reviewer = '';
      if (patch.project === undefined) { patch.project = ''; patch.ps = ''; }
      moved = true;
    }
    const s = await db.programStudents.updateOne(pid, reg, patch);
    if (moved || patch.batchNo !== undefined) await reshareReviewers(pid);
    res.json({ ok: true, student: s, moved });
  });
  app.post('/api/admin/programs/:id/student/:reg/delete', progGuard, async (req, res) => {
    const pid = req.params.id, reg = txt(req.params.reg, 64);
    const scored = (await db.programScores.byProgram(pid)).some((s) => String(s.reg) === reg);
    if (scored) return res.status(403).json({ error: 'This student already has review marks, so they are kept. Move them to another room instead.' });
    const n = await db.programStudents.removeOne(pid, reg);
    if (!n) return res.status(404).json({ error: 'Student not found in this hackathon.' });
    await reshareReviewers(pid);
    res.json({ ok: true });
  });

  /** Change a room's faculty: { room, faculty: [name | { name, empId, email }], label? } → all its students. */
  app.post('/api/admin/programs/:id/room-faculty', progGuard, async (req, res) => {
    const pid = req.params.id, room = txt(req.body?.room, 64);
    const all = await db.programStudents.byProgram(pid);
    const inRoom = all.filter((s) => roomKey(s.room) === roomKey(room));
    if (!inRoom.length) return res.status(404).json({ error: 'No students in this room.' });
    const warnings = []; const names = [];
    for (const f of (Array.isArray(req.body?.faculty) ? req.body.faculty : []).slice(0, 8)) {
      const n = await resolveFaculty(f, req, warnings);
      if (n && !names.some((x) => facultyKey(x) === facultyKey(n))) names.push(n);
    }
    if (!names.length) return res.status(400).json({ error: 'Give the room at least one faculty.' });
    const label = txt(req.body?.label, 64);
    for (const s of inRoom) await db.programStudents.updateOne(pid, s.reg, { facultyList: names, facultyName: names[0], ...(label ? { room: label } : {}) });
    const reassigned = await reshareReviewers(pid);
    res.json({ ok: true, room: label || room, faculty: names, students: inRoom.length, reassigned, warnings });
  });
  /** Hand one batch to another faculty of the same room. */
  app.post('/api/admin/programs/:id/batch-reviewer', progGuard, async (req, res) => {
    const pid = req.params.id, room = roomKey(req.body?.room), batchNo = txt(req.body?.batchNo, 32), reviewer = txt(req.body?.reviewer);
    const all = await db.programStudents.byProgram(pid);
    const members = all.filter((s) => roomKey(s.room) === room && s.batchNo === batchNo);
    if (!members.length) return res.status(404).json({ error: 'Batch not found.' });
    if (!roomsOf(members)[0].faculty.some((f) => f.key === reviewer)) return res.status(400).json({ error: 'The reviewer must be one of this room\'s faculty.' });
    await db.programStudents.setBatches(pid, members.map((s) => ({ id: s.id, reg: s.reg, batchNo, reviewer })));
    res.json({ ok: true, batch: batchNo, members: members.length });
  });

  // ---- the program's own project list, mapped to batches ----
  app.get('/api/admin/programs/:id/projects', progGuard, async (req, res) => {
    const projects = await db.programProjects.byProgram(req.params.id);
    const students = await db.programStudents.byProgram(req.params.id);
    const used = new Map(); const batches = new Map();
    for (const s of students) if (s.batchNo) { const k = `${roomKey(s.room)}|${s.batchNo}`; if (!batches.has(k)) batches.set(k, s); }
    for (const s of batches.values()) if (s.ps || s.project) { const k = s.ps || s.project; used.set(k, (used.get(k) || 0) + 1); }
    res.json({ projects: projects.map((p) => ({ ...p, batches: used.get(p.projectId) || used.get(p.title) || 0 })), batches: batches.size, withProject: [...batches.values()].filter((s) => s.project).length });
  });
  app.post('/api/admin/programs/:id/projects', progGuard, async (req, res) => {
    const raw = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!raw) return res.status(400).json({ error: 'Body must be { rows: [...] }' });
    const seen = new Set(); const rows = []; let n = 0;
    for (const r of raw) {
      const title = txt(r.title, 500); if (!title) continue;
      const projectId = txt(r.projectId, 64) || `P${String(rows.length + 1).padStart(3, '0')}`;
      const k = projectId.toUpperCase(); if (seen.has(k)) continue; seen.add(k);
      rows.push({ id: crypto.randomUUID(), projectId, title, domain: txt(r.domain, 190), courseCode: txt(r.courseCode, 32).toUpperCase() });
    }
    if (!rows.length) return res.status(400).json({ error: 'No valid rows (each project needs a title).' });
    await db.programProjects.replace(req.params.id, rows);
    res.json({ total: rows.length, domains: [...new Set(rows.map((r) => r.domain).filter(Boolean))].length });
  });
  /** Give every batch a project: least-used first, the batch's course only, varied domains in a room. */
  app.post('/api/admin/programs/:id/projects/assign', progGuard, async (req, res) => {
    const pid = req.params.id, overwrite = !!req.body?.overwrite;
    const projects = await db.programProjects.byProgram(pid);
    if (!projects.length) return res.status(400).json({ error: 'Upload the project list first.' });
    const students = await db.programStudents.byProgram(pid);
    const batches = new Map();
    for (const s of students) if (s.batchNo) { const k = `${roomKey(s.room)}|${s.batchNo}`; (batches.get(k) || batches.set(k, []).get(k)).push(s); }
    if (!batches.size) return res.status(400).json({ error: 'There are no batches yet. Make the batches first.' });
    const use = new Map(projects.map((p) => [p.projectId, 0]));
    for (const m of batches.values()) if (m[0].ps && use.has(m[0].ps)) use.set(m[0].ps, use.get(m[0].ps) + 1);
    const roomDomains = new Map(); const rows = []; let assigned = 0;
    const keys = [...batches.keys()].sort(byNatural);
    for (const k of keys) {
      const m = batches.get(k); const room = k.split('|')[0];
      if (!overwrite && m[0].project) { const d = projects.find((p) => p.projectId === m[0].ps)?.domain; if (d) { const rd = roomDomains.get(room) || new Map(); rd.set(d, (rd.get(d) || 0) + 1); roomDomains.set(room, rd); } continue; }
      const code = (m[0].courseCode || '').toUpperCase();
      let pool = projects.filter((p) => !p.courseCode || !code || p.courseCode === code);
      if (!pool.length) pool = projects;
      const rd = roomDomains.get(room) || new Map();
      const takenHere = new Set(keys.filter((x) => x.startsWith(room + '|')).map((x) => batches.get(x)[0].ps).filter(Boolean));
      pool.sort((a, b) => (takenHere.has(a.projectId) - takenHere.has(b.projectId)) || (use.get(a.projectId) - use.get(b.projectId)) || ((rd.get(a.domain) || 0) - (rd.get(b.domain) || 0)) || byNatural(a.projectId, b.projectId));
      const p = pool[0];
      use.set(p.projectId, use.get(p.projectId) + 1);
      if (p.domain) { rd.set(p.domain, (rd.get(p.domain) || 0) + 1); roomDomains.set(room, rd); }
      for (const s of m) { rows.push({ reg: s.reg, project: p.title, ps: p.projectId }); s.ps = p.projectId; s.project = p.title; }
      assigned++;
    }
    if (rows.length) await db.programStudents.setProjects(pid, rows);
    res.json({ ok: true, batches: batches.size, assigned, maxPerProject: Math.max(0, ...use.values()) });
  });
  /** Set one batch's project by hand: { room, batchNo, projectId } or { …, title }. */
  app.post('/api/admin/programs/:id/batch-project', progGuard, async (req, res) => {
    const pid = req.params.id, room = roomKey(req.body?.room), batchNo = txt(req.body?.batchNo, 32);
    const members = (await db.programStudents.byProgram(pid)).filter((s) => roomKey(s.room) === room && s.batchNo === batchNo);
    if (!members.length) return res.status(404).json({ error: 'Batch not found.' });
    const p = req.body?.projectId ? (await db.programProjects.byProgram(pid)).find((x) => x.projectId === txt(req.body.projectId, 64)) : null;
    const title = p ? p.title : txt(req.body?.title, 2000);
    await db.programStudents.setProjects(pid, members.map((s) => ({ reg: s.reg, project: title, ps: p ? p.projectId : '' })));
    res.json({ ok: true, project: title, members: members.length });
  });

  // ---- the program's own rubric ----
  const shapeOf = (r) => JSON.stringify((r?.tables || []).map((t) => (t.criteria || []).length));
  app.get('/api/admin/programs/:id/rubric', progGuard, async (req, res) => {
    const p = await db.programs.get(req.params.id);
    res.json({ rubric: await rubricFor(req.params.id), own: !!p?.meta?.rubric, global: await getRubric() });
  });
  app.post('/api/admin/programs/:id/rubric', progGuard, async (req, res) => {
    const p = await db.programs.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Program not found' });
    const next = req.body?.reset ? null : normalizeRubric(req.body?.rubric || {});
    if (next && (!next.tables.length || !next.tables.some((t) => t.criteria.length) || next.tables.some((t) => t.criteria.some((c) => !c.label)))) return res.status(400).json({ error: 'Every criterion needs a name and marks.' });
    const scored = (await db.programScores.byProgram(p.id)).length;
    if (scored && shapeOf(next || await getRubric()) !== shapeOf(await rubricFor(p.id))) return res.status(409).json({ error: 'Review marks are already entered, so criteria can no longer be added or removed. You can still rename them or change band descriptions.' });
    const meta = { ...(p.meta || {}) };
    if (next) meta.rubric = next; else delete meta.rubric;
    await db.programs.update(p.id, { meta });
    res.json({ rubric: await rubricFor(p.id), own: !!next });
  });

  /** Replace the program's session plan in one go: [{ id?, kind, name, date, startTime, endTime, auto }].
   *  Sessions missing from the list are removed unless they already hold attendance or marks. */
  app.post('/api/admin/programs/:id/schedule', progGuard, async (req, res) => {
    const pid = req.params.id;
    const list = Array.isArray(req.body?.sessions) ? req.body.sessions.slice(0, 40) : null;
    if (!list) return res.status(400).json({ error: 'Body must be { sessions: [...] }' });
    const cur = await db.programSessions.byProgram(pid);
    const keep = new Set(); const kept = [];
    for (const r of list) {
      const kind = KINDS.includes(r.kind) ? r.kind : null; if (!kind) continue;
      const fields = { name: txt(r.name) || (kind === 'review' ? 'Review' : 'Attendance'), date: txt(r.date, 16), startTime: txt(r.startTime, 8), endTime: txt(r.endTime, 8), auto: r.auto !== false };
      const ex = r.id ? cur.find((s) => s.id === r.id) : null;
      if (ex) {
        const patch = { ...fields };
        const w = windowOf({ ...ex, ...patch }), now = Date.now();
        if (['date', 'startTime', 'endTime', 'auto'].some((k) => patch[k] !== ex[k])) { if (!w || now < w.start) patch.autoState = ''; else if (now < w.end) patch.autoState = ex.autoState === 'opened' ? 'opened' : ''; }
        kept.push(await db.programSessions.update(ex.id, patch)); keep.add(ex.id);
      } else {
        const s = { id: crypto.randomUUID(), programId: pid, kind, ...fields, openRooms: [], autoState: '', createdAt: new Date(Date.now() + kept.length).toISOString() };
        await db.programSessions.add(s); kept.push(s); keep.add(s.id);
      }
    }
    const blocked = [];
    for (const s of cur) {
      if (keep.has(s.id)) continue;
      const has = s.kind === 'attendance' ? (await db.programAttendance.bySession(s.id)).length : (await db.programScores.bySession(s.id)).length;
      if (has) { blocked.push(s.name); continue; }
      await db.programSessions.remove(s.id);
    }
    rememberPublicUrl(req);
    res.json({ sessions: await db.programSessions.byProgram(pid), kept: blocked });
  });

  /** Readiness check: what is missing before (or while) the hackathon runs. */
  app.get('/api/admin/programs/:id/checks', progGuard, async (req, res) => {
    const p = await db.programs.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Program not found' });
    const [students, sessions, projects] = await Promise.all([db.programStudents.byProgram(p.id), db.programSessions.byProgram(p.id), db.programProjects.byProgram(p.id)]);
    const dir = await dirMap(); const rooms = roomsOf(students, dir); const meta = p.meta || {};
    const out = []; const add = (level, area, text) => out.push({ level, area, text });
    if (!meta.courseCode || !meta.courseName) add('warn', 'Course', 'Course code or course name is missing.');
    if (!students.length) add('error', 'Students', 'No students uploaded yet.');
    else add('ok', 'Students', `${students.length} students in ${rooms.length} room(s).`);
    const noFac = rooms.filter((r) => !r.faculty.length);
    if (noFac.length) add('error', 'Faculty', `No faculty in ${noFac.length} room(s): ${noFac.map((r) => r.label).join(', ')}.`);
    if (await otpOn()) {
      const noMail = [...new Map(rooms.flatMap((r) => r.faculty).filter((f) => !f.hasEmail).map((f) => [f.key, f.name])).values()];
      if (noMail.length) add('error', 'Faculty', `No email registered for ${noMail.length} faculty, so they cannot sign in: ${noMail.slice(0, 8).join(', ')}${noMail.length > 8 ? '…' : ''}.`);
    }
    const heavy = rooms.filter((r) => r.faculty.length && r.students / r.faculty.length > 45);
    if (heavy.length) add('warn', 'Faculty', `Heavy load (more than 45 students per faculty) in ${heavy.map((r) => `${r.label} (${r.students}/${r.faculty.length})`).join(', ')}.`);
    if (rooms.length && !noFac.length) add('ok', 'Faculty', `Every room has faculty (${new Set(rooms.flatMap((r) => r.faculty.map((f) => f.key))).size} in total).`);
    const att = sessions.filter((s) => s.kind === 'attendance'), rev = sessions.filter((s) => s.kind === 'review');
    if (!att.length) add('warn', 'Schedule', 'No attendance session is scheduled.');
    if ((meta.reviews || 0) > rev.length) add('warn', 'Schedule', `${meta.reviews} review(s) planned but ${rev.length} scheduled.`);
    const noTime = sessions.filter((s) => !windowOf(s));
    if (noTime.length) add('error', 'Schedule', `No date/time for: ${noTime.map((s) => s.name).join(', ')}.`);
    const timed = sessions.map((s) => ({ s, w: windowOf(s) })).filter((x) => x.w).sort((a, b) => a.w.start - b.w.start);
    for (let i = 1; i < timed.length; i++) if (timed[i].s.kind === timed[i - 1].s.kind && timed[i].w.start < timed[i - 1].w.end) add('warn', 'Schedule', `${timed[i - 1].s.name} and ${timed[i].s.name} overlap.`);
    const past = timed.filter((x) => x.w.end < Date.now() && !(x.s.autoState === 'closed'));
    if (past.length && meta.status !== 'live') add('warn', 'Schedule', `Already in the past: ${past.map((x) => x.s.name).join(', ')}.`);
    if (timed.length && !noTime.length) add('ok', 'Schedule', `${att.length} attendance and ${rev.length} review session(s) scheduled; rooms open and close on time automatically.`);
    if (rev.length || meta.reviews) {
      const b = new Map(); for (const s of students) if (s.batchNo) { const k = `${roomKey(s.room)}|${s.batchNo}`; if (!b.has(k)) b.set(k, s); }
      const loose = students.filter((s) => !s.batchNo).length;
      if (!b.size) add('warn', 'Batches', 'No batches yet: either make them now, or the faculty form them during the review.');
      else {
        add(loose ? 'warn' : 'ok', 'Batches', `${b.size} batches${loose ? `; ${loose} student(s) not in a batch` : ''}.`);
        const noProj = [...b.values()].filter((s) => !s.project).length;
        if (projects.length && noProj) add('warn', 'Projects', `${noProj} batch(es) have no project yet.`);
        else if (projects.length) add('ok', 'Projects', `Every batch has a project (${projects.length} in the list).`);
      }
      if (!projects.length) add('warn', 'Projects', 'No project list uploaded (faculty can still type the project title).');
    }
    const rub = await rubricFor(p.id); const total = rub.tables.reduce((n, t) => n + t.criteria.reduce((m, c) => m + c.max, 0), 0);
    add('ok', 'Rubric', `${p.meta?.rubric ? 'Own rubric' : 'Default rubric'}: ${rub.tables.reduce((n, t) => n + t.criteria.length, 0)} criteria, ${total} marks.`);
    res.json({ checks: out, ready: !out.some((c) => c.level === 'error') });
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
    const rubric = await rubricFor(c.session.programId); const critMax = critMaxOf(rubric);
    const scores = new Map((await db.programScores.bySession(c.session.id)).filter((s) => s.room === c.room).map((s) => [s.reg, s]));
    // totals from this room's earlier review rounds, so the faculty can see them while marking
    const earlier = (await db.programSessions.byProgram(c.session.programId))
      .filter((s) => s.kind === 'review' && s.createdAt < c.session.createdAt)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const previous = [];
    for (const s of earlier) {
      const totals = {};
      for (const sc of await db.programScores.bySession(s.id)) if (sc.room === c.room) totals[sc.reg] = sc.present ? sc.total : null;
      if (Object.keys(totals).length) previous.push({ id: s.id, name: s.name, totals });
    }
    // the project register for this room's certification course(s)
    const codes = [...new Set(c.students.map((s) => (s.courseCode || '').toUpperCase()).filter(Boolean))];
    const own = await db.programProjects.byProgram(c.session.programId); // the coordinator's own list comes first
    const projects = own.length ? own.map((p) => ({ ...p, courseCode: p.courseCode || codes[0] || '' })) : codes.length ? await db.courseProjects.byCourses(codes) : [];
    const courses = codes.map((code) => ({ code, name: c.students.find((s) => (s.courseCode || '').toUpperCase() === code)?.courseName || '' }));
    res.json({
      ...base, rubric, courses, previous, projects: projects.map((p) => ({ projectId: p.projectId, title: p.title, domain: p.domain, courseCode: p.courseCode })),
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
    const critMax = critMaxOf(await rubricFor(c.session.programId));
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

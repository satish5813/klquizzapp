// JSON-file storage adapter (local dev / zero-setup). Async interface so it is
// interchangeable with the MySQL adapter used on the Hostinger VPS.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const file = (name) => join(DATA_DIR, `${name}.json`);
function read(name) {
  const p = file(name);
  if (!existsSync(p)) return [];
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return []; }
}
const write = (name, arr) => writeFileSync(file(name), JSON.stringify(arr, null, 2));
function readObj(name) {
  const p = file(name);
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; }
}

export const jsonDb = {
  driver: 'json',
  async init() { /* nothing to set up for files */ },

  questions: {
    all: async () => read('questions'),
    count: async () => read('questions').length,
    addMany: async (items) => { const cur = read('questions'); cur.push(...items); write('questions', cur); return cur.length; },
    clear: async () => write('questions', []),
    get: async (id) => read('questions').find((q) => q.id === id) || null,
    remove: async (id) => {
      const cur = read('questions');
      const keep = cur.filter((q) => q.id !== id);
      write('questions', keep);
      return cur.length - keep.length; // 1 if removed, 0 if not found
    },
    update: async (id, patch) => {
      const cur = read('questions');
      const i = cur.findIndex((q) => q.id === id);
      if (i === -1) return null;
      for (const k of ['question', 'options', 'answerIndex', 'topic', 'difficulty', 'explanation', 'domain']) if (k in patch) cur[i][k] = patch[k];
      write('questions', cur);
      return cur[i];
    },
    clearDomain: async (domain) => {
      const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const cur = read('questions');
      const keep = cur.filter((q) => norm(q.domain) !== norm(domain));
      write('questions', keep);
      return cur.length - keep.length;
    },
    renameDomain: async (from, to) => {
      const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const cur = read('questions'); let n = 0;
      for (const q of cur) if (norm(q.domain) === norm(from)) { q.domain = to; n++; }
      write('questions', cur);
      return n;
    },
    normSet: async () => new Set(read('questions').map((q) => q.norm)),
    // Tag a domain onto questions (all, or only those currently untagged). Returns count changed.
    assignDomain: async (domain, onlyUntagged = true) => {
      const cur = read('questions');
      let n = 0;
      for (const q of cur) { if (onlyUntagged && q.domain) continue; q.domain = domain; n++; }
      write('questions', cur);
      return n;
    },
  },

  students: {
    all: async () => read('students'),
    count: async () => read('students').length,
    get: async (id) => read('students').find((s) => s.id === id) || null,
    byRegNo: async (rn) => read('students').find((s) => s.registrationNumber === rn) || null,
    byEmpId: async (empId) => read('students').filter((s) => String(s.empId || '') === String(empId)).sort((a, b) => String(a.registrationNumber).localeCompare(String(b.registrationNumber))),
    add: async (s) => { const cur = read('students'); cur.push(s); write('students', cur); return s; },
    update: async (id, patch) => {
      const cur = read('students');
      const i = cur.findIndex((s) => s.id === id);
      if (i === -1) return null;
      const allow = ['name', 'branch', 'section', 'domain', 'active'];
      for (const k of allow) if (k in patch) cur[i][k] = patch[k];
      write('students', cur);
      return cur[i];
    },
    // Delete every student in a domain (and their attempts). Used to purge load-test data.
    removeByDomain: async (domain) => {
      const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const studs = read('students');
      const goneIds = new Set(studs.filter((s) => norm(s.domain) === norm(domain)).map((s) => s.id));
      write('students', studs.filter((s) => !goneIds.has(s.id)));
      write('attempts', read('attempts').filter((a) => !goneIds.has(a.studentId)));
      return goneIds.size;
    },
    // Delete specific students by id (and any attempts they own).
    removeMany: async (ids) => {
      const gone = new Set(ids);
      if (!gone.size) return 0;
      const studs = read('students');
      const keep = studs.filter((s) => !gone.has(s.id));
      write('students', keep);
      write('attempts', read('attempts').filter((a) => !gone.has(a.studentId)));
      return studs.length - keep.length;
    },
    // Upsert a roster by registrationNumber. New rows default to active.
    importMany: async (rows) => {
      const cur = read('students');
      const idx = new Map(cur.map((s) => [s.registrationNumber, s]));
      let added = 0, updated = 0;
      for (const r of rows) {
        const existing = idx.get(r.registrationNumber);
        if (existing) { Object.assign(existing, { name: r.name, branch: r.branch, section: r.section, domain: r.domain, empId: r.empId, room: r.room, facultyName: r.facultyName }); updated++; }
        else { cur.push({ ...r, active: true }); idx.set(r.registrationNumber, r); added++; }
      }
      write('students', cur);
      return { added, updated, total: cur.length };
    },
  },

  attempts: {
    all: async () => read('attempts'),
    get: async (id) => read('attempts').find((a) => a.id === id) || null,
    add: async (a) => { const cur = read('attempts'); cur.push(a); write('attempts', cur); return a; },
    update: async (id, patch) => {
      const cur = read('attempts');
      const i = cur.findIndex((a) => a.id === id);
      if (i === -1) return null;
      cur[i] = { ...cur[i], ...patch };
      write('attempts', cur);
      return cur[i];
    },
    remove: async (id) => write('attempts', read('attempts').filter((a) => a.id !== id)),
    clearAll: async () => write('attempts', []),
    byStudent: async (studentId) => read('attempts').filter((a) => a.studentId === studentId),
  },

  // key-value settings (e.g. the exam schedule)
  settings: {
    get: async (key) => { const all = readObj('settings'); return all[key] ?? null; },
    set: async (key, val) => { const all = readObj('settings'); all[key] = val; write('settings', all); return val; },
  },

  // student support tickets
  tickets: {
    all: async () => read('tickets'),
    add: async (t) => { const cur = read('tickets'); cur.push(t); write('tickets', cur); return t; },
    update: async (id, patch) => {
      const cur = read('tickets'); const i = cur.findIndex((t) => t.id === id);
      if (i === -1) return null; cur[i] = { ...cur[i], ...patch }; write('tickets', cur); return cur[i];
    },
  },

  // login events (monitoring). Capped so the file can't grow unbounded.
  loginEvents: {
    add: async (e) => {
      const cur = read('loginEvents'); cur.push(e);
      if (cur.length > 20000) cur.splice(0, cur.length - 20000);
      write('loginEvents', cur); return e;
    },
    recent: async (limit = 500) => read('loginEvents').slice(-Number(limit || 500)).reverse(),
    all: async () => read('loginEvents'),
  },

  // faculty attendance postings — one per (sessionId, empId). Old sessions are kept.
  attendance: {
    bySession: async (sessionId) => read('attendance').filter((p) => String(p.sessionId) === String(sessionId)),
    byEmp: async (sessionId, empId) => read('attendance').find((p) => String(p.sessionId) === String(sessionId) && String(p.empId) === String(empId)) || null,
    byEmpAll: async (empId) => read('attendance').filter((p) => String(p.empId) === String(empId)),
    all: async () => read('attendance'),
    reassign: async (from, to) => { const cur = read('attendance'); let n = 0; for (const p of cur) { if (String(p.sessionId || '') === String(from || '')) { p.sessionId = to; n++; } } write('attendance', cur); return n; },
    set: async (rec) => { const cur = read('attendance').filter((p) => !(String(p.sessionId) === String(rec.sessionId) && String(p.empId) === String(rec.empId))); cur.push(rec); write('attendance', cur); return rec; },
    removeByEmp: async (sessionId, empId) => { const cur = read('attendance'); const keep = cur.filter((p) => !(String(p.sessionId) === String(sessionId) && String(p.empId) === String(empId))); write('attendance', keep); return cur.length - keep.length; },
    removeSession: async (sessionId) => write('attendance', read('attendance').filter((p) => String(p.sessionId) !== String(sessionId))),
  },

  // ---- Hackathon Review System ----
  reviewBatches: {
    all: async () => read('reviewBatches'),
    byEmp: async (empId) => read('reviewBatches').filter((b) => String(b.empId) === String(empId)).sort((a, b) => String(a.batchNo).localeCompare(String(b.batchNo), undefined, { numeric: true })),
    get: async (id) => read('reviewBatches').find((b) => b.id === id) || null,
    add: async (b) => { const cur = read('reviewBatches'); cur.push(b); write('reviewBatches', cur); return b; },
    update: async (id, p) => { const cur = read('reviewBatches'); const i = cur.findIndex((b) => b.id === id); if (i === -1) return null; cur[i] = { ...cur[i], ...p }; write('reviewBatches', cur); return cur[i]; },
    remove: async (id) => write('reviewBatches', read('reviewBatches').filter((b) => b.id !== id)),
    clear: async () => write('reviewBatches', []),
  },
  reviewScores: {
    byReview: async (reviewId) => read('reviewScores').filter((s) => String(s.reviewId) === String(reviewId)),
    byReviewBatch: async (reviewId, batchId) => read('reviewScores').filter((s) => String(s.reviewId) === String(reviewId) && String(s.batchId) === String(batchId)),
    set: async (s) => { const cur = read('reviewScores').filter((x) => !(x.reviewId === s.reviewId && x.batchId === s.batchId && x.reg === s.reg)); cur.push(s); write('reviewScores', cur); return s; },
    removeByBatch: async (reviewId, batchId) => write('reviewScores', read('reviewScores').filter((s) => !(String(s.reviewId) === String(reviewId) && String(s.batchId) === String(batchId)))),
  },

  // ---- Programs ----
  programs: {
    all: async () => read('programs').slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    get: async (id) => read('programs').find((p) => p.id === id) || null,
    add: async (p) => { const cur = read('programs'); cur.push(p); write('programs', cur); return p; },
    update: async (id, patch) => { const cur = read('programs'); const i = cur.findIndex((p) => p.id === id); if (i === -1) return null; if (typeof patch.title === 'string') cur[i].title = patch.title; write('programs', cur); return cur[i]; },
    remove: async (id) => {
      for (const f of ['programScores', 'programAttendance', 'programSessions', 'programStudents']) write(f, read(f).filter((x) => x.programId !== id));
      write('programs', read('programs').filter((p) => p.id !== id));
    },
  },
  programStudents: {
    byProgram: async (pid) => read('programStudents').filter((s) => s.programId === pid),
    byEmp: async (empId) => read('programStudents').filter((s) => String(s.empId) === String(empId)),
    importMany: async (pid, rows, replace) => {
      let cur = read('programStudents');
      if (replace) cur = cur.filter((s) => s.programId !== pid);
      const idx = new Map(cur.filter((s) => s.programId === pid).map((s) => [s.reg, s]));
      let added = 0, updated = 0;
      for (const r of rows) {
        const ex = idx.get(r.reg);
        // a re-upload without a Batch column keeps the batches already assigned
        if (ex) { Object.assign(ex, { ...r, id: ex.id, programId: pid, batchNo: r.batchNo || ex.batchNo || '', reviewer: ex.reviewer || '' }); updated++; }
        else { const n = { ...r, programId: pid }; cur.push(n); idx.set(r.reg, n); added++; }
      }
      write('programStudents', cur);
      return { added, updated, total: cur.filter((s) => s.programId === pid).length };
    },
    setBatches: async (pid, rows) => {
      const cur = read('programStudents'); const m = new Map(rows.map((r) => [r.id, r]));
      for (const s of cur) { const u = m.get(s.id); if (u && s.programId === pid) { s.batchNo = u.batchNo; s.reviewer = u.reviewer; } }
      write('programStudents', cur);
    },
    // Project titles typed by the reviewing faculty: [{ reg, project }].
    setProjects: async (pid, rows) => {
      const cur = read('programStudents'); const m = new Map(rows.map((r) => [String(r.reg), r.project]));
      for (const s of cur) { if (s.programId === pid && m.has(String(s.reg))) s.project = m.get(String(s.reg)); }
      write('programStudents', cur);
    },
  },
  facultyDir: {
    all: async () => read('facultyDir'),
    get: async (fkey) => read('facultyDir').find((f) => f.key === fkey) || null,
    byEmail: async (email) => read('facultyDir').find((f) => String(f.email || '').toLowerCase() === String(email).toLowerCase()) || null,
    byEmp: async (empId) => read('facultyDir').find((f) => String(f.empId || '') === String(empId)) || null,
    upsert: async (f) => {
      const cur = read('facultyDir'); const ex = cur.find((x) => x.key === f.key);
      if (ex) { for (const k of ['name', 'email', 'empId']) if (f[k]) ex[k] = f[k]; ex.updatedAt = new Date().toISOString(); }
      else cur.push({ key: f.key, name: f.name || '', email: f.email || '', empId: f.empId || '', updatedAt: new Date().toISOString() });
      write('facultyDir', cur);
    },
  },
  facultyAuth: {
    add: async (a) => { const cur = read('facultyAuth'); cur.push(a); write('facultyAuth', cur); return a; },
    latest: async (fkey, kind) => read('facultyAuth').filter((a) => a.fkey === fkey && a.kind === kind).sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)))[0] || null,
    countSince: async (fkey, kind, since) => read('facultyAuth').filter((a) => a.fkey === fkey && a.kind === kind && a.createdAt >= since).length,
    byHash: async (hash, kind) => read('facultyAuth').find((a) => a.secretHash === hash && a.kind === kind) || null,
    bumpAttempts: async (id) => { const cur = read('facultyAuth'); const a = cur.find((x) => x.id === id); if (a) a.attempts = (a.attempts || 0) + 1; write('facultyAuth', cur); },
    remove: async (id) => write('facultyAuth', read('facultyAuth').filter((a) => a.id !== id)),
    removeKind: async (fkey, kind) => write('facultyAuth', read('facultyAuth').filter((a) => !(a.fkey === fkey && a.kind === kind))),
    purgeExpired: async (nowIso) => write('facultyAuth', read('facultyAuth').filter((a) => !(a.expiresAt && a.expiresAt < nowIso))),
  },
  programSessions: {
    byProgram: async (pid) => read('programSessions').filter((s) => s.programId === pid).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
    get: async (id) => read('programSessions').find((s) => s.id === id) || null,
    add: async (s) => { const cur = read('programSessions'); cur.push(s); write('programSessions', cur); return s; },
    update: async (id, p) => { const cur = read('programSessions'); const i = cur.findIndex((s) => s.id === id); if (i === -1) return null; cur[i] = { ...cur[i], ...p }; write('programSessions', cur); return cur[i]; },
    remove: async (id) => write('programSessions', read('programSessions').filter((s) => s.id !== id)),
  },
  programAttendance: {
    bySession: async (sid) => read('programAttendance').filter((a) => a.sessionId === sid),
    byProgram: async (pid) => read('programAttendance').filter((a) => a.programId === pid),
    get: async (sid, room) => read('programAttendance').find((a) => a.sessionId === sid && a.room === room) || null,
    set: async (a) => { const cur = read('programAttendance').filter((x) => !(x.sessionId === a.sessionId && x.room === a.room)); cur.push(a); write('programAttendance', cur); return a; },
    remove: async (sid, room) => { const cur = read('programAttendance'); const keep = cur.filter((a) => !(a.sessionId === sid && a.room === room)); write('programAttendance', keep); return cur.length - keep.length; },
  },
  programScores: {
    bySession: async (sid) => read('programScores').filter((s) => s.sessionId === sid),
    byProgram: async (pid) => read('programScores').filter((s) => s.programId === pid),
    set: async (s) => { const cur = read('programScores').filter((x) => !(x.sessionId === s.sessionId && x.reg === s.reg)); cur.push(s); write('programScores', cur); return s; },
    removeRoom: async (sid, room) => { const cur = read('programScores'); const keep = cur.filter((s) => !(s.sessionId === sid && s.room === room)); write('programScores', keep); return cur.length - keep.length; },
  },
};

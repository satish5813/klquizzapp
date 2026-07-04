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
};

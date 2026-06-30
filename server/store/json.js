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
    normSet: async () => new Set(read('questions').map((q) => q.norm)),
  },

  students: {
    all: async () => read('students'),
    count: async () => read('students').length,
    get: async (id) => read('students').find((s) => s.id === id) || null,
    byRegNo: async (rn) => read('students').find((s) => s.registrationNumber === rn) || null,
    add: async (s) => { const cur = read('students'); cur.push(s); write('students', cur); return s; },
    update: async (id, patch) => {
      const cur = read('students');
      const i = cur.findIndex((s) => s.id === id);
      if (i === -1) return null;
      const allow = ['name', 'branch', 'section', 'active'];
      for (const k of allow) if (k in patch) cur[i][k] = patch[k];
      write('students', cur);
      return cur[i];
    },
    // Upsert a roster by registrationNumber. New rows default to active.
    importMany: async (rows) => {
      const cur = read('students');
      const idx = new Map(cur.map((s) => [s.registrationNumber, s]));
      let added = 0, updated = 0;
      for (const r of rows) {
        const existing = idx.get(r.registrationNumber);
        if (existing) { Object.assign(existing, { name: r.name, branch: r.branch, section: r.section }); updated++; }
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
    byStudent: async (studentId) => read('attempts').filter((a) => a.studentId === studentId),
  },

  // key-value settings (e.g. the exam schedule)
  settings: {
    get: async (key) => { const all = readObj('settings'); return all[key] ?? null; },
    set: async (key, val) => { const all = readObj('settings'); all[key] = val; write('settings', all); return val; },
  },
};

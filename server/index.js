import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import cluster from 'node:cluster';
import { fileURLToPath } from 'url';
import { initStore } from './db.js';
import { shuffle, normalizeQuestion } from './util.js';
import { estimate, generateBank, extractMcqs } from './claude.js';

const PORT = Number(process.env.PORT || 4000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'change-me-admin';
const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5';
const QUIZ_SIZE = Number(process.env.QUIZ_SIZE || 60);
const QUIZ_DURATION_MIN = Number(process.env.QUIZ_DURATION_MIN || 90);
const APP_NAME = 'KL AI QuizApp';

const db = await initStore();

const app = express();
app.set('trust proxy', true); // behind Coolify/Traefik → get the real client IP
app.use(cors());
app.use(express.json({ limit: '8mb' }));

const requireAdmin = (req, res, next) => {
  if ((req.headers['x-admin-token'] || '') !== ADMIN_TOKEN) return res.status(401).json({ error: 'Invalid admin token' });
  next();
};
const pct = (score, total) => Math.round(((score ?? 0) / total) * 100);
const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '';
// Normalize a domain label so "Java Core", "JavaCore", "java core" all match.
const normDomain = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// A screen is considered "still active" if it pinged within this window.
const SESSION_ACTIVE_MS = 90_000;

// In-memory question bank cache — avoids a full questions read on every
// start/quiz/submit, so the API scales to thousands of concurrent students.
let _bank = null, _bankAt = 0;
// Short TTL so an answer-key fix propagates across ALL cluster workers (each worker
// has its own in-memory cache). Explicit invalidate handles the local worker instantly.
const BANK_TTL_MS = Number(process.env.BANK_TTL_MS || 30_000);
async function getBank() {
  if (!_bank || (Date.now() - _bankAt) > BANK_TTL_MS) {
    const list = await db.questions.all();
    _bank = { list, byId: new Map(list.map((q) => [q.id, q])) };
    _bankAt = Date.now();
  }
  return _bank;
}
const invalidateBank = () => { _bank = null; };

app.get('/api/health', (_req, res) =>
  res.json({ app: APP_NAME, status: 'ok', model: MODEL, driver: db.driver, quizSize: QUIZ_SIZE, durationMin: QUIZ_DURATION_MIN, hasKey: !!process.env.ANTHROPIC_API_KEY }));

// ============ Admin: bank ============
app.get('/api/admin/bank/stats', requireAdmin, async (_req, res) => {
  const qs = await db.questions.all();
  const byDomain = {};
  const byDomainDiff = {}; // { domain: { EASY, MEDIUM, HARD } }
  for (const q of qs) {
    const d = q.domain || '(none)';
    byDomain[d] = (byDomain[d] || 0) + 1;
    const dd = (byDomainDiff[d] = byDomainDiff[d] || { EASY: 0, MEDIUM: 0, HARD: 0 });
    const k = String(q.difficulty || 'MEDIUM').toUpperCase();
    dd[k === 'EASY' || k === 'HARD' ? k : 'MEDIUM']++;
  }
  res.json({ count: qs.length, topics: [...new Set(qs.map((q) => q.topic))].slice(0, 40), byDomain, byDomainDiff });
});

app.post('/api/admin/estimate', requireAdmin, (req, res) => {
  res.json(estimate(Math.max(1, Math.min(50000, Number(req.body?.count) || 1000))));
});

/** Delete questions — a whole domain's, or the entire bank. */
app.post('/api/admin/questions/clear', requireAdmin, async (req, res) => {
  const domain = String(req.body?.domain || '').trim();
  let removed;
  if (domain) removed = await db.questions.clearDomain(domain);
  else { removed = await db.questions.count(); await db.questions.clear(); }
  invalidateBank();
  res.json({ removed, bankTotal: await db.questions.count() });
});

/** List questions WITH answers — searchable + paginated (admin question editor). */
app.get('/api/admin/questions/list', requireAdmin, async (req, res) => {
  const search = String(req.query.search || '').trim().toLowerCase();
  const domain = String(req.query.domain || '').trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(5, Number(req.query.pageSize) || 20));
  let all = (await getBank()).list;
  if (domain) all = all.filter((q) => normDomain(q.domain) === normDomain(domain));
  if (search) all = all.filter((q) => (q.question + ' ' + (q.options || []).join(' ') + ' ' + (q.topic || '')).toLowerCase().includes(search));
  const total = all.length, start = (page - 1) * pageSize;
  res.json({ rows: all.slice(start, start + pageSize), total, page, pageSize });
});

/** Edit a question (fix a wrong answer key, text, options, etc.). */
app.post('/api/admin/questions/:id', requireAdmin, async (req, res) => {
  const patch = {};
  if (typeof req.body?.question === 'string') patch.question = req.body.question;
  if (Array.isArray(req.body?.options) && req.body.options.length === 4) patch.options = req.body.options.map(String);
  if (Number.isInteger(req.body?.answerIndex) && req.body.answerIndex >= 0 && req.body.answerIndex <= 3) patch.answerIndex = req.body.answerIndex;
  for (const k of ['topic', 'difficulty', 'explanation']) if (typeof req.body?.[k] === 'string') patch[k] = req.body[k];
  const updated = await db.questions.update(req.params.id, patch);
  if (!updated) return res.status(404).json({ error: 'Question not found' });
  invalidateBank();
  res.json(updated);
});

/** Re-grade all submitted attempts against the CURRENT answer keys (after fixing a wrong answer). */
app.post('/api/admin/regrade', requireAdmin, async (_req, res) => {
  const { byId } = await getBank();
  const all = await db.attempts.all();
  let changed = 0;
  for (const a of all) {
    if (a.status !== 'submitted') continue;
    let score = 0;
    for (const id of a.questionIds) { const q = byId.get(id); if (q && Number(a.answers[id]) === q.answerIndex) score++; }
    if (score !== a.score) { await db.attempts.update(a.id, { score }); changed++; }
  }
  res.json({ regraded: all.filter((a) => a.status === 'submitted').length, changed });
});

/** Rename a question domain (e.g. fix "Python Core" → "Python" to match students). */
app.post('/api/admin/questions/rename-domain', requireAdmin, async (req, res) => {
  const from = String(req.body?.from || '').trim();
  const to = String(req.body?.to || '').trim();
  if (!from || !to) return res.status(400).json({ error: 'Provide from and to' });
  const changed = await db.questions.renameDomain(from, to);
  invalidateBank();
  res.json({ changed, from, to });
});

/** Tag a domain onto existing questions (default: only those without a domain). */
app.post('/api/admin/questions/assign-domain', requireAdmin, async (req, res) => {
  const domain = String(req.body?.domain || '').trim();
  if (!domain) return res.status(400).json({ error: 'Provide a domain' });
  const onlyUntagged = req.body?.all ? false : true;
  const changed = await db.questions.assignDomain(domain, onlyUntagged);
  invalidateBank();
  res.json({ changed, domain });
});

// Generation/extraction jobs. Kept in a fast local Map on the worker that owns the job,
// AND mirrored to the shared DB (settings key `job:<id>`) so that under the cluster (3
// workers) the poll / publish / discard requests — which the proxy load-balances to ANY
// worker — always find the job. Without this mirror, jobs "disappear" intermittently.
const jobsLocal = new Map();
async function jobSet(id, val) { jobsLocal.set(id, val); try { await db.settings.set(`job:${id}`, val); } catch { /* mirror best-effort */ } }
async function jobGet(id) { return jobsLocal.get(id) || (await db.settings.get(`job:${id}`)); }
async function jobDel(id) { jobsLocal.delete(id); try { await db.settings.set(`job:${id}`, null); } catch { /* ignore */ } }

app.post('/api/admin/generate', requireAdmin, async (req, res) => {
  // Key may come from the admin desktop app (preferred) or the server env.
  const apiKey = String(req.body?.apiKey || '').trim() || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(400).json({ error: 'No Claude API key. Enter it in the desktop app (Question bank tab), or set ANTHROPIC_API_KEY on the server.' });
  const syllabus = String(req.body?.syllabus || '').trim();
  const count = Math.max(1, Math.min(50000, Number(req.body?.count) || 1000));
  const replace = !!req.body?.replace;
  const domain = String(req.body?.domain || '').trim();
  const mix = req.body?.mix && typeof req.body.mix === 'object' ? req.body.mix : null;
  if (syllabus.length < 10) return res.status(400).json({ error: 'Provide a syllabus (min 10 chars)' });

  const jobId = crypto.randomUUID();
  await jobSet(jobId, { status: 'running', collected: 0, target: count, requests: 0, replace, domain });
  (async () => {
    try {
      const { questions, stats } = await generateBank({
        apiKey, model: MODEL, syllabus, target: count, mix,
        existingNorms: await db.questions.normSet(),
        onProgress: (p) => { jobSet(jobId, { ...(jobsLocal.get(jobId) || {}), ...p, status: 'running' }); },
      });
      questions.forEach((q) => { q.domain = domain; }); // tag with the exam domain
      // Hold for PREVIEW — do not save until the admin posts/publishes.
      await jobSet(jobId, { status: 'ready', collected: questions.length, target: count, requests: stats.requests, stats, replace, domain, questions });
    } catch (e) { await jobSet(jobId, { ...(jobsLocal.get(jobId) || {}), status: 'error', error: e.message }); }
  })();
  res.json({ jobId });
});

app.get('/api/admin/jobs/:id', requireAdmin, async (req, res) => {
  const job = await jobGet(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job); // when status==='ready', includes the generated `questions` for preview
});

/** Publish previewed questions into the bank. */
app.post('/api/admin/generate/:id/publish', requireAdmin, async (req, res) => {
  const job = await jobGet(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'ready') return res.status(409).json({ error: `Nothing to publish (job is ${job.status})` });
  if (job.replace) await db.questions.clear();
  const added = job.questions.length;
  await db.questions.addMany(job.questions);
  invalidateBank();
  const bankTotal = await db.questions.count();
  await jobSet(req.params.id, { ...job, status: 'published', questions: undefined, bankTotal });
  res.json({ added, bankTotal });
});

/** Discard previewed questions without saving. */
app.post('/api/admin/generate/:id/discard', requireAdmin, async (req, res) => {
  await jobDel(req.params.id);
  res.json({ ok: true });
});

// ============ Admin: per-domain exam schedule ============
// Exams are CLOSED by default. A domain's exam opens only when the admin enables
// its schedule (optionally within a start/end window).
// Difficulty composition of an exam. Percentages that always sum to 100.
// Default = an even-ish spread if the admin never set one.
const DEFAULT_MIX = { easy: 40, medium: 40, hard: 20 };
function normMix(m) {
  const e = Math.max(0, Math.round(Number(m?.easy)) || 0);
  const md = Math.max(0, Math.round(Number(m?.medium)) || 0);
  const h = Math.max(0, Math.round(Number(m?.hard)) || 0);
  const sum = e + md + h;
  if (sum <= 0) return { ...DEFAULT_MIX };
  // Re-scale to exactly 100 so callers can trust the percentages.
  const easy = Math.round((e / sum) * 100);
  const medium = Math.round((md / sum) * 100);
  return { easy, medium, hard: 100 - easy - medium };
}
const diffKey = (q) => String(q?.difficulty || 'MEDIUM').toUpperCase();
// Pick `size` questions from `pool` honouring the difficulty mix. If a bucket is
// short, the shortfall is filled from the remaining questions so students always
// get a full-length exam.
function pickByMix(pool, size, mix) {
  size = Math.min(size, pool.length);
  const m = normMix(mix);
  const buckets = {
    EASY: shuffle(pool.filter((q) => diffKey(q) === 'EASY')),
    MEDIUM: shuffle(pool.filter((q) => diffKey(q) === 'MEDIUM')),
    HARD: shuffle(pool.filter((q) => diffKey(q) === 'HARD')),
  };
  // Any difficulty label that isn't E/M/H falls back into MEDIUM.
  const known = new Set(['EASY', 'MEDIUM', 'HARD']);
  buckets.MEDIUM.push(...shuffle(pool.filter((q) => !known.has(diffKey(q)))));
  const want = { EASY: Math.round((m.easy / 100) * size), MEDIUM: Math.round((m.medium / 100) * size) };
  want.HARD = size - want.EASY - want.MEDIUM;
  const picked = [];
  for (const k of ['EASY', 'MEDIUM', 'HARD']) picked.push(...buckets[k].splice(0, Math.max(0, want[k])));
  // Fill any shortfall (a bucket ran out) from whatever questions remain.
  if (picked.length < size) {
    const chosen = new Set(picked.map((q) => q.id));
    const rest = shuffle(pool.filter((q) => !chosen.has(q.id)));
    picked.push(...rest.slice(0, size - picked.length));
  }
  return shuffle(picked).slice(0, size);
}

async function scheduleStatusFor(domain) {
  const all = (await db.settings.get('schedules')) || {};
  const key = Object.keys(all).find((k) => normDomain(k) === normDomain(domain));
  const s = key ? all[key] : null;
  const durationMin = (s && Number(s.durationMin)) || QUIZ_DURATION_MIN;
  const questionCount = (s && Number(s.questionCount)) || QUIZ_SIZE;
  const mix = normMix(s && s.mix);
  if (!s || !s.enabled) return { open: false, reason: 'not_scheduled', domain, durationMin, questionCount, mix };
  return { open: true, reason: 'open', domain, durationMin, questionCount, mix };
}

app.get('/api/admin/schedules', requireAdmin, async (_req, res) => {
  const schedules = (await db.settings.get('schedules')) || {};
  const domains = [...new Set((await db.students.all()).map((s) => s.domain).filter(Boolean))].sort();
  res.json({ schedules, domains });
});

app.post('/api/admin/schedules', requireAdmin, async (req, res) => {
  const domain = String(req.body?.domain || '').trim();
  if (!domain) return res.status(400).json({ error: 'Domain is required' });
  const enabled = !!req.body?.enabled;
  const durationMin = Math.max(1, Math.min(180, Number(req.body?.durationMin) || QUIZ_DURATION_MIN)); // 1..180 min
  const questionCount = Math.max(1, Math.min(500, Number(req.body?.questionCount) || QUIZ_SIZE)); // MCQs per exam
  const mix = normMix(req.body?.mix); // Easy/Medium/Hard % (always sums to 100)
  const all = (await db.settings.get('schedules')) || {};
  all[domain] = { enabled, durationMin, questionCount, mix };
  await db.settings.set('schedules', all);
  res.json({ domain, ...all[domain] });
});

/** Delete a domain's schedule entry. */
app.post('/api/admin/schedules/delete', requireAdmin, async (req, res) => {
  const domain = String(req.body?.domain || '').trim();
  const all = (await db.settings.get('schedules')) || {};
  const key = Object.keys(all).find((k) => normDomain(k) === normDomain(domain));
  if (key) { delete all[key]; await db.settings.set('schedules', all); }
  res.json({ ok: true, deleted: !!key });
});

/** Import model/sample MCQs directly (no AI). */
app.post('/api/admin/import', requireAdmin, async (req, res) => {
  const raw = Array.isArray(req.body?.questions) ? req.body.questions : null;
  if (!raw) return res.status(400).json({ error: 'Body must be { questions: [...] }' });
  const domain = String(req.body?.domain || '').trim();
  if (req.body?.replace) await db.questions.clear();
  const seen = await db.questions.normSet();
  const toAdd = [], errors = [];
  raw.forEach((q, i) => {
    const question = String(q.question ?? q.q ?? '').trim();
    let options = Array.isArray(q.options) ? q.options.map(String) : [];
    if (!options.length && (q.a || q.b || q.c || q.d)) options = [q.a, q.b, q.c, q.d].map((o) => String(o ?? ''));
    let answerIndex = q.answerIndex;
    if (answerIndex === undefined && q.answer !== undefined) {
      const a = String(q.answer).trim();
      if (/^[0-3]$/.test(a)) answerIndex = Number(a);
      else if (/^[A-Da-d]$/.test(a)) answerIndex = a.toUpperCase().charCodeAt(0) - 65;
      else answerIndex = options.findIndex((o) => o.trim().toLowerCase() === a.toLowerCase());
    }
    if (!question || options.length !== 4 || typeof answerIndex !== 'number' || answerIndex < 0 || answerIndex > 3) {
      errors.push({ row: i + 1, reason: 'need question, exactly 4 options, valid answer' }); return;
    }
    const norm = normalizeQuestion(question);
    if (!norm || seen.has(norm)) { errors.push({ row: i + 1, reason: 'duplicate' }); return; }
    seen.add(norm);
    toAdd.push({ id: crypto.randomUUID(), question, options, answerIndex, topic: q.topic || 'General', difficulty: (q.difficulty || 'MEDIUM').toUpperCase(), explanation: q.explanation || '', domain, norm });
  });
  await db.questions.addMany(toAdd);
  invalidateBank();
  res.json({ added: toAdd.length, skipped: errors.length, errors: errors.slice(0, 50), bankTotal: await db.questions.count() });
});

/** Use Claude to extract ready-made MCQs from PDF text. Runs as a background
 *  job (poll GET /api/admin/jobs/:id) so long PDFs don't hit the proxy timeout. */
app.post('/api/admin/parse-mcqs', requireAdmin, async (req, res) => {
  const apiKey = String(req.body?.apiKey || '').trim() || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(400).json({ error: 'No Claude API key. Enter it in the desktop app (Question bank tab).' });
  const text = String(req.body?.text || '').trim();
  if (text.length < 20) return res.status(400).json({ error: 'No readable text found in the file.' });

  const jobId = crypto.randomUUID();
  await jobSet(jobId, { status: 'running', kind: 'extract', chunk: 0, chunks: 0, found: 0 });
  (async () => {
    try {
      const { questions } = await extractMcqs({
        apiKey, model: MODEL, text,
        onProgress: (p) => { jobSet(jobId, { ...(jobsLocal.get(jobId) || {}), ...p, status: 'running' }); },
      });
      await jobSet(jobId, { status: 'ready', kind: 'extract', questions, count: questions.length });
    } catch (e) { await jobSet(jobId, { ...(jobsLocal.get(jobId) || {}), status: 'error', error: e.message }); }
  })();
  res.json({ jobId });
});

// ============ Admin: students roster ============
/** Import the student roster (pre-load who is allowed to log in). */
app.post('/api/admin/students/import', requireAdmin, async (req, res) => {
  const raw = Array.isArray(req.body?.students) ? req.body.students : null;
  if (!raw) return res.status(400).json({ error: 'Body must be { students: [...] }' });
  const rows = [], errors = [];
  raw.forEach((s, i) => {
    const registrationNumber = String(s.registrationNumber ?? s.regNo ?? s.registration_number ?? s.rollNumber ?? s.roll ?? '').trim();
    const name = String(s.name ?? '').trim();
    const branch = String(s.branch ?? '').trim();
    const section = String(s.section ?? '').trim();
    const domain = String(s.domain ?? '').trim();
    const empId = String(s.empId ?? s.emp_id ?? '').trim();
    const room = String(s.room ?? '').trim();
    const facultyName = String(s.facultyName ?? s.faculty_name ?? '').trim();
    if (!registrationNumber || !name) { errors.push({ row: i + 1, reason: 'need registrationNumber and name' }); return; }
    rows.push({ id: crypto.randomUUID(), registrationNumber, name, branch, section, domain, empId, room, facultyName, createdAt: new Date().toISOString() });
  });
  const r = await db.students.importMany(rows);
  res.json({ ...r, skipped: errors.length, errors: errors.slice(0, 50) });
});

/** Delete ALL students in a domain (and their attempts). For removing load-test data. */
app.post('/api/admin/students/purge-domain', requireAdmin, async (req, res) => {
  const domain = String(req.body?.domain || '').trim();
  if (!domain) return res.status(400).json({ error: 'Provide a domain (e.g. LoadTest).' });
  const removed = await db.students.removeByDomain(domain);
  res.json({ ok: true, domain, removed });
});

/** Students list with search, active/inactive filter, and pagination. */
app.get('/api/admin/students', requireAdmin, async (req, res) => {
  const all = await db.students.all();
  const isActive = (s) => s.active !== false;
  const activeCount = all.filter(isActive).length;
  const status = String(req.query.status || 'all');
  const search = String(req.query.search || '').trim().toLowerCase();
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(5, Number(req.query.pageSize) || 25));

  let rows = all;
  if (status === 'active') rows = rows.filter(isActive);
  else if (status === 'inactive') rows = rows.filter((s) => !isActive(s));
  if (search) rows = rows.filter((s) =>
    [s.registrationNumber, s.name, s.branch, s.section].some((v) => String(v || '').toLowerCase().includes(search)));

  const total = rows.length;
  const start = (page - 1) * pageSize;
  res.json({
    rows: rows.slice(start, start + pageSize),
    total, page, pageSize,
    activeCount, inactiveCount: all.length - activeCount, allCount: all.length,
  });
});

/** Update a student's profile / active state. */
app.post('/api/admin/students/:id', requireAdmin, async (req, res) => {
  const patch = {};
  for (const k of ['name', 'branch', 'section', 'domain']) if (typeof req.body?.[k] === 'string') patch[k] = req.body[k].trim();
  if (typeof req.body?.active === 'boolean') patch.active = req.body.active;
  const updated = await db.students.update(req.params.id, patch);
  if (!updated) return res.status(404).json({ error: 'Student not found' });
  res.json(updated);
});

// ============ Admin: results & reports ============
async function attemptRows() {
  const students = new Map((await db.students.all()).map((s) => [s.id, s]));
  return (await db.attempts.all()).map((a) => {
    const s = students.get(a.studentId) || {};
    return {
      attemptId: a.id, registrationNumber: s.registrationNumber || '', name: s.name || '', branch: s.branch || '', section: s.section || '', domain: s.domain || '',
      score: a.score, total: a.total, percentage: a.score == null ? null : pct(a.score, a.total),
      status: a.status, reason: a.reason || '', violations: a.violations ?? 0, autoSubmitted: !!a.autoSubmitted,
      ip: a.ip || '', startedAt: a.startedAt, submittedAt: a.submittedAt,
    };
  }).sort((x, y) => (y.startedAt || '').localeCompare(x.startedAt || ''));
}

app.get('/api/admin/attempts', requireAdmin, async (_req, res) => res.json(await attemptRows()));

app.get('/api/admin/export.csv', requireAdmin, async (_req, res) => {
  const rows = await attemptRows();
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['RegistrationNumber', 'Name', 'Branch', 'Section', 'Domain', 'Score', 'Total', 'Percentage', 'Status', 'AutoSubmitted', 'Violations', 'IP', 'StartedAt', 'SubmittedAt'];
  const lines = rows.map((r) => [r.registrationNumber, r.name, r.branch, r.section, r.domain, r.score ?? '', r.total, r.percentage ?? '', r.status, r.autoSubmitted ? 'yes' : 'no', r.violations ?? 0, r.ip, r.startedAt, r.submittedAt || ''].map(esc).join(','));
  res.setHeader('content-type', 'text/csv');
  res.setHeader('content-disposition', 'attachment; filename="kl-ai-quiz-results.csv"');
  res.send([header.join(','), ...lines].join('\n'));
});

app.post('/api/admin/attempts/:id/reopen', requireAdmin, async (req, res) => {
  const a = await db.attempts.get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Attempt not found' });
  await db.attempts.remove(a.id);
  res.json({ ok: true, message: 'Attempt cleared. The student can log in and take the exam again.' });
});

/** Delete ALL exam attempts (fresh start). Students keep their roster; questions stay. */
app.post('/api/admin/attempts/clear-all', requireAdmin, async (_req, res) => {
  const n = (await db.attempts.all()).length;
  await db.attempts.clearAll();
  res.json({ ok: true, cleared: n });
});

/** Force-submit ONE in-progress attempt now (grades current answers). The admin
 *  "revoke like auto-submit" action for a stuck/flagged student. */
app.post('/api/admin/attempts/:id/force-submit', requireAdmin, async (req, res) => {
  const a = await db.attempts.get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Attempt not found' });
  if (a.status !== 'in_progress') return res.json({ ok: true, already: true, status: a.status, score: a.score ?? 0, total: a.total });
  const { byId } = await getBank();
  let score = 0;
  for (const id of a.questionIds) { const q = byId.get(id); if (q && Number(a.answers[id]) === q.answerIndex) score++; }
  await db.attempts.update(a.id, { score, status: 'submitted', autoSubmitted: true, submittedAt: new Date().toISOString() });
  res.json({ ok: true, score, total: a.total, status: 'submitted' });
});

/** Force-submit EVERY in-progress attempt, as a background job (safe for thousands).
 *  Grades each on its saved answers and marks it submitted/auto. Poll GET /jobs/:id. */
app.post('/api/admin/attempts/force-submit-all', requireAdmin, async (_req, res) => {
  const jobId = crypto.randomUUID();
  await jobSet(jobId, { status: 'running', kind: 'force-all', done: 0, total: 0 });
  (async () => {
    try {
      const pending = (await db.attempts.all()).filter((a) => a.status === 'in_progress');
      const { byId } = await getBank();
      await jobSet(jobId, { status: 'running', kind: 'force-all', done: 0, total: pending.length });
      let done = 0;
      for (const a of pending) {
        let score = 0;
        for (const id of a.questionIds) { const q = byId.get(id); if (q && Number(a.answers[id]) === q.answerIndex) score++; }
        await db.attempts.update(a.id, { score, status: 'submitted', autoSubmitted: true, submittedAt: new Date().toISOString() });
        done++;
        if (done % 25 === 0) await jobSet(jobId, { status: 'running', kind: 'force-all', done, total: pending.length });
      }
      await jobSet(jobId, { status: 'ready', kind: 'force-all', done, total: pending.length, submitted: done });
    } catch (e) { await jobSet(jobId, { ...(jobsLocal.get(jobId) || {}), status: 'error', kind: 'force-all', error: e.message }); }
  })();
  res.json({ jobId });
});

// ============ Monitoring: live logins, per-student issue flags ============
const STUCK_MS = 3 * 60_000; // in_progress but no heartbeat for 3 min => "stuck / disconnected"
/** Live snapshot + flagged students. Flags: shared-IP, multi-IP, warnings, auto-submit, stuck. */
app.get('/api/admin/monitor', requireAdmin, async (_req, res) => {
  const now = Date.now();
  const [attempts, studentsAll, logins] = await Promise.all([db.attempts.all(), db.students.all(), db.loginEvents.all()]);
  const byId = new Map(studentsAll.map((s) => [s.id, s]));
  // IP → distinct students (from attempts) → shared-IP detection
  const ipStudents = new Map();
  for (const a of attempts) { if (!a.ip) continue; const k = a.ip; const set = ipStudents.get(k) || new Set(); set.add(a.studentId); ipStudents.set(k, set); }
  const sharedIps = [...ipStudents.entries()].filter(([, set]) => set.size > 1).map(([ip, set]) => ({ ip, students: set.size })).sort((x, y) => y.students - x.students);
  const sharedIpSet = new Set(sharedIps.map((s) => s.ip));
  // login events per reg → distinct IPs + count
  const loginByReg = new Map();
  for (const e of logins) { const m = loginByReg.get(e.registrationNumber) || { ips: new Set(), count: 0 }; if (e.ip) m.ips.add(e.ip); m.count++; loginByReg.set(e.registrationNumber, m); }
  let liveNow = 0, inProgress = 0, submitted = 0, autoSubmitted = 0;
  const rows = [];
  for (const a of attempts) {
    const s = byId.get(a.studentId) || {};
    const live = a.status === 'in_progress' && a.lastSeen && (now - Date.parse(a.lastSeen) < SESSION_ACTIVE_MS);
    const stuck = a.status === 'in_progress' && (!a.lastSeen || (now - Date.parse(a.lastSeen) > STUCK_MS));
    if (a.status === 'in_progress') inProgress++; if (a.status === 'submitted' || a.status === 'terminated') submitted++;
    if (a.autoSubmitted) autoSubmitted++; if (live) liveNow++;
    const lm = loginByReg.get(s.registrationNumber) || { ips: new Set(), count: 0 };
    const flags = [];
    if (a.ip && sharedIpSet.has(a.ip)) flags.push({ code: 'shared_ip', label: `Shared IP (${ipStudents.get(a.ip)?.size || 0} students)`, sev: 'high' });
    if (lm.ips.size > 1) flags.push({ code: 'multi_ip', label: `Multiple IPs (${lm.ips.size})`, sev: 'high' });
    if ((a.violations ?? 0) > 0) flags.push({ code: 'warnings', label: `${a.violations} warning${a.violations === 1 ? '' : 's'}`, sev: 'medium' });
    if (stuck) flags.push({ code: 'stuck', label: 'Stuck / disconnected', sev: 'medium' });
    if (a.autoSubmitted) flags.push({ code: 'auto', label: 'Auto-submitted', sev: 'info' });
    if (!flags.length && !live) continue; // only surface rows needing attention (+ live)
    rows.push({
      attemptId: a.id, registrationNumber: s.registrationNumber || '', name: s.name || '', section: s.section || '', domain: s.domain || '',
      ip: a.ip || '', status: a.status, live, stuck, violations: a.violations ?? 0, autoSubmitted: !!a.autoSubmitted,
      loginCount: lm.count, ipCount: lm.ips.size, startedAt: a.startedAt, flags,
      sev: flags.some((f) => f.sev === 'high') ? 3 : flags.some((f) => f.sev === 'medium') ? 2 : live ? 1 : 0,
    });
  }
  rows.sort((x, y) => (y.sev - x.sev) || (y.live - x.live) || (y.startedAt || '').localeCompare(x.startedAt || ''));
  res.json({
    summary: { liveNow, inProgress, submitted, autoSubmitted, flagged: rows.filter((r) => r.flags.length).length, sharedIps: sharedIps.length, totalAttempts: attempts.length },
    sharedIps: sharedIps.slice(0, 20), rows,
  });
});

/** Recent login history (newest first), optional search on regno/name/ip. */
app.get('/api/admin/monitor/logins', requireAdmin, async (req, res) => {
  const limit = Math.max(1, Math.min(2000, Number(req.query.limit) || 300));
  const search = String(req.query.search || '').trim().toLowerCase();
  let list = await db.loginEvents.recent(search ? 2000 : limit);
  if (search) list = list.filter((e) => `${e.registrationNumber} ${e.name} ${e.ip}`.toLowerCase().includes(search)).slice(0, limit);
  res.json(list);
});

/** Per-student strength/weakness analysis: by difficulty and by topic (concept). */
app.get('/api/admin/attempts/:id/analysis', requireAdmin, async (req, res) => {
  const a = await db.attempts.get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Attempt not found' });
  const student = await db.students.get(a.studentId);
  const { byId } = await getBank();
  const diff = { EASY: { c: 0, t: 0 }, MEDIUM: { c: 0, t: 0 }, HARD: { c: 0, t: 0 } };
  const topicMap = new Map();
  for (const qid of a.questionIds) {
    const q = byId.get(qid); if (!q) continue;
    const d = (q.difficulty || 'MEDIUM').toUpperCase(); if (!diff[d]) diff[d] = { c: 0, t: 0 };
    const correct = a.answers[qid] !== undefined && Number(a.answers[qid]) === q.answerIndex;
    diff[d].t++; if (correct) diff[d].c++;
    const tp = q.topic || 'General'; const tm = topicMap.get(tp) || { c: 0, t: 0 }; tm.t++; if (correct) tm.c++; topicMap.set(tp, tm);
  }
  const pctOf = (v) => (v.t ? Math.round((v.c / v.t) * 100) : 0);
  const byDifficulty = Object.entries(diff).map(([k, v]) => ({ difficulty: k, correct: v.c, total: v.t, pct: pctOf(v) }));
  const byTopic = [...topicMap].map(([topic, v]) => ({ topic, correct: v.c, total: v.t, pct: pctOf(v) })).sort((x, y) => y.pct - x.pct || y.total - x.total);
  const strengths = byTopic.filter((t) => t.total >= 1 && t.pct >= 70).slice(0, 6);
  const weaknesses = byTopic.filter((t) => t.total >= 1 && t.pct < 50).sort((x, y) => x.pct - y.pct).slice(0, 6);
  res.json({
    name: student?.name || '', registrationNumber: student?.registrationNumber || '', domain: student?.domain || '',
    score: a.score ?? 0, total: a.total, percentage: pct(a.score, a.total),
    byDifficulty, byTopic, strengths, weaknesses,
  });
});

/** Domain-wide class analysis: group stats, concept mastery, and per-student detail. */
app.get('/api/admin/analysis/domain', requireAdmin, async (req, res) => {
  const domain = String(req.query.domain || '').trim();
  const nd = normDomain(domain);
  const students = await db.students.all();
  const inDomain = domain ? students.filter((s) => normDomain(s.domain) === nd) : students;
  const idSet = new Set(inDomain.map((s) => s.id));
  const sById = new Map(inDomain.map((s) => [s.id, s]));
  const { byId } = await getBank();
  const attempts = (await db.attempts.all()).filter((a) => idSet.has(a.studentId));
  const submitted = attempts.filter((a) => a.status === 'submitted' || a.status === 'terminated');
  const diff = { EASY: { c: 0, t: 0 }, MEDIUM: { c: 0, t: 0 }, HARD: { c: 0, t: 0 } };
  const topicMap = new Map();
  const studentRows = [];
  let sumPct = 0, passed = 0;
  for (const a of submitted) {
    const s = sById.get(a.studentId) || {};
    for (const qid of a.questionIds) {
      const q = byId.get(qid); if (!q) continue;
      const d = (q.difficulty || 'MEDIUM').toUpperCase(); if (!diff[d]) diff[d] = { c: 0, t: 0 };
      const ok = a.answers[qid] !== undefined && Number(a.answers[qid]) === q.answerIndex;
      diff[d].t++; if (ok) diff[d].c++;
      const tp = q.topic || 'General'; const tm = topicMap.get(tp) || { c: 0, t: 0 }; tm.t++; if (ok) tm.c++; topicMap.set(tp, tm);
    }
    const p = pct(a.score, a.total); sumPct += p; if (p >= 75) passed++;
    studentRows.push({ registrationNumber: s.registrationNumber || '', name: s.name || '', branch: s.branch || '', section: s.section || '', score: a.score ?? 0, total: a.total, percentage: p, result: p >= 75 ? 'PASS' : 'FAIL', status: a.status, autoSubmitted: !!a.autoSubmitted, violations: a.violations ?? 0, ip: a.ip || '' });
  }
  const pctOf = (v) => (v.t ? Math.round((v.c / v.t) * 100) : 0);
  const byDifficulty = Object.entries(diff).map(([k, v]) => ({ difficulty: k, correct: v.c, total: v.t, pct: pctOf(v) }));
  const byTopic = [...topicMap].map(([topic, v]) => ({ topic, correct: v.c, total: v.t, pct: pctOf(v) })).sort((x, y) => y.pct - x.pct);
  studentRows.sort((x, y) => y.percentage - x.percentage);
  res.json({
    domain: domain || '(all)', studentsInDomain: inDomain.length, attempted: attempts.length, submitted: submitted.length,
    passed, failed: submitted.length - passed, avgPercentage: submitted.length ? Math.round(sumPct / submitted.length) : 0,
    byDifficulty, byTopic, strengths: byTopic.filter((t) => t.pct >= 70).slice(0, 8), weaknesses: byTopic.filter((t) => t.pct < 50).sort((x, y) => x.pct - y.pct).slice(0, 8),
    students: studentRows,
  });
});

app.get('/api/admin/report/questions', requireAdmin, async (_req, res) => {
  const subs = (await db.attempts.all()).filter((a) => a.status === 'submitted');
  const byId = new Map((await db.questions.all()).map((q) => [q.id, q]));
  const stat = new Map();
  for (const a of subs) for (const qid of a.questionIds) {
    const q = byId.get(qid); if (!q) continue;
    const s = stat.get(qid) || { answered: 0, correct: 0 };
    const ans = a.answers[qid];
    if (ans !== undefined) { s.answered++; if (Number(ans) === q.answerIndex) s.correct++; }
    stat.set(qid, s);
  }
  const questions = (await db.questions.all()).map((q) => {
    const s = stat.get(q.id) || { answered: 0, correct: 0 };
    return { id: q.id, question: q.question, topic: q.topic, difficulty: q.difficulty, answered: s.answered, correct: s.correct, pctCorrect: s.answered ? Math.round((s.correct / s.answered) * 100) : null };
  });
  res.json({ submittedAttempts: subs.length, questions });
});

// ============ Support tickets ============
/** Any student can raise a ticket (no auth). */
app.post('/api/ticket', async (req, res) => {
  const registrationNumber = String(req.body?.registrationNumber || '').trim();
  const message = String(req.body?.message || '').trim().slice(0, 1000);
  if (!message) return res.status(400).json({ error: 'Please describe your issue.' });
  const student = registrationNumber ? await db.students.byRegNo(registrationNumber) : null;
  const t = await db.tickets.add({ id: crypto.randomUUID(), registrationNumber, name: student?.name || '', message, status: 'open', createdAt: new Date().toISOString() });
  res.json({ ok: true, id: t.id });
});

app.get('/api/admin/tickets', requireAdmin, async (_req, res) => res.json(await db.tickets.all()));
app.post('/api/admin/tickets/:id/resolve', requireAdmin, async (req, res) => {
  const t = await db.tickets.update(req.params.id, { status: 'resolved' });
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  res.json(t);
});

// ============ Faculty: login by Emp ID → attendance for their section only ============
/** A faculty enters their Emp ID and sees ONLY their assigned students, with live
 *  attendance (Present = started the exam) + status + score. Read-only; Emp ID is the key. */
app.post('/api/faculty/login', async (req, res) => {
  const empId = String(req.body?.empId || '').trim();
  if (!empId) return res.status(400).json({ error: 'Enter your Employee ID.' });
  const students = await db.students.byEmpId(empId);
  if (!students.length) return res.status(404).json({ error: 'No students are assigned to this Employee ID. Please check the ID.' });
  const attempts = await db.attempts.all();
  const byStudent = new Map();
  for (const a of attempts) byStudent.set(a.studentId, a); // one attempt per student
  const loggedInRegs = new Set((await db.loginEvents.all()).filter((e) => e.ok).map((e) => e.registrationNumber));
  let present = 0, submitted = 0, inProgress = 0, absent = 0;
  const rows = students.map((s) => {
    const a = byStudent.get(s.id);
    const started = !!a;
    const done = a && (a.status === 'submitted' || a.status === 'terminated');
    if (done) submitted++; else if (a && a.status === 'in_progress') inProgress++;
    if (started) present++; else absent++;
    return {
      registrationNumber: s.registrationNumber, name: s.name, branch: s.branch, section: s.section,
      loggedIn: loggedInRegs.has(s.registrationNumber),
      present: started,
      status: done ? 'submitted' : a && a.status === 'in_progress' ? 'in_progress' : loggedInRegs.has(s.registrationNumber) ? 'logged_in' : 'absent',
      autoSubmitted: !!(a && a.autoSubmitted),
      score: done ? (a.score ?? 0) : null, total: a ? a.total : null,
      percentage: done ? pct(a.score, a.total) : null,
      startedAt: a ? a.startedAt : null, submittedAt: a ? a.submittedAt : null,
    };
  });
  const first = students[0];
  const sessions = await getSessions();
  const myPostings = await db.attendance.byEmpAll(empId);
  const postBySession = new Map(myPostings.map((p) => [String(p.sessionId), p]));
  // one card per session (newest first) with THIS faculty's posting status
  const sessionCards = sessions.slice().reverse().map((s) => {
    const p = postBySession.get(String(s.id));
    return { id: s.id, name: s.name, open: !!s.open, createdAt: s.createdAt, posted: !!p, postedAt: p?.postedAt || null, present: p ? p.present : 0, absent: p ? p.absent : 0, total: students.length, marks: p?.marks || null };
  });
  res.json({
    faculty: { empId, name: first.facultyName || '', section: first.section || '', room: first.room || '', total: students.length },
    summary: { total: students.length, present, absent, submitted, inProgress },
    sessions: sessionCards,
    students: rows,
  });
});

/** Faculty SUBMIT attendance for their section, for the OPEN session — strict: ONCE per session. */
app.post('/api/faculty/attendance', async (req, res) => {
  const empId = String(req.body?.empId || '').trim();
  const marks = (req.body?.marks && typeof req.body.marks === 'object') ? req.body.marks : null;
  if (!empId || !marks) return res.status(400).json({ error: 'Missing attendance data.' });
  const sessions = await getSessions();
  const active = sessions.find((s) => s.open) || null;
  if (!active) return res.status(403).json({ error: 'No attendance session is open. Please ask the coordinator to start one.' });
  const existing = await db.attendance.byEmp(active.id, empId);
  if (existing) return res.status(409).json({ error: `You already submitted attendance for "${active.name}" — it is locked. Ask the coordinator to revoke it if a change is needed.`, postedAt: existing.postedAt });
  const students = await db.students.byEmpId(empId);
  if (!students.length) return res.status(404).json({ error: 'No students for this Employee ID.' });
  const clean = {}; let present = 0;
  for (const s of students) { const p = !!marks[s.registrationNumber]; clean[s.registrationNumber] = p; if (p) present++; }
  const rec = { sessionId: active.id, empId, section: students[0].section || '', room: students[0].room || '', facultyName: students[0].facultyName || '', present, absent: students.length - present, total: students.length, marks: clean, postedAt: new Date().toISOString() };
  await db.attendance.set(rec);
  res.json({ ok: true, session: active.name, postedAt: rec.postedAt, present, absent: rec.absent, total: rec.total });
});

// ============ Attendance admin: sessions (create/open/close/delete) + report ============
// Multiple sessions are kept as history. Only one is "open" for faculty submissions at a time.
const getSessions = async () => (await db.settings.get('attendance_sessions')) || [];
const setSessions = async (arr) => db.settings.set('attendance_sessions', arr);

app.get('/api/admin/attendance/sessions', requireAdmin, async (_req, res) => res.json({ sessions: await getSessions() }));

/** Create a NEW session (keeps old ones). It becomes the open one; any other open session is closed. */
app.post('/api/admin/attendance/sessions/create', requireAdmin, async (req, res) => {
  const sessions = await getSessions();
  const now = new Date().toISOString();
  for (const s of sessions) if (s.open) { s.open = false; s.closedAt = now; }
  const name = String(req.body?.name || '').trim() || `Session ${sessions.length + 1}`;
  const sess = { id: crypto.randomUUID(), name, createdAt: now, openedAt: now, closedAt: null, open: true };
  sessions.push(sess); await setSessions(sessions);
  res.json(sess);
});

app.post('/api/admin/attendance/sessions/:id/open', requireAdmin, async (req, res) => {
  const sessions = await getSessions(); const now = new Date().toISOString();
  let found = null;
  for (const s of sessions) { if (s.id === req.params.id) { s.open = true; s.openedAt = now; s.closedAt = null; found = s; } else if (s.open) { s.open = false; s.closedAt = now; } }
  if (!found) return res.status(404).json({ error: 'Session not found' });
  await setSessions(sessions); res.json(found);
});

app.post('/api/admin/attendance/sessions/:id/close', requireAdmin, async (req, res) => {
  const sessions = await getSessions(); const s = sessions.find((x) => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  s.open = false; s.closedAt = new Date().toISOString(); await setSessions(sessions); res.json(s);
});

// Session deletion is intentionally DISABLED — every session's attendance is kept
// permanently as a record. (Close a session instead; its data stays viewable.)
app.post('/api/admin/attendance/sessions/:id/delete', requireAdmin, async (_req, res) =>
  res.status(403).json({ error: 'Deleting attendance sessions is disabled — all data is kept permanently. Close the session instead.' }));

app.post('/api/admin/attendance/revoke', requireAdmin, async (req, res) => {
  const empId = String(req.body?.empId || '').trim();
  const sessionId = String(req.body?.sessionId || '').trim();
  if (!empId || !sessionId) return res.status(400).json({ error: 'sessionId and empId required' });
  const removed = await db.attendance.removeByEmp(sessionId, empId);
  res.json({ ok: true, removed });
});

/** Overall + section-wise report for one session (defaults to the open session, else the latest). */
app.get('/api/admin/attendance/report', requireAdmin, async (req, res) => {
  const sessions = await getSessions();
  let sessionId = String(req.query.sessionId || '').trim();
  const session = sessions.find((s) => s.id === sessionId) || sessions.find((s) => s.open) || sessions[sessions.length - 1] || null;
  sessionId = session?.id || '';
  const [students, postings] = await Promise.all([db.students.all(), sessionId ? db.attendance.bySession(sessionId) : []]);
  const postByEmp = new Map(postings.map((p) => [String(p.empId), p]));
  const facMap = new Map();
  for (const s of students) {
    const e = String(s.empId || ''); if (!e) continue;
    let f = facMap.get(e);
    if (!f) { f = { empId: e, facultyName: s.facultyName || '', section: s.section || '', room: s.room || '', total: 0 }; facMap.set(e, f); }
    f.total++;
  }
  const sections = [...facMap.values()].map((f) => {
    const p = postByEmp.get(f.empId);
    return { ...f, posted: !!p, postedAt: p?.postedAt || null, present: p ? p.present : 0, absent: p ? p.absent : f.total, pct: p && f.total ? Math.round((p.present / f.total) * 100) : 0 };
  }).sort((a, b) => String(a.section).localeCompare(String(b.section)));
  const summary = {
    faculties: sections.length,
    posted: sections.filter((s) => s.posted).length,
    notPosted: sections.filter((s) => !s.posted).length,
    totalStudents: students.filter((s) => s.empId).length,
    present: sections.reduce((n, s) => n + s.present, 0),
    absent: sections.reduce((n, s) => n + (s.posted ? s.absent : 0), 0),
  };
  res.json({ sessions, session, summary, sections });
});

// ============ Student: login → instructions → start ============
/** Look up a student by registration number (no password). Returns their details + attempt state. */
app.post('/api/login', async (req, res) => {
  const registrationNumber = String(req.body?.registrationNumber || '').trim();
  const ip = clientIp(req);
  // Fire-and-forget login event for the Monitoring tab (never blocks/fails the login).
  const logLogin = (name, ok, reason) =>
    db.loginEvents.add({ id: crypto.randomUUID(), registrationNumber, name: name || '', ip, ok, reason, createdAt: new Date().toISOString() }).catch(() => {});
  if (!registrationNumber) return res.status(400).json({ error: 'Enter your registration number' });
  const student = await db.students.byRegNo(registrationNumber);
  if (!student) { logLogin('', false, 'not_found'); return res.status(404).json({ error: 'Registration number not found. Please contact the exam coordinator.' }); }
  if (student.active === false) { logLogin(student.name, false, 'deactivated'); return res.status(403).json({ error: 'Your account is deactivated. Please contact the exam coordinator.' }); }
  const mine = await db.attempts.byStudent(student.id);
  const done = mine.find((a) => a.status === 'submitted' || a.status === 'terminated');
  const inProgress = mine.find((a) => a.status === 'in_progress');
  logLogin(student.name, true, done ? 'completed' : inProgress ? 'resume' : 'ok');
  res.json({
    student: { registrationNumber: student.registrationNumber, name: student.name, branch: student.branch, section: student.section, domain: student.domain || '' },
    attempt: done ? { state: 'completed', attemptId: done.id, status: done.status, score: done.score ?? 0, total: done.total, percentage: pct(done.score, done.total) }
      : inProgress ? { state: 'in_progress', attemptId: inProgress.id } : { state: 'none' },
    quizSize: QUIZ_SIZE, durationMin: QUIZ_DURATION_MIN, schedule: await scheduleStatusFor(student.domain),
  });
});

/** Begin the exam (one attempt per registration number; one active screen at a time). */
app.post('/api/exam/start', async (req, res) => {
  const registrationNumber = String(req.body?.registrationNumber || '').trim();
  const incomingSid = String(req.body?.sessionId || '');
  const student = await db.students.byRegNo(registrationNumber);
  if (!student) return res.status(404).json({ error: 'Registration number not found.' });
  if (student.active === false) return res.status(403).json({ error: 'Your account is deactivated. Please contact the exam coordinator.' });
  const mine = await db.attempts.byStudent(student.id);
  const done = mine.find((a) => a.status === 'submitted' || a.status === 'terminated');
  if (done) return res.json({ completed: true, attemptId: done.id });
  const inProgress = mine.find((a) => a.status === 'in_progress');
  if (inProgress) {
    // single active screen: block a second device while the first is live (heartbeat fresh)
    const sessionActive = inProgress.lastSeen && (Date.now() - Date.parse(inProgress.lastSeen) < SESSION_ACTIVE_MS);
    if (sessionActive && incomingSid !== inProgress.sessionId) {
      return res.status(409).json({ openElsewhere: true, error: 'This registration number is already taking the exam on another screen/device. Close it, then wait about a minute and try again.' });
    }
    const sid = incomingSid && incomingSid === inProgress.sessionId ? inProgress.sessionId : crypto.randomUUID();
    await db.attempts.update(inProgress.id, { sessionId: sid, lastSeen: new Date().toISOString() });
    return res.json({ attemptId: inProgress.id, total: inProgress.total, sessionId: sid });
  }
  // The student's DOMAIN exam must be scheduled + open.
  const sch = await scheduleStatusFor(student.domain);
  if (!sch.open) return res.status(403).json({
    error: `No exam is scheduled for your domain${student.domain ? ` (${student.domain})` : ''} yet. Please wait for the coordinator.`,
    schedule: sch,
  });
  // Domain-specific: a student only gets questions from their Hackathon Domain.
  const sd = normDomain(student.domain);
  const pool = (await getBank()).list.filter((q) => normDomain(q.domain) === sd);
  if (!pool.length) return res.status(400).json({
    error: student.domain
      ? `No questions are available yet for your domain "${student.domain}". Please contact the coordinator.`
      : 'No exam domain is assigned to you. Please contact the coordinator.',
  });
  const size = Math.min(sch.questionCount || QUIZ_SIZE, pool.length);
  const picked = pickByMix(pool, size, sch.mix); // honour the Easy/Medium/Hard composition
  const sid = crypto.randomUUID();
  const attempt = await db.attempts.add({
    id: crypto.randomUUID(), studentId: student.id, questionIds: picked.map((q) => q.id),
    answers: {}, score: null, total: size, status: 'in_progress', reason: '', durationMin: sch.durationMin,
    ip: clientIp(req), autoSubmitted: false,
    sessionId: sid, lastSeen: new Date().toISOString(), startedAt: new Date().toISOString(), submittedAt: null,
  });
  res.json({ attemptId: attempt.id, total: size, sessionId: sid, durationMin: sch.durationMin });
});

// ============ Exam: questions / submit / terminate / result ============
app.get('/api/quiz/:attemptId', async (req, res) => {
  const attempt = await db.attempts.get(req.params.attemptId);
  if (!attempt) return res.status(404).json({ error: 'Attempt not found' });
  // one active screen: block if another live session owns this attempt
  const sid = String(req.query.s || req.headers['x-exam-session'] || '');
  if (attempt.sessionId && sid !== attempt.sessionId) {
    const active = attempt.lastSeen && (Date.now() - Date.parse(attempt.lastSeen) < SESSION_ACTIVE_MS);
    if (active) return res.status(409).json({ openElsewhere: true, error: 'This exam is open on another screen.' });
  }
  if (sid && sid === attempt.sessionId) await db.attempts.update(attempt.id, { lastSeen: new Date().toISOString() });
  const { byId } = await getBank();
  const questions = attempt.questionIds.map((id) => byId.get(id)).filter(Boolean)
    .map((q) => ({ id: q.id, question: q.question, options: q.options, topic: q.topic, difficulty: q.difficulty }));
  res.json({ attemptId: attempt.id, total: attempt.total, status: attempt.status, startedAt: attempt.startedAt, durationMin: attempt.durationMin || QUIZ_DURATION_MIN, serverNow: Date.now(), answers: attempt.answers || {}, questions });
});

/** Auto-save answers (also acts as the heartbeat). Lets a student resume the exact state. */
app.post('/api/quiz/:attemptId/save', async (req, res) => {
  const attempt = await db.attempts.get(req.params.attemptId);
  if (!attempt || attempt.status !== 'in_progress') return res.json({ ok: false, done: true });
  const sid = String(req.body?.sessionId || '');
  if (attempt.sessionId && sid !== attempt.sessionId) return res.json({ ok: false, openElsewhere: true });
  const answers = (req.body && typeof req.body.answers === 'object' && req.body.answers) || attempt.answers || {};
  await db.attempts.update(attempt.id, { answers, lastSeen: new Date().toISOString() });
  res.json({ ok: true });
});

/** Heartbeat — keeps this screen's session alive; 409 if another screen took over. */
app.post('/api/quiz/:attemptId/ping', async (req, res) => {
  const attempt = await db.attempts.get(req.params.attemptId);
  if (!attempt || attempt.status !== 'in_progress') return res.json({ ok: false, done: true });
  const sid = String(req.body?.sessionId || '');
  if (attempt.sessionId && sid !== attempt.sessionId) return res.json({ ok: false, openElsewhere: true });
  await db.attempts.update(attempt.id, { lastSeen: new Date().toISOString() });
  res.json({ ok: true });
});

app.post('/api/quiz/:attemptId/submit', async (req, res) => {
  const attempt = await db.attempts.get(req.params.attemptId);
  if (!attempt) return res.status(404).json({ error: 'Attempt not found' });
  // Idempotent: if it's already finished (e.g. the server auto-finalized it, or a retry),
  // return the recorded result instead of erroring — the client just proceeds to the result.
  if (attempt.status !== 'in_progress') {
    return res.json({ score: attempt.score ?? 0, total: attempt.total, percentage: pct(attempt.score, attempt.total), status: attempt.status, alreadyDone: true });
  }
  const answers = req.body?.answers || {};
  const violations = Math.max(0, Number(req.body?.violations) || 0);
  const { byId } = await getBank();
  let score = 0;
  for (const id of attempt.questionIds) { const q = byId.get(id); if (q && Number(answers[id]) === q.answerIndex) score++; }
  const updated = await db.attempts.update(attempt.id, { answers, score, violations, status: 'submitted', submittedAt: new Date().toISOString() });
  res.json({ score, total: updated.total, percentage: pct(score, updated.total) });
});

app.post('/api/quiz/:attemptId/terminate', async (req, res) => {
  const attempt = await db.attempts.get(req.params.attemptId);
  if (!attempt) return res.status(404).json({ error: 'Attempt not found' });
  if (attempt.status !== 'in_progress') return res.json({ score: attempt.score ?? 0, status: attempt.status });
  const reason = String(req.body?.reason || 'security-violation');
  await db.attempts.update(attempt.id, { score: 0, status: 'terminated', reason, submittedAt: new Date().toISOString() });
  res.json({ score: 0, total: attempt.total, status: 'terminated', reason });
});

app.get('/api/result/:attemptId', async (req, res) => {
  const attempt = await db.attempts.get(req.params.attemptId);
  if (!attempt) return res.status(404).json({ error: 'Attempt not found' });
  if (attempt.status === 'in_progress') return res.status(409).json({ error: 'Not submitted yet' });
  const terminated = attempt.status === 'terminated';
  const { byId } = await getBank();
  const review = terminated ? [] : attempt.questionIds.map((id) => {
    const q = byId.get(id); const your = attempt.answers[id];
    return { question: q?.question, options: q?.options, correctIndex: q?.answerIndex, yourIndex: your === undefined ? null : Number(your), correct: q ? Number(your) === q.answerIndex : false, explanation: q?.explanation };
  });
  res.json({ score: attempt.score ?? 0, total: attempt.total, percentage: pct(attempt.score, attempt.total), status: attempt.status, terminated, reason: attempt.reason || '', review });
});

// Serve the built student client (same origin as the API) if it's present.
// Students open https://<this-server>/ and get the exam app; /api/* stays the API.
const clientDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (fs.existsSync(path.join(clientDir, 'index.html'))) {
  // Hashed assets (index-<hash>.js/css) can cache forever; index.html must NOT be cached
  // or a browser keeps loading the OLD bundle after a redeploy (stale-client bug).
  app.use(express.static(clientDir, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      else if (/\.[0-9a-zA-Z_-]{8,}\.(js|css)$/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(clientDir, 'index.html'));
  });
  console.log('[client] serving student app from', clientDir);
}

// Safety net: auto-submit any in-progress attempt whose time is up, so "time over"
// always records a result even if the student's browser/tab didn't submit (backgrounded
// tab, lost connection, closed laptop, etc.). Runs every 60s.
async function finalizeExpired() {
  const now = Date.now();
  const all = await db.attempts.all();
  const expired = all.filter((a) => a.status === 'in_progress' && a.startedAt &&
    (now - Date.parse(a.startedAt)) > ((a.durationMin || QUIZ_DURATION_MIN) * 60_000) + 5_000);
  if (!expired.length) return;
  const { byId } = await getBank();
  for (const a of expired) {
    let score = 0;
    for (const id of a.questionIds) { const q = byId.get(id); if (q && Number(a.answers[id]) === q.answerIndex) score++; }
    await db.attempts.update(a.id, { score, status: 'submitted', autoSubmitted: true, submittedAt: new Date().toISOString() });
  }
  console.log(`[finalize] auto-submitted ${expired.length} expired attempt(s)`);
}
// Run the auto-finalize sweep in ONE process only: the single worker (id 1) when
// clustered, or this process when running standalone. Otherwise every worker would
// redundantly sweep the same attempts each minute.
const runSweep = !cluster.isWorker || cluster.worker.id === 1;
if (runSweep) setInterval(() => finalizeExpired().catch((e) => console.error('[finalize]', e.message)), 60_000);

app.listen(PORT, () => console.log(`[${APP_NAME}] worker ${cluster.worker?.id || 'standalone'} on http://localhost:${PORT}  (model: ${MODEL}, store: ${db.driver})`));

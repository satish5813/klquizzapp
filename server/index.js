import 'dotenv/config';
import express from 'express';
import cors from 'cors';
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
app.use(cors());
app.use(express.json({ limit: '8mb' }));

const requireAdmin = (req, res, next) => {
  if ((req.headers['x-admin-token'] || '') !== ADMIN_TOKEN) return res.status(401).json({ error: 'Invalid admin token' });
  next();
};
const pct = (score, total) => Math.round(((score ?? 0) / total) * 100);
// Normalize a domain label so "Java Core", "JavaCore", "java core" all match.
const normDomain = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// In-memory question bank cache — avoids a full questions read on every
// start/quiz/submit, so the API scales to thousands of concurrent students.
let _bank = null;
async function getBank() {
  if (!_bank) {
    const list = await db.questions.all();
    _bank = { list, byId: new Map(list.map((q) => [q.id, q])) };
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
  for (const q of qs) { const d = q.domain || '(none)'; byDomain[d] = (byDomain[d] || 0) + 1; }
  res.json({ count: qs.length, topics: [...new Set(qs.map((q) => q.topic))].slice(0, 40), byDomain });
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

const jobs = new Map();
app.post('/api/admin/generate', requireAdmin, async (req, res) => {
  // Key may come from the admin desktop app (preferred) or the server env.
  const apiKey = String(req.body?.apiKey || '').trim() || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(400).json({ error: 'No Claude API key. Enter it in the desktop app (Question bank tab), or set ANTHROPIC_API_KEY on the server.' });
  const syllabus = String(req.body?.syllabus || '').trim();
  const count = Math.max(1, Math.min(50000, Number(req.body?.count) || 1000));
  const replace = !!req.body?.replace;
  const domain = String(req.body?.domain || '').trim();
  if (syllabus.length < 10) return res.status(400).json({ error: 'Provide a syllabus (min 10 chars)' });

  const jobId = crypto.randomUUID();
  jobs.set(jobId, { status: 'running', collected: 0, target: count, requests: 0, replace, domain });
  (async () => {
    try {
      const { questions, stats } = await generateBank({
        apiKey, model: MODEL, syllabus, target: count,
        existingNorms: await db.questions.normSet(),
        onProgress: (p) => jobs.set(jobId, { ...jobs.get(jobId), ...p, status: 'running' }),
      });
      questions.forEach((q) => { q.domain = domain; }); // tag with the exam domain
      // Hold for PREVIEW — do not save until the admin posts/publishes.
      jobs.set(jobId, { status: 'ready', collected: questions.length, target: count, requests: stats.requests, stats, replace, domain, questions });
    } catch (e) { jobs.set(jobId, { ...jobs.get(jobId), status: 'error', error: e.message }); }
  })();
  res.json({ jobId });
});

app.get('/api/admin/jobs/:id', requireAdmin, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job); // when status==='ready', includes the generated `questions` for preview
});

/** Publish previewed questions into the bank. */
app.post('/api/admin/generate/:id/publish', requireAdmin, async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'ready') return res.status(409).json({ error: `Nothing to publish (job is ${job.status})` });
  if (job.replace) await db.questions.clear();
  const added = job.questions.length;
  await db.questions.addMany(job.questions);
  invalidateBank();
  const bankTotal = await db.questions.count();
  jobs.set(req.params.id, { ...job, status: 'published', questions: undefined, bankTotal });
  res.json({ added, bankTotal });
});

/** Discard previewed questions without saving. */
app.post('/api/admin/generate/:id/discard', requireAdmin, (req, res) => {
  jobs.delete(req.params.id);
  res.json({ ok: true });
});

// ============ Admin: per-domain exam schedule ============
// Exams are CLOSED by default. A domain's exam opens only when the admin enables
// its schedule (optionally within a start/end window).
async function scheduleStatusFor(domain) {
  const all = (await db.settings.get('schedules')) || {};
  const key = Object.keys(all).find((k) => normDomain(k) === normDomain(domain));
  const s = key ? all[key] : null;
  if (!s || !s.enabled) return { open: false, reason: 'not_scheduled', domain };
  const now = Date.now();
  if (s.startAt && now < Date.parse(s.startAt)) return { open: false, reason: 'not_started', startAt: s.startAt, endAt: s.endAt, domain };
  if (s.endAt && now > Date.parse(s.endAt)) return { open: false, reason: 'closed', startAt: s.startAt, endAt: s.endAt, domain };
  return { open: true, reason: 'open', startAt: s.startAt, endAt: s.endAt, domain };
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
  const startAt = req.body?.startAt ? new Date(req.body.startAt).toISOString() : null;
  const endAt = req.body?.endAt ? new Date(req.body.endAt).toISOString() : null;
  if (enabled && startAt && endAt && Date.parse(endAt) <= Date.parse(startAt)) return res.status(400).json({ error: 'End time must be after start time' });
  const all = (await db.settings.get('schedules')) || {};
  all[domain] = { enabled, startAt, endAt };
  await db.settings.set('schedules', all);
  res.json({ domain, ...all[domain] });
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
app.post('/api/admin/parse-mcqs', requireAdmin, (req, res) => {
  const apiKey = String(req.body?.apiKey || '').trim() || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(400).json({ error: 'No Claude API key. Enter it in the desktop app (Question bank tab).' });
  const text = String(req.body?.text || '').trim();
  if (text.length < 20) return res.status(400).json({ error: 'No readable text found in the file.' });

  const jobId = crypto.randomUUID();
  jobs.set(jobId, { status: 'running', kind: 'extract', chunk: 0, chunks: 0, found: 0 });
  (async () => {
    try {
      const { questions } = await extractMcqs({
        apiKey, model: MODEL, text,
        onProgress: (p) => jobs.set(jobId, { ...jobs.get(jobId), ...p, status: 'running' }),
      });
      jobs.set(jobId, { status: 'ready', kind: 'extract', questions, count: questions.length });
    } catch (e) { jobs.set(jobId, { ...jobs.get(jobId), status: 'error', error: e.message }); }
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
    if (!registrationNumber || !name) { errors.push({ row: i + 1, reason: 'need registrationNumber and name' }); return; }
    rows.push({ id: crypto.randomUUID(), registrationNumber, name, branch, section, domain, createdAt: new Date().toISOString() });
  });
  const r = await db.students.importMany(rows);
  res.json({ ...r, skipped: errors.length, errors: errors.slice(0, 50) });
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
  for (const k of ['name', 'branch', 'section']) if (typeof req.body?.[k] === 'string') patch[k] = req.body[k].trim();
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
      attemptId: a.id, registrationNumber: s.registrationNumber || '', name: s.name || '', branch: s.branch || '', section: s.section || '',
      score: a.score, total: a.total, percentage: a.score == null ? null : pct(a.score, a.total),
      status: a.status, reason: a.reason || '', violations: a.violations ?? 0, startedAt: a.startedAt, submittedAt: a.submittedAt,
    };
  }).sort((x, y) => (y.startedAt || '').localeCompare(x.startedAt || ''));
}

app.get('/api/admin/attempts', requireAdmin, async (_req, res) => res.json(await attemptRows()));

app.get('/api/admin/export.csv', requireAdmin, async (_req, res) => {
  const rows = await attemptRows();
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['RegistrationNumber', 'Name', 'Branch', 'Section', 'Score', 'Total', 'Percentage', 'Status', 'Violations', 'StartedAt', 'SubmittedAt'];
  const lines = rows.map((r) => [r.registrationNumber, r.name, r.branch, r.section, r.score ?? '', r.total, r.percentage ?? '', r.status, r.violations ?? 0, r.startedAt, r.submittedAt || ''].map(esc).join(','));
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

// ============ Student: login → instructions → start ============
/** Look up a student by registration number (no password). Returns their details + attempt state. */
app.post('/api/login', async (req, res) => {
  const registrationNumber = String(req.body?.registrationNumber || '').trim();
  if (!registrationNumber) return res.status(400).json({ error: 'Enter your registration number' });
  const student = await db.students.byRegNo(registrationNumber);
  if (!student) return res.status(404).json({ error: 'Registration number not found. Please contact the exam coordinator.' });
  if (student.active === false) return res.status(403).json({ error: 'Your account is deactivated. Please contact the exam coordinator.' });
  const mine = await db.attempts.byStudent(student.id);
  const done = mine.find((a) => a.status === 'submitted' || a.status === 'terminated');
  const inProgress = mine.find((a) => a.status === 'in_progress');
  res.json({
    student: { registrationNumber: student.registrationNumber, name: student.name, branch: student.branch, section: student.section, domain: student.domain || '' },
    attempt: done ? { state: 'completed', attemptId: done.id, status: done.status, score: done.score ?? 0, total: done.total, percentage: pct(done.score, done.total) }
      : inProgress ? { state: 'in_progress', attemptId: inProgress.id } : { state: 'none' },
    quizSize: QUIZ_SIZE, durationMin: QUIZ_DURATION_MIN, schedule: await scheduleStatusFor(student.domain),
  });
});

/** Begin the exam (one attempt per registration number). */
app.post('/api/exam/start', async (req, res) => {
  const registrationNumber = String(req.body?.registrationNumber || '').trim();
  const student = await db.students.byRegNo(registrationNumber);
  if (!student) return res.status(404).json({ error: 'Registration number not found.' });
  if (student.active === false) return res.status(403).json({ error: 'Your account is deactivated. Please contact the exam coordinator.' });
  const mine = await db.attempts.byStudent(student.id);
  const done = mine.find((a) => a.status === 'submitted' || a.status === 'terminated');
  if (done) return res.json({ completed: true, attemptId: done.id });
  const inProgress = mine.find((a) => a.status === 'in_progress');
  if (inProgress) return res.json({ attemptId: inProgress.id, total: inProgress.total });
  // The student's DOMAIN exam must be scheduled + open.
  const sch = await scheduleStatusFor(student.domain);
  if (!sch.open) return res.status(403).json({
    error: sch.reason === 'not_started'
      ? `Your ${student.domain || ''} exam has not started yet. It opens at ${new Date(sch.startAt).toLocaleString()}.`
      : sch.reason === 'closed'
        ? `Your ${student.domain || ''} exam window has closed.`
        : `No exam is scheduled for your domain${student.domain ? ` (${student.domain})` : ''} yet. Please wait for the coordinator.`,
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
  const size = Math.min(QUIZ_SIZE, pool.length);
  const picked = shuffle(pool).slice(0, size);
  const attempt = await db.attempts.add({
    id: crypto.randomUUID(), studentId: student.id, questionIds: picked.map((q) => q.id),
    answers: {}, score: null, total: size, status: 'in_progress', reason: '', startedAt: new Date().toISOString(), submittedAt: null,
  });
  res.json({ attemptId: attempt.id, total: size });
});

// ============ Exam: questions / submit / terminate / result ============
app.get('/api/quiz/:attemptId', async (req, res) => {
  const attempt = await db.attempts.get(req.params.attemptId);
  if (!attempt) return res.status(404).json({ error: 'Attempt not found' });
  const { byId } = await getBank();
  const questions = attempt.questionIds.map((id) => byId.get(id)).filter(Boolean)
    .map((q) => ({ id: q.id, question: q.question, options: q.options, topic: q.topic, difficulty: q.difficulty }));
  res.json({ attemptId: attempt.id, total: attempt.total, status: attempt.status, startedAt: attempt.startedAt, durationMin: QUIZ_DURATION_MIN, questions });
});

app.post('/api/quiz/:attemptId/submit', async (req, res) => {
  const attempt = await db.attempts.get(req.params.attemptId);
  if (!attempt) return res.status(404).json({ error: 'Attempt not found' });
  if (attempt.status !== 'in_progress') return res.status(409).json({ error: `Attempt already ${attempt.status}` });
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

app.listen(PORT, () => console.log(`[${APP_NAME}] server on http://localhost:${PORT}  (model: ${MODEL}, store: ${db.driver})`));

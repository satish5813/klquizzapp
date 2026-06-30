import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initStore } from './db.js';
import { shuffle, normalizeQuestion } from './util.js';
import { estimate, generateBank } from './claude.js';

const PORT = Number(process.env.PORT || 4000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'change-me-admin';
const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5';
const QUIZ_SIZE = Number(process.env.QUIZ_SIZE || 60);
const QUIZ_DURATION_MIN = Number(process.env.QUIZ_DURATION_MIN || 60);
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

app.get('/api/health', (_req, res) =>
  res.json({ app: APP_NAME, status: 'ok', model: MODEL, driver: db.driver, quizSize: QUIZ_SIZE, durationMin: QUIZ_DURATION_MIN, hasKey: !!process.env.ANTHROPIC_API_KEY }));

// ============ Admin: bank ============
app.get('/api/admin/bank/stats', requireAdmin, async (_req, res) => {
  const qs = await db.questions.all();
  res.json({ count: qs.length, topics: [...new Set(qs.map((q) => q.topic))].slice(0, 40) });
});

app.post('/api/admin/estimate', requireAdmin, (req, res) => {
  res.json(estimate(Math.max(1, Math.min(50000, Number(req.body?.count) || 1000))));
});

const jobs = new Map();
app.post('/api/admin/generate', requireAdmin, async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ error: 'ANTHROPIC_API_KEY is not set on the server (.env)' });
  const syllabus = String(req.body?.syllabus || '').trim();
  const count = Math.max(1, Math.min(50000, Number(req.body?.count) || 1000));
  const replace = !!req.body?.replace;
  if (syllabus.length < 10) return res.status(400).json({ error: 'Provide a syllabus (min 10 chars)' });

  const jobId = crypto.randomUUID();
  jobs.set(jobId, { status: 'running', collected: 0, target: count, requests: 0 });
  (async () => {
    try {
      if (replace) await db.questions.clear();
      const { questions, stats } = await generateBank({
        apiKey: process.env.ANTHROPIC_API_KEY, model: MODEL, syllabus, target: count,
        existingNorms: await db.questions.normSet(),
        onProgress: (p) => jobs.set(jobId, { ...jobs.get(jobId), ...p, status: 'running' }),
      });
      await db.questions.addMany(questions);
      jobs.set(jobId, { status: 'done', collected: questions.length, target: count, requests: stats.requests, stats, bankTotal: await db.questions.count() });
    } catch (e) { jobs.set(jobId, { ...jobs.get(jobId), status: 'error', error: e.message }); }
  })();
  res.json({ jobId });
});

app.get('/api/admin/jobs/:id', requireAdmin, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

/** Import model/sample MCQs directly (no AI). */
app.post('/api/admin/import', requireAdmin, async (req, res) => {
  const raw = Array.isArray(req.body?.questions) ? req.body.questions : null;
  if (!raw) return res.status(400).json({ error: 'Body must be { questions: [...] }' });
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
    toAdd.push({ id: crypto.randomUUID(), question, options, answerIndex, topic: q.topic || 'General', difficulty: (q.difficulty || 'MEDIUM').toUpperCase(), explanation: q.explanation || '', norm });
  });
  await db.questions.addMany(toAdd);
  res.json({ added: toAdd.length, skipped: errors.length, errors: errors.slice(0, 50), bankTotal: await db.questions.count() });
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
    if (!registrationNumber || !name) { errors.push({ row: i + 1, reason: 'need registrationNumber and name' }); return; }
    rows.push({ id: crypto.randomUUID(), registrationNumber, name, branch, section, createdAt: new Date().toISOString() });
  });
  const r = await db.students.importMany(rows);
  res.json({ ...r, skipped: errors.length, errors: errors.slice(0, 50) });
});

app.get('/api/admin/students', requireAdmin, async (_req, res) => res.json(await db.students.all()));

// ============ Admin: results & reports ============
async function attemptRows() {
  const students = new Map((await db.students.all()).map((s) => [s.id, s]));
  return (await db.attempts.all()).map((a) => {
    const s = students.get(a.studentId) || {};
    return {
      attemptId: a.id, registrationNumber: s.registrationNumber || '', name: s.name || '', branch: s.branch || '', section: s.section || '',
      score: a.score, total: a.total, percentage: a.score == null ? null : pct(a.score, a.total),
      status: a.status, reason: a.reason || '', startedAt: a.startedAt, submittedAt: a.submittedAt,
    };
  }).sort((x, y) => (y.startedAt || '').localeCompare(x.startedAt || ''));
}

app.get('/api/admin/attempts', requireAdmin, async (_req, res) => res.json(await attemptRows()));

app.get('/api/admin/export.csv', requireAdmin, async (_req, res) => {
  const rows = await attemptRows();
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['RegistrationNumber', 'Name', 'Branch', 'Section', 'Score', 'Total', 'Percentage', 'Status', 'Reason', 'StartedAt', 'SubmittedAt'];
  const lines = rows.map((r) => [r.registrationNumber, r.name, r.branch, r.section, r.score ?? '', r.total, r.percentage ?? '', r.status, r.reason, r.startedAt, r.submittedAt || ''].map(esc).join(','));
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
  const mine = await db.attempts.byStudent(student.id);
  const done = mine.find((a) => a.status === 'submitted' || a.status === 'terminated');
  const inProgress = mine.find((a) => a.status === 'in_progress');
  res.json({
    student: { registrationNumber: student.registrationNumber, name: student.name, branch: student.branch, section: student.section },
    attempt: done ? { state: 'completed', attemptId: done.id, status: done.status, score: done.score ?? 0, total: done.total, percentage: pct(done.score, done.total) }
      : inProgress ? { state: 'in_progress', attemptId: inProgress.id } : { state: 'none' },
    quizSize: QUIZ_SIZE, durationMin: QUIZ_DURATION_MIN,
  });
});

/** Begin the exam (one attempt per registration number). */
app.post('/api/exam/start', async (req, res) => {
  const registrationNumber = String(req.body?.registrationNumber || '').trim();
  const student = await db.students.byRegNo(registrationNumber);
  if (!student) return res.status(404).json({ error: 'Registration number not found.' });
  const bank = await db.questions.all();
  if (!bank.length) return res.status(400).json({ error: 'No questions available yet. Please contact the coordinator.' });
  const mine = await db.attempts.byStudent(student.id);
  const done = mine.find((a) => a.status === 'submitted' || a.status === 'terminated');
  if (done) return res.json({ completed: true, attemptId: done.id });
  const inProgress = mine.find((a) => a.status === 'in_progress');
  if (inProgress) return res.json({ attemptId: inProgress.id, total: inProgress.total });
  const size = Math.min(QUIZ_SIZE, bank.length);
  const picked = shuffle(bank).slice(0, size);
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
  const byId = new Map((await db.questions.all()).map((q) => [q.id, q]));
  const questions = attempt.questionIds.map((id) => byId.get(id)).filter(Boolean)
    .map((q) => ({ id: q.id, question: q.question, options: q.options, topic: q.topic, difficulty: q.difficulty }));
  res.json({ attemptId: attempt.id, total: attempt.total, status: attempt.status, startedAt: attempt.startedAt, durationMin: QUIZ_DURATION_MIN, questions });
});

app.post('/api/quiz/:attemptId/submit', async (req, res) => {
  const attempt = await db.attempts.get(req.params.attemptId);
  if (!attempt) return res.status(404).json({ error: 'Attempt not found' });
  if (attempt.status !== 'in_progress') return res.status(409).json({ error: `Attempt already ${attempt.status}` });
  const answers = req.body?.answers || {};
  const byId = new Map((await db.questions.all()).map((q) => [q.id, q]));
  let score = 0;
  for (const id of attempt.questionIds) { const q = byId.get(id); if (q && Number(answers[id]) === q.answerIndex) score++; }
  const updated = await db.attempts.update(attempt.id, { answers, score, status: 'submitted', submittedAt: new Date().toISOString() });
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
  const byId = new Map((await db.questions.all()).map((q) => [q.id, q]));
  const review = terminated ? [] : attempt.questionIds.map((id) => {
    const q = byId.get(id); const your = attempt.answers[id];
    return { question: q?.question, options: q?.options, correctIndex: q?.answerIndex, yourIndex: your === undefined ? null : Number(your), correct: q ? Number(your) === q.answerIndex : false, explanation: q?.explanation };
  });
  res.json({ score: attempt.score ?? 0, total: attempt.total, percentage: pct(attempt.score, attempt.total), status: attempt.status, terminated, reason: attempt.reason || '', review });
});

app.listen(PORT, () => console.log(`[${APP_NAME}] server on http://localhost:${PORT}  (model: ${MODEL}, store: ${db.driver})`));

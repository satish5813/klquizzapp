// ============ Certification exams (9 certification courses) ============
// Global-certification style: case studies with linked questions, single and multi-select,
// a paper blueprint per course, scheduling, one question at a time with a Back button,
// enforced fullscreen with warnings, and lightweight proctoring events (no camera, no models).
import crypto from 'node:crypto';

const txt = (v, n = 190) => String(v ?? '').trim().slice(0, n);
const num = (v, d, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const normOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 500);
const ok = (a) => (Array.isArray(a) ? a : []);
const shuffle = (arr, rnd) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// deterministic per-student shuffle, so a refresh never reshuffles the paper
function rng(seed) { let h = 2166136261; for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const DEFAULT_RULES = {
  fullscreen: true, warnings: 2, autoSubmitOnBreach: true,
  back: true, oneAtATime: true, shuffleQuestions: true, shuffleOptions: true,
  showResult: true, negativeMarking: 0,
};
// how much each proctoring flag costs the integrity score
const PENALTY = { blur_short: 2, blur_long: 6, fullscreen_exit: 10, paste: 8, copy: 2, second_display: 10, devtools: 15, offline: 3, quick_answer_after_away: 20, resize: 2 };

export function registerCertExamRoutes(app, { db, requireAdmin }) {
  const now = () => new Date().toISOString();

  // ---------------- courses ----------------
  app.get('/api/admin/cert/courses', requireAdmin, async (_req, res) => {
    const courses = await db.certCourses.all();
    const out = [];
    for (const c of courses) {
      const [qs, cases, papers] = await Promise.all([db.certQuestions.byCourse(c.code), db.certCases.byCourse(c.code), db.certPapers.byCourse(c.code)]);
      out.push({ ...c, questions: qs.length, cases: cases.length, papers: papers.length, caseQuestions: qs.filter((q) => q.caseId).length });
    }
    res.json({ courses: out });
  });

  app.post('/api/admin/cert/courses', requireAdmin, async (req, res) => {
    const code = txt(req.body?.code, 32).toUpperCase();
    if (!code) return res.status(400).json({ error: 'Course code is needed.' });
    const c = {
      code, name: txt(req.body?.name, 255), certName: txt(req.body?.certName, 255),
      department: txt(req.body?.department), coordinator: txt(req.body?.coordinator),
      syllabus: String(req.body?.syllabus ?? '').slice(0, 40000),
      outcomes: ok(req.body?.outcomes).map((o) => ({ no: num(o.no, 0, 0, 99), btl: num(o.btl, 0, 0, 6), text: txt(o.text, 500) })),
      active: req.body?.active !== false, createdAt: now(),
    };
    await db.certCourses.upsert(c);
    res.json(c);
  });

  app.post('/api/admin/cert/courses/:code/delete', requireAdmin, async (req, res) => {
    const code = txt(req.params.code, 32).toUpperCase();
    const qs = await db.certQuestions.byCourse(code);
    if (qs.length) return res.status(403).json({ error: `This course has ${qs.length} questions. Delete them first.` });
    await db.certCourses.remove(code);
    res.json({ ok: true });
  });

  // ---------------- case studies ----------------
  app.get('/api/admin/cert/cases', requireAdmin, async (req, res) => {
    const code = txt(req.query.course, 32).toUpperCase();
    const cases = await db.certCases.byCourse(code);
    const out = [];
    for (const c of cases) out.push({ ...c, questions: (await db.certQuestions.byCase(c.id)).length });
    res.json({ cases: out });
  });

  app.post('/api/admin/cert/cases', requireAdmin, async (req, res) => {
    const courseCode = txt(req.body?.courseCode, 32).toUpperCase();
    const scenario = String(req.body?.scenario ?? '').trim();
    if (!courseCode || !scenario) return res.status(400).json({ error: 'A case study needs a course and a scenario.' });
    const c = {
      id: txt(req.body?.id, 64) || crypto.randomUUID(), courseCode, title: txt(req.body?.title, 255) || 'Case study',
      scenario: scenario.slice(0, 20000), exhibits: ok(req.body?.exhibits).map((e) => txt(e, 2000)),
      topic: txt(req.body?.topic), difficulty: txt(req.body?.difficulty, 16), createdAt: now(),
    };
    await db.certCases.upsert(c);
    res.json(c);
  });

  app.post('/api/admin/cert/cases/:id/delete', requireAdmin, async (req, res) => {
    await db.certCases.remove(txt(req.params.id, 64));
    res.json({ ok: true });
  });

  // ---------------- question bank ----------------
  app.get('/api/admin/cert/questions', requireAdmin, async (req, res) => {
    const code = txt(req.query.course, 32).toUpperCase();
    const rows = await db.certQuestions.byCourse(code);
    const cases = new Map((await db.certCases.byCourse(code)).map((c) => [c.id, c.title]));
    res.json({
      questions: rows.map((q) => ({ ...q, caseTitle: cases.get(q.caseId) || '' })),
      stats: {
        total: rows.length, standalone: rows.filter((q) => !q.caseId).length, inCases: rows.filter((q) => q.caseId).length,
        multi: rows.filter((q) => q.type === 'multi').length,
        byDifficulty: rows.reduce((o, q) => ({ ...o, [q.difficulty || 'unset']: (o[q.difficulty || 'unset'] || 0) + 1 }), {}),
        byTopic: rows.reduce((o, q) => ({ ...o, [q.topic || 'unset']: (o[q.topic || 'unset'] || 0) + 1 }), {}),
      },
    });
  });

  /** Add questions: { courseCode, questions: [{ question, options, answers|answerIndex, type, caseId, marks, topic, difficulty, explanation }] } */
  app.post('/api/admin/cert/questions', requireAdmin, async (req, res) => {
    const courseCode = txt(req.body?.courseCode, 32).toUpperCase();
    const raw = ok(req.body?.questions);
    if (!courseCode || !raw.length) return res.status(400).json({ error: 'Body must be { courseCode, questions: [...] }' });
    const rows = []; const bad = [];
    for (const [i, x] of raw.entries()) {
      const question = String(x.question ?? '').trim();
      const options = ok(x.options).map((o) => String(o ?? '').trim()).filter(Boolean);
      let answers = ok(x.answers).map((n) => Number(n)).filter((n) => Number.isInteger(n));
      if (!answers.length && Number.isInteger(Number(x.answerIndex))) answers = [Number(x.answerIndex)];
      if (!question || options.length < 2 || !answers.length || answers.some((n) => n < 0 || n >= options.length)) { bad.push(i + 1); continue; }
      const type = answers.length > 1 ? 'multi' : (x.type === 'multi' ? 'multi' : 'single');
      rows.push({
        id: crypto.randomUUID(), courseCode, caseId: txt(x.caseId, 64), type, question: question.slice(0, 8000),
        options, answers: [...new Set(answers)].sort((a, b) => a - b), marks: num(x.marks, 1, 1, 20),
        topic: txt(x.topic), difficulty: txt(x.difficulty, 16).toUpperCase(), explanation: String(x.explanation ?? '').slice(0, 8000),
        norm: normOf(`${courseCode}|${question}`), createdAt: now(),
      });
    }
    if (!rows.length) return res.status(400).json({ error: `No usable questions (each needs a question, at least two options and a correct answer). Bad rows: ${bad.join(', ')}` });
    const added = await db.certQuestions.addMany(rows);
    await db.certCourses.upsert({ code: courseCode, name: '', active: true, createdAt: now() });
    res.json({ added, duplicates: rows.length - added, rejected: bad.length, total: await db.certQuestions.countByCourse(courseCode) });
  });

  app.post('/api/admin/cert/questions/:id', requireAdmin, async (req, res) => {
    const patch = {};
    for (const k of ['question', 'topic', 'difficulty', 'explanation', 'caseId', 'type']) if (typeof req.body?.[k] === 'string') patch[k] = req.body[k];
    if (req.body?.options) patch.options = ok(req.body.options).map((o) => String(o));
    if (req.body?.answers) patch.answers = ok(req.body.answers).map(Number);
    if (req.body?.marks !== undefined) patch.marks = num(req.body.marks, 1, 1, 20);
    const q = await db.certQuestions.update(txt(req.params.id, 64), patch);
    if (!q) return res.status(404).json({ error: 'Question not found' });
    res.json(q);
  });

  app.post('/api/admin/cert/questions/:id/delete', requireAdmin, async (req, res) => {
    await db.certQuestions.remove(txt(req.params.id, 64));
    res.json({ ok: true });
  });

  // ---------------- AI question generation ----------------
  // One batch per request, so the browser can show progress and nothing times out.
  const GEN_MODEL = process.env.CERT_MODEL || 'claude-sonnet-4-5';

  const QUESTION_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['questions'],
    properties: {
      questions: {
        type: 'array', items: {
          type: 'object', additionalProperties: false,
          required: ['question', 'options', 'answers', 'topic', 'difficulty', 'explanation'],
          properties: {
            question: { type: 'string' },
            options: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string' } },
            answers: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'integer' } },
            topic: { type: 'string' }, difficulty: { type: 'string', enum: ['EASY', 'MEDIUM', 'HARD'] },
            explanation: { type: 'string' },
          },
        },
      },
    },
  };
  const CASE_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['title', 'scenario', 'questions'],
    properties: {
      title: { type: 'string' }, scenario: { type: 'string' },
      questions: QUESTION_SCHEMA.properties.questions,
    },
  };

  async function askClaude({ apiKey, prompt, schema, model }) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: model || GEN_MODEL, max_tokens: 8000,
        output_config: { format: { type: 'json_schema', schema } },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const text = await res.text();
    if (!res.ok) { let m = `Claude API ${res.status}`; try { m = JSON.parse(text).error?.message || m; } catch { /* keep */ } throw new Error(m); }
    const block = (JSON.parse(text).content || []).find((b) => b.type === 'text');
    if (!block) throw new Error('Claude returned no content.');
    return JSON.parse(block.text);
  }

  const GEMINI_MODEL = process.env.CERT_GEMINI_MODEL || 'gemini-3.8-flash';

  async function askGemini({ apiKey, prompt, schema, model }) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || GEMINI_MODEL)}:generateContent`;
    const call = async (strict) => {
      const generationConfig = { responseMimeType: 'application/json', maxOutputTokens: 16000 };
      if (strict) Object.assign(generationConfig, { responseJsonSchema: schema, thinkingConfig: { thinkingLevel: 'low' } });
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: strict ? prompt : `${prompt}\n\nReply with JSON only, matching this JSON schema exactly:\n${JSON.stringify(schema)}` }] }],
          generationConfig,
        }),
      });
      const text = await res.text();
      let body = {}; try { body = JSON.parse(text); } catch { /* not JSON */ }
      if (!res.ok) { const e = new Error(body.error?.message || `Gemini API ${res.status}`); e.status = res.status; throw e; }
      const parts = body.candidates?.[0]?.content?.parts || [];
      const out = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('').trim();
      if (!out) throw new Error(`Gemini returned no content${body.candidates?.[0]?.finishReason ? ` (${body.candidates[0].finishReason})` : ''}.`);
      return JSON.parse(out.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    };
    try { return await call(true); } catch (e) {
      // older/newer models may reject the schema or thinking fields — retry with the schema in the prompt
      if (e.status === 400 && !/api key/i.test(e.message)) return call(false);
      throw e;
    }
  }

  const ask = (provider, args) => (provider === 'gemini' ? askGemini(args) : askClaude(args));

  const courseBrief = (c, projects) => [
    `Certification course: ${c.name} (${c.code}).`,
    c.certName ? `It prepares students for: ${c.certName}.` : '',
    `Syllabus: ${c.syllabus}`,
    c.outcomes?.length ? `Course outcomes: ${c.outcomes.map((o) => `CO${o.no} (Bloom level ${o.btl}) ${o.text}`).join('; ')}` : '',
    projects?.length ? `Typical student project themes: ${projects.slice(0, 25).join('; ')}.` : '',
  ].filter(Boolean).join('\n');

  const STYLE = [
    'Write in the style of the real global certification exam: practical, scenario-led, no trick questions.',
    'Every option must be plausible to someone who half-knows the topic; wrong options are common misconceptions, never silly.',
    'Exactly four options. Use "answers" with one index for a single-answer question, or two indexes when the stem says "choose two". Indexes are zero-based: 0 is the first option, 3 the last.',
    'Options are plain text with no "A)" or "1." prefix.',
    'EASY = recall or a single fact. MEDIUM = apply a concept to a short situation. HARD = compare trade-offs, or pick the best of two defensible designs.',
    'No "all of the above", no "none of the above", no negative stems unless the word NOT is capitalised.',
    'topic must be a short phrase taken from the syllabus. explanation is one sentence saying why the answer is right.',
    'British spelling, plain language, no markdown.',
  ].join(' ');

  /** Generate one batch of standalone questions, or one case study with its questions. */
  app.post('/api/admin/cert/generate', requireAdmin, async (req, res) => {
    const provider = req.body?.provider === 'gemini' ? 'gemini' : 'claude';
    const apiKey = String(req.body?.apiKey || (provider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY) || '').trim();
    if (!apiKey) return res.status(400).json({ error: `A ${provider === 'gemini' ? 'Gemini' : 'Claude'} API key is needed. Paste it in the admin (it stays in your browser) or set ${provider === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY'} on the server.` });
    const course = await db.certCourses.get(txt(req.body?.courseCode, 32).toUpperCase());
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (!course.syllabus) return res.status(400).json({ error: 'This course has no syllabus stored, so questions cannot be grounded in it.' });

    const projects = (await db.courseProjects.byCourses([course.code])).map((p) => p.title);
    const existing = (await db.certQuestions.byCourse(course.code)).map((q) => q.question);
    const avoid = existing.slice(-60).map((q) => `- ${q.slice(0, 120)}`).join('\n');
    const kind = req.body?.kind === 'case' ? 'case' : 'questions';
    const count = num(req.body?.count, 10, 1, 12);
    const difficulty = ['EASY', 'MEDIUM', 'HARD'].includes(txt(req.body?.difficulty, 16).toUpperCase()) ? txt(req.body.difficulty, 16).toUpperCase() : 'MEDIUM';
    const multi = num(req.body?.multi, 0, 0, 6); // how many of them should be "choose two"

    try {
      if (kind === 'case') {
        const data = await ask(provider, {
          apiKey, model: txt(req.body?.model, 64), schema: CASE_SCHEMA,
          prompt: [
            courseBrief(course, projects), '',
            `Write ONE case study for this certification exam, then ${count} questions that can only be answered after reading it.`,
            'The scenario is 120-200 words: a real organisation with a concrete need, constraints (budget, compliance, traffic, deadline) and the current setup. No question text inside the scenario.',
            `Difficulty of the questions: ${difficulty}.${multi ? ` Exactly ${multi} of them must say "choose two" and have two correct answers.` : ''}`,
            STYLE,
            avoid ? `Do not repeat anything close to these existing questions:\n${avoid}` : '',
          ].filter(Boolean).join('\n'),
        });
        return res.json({
          kind: 'case',
          case: { title: txt(data.title, 255) || 'Case study', scenario: String(data.scenario || '').slice(0, 20000), topic: txt(data.questions?.[0]?.topic), difficulty },
          questions: ok(data.questions).slice(0, count),
        });
      }
      const data = await ask(provider, {
        apiKey, model: txt(req.body?.model, 64), schema: QUESTION_SCHEMA,
        prompt: [
          courseBrief(course, projects), '',
          `Write ${count} standalone multiple-choice questions at ${difficulty} difficulty for this certification exam.`,
          multi ? `Exactly ${multi} of them must say "choose two" and have two correct answers.` : 'Each has exactly one correct answer.',
          'Spread them across different parts of the syllabus — do not cluster on one topic.',
          STYLE,
          avoid ? `Do not repeat anything close to these existing questions:\n${avoid}` : '',
        ].filter(Boolean).join('\n'),
      });
      res.json({ kind: 'questions', questions: ok(data.questions).slice(0, count) });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  /** Save a reviewed batch: optional case study plus its questions. */
  app.post('/api/admin/cert/generate/publish', requireAdmin, async (req, res) => {
    const courseCode = txt(req.body?.courseCode, 32).toUpperCase();
    if (!await db.certCourses.get(courseCode)) return res.status(404).json({ error: 'Course not found' });
    let caseId = txt(req.body?.caseId, 64);
    if (req.body?.case?.scenario) {
      const c = {
        id: crypto.randomUUID(), courseCode, title: txt(req.body.case.title, 255) || 'Case study',
        scenario: String(req.body.case.scenario).slice(0, 20000), exhibits: [],
        topic: txt(req.body.case.topic), difficulty: txt(req.body.case.difficulty, 16).toUpperCase(), createdAt: now(),
      };
      await db.certCases.upsert(c);
      caseId = c.id;
    }
    const rows = [];
    for (const x of ok(req.body?.questions)) {
      const question = String(x.question ?? '').trim();
      const options = ok(x.options).map((o) => String(o ?? '').trim()).filter(Boolean);
      const answers = [...new Set(ok(x.answers).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < options.length))].sort((a, b) => a - b);
      if (!question || options.length < 2 || !answers.length) continue;
      rows.push({
        id: crypto.randomUUID(), courseCode, caseId, type: answers.length > 1 ? 'multi' : 'single',
        question: question.slice(0, 8000), options, answers, marks: num(x.marks, answers.length > 1 ? 2 : 1, 1, 20),
        topic: txt(x.topic), difficulty: txt(x.difficulty, 16).toUpperCase() || 'MEDIUM',
        explanation: String(x.explanation ?? '').slice(0, 8000), norm: normOf(`${courseCode}|${question}`), createdAt: now(),
      });
    }
    const added = rows.length ? await db.certQuestions.addMany(rows) : 0;
    res.json({ added, duplicates: rows.length - added, caseId, total: await db.certQuestions.countByCourse(courseCode) });
  });

  /** Sections and branches that actually exist in the student roster, for scheduling. */
  app.get('/api/admin/cert/audience', requireAdmin, async (_req, res) => {
    const students = await db.students.all();
    const count = (key) => {
      const m = new Map();
      for (const s of students) { const v = String(s[key] || '').trim(); if (v) m.set(v, (m.get(v) || 0) + 1); }
      return [...m.entries()].map(([name, n]) => ({ name, students: n })).sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
    };
    res.json({ sections: count('section'), branches: count('branch'), total: students.length });
  });

  // ---------------- paper setting (the blueprint) ----------------
  app.get('/api/admin/cert/papers', requireAdmin, async (req, res) => {
    const code = txt(req.query.course, 32).toUpperCase();
    const papers = code ? await db.certPapers.byCourse(code) : await db.certPapers.all();
    const out = [];
    for (const p of papers) { const chk = await checkPaper(p); out.push({ ...p, ...chk }); }
    res.json({ papers: out });
  });

  /** Create or edit a paper. blueprint: [{ name, source: 'case'|'standalone'|'any', count, difficulty, topic, marks }] */
  app.post('/api/admin/cert/papers', requireAdmin, async (req, res) => {
    const courseCode = txt(req.body?.courseCode, 32).toUpperCase();
    if (!courseCode) return res.status(400).json({ error: 'Pick the certification course.' });
    const blueprint = ok(req.body?.blueprint).map((s) => ({
      name: txt(s.name, 120) || 'Section', source: ['case', 'standalone', 'any'].includes(s.source) ? s.source : 'any',
      count: num(s.count, 10, 1, 200), difficulty: txt(s.difficulty, 16).toUpperCase(), topic: txt(s.topic),
      marks: num(s.marks, 1, 1, 20), caseCount: num(s.caseCount, 0, 0, 50),
    }));
    if (!blueprint.length) return res.status(400).json({ error: 'Add at least one section to the paper.' });
    const p = {
      id: txt(req.body?.id, 64) || crypto.randomUUID(), courseCode, name: txt(req.body?.name, 255) || 'Paper',
      durationMin: num(req.body?.durationMin, 60, 5, 360), passMark: num(req.body?.passMark, 70, 0, 100),
      blueprint, rules: { ...DEFAULT_RULES, ...(req.body?.rules || {}), warnings: num(req.body?.rules?.warnings, 2, 0, 5) },
      createdAt: req.body?.createdAt || now(),
    };
    await db.certPapers.upsert(p);
    res.json({ ...p, ...(await checkPaper(p)) });
  });

  app.post('/api/admin/cert/papers/:id/delete', requireAdmin, async (req, res) => {
    await db.certPapers.remove(txt(req.params.id, 64));
    res.json({ ok: true });
  });

  /** Can the bank actually fill this paper? */
  async function checkPaper(p) {
    const bank = await db.certQuestions.byCourse(p.courseCode);
    const problems = []; let questions = 0, marks = 0;
    for (const s of p.blueprint) {
      const pool = bank.filter((q) => matches(q, s));
      questions += s.count; marks += s.count * (s.marks || 1);
      if (pool.length < s.count) problems.push(`${s.name}: needs ${s.count}, bank has ${pool.length}`);
    }
    return { questions, marks, bankSize: bank.length, ready: problems.length === 0, problems };
  }
  const matches = (q, s) => (s.source === 'case' ? !!q.caseId : s.source === 'standalone' ? !q.caseId : true)
    && (!s.difficulty || (q.difficulty || '').toUpperCase() === s.difficulty)
    && (!s.topic || (q.topic || '').toLowerCase() === s.topic.toLowerCase());

  /** Preview a paper exactly as a student would get it (without saving an attempt). */
  app.get('/api/admin/cert/papers/:id/preview', requireAdmin, async (req, res) => {
    const paper = await db.certPapers.get(txt(req.params.id, 64));
    if (!paper) return res.status(404).json({ error: 'Paper not found' });
    const built = await buildPaper(paper, txt(req.query.seed, 64) || 'preview');
    if (built.error) return res.status(400).json({ error: built.error });
    const cases = new Map();
    for (const it of built.items) if (it.caseId && !cases.has(it.caseId)) cases.set(it.caseId, await db.certCases.get(it.caseId));
    res.json({ paper, items: built.items, cases: [...cases.values()].filter(Boolean), total: built.total });
  });

  /** Pick the questions for one student: blueprint order, case questions kept together. */
  async function buildPaper(paper, seed) {
    const bank = await db.certQuestions.byCourse(paper.courseCode);
    const rnd = rng(`${paper.id}:${seed}`);
    const used = new Set(); const items = []; let total = 0;
    for (const s of paper.blueprint) {
      const pool = shuffle(bank.filter((q) => matches(q, s) && !used.has(q.id)), rnd);
      if (pool.length < s.count) return { error: `Section "${s.name}" needs ${s.count} questions but only ${pool.length} are available in the bank.` };
      let picked = [];
      if (s.source === 'case') {
        // take whole case studies, so a scenario is never split across papers
        const byCase = new Map();
        for (const q of pool) { const a = byCase.get(q.caseId) || []; a.push(q); byCase.set(q.caseId, a); }
        for (const [, group] of shuffle([...byCase.entries()], rnd)) {
          if (picked.length >= s.count) break;
          picked = picked.concat(group.slice(0, s.count - picked.length));
        }
      } else picked = pool.slice(0, s.count);
      for (const q of picked) {
        used.add(q.id);
        const order = paper.rules?.shuffleOptions === false ? q.options.map((_, i) => i) : shuffle(q.options.map((_, i) => i), rnd);
        items.push({
          id: q.id, section: s.name, caseId: q.caseId, type: q.type, marks: s.marks || q.marks || 1,
          question: q.question, options: order.map((i) => q.options[i]), order, topic: q.topic, difficulty: q.difficulty,
        });
        total += s.marks || q.marks || 1;
      }
    }
    // keep a case's questions next to each other, then shuffle the blocks if asked
    const blocks = []; const index = new Map();
    for (const it of items) {
      const key = it.caseId || `q:${it.id}`;
      if (!index.has(key)) { index.set(key, blocks.length); blocks.push([]); }
      blocks[index.get(key)].push(it);
    }
    const ordered = (paper.rules?.shuffleQuestions === false ? blocks : shuffle(blocks, rnd)).flat();
    return { items: ordered, total };
  }

  // ---------------- scheduling ----------------
  app.get('/api/admin/cert/exams', requireAdmin, async (_req, res) => {
    const exams = await db.certExams.all();
    const out = [];
    for (const e of exams) {
      const [paper, attempts] = await Promise.all([db.certPapers.get(e.paperId), db.certAttempts.byExam(e.id)]);
      const done = attempts.filter((a) => a.status === 'submitted');
      out.push({
        ...e, paperName: paper?.name || '', durationMin: paper?.durationMin || 0, passMark: paper?.passMark ?? 0,
        attempts: attempts.length, submitted: done.length, inProgress: attempts.length - done.length,
        avgScore: done.length ? Math.round((done.reduce((n, a) => n + (a.score || 0), 0) / done.length) * 10) / 10 : null,
        flagged: attempts.filter((a) => (a.integrity ?? 100) < 85).length,
      });
    }
    res.json({ exams: out });
  });

  app.post('/api/admin/cert/exams', requireAdmin, async (req, res) => {
    const paper = await db.certPapers.get(txt(req.body?.paperId, 64));
    if (!paper) return res.status(400).json({ error: 'Pick a paper first.' });
    const chk = await checkPaper(paper);
    if (!chk.ready) return res.status(400).json({ error: `This paper cannot be filled from the bank — ${chk.problems.join('; ')}` });
    const e = {
      id: txt(req.body?.id, 64) || crypto.randomUUID(), paperId: paper.id, courseCode: paper.courseCode,
      title: txt(req.body?.title, 255) || `${paper.courseCode} — ${paper.name}`,
      startAt: txt(req.body?.startAt, 32), endAt: txt(req.body?.endAt, 32),
      status: txt(req.body?.status, 16) || 'scheduled',
      audience: { branches: ok(req.body?.audience?.branches).map((x) => txt(x, 64)), sections: ok(req.body?.audience?.sections).map((x) => txt(x, 64)), regs: ok(req.body?.audience?.regs).map((x) => txt(x, 64)) },
      createdAt: now(),
    };
    await db.certExams.upsert(e);
    res.json(e);
  });

  app.post('/api/admin/cert/exams/:id/delete', requireAdmin, async (req, res) => {
    const id = txt(req.params.id, 64);
    if ((await db.certAttempts.byExam(id)).length) return res.status(403).json({ error: 'Students have already started this exam, so it is kept.' });
    await db.certExams.remove(id);
    res.json({ ok: true });
  });

  /** Live view of one exam: who is writing, who finished, who is being flagged. */
  app.get('/api/admin/cert/exams/:id/monitor', requireAdmin, async (req, res) => {
    const exam = await db.certExams.get(txt(req.params.id, 64));
    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    const paper = await db.certPapers.get(exam.paperId);
    const attempts = await db.certAttempts.byExam(exam.id);
    const rows = attempts.map((a) => ({
      reg: a.reg, name: a.name, branch: a.branch, section: a.section, status: a.status, reason: a.reason,
      answered: Object.keys(a.answers || {}).length, items: (a.items || []).length,
      score: a.score, total: a.total, integrity: a.integrity ?? 100, flags: a.flags || {},
      startedAt: a.startedAt, lastSeen: a.lastSeen, submittedAt: a.submittedAt, id: a.id,
    })).sort((x, y) => (x.integrity - y.integrity) || String(x.reg).localeCompare(String(y.reg)));
    res.json({
      exam, paper,
      summary: {
        started: rows.length, writing: rows.filter((r) => r.status === 'in_progress').length,
        submitted: rows.filter((r) => r.status === 'submitted').length,
        terminated: rows.filter((r) => r.status === 'terminated').length,
        clean: rows.filter((r) => r.integrity >= 85).length,
        watch: rows.filter((r) => r.integrity >= 60 && r.integrity < 85).length,
        review: rows.filter((r) => r.integrity < 60).length,
      },
      rows,
    });
  });

  /** Everything one student did, including the proctoring timeline. */
  app.get('/api/admin/cert/attempts/:id', requireAdmin, async (req, res) => {
    const a = await db.certAttempts.get(txt(req.params.id, 64));
    if (!a) return res.status(404).json({ error: 'Attempt not found' });
    const exam = await db.certExams.get(a.examId);
    const paper = exam ? await db.certPapers.get(exam.paperId) : null;
    const bank = new Map((await db.certQuestions.byIds((a.items || []).map((i) => i.id))).map((q) => [q.id, q]));
    const items = (a.items || []).map((it, i) => {
      const q = bank.get(it.id);
      const given = a.answers?.[String(i)];
      const correctShown = q ? q.answers.map((idx) => it.order.indexOf(idx)).sort((x, y) => x - y) : [];
      const chosen = ok(given).slice().sort((x, y) => x - y);
      return {
        no: i + 1, section: it.section, caseId: it.caseId, question: it.question, options: it.options,
        marks: it.marks, chosen, correct: correctShown,
        right: !!given && chosen.length === correctShown.length && chosen.every((v, k) => v === correctShown[k]),
        explanation: q?.explanation || '',
      };
    });
    res.json({ attempt: a, exam, paper, items, events: await db.certEvents.byAttempt(a.id) });
  });

  // =============== student side ===============
  /** Which certification exams are open for this student right now. */
  app.post('/api/cert/exams', async (req, res) => {
    const reg = txt(req.body?.reg, 64);
    if (!reg) return res.status(400).json({ error: 'Enter your registration number.' });
    const student = await db.students.byRegNo(reg);
    if (!student) return res.status(404).json({ error: 'This registration number is not in the list. Please contact the coordinator.' });
    const t = now();
    const out = [];
    for (const e of await db.certExams.all()) {
      if (e.status === 'draft') continue;
      const aud = e.audience || {};
      if (aud.regs?.length && !aud.regs.includes(reg)) continue;
      if (aud.branches?.length && !aud.branches.includes(student.branch)) continue;
      if (aud.sections?.length && !aud.sections.includes(student.section)) continue;
      const paper = await db.certPapers.get(e.paperId);
      const attempt = await db.certAttempts.byExamReg(e.id, reg);
      const open = (!e.startAt || e.startAt <= t) && (!e.endAt || e.endAt >= t);
      out.push({
        id: e.id, title: e.title, courseCode: e.courseCode, startAt: e.startAt, endAt: e.endAt, open,
        durationMin: paper?.durationMin || 0, passMark: paper?.passMark ?? 0, questions: (paper?.blueprint || []).reduce((n, s) => n + s.count, 0),
        rules: paper?.rules || DEFAULT_RULES,
        state: attempt ? attempt.status : 'none', score: attempt?.score ?? null, total: attempt?.total ?? null,
      });
    }
    res.json({ student: { reg, name: student.name, branch: student.branch, section: student.section }, exams: out });
  });

  /** Start (or resume) an attempt. The paper is built once and stored with the attempt. */
  app.post('/api/cert/start', async (req, res) => {
    const reg = txt(req.body?.reg, 64);
    const exam = await db.certExams.get(txt(req.body?.examId, 64));
    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    const paper = await db.certPapers.get(exam.paperId);
    if (!paper) return res.status(400).json({ error: 'This exam has no paper.' });
    const t = now();
    if (exam.startAt && exam.startAt > t) return res.status(403).json({ error: 'The exam has not started yet.' });
    if (exam.endAt && exam.endAt < t) return res.status(403).json({ error: 'The exam is closed.' });

    const aud = exam.audience || {};
    if (aud.regs?.length && !aud.regs.includes(reg)) return res.status(403).json({ error: 'This exam is not assigned to your registration number.' });
    let attempt = await db.certAttempts.byExamReg(exam.id, reg);
    if (attempt && attempt.status !== 'in_progress') return res.status(409).json({ error: 'You have already finished this exam.', state: attempt.status });
    if (!attempt) {
      const student = await db.students.byRegNo(reg);
      if (!student) return res.status(404).json({ error: 'This registration number is not in the list.' });
      const built = await buildPaper(paper, reg);
      if (built.error) return res.status(400).json({ error: built.error });
      attempt = {
        id: crypto.randomUUID(), examId: exam.id, reg, name: student.name, branch: student.branch, section: student.section,
        items: built.items, answers: {}, marked: [], score: null, total: built.total, status: 'in_progress', reason: '',
        integrity: 100, flags: {}, ip: (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim(),
        sessionId: crypto.randomUUID(), startedAt: t, lastSeen: t, submittedAt: null,
      };
      await db.certAttempts.add(attempt);
    }
    res.json(await viewOf(attempt, paper, exam));
  });

  /** What the student's browser needs: questions without answers, plus their saved answers. */
  async function viewOf(a, paper, exam) {
    const cases = new Map();
    for (const it of a.items) if (it.caseId && !cases.has(it.caseId)) cases.set(it.caseId, await db.certCases.get(it.caseId));
    const endsAt = new Date(Math.min(
      new Date(a.startedAt).getTime() + paper.durationMin * 60000,
      exam.endAt ? new Date(exam.endAt).getTime() : Infinity,
    )).toISOString();
    return {
      attemptId: a.id, examTitle: exam.title, courseCode: exam.courseCode, paperName: paper.name,
      rules: { ...DEFAULT_RULES, ...(paper.rules || {}) }, passMark: paper.passMark, durationMin: paper.durationMin,
      startedAt: a.startedAt, endsAt, serverNow: now(), total: a.total,
      items: a.items.map((it, i) => ({ no: i + 1, section: it.section, caseId: it.caseId, type: it.type, marks: it.marks, question: it.question, options: it.options })),
      cases: [...cases.values()].filter(Boolean).map((c) => ({ id: c.id, title: c.title, scenario: c.scenario, exhibits: c.exhibits })),
      answers: a.answers || {}, marked: a.marked || [], warningsUsed: (a.flags || {}).warnings || 0,
    };
  }

  /** Save answers as the student moves (and keep the clock honest). */
  app.post('/api/cert/save', async (req, res) => {
    const a = await db.certAttempts.get(txt(req.body?.attemptId, 64));
    if (!a) return res.status(404).json({ error: 'Attempt not found' });
    if (a.status !== 'in_progress') return res.status(409).json({ error: 'This attempt is already closed.', state: a.status });
    const answers = { ...(a.answers || {}) };
    for (const [k, v] of Object.entries(req.body?.answers || {})) {
      const i = Number(k); if (!Number.isInteger(i) || i < 0 || i >= a.items.length) continue;
      const picks = ok(v).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < a.items[i].options.length);
      if (picks.length) answers[String(i)] = [...new Set(picks)].sort((x, y) => x - y); else delete answers[String(i)];
    }
    const marked = ok(req.body?.marked).map(Number).filter((n) => Number.isInteger(n));
    await db.certAttempts.update(a.id, { answers, marked, lastSeen: now() });
    res.json({ ok: true, answered: Object.keys(answers).length });
  });

  /** Proctoring beacon: a batch of events, scored into the integrity number. */
  app.post('/api/cert/events', async (req, res) => {
    const a = await db.certAttempts.get(txt(req.body?.attemptId, 64));
    if (!a) return res.status(404).json({ error: 'Attempt not found' });
    const rows = ok(req.body?.events).slice(0, 200).map((e) => ({
      at: txt(e.at, 32) || now(), kind: txt(e.kind, 32), seconds: num(e.seconds, 0, 0, 100000),
      item: num(e.item, -1, -1, 10000), detail: typeof e.detail === 'object' && e.detail ? e.detail : {},
    })).filter((e) => e.kind);
    if (rows.length) await db.certEvents.add(a.id, rows);

    const flags = { ...(a.flags || {}) };
    let integrity = a.integrity ?? 100;
    for (const e of rows) {
      const kind = e.kind === 'blur' ? (e.seconds >= 15 ? 'blur_long' : 'blur_short') : e.kind;
      flags[kind] = (flags[kind] || 0) + 1;
      integrity -= PENALTY[kind] || 0;
    }
    integrity = Math.max(0, Math.min(100, integrity));
    const breaches = (flags.fullscreen_exit || 0) + (flags.blur_long || 0);
    const patch = { flags, integrity, lastSeen: now() };

    // fullscreen rule: warn, warn, then end the attempt
    const paper = await db.certPapers.get((await db.certExams.get(a.examId))?.paperId || '');
    const rules = { ...DEFAULT_RULES, ...(paper?.rules || {}) };
    let terminated = false;
    if (rules.fullscreen && rules.autoSubmitOnBreach && breaches > rules.warnings) {
      terminated = true;
      Object.assign(patch, await gradeOf(a, 'terminated', 'left the exam screen too many times'));
    }
    const saved = await db.certAttempts.update(a.id, patch);
    res.json({
      ok: true, integrity: saved.integrity, warningsUsed: breaches, warningsAllowed: rules.warnings,
      terminated, ...(terminated ? { score: saved.score, total: saved.total } : {}),
    });
  });

  /** Mark the paper. Multi-select must match exactly (no part marks). */
  async function gradeOf(a, status, reason) {
    const bank = new Map((await db.certQuestions.byIds(a.items.map((i) => i.id))).map((q) => [q.id, q]));
    let score = 0;
    a.items.forEach((it, i) => {
      const q = bank.get(it.id); if (!q) return;
      const want = q.answers.map((idx) => it.order.indexOf(idx)).sort((x, y) => x - y);
      const got = ok(a.answers?.[String(i)]).slice().sort((x, y) => x - y);
      if (got.length === want.length && got.every((v, k) => v === want[k])) score += it.marks || 1;
    });
    return { score, status, reason: reason || '', submittedAt: now() };
  }

  app.post('/api/cert/submit', async (req, res) => {
    const a = await db.certAttempts.get(txt(req.body?.attemptId, 64));
    if (!a) return res.status(404).json({ error: 'Attempt not found' });
    if (a.status !== 'in_progress') return res.status(409).json({ error: 'Already submitted.', state: a.status, score: a.score, total: a.total });
    const graded = await gradeOf(a, 'submitted', txt(req.body?.reason, 64));
    const saved = await db.certAttempts.update(a.id, graded);
    const exam = await db.certExams.get(a.examId);
    const paper = exam ? await db.certPapers.get(exam.paperId) : null;
    const pctScore = saved.total ? Math.round((saved.score / saved.total) * 100) : 0;
    res.json({
      ok: true, score: saved.score, total: saved.total, percentage: pctScore,
      passMark: paper?.passMark ?? 0, passed: pctScore >= (paper?.passMark ?? 0),
      showResult: (paper?.rules || DEFAULT_RULES).showResult !== false, integrity: saved.integrity,
    });
  });

  /** Resume after a refresh or a dropped connection. */
  app.post('/api/cert/resume', async (req, res) => {
    const a = await db.certAttempts.get(txt(req.body?.attemptId, 64));
    if (!a) return res.status(404).json({ error: 'Attempt not found' });
    const exam = await db.certExams.get(a.examId);
    const paper = exam ? await db.certPapers.get(exam.paperId) : null;
    if (!exam || !paper) return res.status(404).json({ error: 'Exam not found' });
    if (a.status !== 'in_progress') return res.json({ state: a.status, score: a.score, total: a.total });
    await db.certAttempts.update(a.id, { lastSeen: now() });
    res.json(await viewOf(a, paper, exam));
  });
}

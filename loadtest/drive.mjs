// Local load driver (Node, no k6 needed). Seeds a test domain, then runs VUS
// concurrent virtual students through login -> start -> save*rounds -> submit,
// and reports latency percentiles, error rate and throughput.
const BASE = process.env.BASE || 'http://localhost:4321';
const TOKEN = process.env.ADMIN_TOKEN || 'testtoken';
const VUS = Number(process.env.VUS || 300);
const ROUNDS = Number(process.env.ROUNDS || 8);
const SAVE_GAP = Number(process.env.SAVE_GAP || 200); // ms between saves (compressed vs real 5s)
const DOMAIN = 'LoadTest';
const N_STUDENTS = VUS;
const N_QUESTIONS = 120;

const J = { 'content-type': 'application/json' };
const admin = { ...J, 'x-admin-token': TOKEN };
const reg = (i) => 'LOADTEST' + String(i).padStart(4, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body, headers = J) {
  const r = await fetch(BASE + path, { method: 'POST', headers, body: JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
  return { status: r.status, body: j };
}

async function seed() {
  // students
  const students = Array.from({ length: N_STUDENTS }, (_, i) => ({
    registrationNumber: reg(i + 1), name: 'Load Test ' + (i + 1), branch: 'CSE', section: 'S01', domain: DOMAIN,
  }));
  for (let i = 0; i < students.length; i += 1000) {
    const r = await post('/api/admin/students/import', { students: students.slice(i, i + 1000) }, admin);
    if (r.status !== 200) throw new Error('student import failed ' + r.status + ' ' + JSON.stringify(r.body));
  }
  // questions (varied difficulty)
  const diffs = ['EASY', 'MEDIUM', 'HARD'];
  const questions = Array.from({ length: N_QUESTIONS }, (_, i) => ({
    question: `LoadTest Q${i + 1}: what is ${i} + 1?`,
    options: [String(i + 1), String(i), String(i + 2), String(i + 3)],
    answerIndex: 0, topic: 'LoadTest', difficulty: diffs[i % 3],
  }));
  const r = await post('/api/admin/import', { questions, domain: DOMAIN, replace: false }, admin);
  if (r.status !== 200) throw new Error('question import failed ' + r.status + ' ' + JSON.stringify(r.body));
  // schedule: open now, long duration so nobody auto-submits, 60 Qs, 40/40/20
  const s = await post('/api/admin/schedules', { domain: DOMAIN, enabled: true, durationMin: 180, questionCount: 60, mix: { easy: 40, medium: 40, hard: 20 } }, admin);
  if (s.status !== 200) throw new Error('schedule failed ' + s.status + ' ' + JSON.stringify(s.body));
  console.log(`seeded: ${N_STUDENTS} students, imported ${r.body.added} questions (bank ${r.body.bankTotal}), schedule OPEN`);
}

const lat = []; let errors = 0, ok = 0, reqs = 0;
const codes = {}; const samples = {};
async function timed(fn, label) {
  const t0 = performance.now();
  try {
    const r = await fn(); const dt = performance.now() - t0; lat.push(dt); reqs++;
    const key = `${label}:${r.status}`; codes[key] = (codes[key] || 0) + 1;
    if (r.status === 200) ok++; else { errors++; if (!samples[key]) samples[key] = JSON.stringify(r.body)?.slice(0, 120); }
    return r;
  } catch (e) { errors++; reqs++; lat.push(performance.now() - t0); const key = `${label}:EXC`; codes[key] = (codes[key] || 0) + 1; if (!samples[key]) samples[key] = String(e.message).slice(0, 120); return { status: 0, body: null }; }
}

async function runVU(i) {
  const rn = reg(i + 1);
  let r = await timed(() => post('/api/login', { registrationNumber: rn }), 'login');
  if (r.status !== 200) return;
  r = await timed(() => post('/api/exam/start', { registrationNumber: rn }), 'start');
  const attemptId = r.body?.attemptId, sid = r.body?.sessionId || '';
  if (!attemptId) return;
  r = await timed(() => fetch(`${BASE}/api/quiz/${attemptId}?s=${encodeURIComponent(sid)}`).then(async (x) => ({ status: x.status, body: await x.json().catch(() => null) })), 'quiz');
  const qs = r.body?.questions || [];
  const answers = {};
  for (let k = 0; k < Math.min(ROUNDS, qs.length); k++) {
    if (qs[k]) answers[qs[k].id] = k % 4;
    await timed(() => post(`/api/quiz/${attemptId}/save`, { sessionId: sid, answers }), 'save');
    await sleep(SAVE_GAP);
  }
  await timed(() => post(`/api/quiz/${attemptId}/submit`, { answers, violations: 0 }), 'submit');
}

function pct(arr, p) { if (!arr.length) return 0; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]; }

(async () => {
  if (process.env.CLEAN === '1') {
    await post('/api/admin/schedules', { domain: DOMAIN, enabled: false, durationMin: 180, questionCount: 60, mix: { easy: 40, medium: 40, hard: 20 } }, admin);
    console.log(`cleanup: "${DOMAIN}" schedule disabled. Test students/questions stay in the isolated "${DOMAIN}" domain; clear attempts via admin "Delete all results" before the real exam.`);
    return;
  }
  if (process.env.SEED !== '0') { console.log(`--- Seeding (${DOMAIN}) ---`); await seed(); }
  else console.log(`--- Skipping seed (SEED=0), reusing existing ${DOMAIN} data ---`);
  console.log(`--- Running ${VUS} concurrent virtual students (rounds=${ROUNDS}, save gap=${SAVE_GAP}ms) ---`);
  const t0 = performance.now();
  await Promise.all(Array.from({ length: VUS }, (_, i) => runVU(i)));
  const wall = (performance.now() - t0) / 1000;
  console.log('\n================ RESULTS ================');
  console.log(`virtual students : ${VUS}`);
  console.log(`total requests   : ${reqs}   (ok ${ok}, errors ${errors})`);
  console.log(`error rate       : ${((errors / reqs) * 100).toFixed(2)}%`);
  console.log(`wall time        : ${wall.toFixed(1)}s`);
  console.log(`throughput       : ${(reqs / wall).toFixed(0)} req/s`);
  console.log(`latency  p50/p95/p99 : ${pct(lat, 50).toFixed(0)} / ${pct(lat, 95).toFixed(0)} / ${pct(lat, 99).toFixed(0)} ms`);
  console.log(`latency  min/max     : ${Math.min(...lat).toFixed(0)} / ${Math.max(...lat).toFixed(0)} ms`);
  console.log('=========================================');
  console.log('--- status by step ---');
  for (const k of Object.keys(codes).sort()) console.log(`  ${k.padEnd(14)} ${codes[k]}${samples[k] ? '   e.g. ' + samples[k] : ''}`);
  console.log(errors / reqs < 0.02 && pct(lat, 95) < 1500 ? 'VERDICT: HEALTHY (err<2%, p95<1500ms)' : 'VERDICT: see numbers above');
})();

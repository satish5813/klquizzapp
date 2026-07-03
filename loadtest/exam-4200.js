// k6 load test — simulates thousands of students taking the exam at once.
// It reproduces the real request pattern: login → start → poll quiz → save answers
// repeatedly → submit. Run this against a STAGING copy (or the real VPS during a
// maintenance window) BEFORE the actual exam, and watch CPU / RAM / MySQL on the VPS.
//
// Prerequisites on the server under test:
//   1. Seed test students whose registration numbers are  LOADTEST0001 .. LOADTEST4200
//      (or change PREFIX / padding below), all in one domain, e.g. "LoadTest".
//   2. Add questions for that domain (at least as many as QUESTION_COUNT).
//   3. Activate that domain's schedule in the admin (a long duration, e.g. 180 min,
//      so nobody auto-submits during the test).
//
// Install k6:  https://k6.io/docs/get-started/installation/
//
// Run (4200 virtual users ramping up over 2 min, holding 5 min):
//   k6 run -e BASE=https://your-api-host -e VUS=4200 loadtest/exam-4200.js
//
// Quick smoke (raw throughput, no seeded data needed — just hits /api/health):
//   k6 run -e BASE=https://your-api-host -e SMOKE=1 loadtest/exam-4200.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE = __ENV.BASE || 'http://localhost:4000';
const VUS = Number(__ENV.VUS || 4200);
const PREFIX = __ENV.PREFIX || 'LOADTEST';
const SMOKE = __ENV.SMOKE === '1';

const saveLatency = new Trend('save_latency', true);
const errors = new Rate('exam_errors');

export const options = SMOKE
  ? { vus: Number(__ENV.VUS || 500), duration: '30s' }
  : {
      scenarios: {
        exam: {
          executor: 'ramping-vus',
          startVUs: 0,
          stages: [
            { duration: '2m', target: VUS }, // ramp up (staggered start — realistic)
            { duration: '5m', target: VUS }, // hold at full load
            { duration: '1m', target: 0 },   // ramp down
          ],
          gracefulRampDown: '30s',
        },
      },
      thresholds: {
        http_req_failed: ['rate<0.02'],      // <2% failed requests
        http_req_duration: ['p(95)<1500'],   // 95% of requests under 1.5s
        exam_errors: ['rate<0.02'],
      },
    };

function regNo(vu) {
  return PREFIX + String(vu).padStart(4, '0');
}

const JSON_HDR = { headers: { 'content-type': 'application/json' } };

export default function () {
  if (SMOKE) {
    const r = http.get(`${BASE}/api/health`);
    check(r, { 'health 200': (x) => x.status === 200 });
    sleep(1);
    return;
  }

  const reg = regNo(__VU);

  // 1) Login
  let r = http.post(`${BASE}/api/login`, JSON.stringify({ registrationNumber: reg }), JSON_HDR);
  if (!check(r, { 'login ok': (x) => x.status === 200 })) { errors.add(1); sleep(2); return; }

  // 2) Start the exam
  r = http.post(`${BASE}/api/exam/start`, JSON.stringify({ registrationNumber: reg }), JSON_HDR);
  if (!check(r, { 'start ok': (x) => x.status === 200 })) { errors.add(1); sleep(2); return; }
  const start = r.json();
  const attemptId = start.attemptId;
  const sid = start.sessionId || '';
  if (!attemptId) { errors.add(1); return; }

  // 3) Load the questions
  r = http.get(`${BASE}/api/quiz/${attemptId}?s=${encodeURIComponent(sid)}`);
  if (!check(r, { 'quiz ok': (x) => x.status === 200 })) { errors.add(1); return; }
  const quiz = r.json();
  const qs = (quiz && quiz.questions) || [];

  // 4) Answer + save repeatedly (mirrors the client: a save every ~5s)
  const answers = {};
  const rounds = Math.min(qs.length, 12); // ~1 min of answering per VU iteration
  for (let i = 0; i < rounds; i++) {
    if (qs[i]) answers[qs[i].id] = (i % 4); // pick option A/B/C/D
    const sr = http.post(`${BASE}/api/quiz/${attemptId}/save`, JSON.stringify({ sessionId: sid, answers }), JSON_HDR);
    saveLatency.add(sr.timings.duration);
    check(sr, { 'save ok': (x) => x.status === 200 }) || errors.add(1);
    sleep(5); // matches the client's 5s debounce
  }

  // 5) Submit
  r = http.post(`${BASE}/api/quiz/${attemptId}/submit`, JSON.stringify({ answers, violations: 0 }), JSON_HDR);
  check(r, { 'submit ok': (x) => x.status === 200 }) || errors.add(1);
  sleep(1);
}

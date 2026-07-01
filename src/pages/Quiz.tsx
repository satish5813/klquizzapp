import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, QuizQuestion } from '../api';
import RichText from '../RichText';

export default function Quiz() {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deadline, setDeadline] = useState(0); // epoch ms when the exam auto-submits
  const [remaining, setRemaining] = useState(0); // seconds left
  const [showResume, setShowResume] = useState(false); // full-screen warning overlay
  const [kicked, setKicked] = useState(false); // opened on another screen
  const [violations, setViolations] = useState(0);
  const violationsRef = useRef(0);
  const endedRef = useRef(false); // true once submitted (stops the guard)
  const submitRef = useRef<() => void>(() => {});
  const sid = sessionStorage.getItem('kl_sid') || '';

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ questions: QuizQuestion[]; status: string; startedAt: string; durationMin: number }>(`/api/quiz/${attemptId}?s=${encodeURIComponent(sid)}`);
        if (res.status !== 'in_progress') { navigate(`/result/${attemptId}`); return; }
        setQuestions(res.questions);
        const dl = new Date(res.startedAt).getTime() + (res.durationMin || 60) * 60_000;
        setDeadline(dl);
        setRemaining(Math.max(0, Math.round((dl - Date.now()) / 1000)));
      } catch (e: any) {
        if (/another screen/i.test(e.message)) setKicked(true); else setError(e.message);
      } finally { setLoading(false); }
    })();
  }, [attemptId, navigate, sid]);

  // --- Heartbeat: keeps this screen's session alive; blocks if opened elsewhere ---
  useEffect(() => {
    if (!started) return;
    const ping = async () => {
      try {
        const r = await api.post<{ ok: boolean; openElsewhere?: boolean }>(`/api/quiz/${attemptId}/ping`, { sessionId: sid });
        if (r.openElsewhere && !endedRef.current) { endedRef.current = true; setKicked(true); }
      } catch { /* transient network error — ignore */ }
    };
    ping();
    const t = setInterval(ping, 30_000);
    return () => clearInterval(t);
  }, [started, attemptId, sid]);

  // --- Countdown: auto-submit when time runs out ---
  useEffect(() => {
    if (!started || !deadline) return;
    const tick = () => {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0 && !endedRef.current) submitRef.current();
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [started, deadline]);

  // --- Exam guard: leaving full screen / switching tab does NOT end the exam.
  //     It is counted as a violation and a "resume full screen" overlay is shown. ---
  function flagViolation() {
    if (endedRef.current) return;
    violationsRef.current += 1;
    setViolations(violationsRef.current);
    setShowResume(true);
  }

  useEffect(() => {
    if (!started) return;
    const onFs = () => { if (!document.fullscreenElement) flagViolation(); };
    const onVis = () => { if (document.hidden) flagViolation(); };
    // Lock the keyboard during the exam — it's click-only (blocks reload, devtools,
    // copy/paste shortcuts, etc.). Released when the exam ends.
    const onKey = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); };
    const block = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('visibilitychange', onVis);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('contextmenu', block, true);
    document.addEventListener('copy', block, true);
    document.addEventListener('cut', block, true);
    document.addEventListener('paste', block, true);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('visibilitychange', onVis);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('contextmenu', block, true);
      document.removeEventListener('copy', block, true);
      document.removeEventListener('cut', block, true);
      document.removeEventListener('paste', block, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  async function startExam() {
    try { await document.documentElement.requestFullscreen(); } catch { /* some browsers block; still start */ }
    setStarted(true);
  }
  async function resume() {
    try { await document.documentElement.requestFullscreen(); } catch { /* ignore */ }
    setShowResume(false);
  }

  async function submit() {
    setBusy(true); setError('');
    endedRef.current = true;
    try {
      await api.post(`/api/quiz/${attemptId}/submit`, { answers, violations: violationsRef.current });
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      navigate(`/result/${attemptId}`);
    } catch (e: any) { setError(e.message); setBusy(false); endedRef.current = false; }
  }
  submitRef.current = submit;

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  if (loading) return <p className="text-sm text-slate-400">Loading exam…</p>;

  if (kicked) {
    return (
      <div className="card mx-auto max-w-md border-2 border-red-200 text-center">
        <p className="text-5xl">🖥️</p>
        <h1 className="mt-2 text-xl font-bold text-red-700">Opened on another screen</h1>
        <p className="mt-1 text-sm text-slate-600">This registration number is now taking the exam on another screen or device. Only one screen is allowed at a time, so this window is locked.</p>
        <button className="btn-ghost mt-4" onClick={() => { sessionStorage.removeItem('kl_reg'); navigate('/'); }}>Close</button>
      </div>
    );
  }

  if (error && !started) return <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>;

  // Start gate
  if (!started) {
    return (
      <div className="card mx-auto max-w-md text-center">
        <h1 className="text-xl font-semibold">Ready to begin</h1>
        <p className="mt-2 text-sm text-slate-600">{questions.length} questions · <b>{fmt(remaining)}</b> total time. The exam opens in full screen.</p>
        <ul className="mx-auto mt-4 max-w-xs space-y-1 text-left text-sm text-slate-600">
          <li>• You have <b>{Math.round(remaining / 60)} minutes</b>; the exam auto-submits when time runs out.</li>
          <li>• Do <b>not</b> exit full screen.</li>
          <li>• Do <b>not</b> switch tabs or windows.</li>
          <li>• Doing so <b>ends the exam with 0 marks</b>.</li>
        </ul>
        <button className="btn-primary mt-5 w-full" onClick={startExam}>Start exam in full screen</button>
      </div>
    );
  }

  const q = questions[idx];
  const answeredCount = Object.keys(answers).length;

  // Exam layout: countdown timer on top; MCQ left, question palette right
  return (
    <div className="space-y-4">
      {/* Full-screen warning overlay — blocks the exam until the student resumes (no penalty) */}
      {showResume && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/90 p-6 text-center">
          <div className="max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <p className="text-4xl">⚠️</p>
            <h2 className="mt-2 text-xl font-bold text-red-700">Please stay in full screen</h2>
            <p className="mt-1 text-sm text-slate-600">
              You left full screen or switched away. This has been recorded (warning #{violations}).
              Your answers are saved — click below to continue the exam.
            </p>
            <button onClick={resume} className="mt-4 w-full rounded-xl bg-teal-600 py-3 text-base font-semibold text-white shadow-sm hover:bg-teal-700">
              Resume exam in full screen
            </button>
          </div>
        </div>
      )}

      {/* TOP: countdown timer bar */}
      <div className={`sticky top-0 z-20 flex items-center justify-between rounded-xl px-4 py-2 text-white shadow ${remaining <= 60 ? 'bg-red-600' : 'bg-teal-600'}`}>
        <span className="text-sm font-semibold">Question {idx + 1} / {questions.length} · {Object.keys(answers).length} answered</span>
        <span className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide opacity-80">Time left</span>
          <span className="font-mono text-2xl font-extrabold tabular-nums">{fmt(remaining)}</span>
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_260px]">
      {/* LEFT: question + options */}
      <div className="space-y-4">
        <div className="card">
          <div className="mb-1 flex items-center justify-between text-sm text-slate-500">
            <span>Question {idx + 1} of {questions.length}</span>
            <span className="flex gap-2 text-xs">
              <span className="rounded-full bg-slate-100 px-2 py-0.5">{q.topic}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5">{q.difficulty}</span>
            </span>
          </div>
          <RichText text={q.question} className="mb-4 text-lg font-medium leading-relaxed" />
          <div className="space-y-2">
            {q.options.map((opt, i) => {
              const selected = answers[q.id] === i;
              return (
                <button key={i} onClick={() => setAnswers((a) => ({ ...a, [q.id]: i }))}
                  className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-base ${selected ? 'border-brand-600 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${selected ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{String.fromCharCode(65 + i)}</span>
                  <RichText text={opt} className="min-w-0 flex-1" />
                </button>
              );
            })}
          </div>
        </div>
        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="flex items-center justify-between">
          <button className="btn-ghost" disabled={idx === 0} onClick={() => setIdx((i) => i - 1)}>← Previous</button>
          {idx < questions.length - 1
            ? <button className="btn-primary" onClick={() => setIdx((i) => i + 1)}>Next →</button>
            : <button className="btn-primary" disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Submit exam'}</button>}
        </div>
      </div>

      {/* RIGHT: question number palette */}
      <div className="card h-fit md:sticky md:top-16">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Questions</p>
          <span className="text-xs text-slate-400">{answeredCount}/{questions.length}</span>
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {questions.map((qq, i) => {
            const isCur = i === idx;
            const isAns = answers[qq.id] !== undefined;
            return (
              <button key={qq.id} onClick={() => setIdx(i)}
                className={`h-9 rounded text-xs font-semibold ${isCur ? 'bg-brand-600 text-white ring-2 ring-brand-200' : isAns ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                {i + 1}
              </button>
            );
          })}
        </div>
        <div className="mt-3 space-y-1 text-xs text-slate-500">
          <div className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-green-100" /> Answered</div>
          <div className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-slate-100" /> Not answered</div>
        </div>
        <button className="btn-primary mt-4 w-full" disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Submit exam'}</button>
        <p className="mt-2 text-center text-[11px] text-red-500">Do not exit full screen or switch tabs.</p>
      </div>
      </div>
    </div>
  );
}

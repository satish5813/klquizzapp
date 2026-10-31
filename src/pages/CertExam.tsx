import { ReactNode, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import RichText from '../RichText';

// ---- shapes returned by /api/cert/* ----
interface CertRules { fullscreen: boolean; warnings: number; autoSubmitOnBreach: boolean; back: boolean; showResult: boolean; }
interface CertExamRow { id: string; title: string; courseCode: string; startAt: string; endAt: string; open: boolean; durationMin: number; passMark: number; questions: number; rules: CertRules; state: 'none' | 'in_progress' | 'submitted' | 'terminated'; score: number | null; total: number | null; }
interface CertItem { no: number; section: string; caseId: string; type: 'single' | 'multi'; marks: number; question: string; options: string[]; }
interface CertCase { id: string; title: string; scenario: string; exhibits: string[]; }
interface CertView { attemptId: string; examTitle: string; courseCode: string; paperName: string; rules: CertRules; passMark: number; durationMin: number; startedAt: string; endsAt: string; serverNow: string; total: number; items: CertItem[]; cases: CertCase[]; answers: Record<string, number[]>; marked: number[]; warningsUsed: number; }
interface CertResult { score: number; total: number; percentage?: number; passMark?: number; passed?: boolean; showResult?: boolean; terminated?: boolean; }

const ATTEMPT_KEY = 'kl_cert_attempt';
const when = (iso: string) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
// ask for full screen inside the click, but never wait on it — some browsers leave the promise pending
const goFull = () => { try { document.documentElement.requestFullscreen?.().catch(() => {}); } catch { /* not supported */ } };
const fmt = (s: number) => `${String(Math.floor(s / 3600)).padStart(1, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/** Certification exams: list → instructions → proctored full-screen paper → result. */
export default function CertExam() {
  const navigate = useNavigate();
  const [reg, setReg] = useState(sessionStorage.getItem('kl_reg') || '');
  const [regInput, setRegInput] = useState('');
  const [list, setList] = useState<{ student: { reg: string; name: string; branch: string; section: string }; exams: CertExamRow[] } | null>(null);
  const [picked, setPicked] = useState<CertExamRow | null>(null);
  const [view, setView] = useState<CertView | null>(null);
  const [needsGesture, setNeedsGesture] = useState(false); // resumed after a refresh: full screen needs a click
  const [result, setResult] = useState<CertResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadList(r = reg) {
    setError('');
    try { setList(await api.post('/api/cert/exams', { reg: r })); } catch (e: any) { setError(e.message); }
  }

  useEffect(() => {
    const saved = sessionStorage.getItem(ATTEMPT_KEY);
    if (saved) {
      api.post<any>('/api/cert/resume', { attemptId: saved }).then((v) => {
        if (v.items) { setView(v); setNeedsGesture(true); } else { sessionStorage.removeItem(ATTEMPT_KEY); if (reg) loadList(); }
      }).catch(() => { sessionStorage.removeItem(ATTEMPT_KEY); if (reg) loadList(); });
    } else if (reg) loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start(exam: CertExamRow) {
    setBusy(true); setError('');
    goFull();
    try {
      const v = await api.post<CertView>('/api/cert/start', { reg, examId: exam.id });
      sessionStorage.setItem(ATTEMPT_KEY, v.attemptId);
      setView(v); setNeedsGesture(false);
    } catch (e: any) {
      setError(e.message);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    } finally { setBusy(false); }
  }

  const logout = () => { sessionStorage.removeItem('kl_reg'); sessionStorage.removeItem(ATTEMPT_KEY); navigate('/'); };

  // ---------- result ----------
  if (result) {
    const pct = result.percentage ?? (result.total ? Math.round((result.score / result.total) * 100) : 0);
    return (
      <div className={`card mx-auto max-w-lg border-2 text-center ${result.terminated ? 'border-red-200' : 'border-teal-200'}`}>
        <p className="text-5xl">{result.terminated ? '⛔' : '✅'}</p>
        <h1 className={`mt-2 text-xl font-bold ${result.terminated ? 'text-red-700' : 'text-teal-700'}`}>{result.terminated ? 'Exam ended' : 'Exam submitted'}</h1>
        {result.terminated && <p className="mt-1 text-sm text-slate-600">The exam was closed because you left the exam screen too many times. Your answers up to that point were marked.</p>}
        {result.showResult !== false ? (
          <>
            <p className="my-3 text-4xl font-extrabold tabular-nums text-slate-800">{result.score} / {result.total}</p>
            <p className="text-sm text-slate-600">{pct}%{result.passMark != null && <> · pass mark {result.passMark}% · <b className={result.passed ? 'text-emerald-600' : 'text-red-600'}>{result.passed ? 'PASSED' : 'NOT PASSED'}</b></>}</p>
          </>
        ) : <p className="mt-3 text-sm text-slate-600">Your answers are recorded. Results will be shared by your coordinator.</p>}
        <div className="mt-5 flex justify-center gap-2">
          <button className="btn-ghost" onClick={() => { setResult(null); loadList(); }}>My exams</button>
          <button className="btn-ghost" onClick={logout}>Log out</button>
        </div>
      </div>
    );
  }

  // ---------- the paper ----------
  if (view) {
    return <Paper view={view} needsGesture={needsGesture} onGesture={() => setNeedsGesture(false)}
      onDone={(r) => { sessionStorage.removeItem(ATTEMPT_KEY); setView(null); setPicked(null); setResult(r); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }} />;
  }

  // ---------- no reg yet (opened /cert directly) ----------
  if (!reg) {
    return (
      <form className="card mx-auto max-w-md space-y-3 text-center" onSubmit={(e) => { e.preventDefault(); const r = regInput.trim(); if (!r) return; sessionStorage.setItem('kl_reg', r); setReg(r); loadList(r); }}>
        <h1 className="text-xl font-bold text-slate-800">Certification Exam</h1>
        <p className="text-sm text-slate-500">Enter your university registration number.</p>
        <input className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-center text-lg font-semibold tracking-[0.15em] outline-none focus:border-teal-500 focus:bg-white focus:ring-4 focus:ring-teal-100" value={regInput} autoFocus onChange={(e) => setRegInput(e.target.value)} placeholder="e.g. 2400030059" />
        <button className="btn-primary w-full" disabled={!regInput.trim()}>Continue</button>
      </form>
    );
  }

  if (error && !list) return (
    <div className="mx-auto max-w-lg space-y-3 text-center">
      <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      <button className="btn-ghost" onClick={logout}>← Back to login</button>
    </div>
  );
  if (!list) return <p className="text-center text-sm text-slate-400">Loading…</p>;

  // ---------- instructions for the chosen exam ----------
  if (picked) return <Instructions exam={picked} student={list.student} busy={busy} error={error} onBack={() => { setPicked(null); setError(''); }} onStart={() => start(picked)} />;

  // ---------- my exams ----------
  const s = list.student;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={logout} className="text-sm font-medium text-slate-500 hover:text-teal-700">← Back to login</button>
        <button onClick={() => loadList()} className="text-sm font-medium text-teal-700 hover:underline">⟳ Refresh</button>
      </div>
      <div className="rounded-3xl bg-gradient-to-br from-teal-600 to-emerald-600 px-6 py-5 text-white shadow-lg">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-50/80">Certification Exams</p>
        <p className="mt-1 text-xl font-bold">{s.name}</p>
        <p className="text-sm text-teal-50/90">{s.reg}{s.branch ? ` · ${s.branch}` : ''}{s.section ? ` · ${s.section}` : ''}</p>
      </div>
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {!list.exams.length && <p className="card text-center text-sm text-slate-500">No certification exam is assigned to you.</p>}
      {list.exams.map((e) => {
        const done = e.state === 'submitted' || e.state === 'terminated';
        const upcoming = !e.open && !done && e.startAt && new Date(e.startAt).getTime() > Date.now();
        return (
          <div key={e.id} className="card flex flex-wrap items-center gap-4">
            <div className="mr-auto min-w-0">
              <p className="font-semibold text-slate-800">{e.title}</p>
              <p className="mt-0.5 text-xs text-slate-500">{when(e.startAt)} → {when(e.endAt)} IST · {e.questions} questions · {e.durationMin} min · pass {e.passMark}%</p>
            </div>
            {done ? (
              <span className={`rounded-xl px-3 py-2 text-sm font-semibold ${e.state === 'terminated' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                {e.state === 'terminated' ? 'Ended' : 'Submitted'}{e.rules?.showResult !== false && e.score != null ? ` · ${e.score}/${e.total}` : ''}
              </span>
            ) : e.open ? (
              <button className="btn-primary" onClick={() => setPicked(e)}>{e.state === 'in_progress' ? 'Resume exam →' : 'Start exam →'}</button>
            ) : (
              <span className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-500">{upcoming ? `Opens ${when(e.startAt)}` : 'Closed'}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Instructions({ exam, student, busy, error, onBack, onStart }: { exam: CertExamRow; student: { reg: string; name: string }; busy: boolean; error: string; onBack: () => void; onStart: () => void }) {
  const [agree, setAgree] = useState(false);
  const r = exam.rules || ({} as CertRules);
  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <button onClick={onBack} className="text-sm font-medium text-slate-500 hover:text-teal-700">← My exams</button>
      <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70">
        <h1 className="text-xl font-bold text-slate-800">{exam.title}</h1>
        <p className="text-sm text-slate-500">{student.name} · {student.reg}</p>
        <div className="my-4 grid grid-cols-3 gap-2 text-center">
          {[[`${exam.questions}`, 'Questions'], [`${exam.durationMin} min`, 'Duration'], [`${exam.passMark}%`, 'Pass mark']].map(([b, s]) => (
            <div key={s} className="rounded-xl bg-teal-50 py-3 ring-1 ring-teal-100"><p className="text-xl font-extrabold text-teal-700">{b}</p><p className="text-[11px] font-semibold uppercase tracking-wide text-teal-600/80">{s}</p></div>
          ))}
        </div>
        <ul className="space-y-2.5 text-sm text-slate-600">
          <Bullet n="1">Questions come one at a time. Some are <b>case studies</b> — the scenario is shown beside its questions.</Bullet>
          <Bullet n="2">Questions marked <b>“Select all that apply”</b> may have more than one correct answer; you must pick exactly the right set to get the marks.</Bullet>
          <Bullet n="3">Use <b>Mark for review</b> and the question panel to come back to questions{r.back === false ? ' (going back is turned off for this exam)' : ''}. Your answers save automatically.</Bullet>
          <Bullet n="4">The timer is at the top. The exam <b>submits automatically</b> when time ends or the exam window closes ({when(exam.endAt)} IST).</Bullet>
          <Bullet n="5" danger>The exam runs in <b>full screen</b>. Leaving full screen or switching away is recorded.{r.autoSubmitOnBreach ? <> After <b>{r.warnings ?? 2} warning{(r.warnings ?? 2) === 1 ? '' : 's'}</b>, the next time the exam <b>ends automatically</b>.</> : null}</Bullet>
          <Bullet n="6" danger>Copy, paste, right-click and keyboard shortcuts are disabled. Use one device and one screen only.</Bullet>
          <Bullet n="7"><b>One attempt only.</b> If your connection drops, log in again — you continue where you stopped, but the clock keeps running.</Bullet>
        </ul>
        <label className="mt-5 flex cursor-pointer items-center gap-2.5 rounded-xl bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 ring-1 ring-slate-200">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="h-4 w-4 accent-teal-600" />
          I have read the instructions and agree to the exam rules.
        </label>
        {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <button className="mt-4 w-full rounded-xl bg-teal-600 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50" disabled={!agree || busy} onClick={onStart}>
          {busy ? 'Starting…' : exam.state === 'in_progress' ? 'Resume exam in full screen' : 'Start exam in full screen'}
        </button>
      </section>
    </div>
  );
}

function Paper({ view, needsGesture, onGesture, onDone }: { view: CertView; needsGesture: boolean; onGesture: () => void; onDone: (r: CertResult) => void }) {
  const items = view.items;
  const rules = view.rules;
  const cases = new Map(view.cases.map((c) => [c.id, c]));
  const [idx, setIdx] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number[]>>(view.answers || {});
  const [marked, setMarked] = useState<number[]>(view.marked || []);
  const [remaining, setRemaining] = useState(0);
  const [warn, setWarn] = useState<{ used: number; allowed: number } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'offline'>('saved');
  const [caseOpen, setCaseOpen] = useState(true);

  const offset = useRef(new Date(view.serverNow).getTime() - Date.now());
  const endsAt = new Date(view.endsAt).getTime();
  const nowMs = () => Date.now() + offset.current;
  const ended = useRef(false);
  const answersRef = useRef(answers); answersRef.current = answers;
  const markedRef = useRef(marked); markedRef.current = marked;
  const dirty = useRef(false);
  const queue = useRef<{ at: string; kind: string; seconds?: number; item?: number }[]>([]);
  const awaySince = useRef(0);
  const backAt = useRef(0);
  const wasFull = useRef(!!document.fullscreenElement);
  const idxRef = useRef(idx); idxRef.current = idx;

  const record = (kind: string, extra: { seconds?: number } = {}) => queue.current.push({ at: new Date(nowMs()).toISOString(), kind, item: idxRef.current, ...extra });

  async function save() {
    if (ended.current || !dirty.current) return;
    dirty.current = false; setSaveState('saving');
    try { await api.post('/api/cert/save', { attemptId: view.attemptId, answers: answersRef.current, marked: markedRef.current }); setSaveState('saved'); }
    catch (e: any) {
      if (/closed/i.test(e.message)) { ended.current = true; finish('time_up'); return; }
      dirty.current = true; setSaveState('offline');
    }
  }
  async function flush() {
    if (ended.current || !queue.current.length) return;
    const events = queue.current.splice(0, queue.current.length);
    try {
      const r = await api.post<{ integrity: number; warningsUsed: number; warningsAllowed: number; terminated: boolean; score?: number; total?: number }>('/api/cert/events', { attemptId: view.attemptId, events });
      if (r.terminated) { ended.current = true; onDone({ score: r.score ?? 0, total: r.total ?? view.total, terminated: true, showResult: rules.showResult }); return; }
      if (events.some((e) => e.kind === 'fullscreen_exit' || (e.kind === 'blur' && (e.seconds || 0) >= 15))) setWarn({ used: r.warningsUsed, allowed: r.warningsAllowed });
    } catch { queue.current.unshift(...events); }
  }
  const saveRef = useRef(save); saveRef.current = save;
  const flushRef = useRef(flush); flushRef.current = flush;

  async function finish(reason = '') {
    ended.current = true; setBusy(true); setConfirm(false);
    for (let i = 1; i <= 6; i++) {
      try {
        await api.post('/api/cert/save', { attemptId: view.attemptId, answers: answersRef.current, marked: markedRef.current }).catch(() => {});
        const r = await api.post<any>('/api/cert/submit', { attemptId: view.attemptId, reason });
        onDone({ score: r.score, total: r.total, percentage: r.percentage, passMark: r.passMark, passed: r.passed, showResult: r.showResult });
        return;
      } catch (e: any) {
        if (/already submitted/i.test(e.message)) { onDone({ score: 0, total: view.total, showResult: false }); return; }
        await new Promise((res) => setTimeout(res, 1500 * i));
      }
    }
    setBusy(false); ended.current = false;
    alert('Could not reach the server to submit. Check your connection — your answers are saved; click Submit again.');
  }
  const finishRef = useRef(finish); finishRef.current = finish;

  // timer
  useEffect(() => {
    const tick = () => {
      const left = Math.max(0, Math.round((endsAt - nowMs()) / 1000));
      setRemaining(left);
      if (left <= 0 && !ended.current) finishRef.current('time_up');
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // autosave + proctoring beacon
  useEffect(() => {
    const t1 = setInterval(() => saveRef.current(), 15000);
    const t2 = setInterval(() => flushRef.current(), 10000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, []);
  useEffect(() => { dirty.current = true; const t = setTimeout(() => saveRef.current(), 3000); return () => clearTimeout(t); }, [answers, marked]);

  // proctoring: full screen, focus, clipboard, keyboard, network
  useEffect(() => {
    if (needsGesture) return;
    const away = () => { if (!awaySince.current) awaySince.current = Date.now(); };
    const back = () => {
      if (!awaySince.current) return;
      const seconds = Math.round((Date.now() - awaySince.current) / 1000);
      awaySince.current = 0; backAt.current = Date.now();
      if (seconds >= 1) { record('blur', { seconds }); flushRef.current(); }
    };
    const onFs = () => {
      if (document.fullscreenElement) { wasFull.current = true; return; }
      if (wasFull.current && rules.fullscreen !== false && !ended.current) { wasFull.current = false; record('fullscreen_exit'); flushRef.current(); setWarn((w) => w || { used: 0, allowed: rules.warnings }); }
    };
    const onVis = () => (document.hidden ? away() : back());
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'j', 'c'].includes(e.key.toLowerCase())) record('devtools');
      if (e.key === 'F12') record('devtools');
      e.preventDefault(); e.stopPropagation();
    };
    const onCopy = (e: Event) => { e.preventDefault(); record('copy'); };
    const onPaste = (e: Event) => { e.preventDefault(); record('paste'); };
    const block = (e: Event) => e.preventDefault();
    const onOffline = () => record('offline');
    const onOnline = () => { flushRef.current(); saveRef.current(); };
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', away);
    window.addEventListener('focus', back);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('copy', onCopy, true);
    document.addEventListener('cut', onCopy, true);
    document.addEventListener('paste', onPaste, true);
    document.addEventListener('contextmenu', block, true);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    const screens = (window.screen as any).isExtended;
    if (screens) record('second_display');
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', away);
      window.removeEventListener('focus', back);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('copy', onCopy, true);
      document.removeEventListener('cut', onCopy, true);
      document.removeEventListener('paste', onPaste, true);
      document.removeEventListener('contextmenu', block, true);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsGesture]);

  function enterFull() {
    goFull();
    setWarn(null); onGesture();
  }

  function choose(i: number) {
    if (backAt.current && Date.now() - backAt.current < 3000) record('quick_answer_after_away');
    const key = String(idx);
    const cur = answers[key] || [];
    const next = items[idx].type === 'multi' ? (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort((a, b) => a - b)) : [i];
    setAnswers({ ...answers, [key]: next });
  }
  const go = (i: number) => { if (i < 0 || i >= items.length) return; if (rules.back === false && i < idx) return; setIdx(i); setFurthest((f) => Math.max(f, i)); };
  const toggleMark = () => setMarked((m) => (m.includes(idx) ? m.filter((x) => x !== idx) : [...m, idx]));
  const isAns = (i: number) => (answers[String(i)] || []).length > 0;
  const answered = items.filter((_, i) => isAns(i)).length;

  if (needsGesture) {
    return (
      <div className="card mx-auto max-w-md text-center">
        <p className="text-4xl">🔁</p>
        <h1 className="mt-2 text-xl font-bold text-slate-800">Continue your exam</h1>
        <p className="mt-1 text-sm text-slate-600">{view.examTitle} · {answered}/{items.length} answered · {fmt(remaining)} left</p>
        <button className="btn-primary mt-4 w-full" onClick={enterFull}>Resume in full screen</button>
      </div>
    );
  }

  const q = items[idx];
  const cs = q.caseId ? cases.get(q.caseId) : undefined;
  const sel = answers[String(idx)] || [];
  const low = remaining <= 300;

  return (
    <div className="space-y-3">
      {warn && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/90 p-6 text-center">
          <div className="max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <p className="text-4xl">⚠️</p>
            <h2 className="mt-2 text-xl font-bold text-red-700">You left the exam screen</h2>
            <p className="mt-1 text-sm text-slate-600">This has been recorded{warn.allowed ? <> — warning <b>{Math.min(warn.used, warn.allowed) || 1} of {warn.allowed}</b>. Next time after that, the exam ends automatically.</> : '.'}</p>
            <button onClick={enterFull} className="mt-4 w-full rounded-xl bg-teal-600 py-3 text-base font-semibold text-white hover:bg-teal-700">Return to the exam in full screen</button>
          </div>
        </div>
      )}
      {confirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/70 p-6" onClick={() => setConfirm(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-4xl">📝</p>
            <h2 className="mt-2 text-xl font-bold text-slate-800">Submit your exam?</h2>
            <p className="mt-1 text-sm text-slate-600">Answered <b>{answered}</b> of <b>{items.length}</b>{marked.length ? <> · <b>{marked.length}</b> marked for review</> : null}.</p>
            {answered < items.length && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-left text-xs text-amber-700">Not answered: {items.map((_, i) => (isAns(i) ? null : i + 1)).filter(Boolean).join(', ')}</p>}
            <div className="mt-4 flex gap-2">
              <button onClick={() => setConfirm(false)} className="flex-1 rounded-xl bg-white py-2.5 font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">← Keep working</button>
              <button onClick={() => finish('')} disabled={busy} className="flex-1 rounded-xl bg-teal-600 py-2.5 font-semibold text-white hover:bg-teal-700 disabled:opacity-50">Submit now</button>
            </div>
          </div>
        </div>
      )}
      {busy && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/80 p-6 text-center">
          <div className="rounded-2xl bg-white px-8 py-6 shadow-2xl">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
            <p className="font-semibold text-slate-800">Submitting your exam…</p>
            <p className="mt-1 text-xs text-slate-500">Please wait — do not close this window.</p>
          </div>
        </div>
      )}

      {/* top bar */}
      <div className={`sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-2 text-white shadow ${remaining <= 60 ? 'bg-red-600' : low ? 'bg-amber-600' : 'bg-teal-700'}`}>
        <span className="min-w-0 truncate text-sm font-semibold">{view.examTitle}</span>
        <span className="text-xs opacity-90">{answered}/{items.length} answered · {saveState === 'saved' ? '✓ saved' : saveState === 'saving' ? 'saving…' : '⚠ offline — will retry'}</span>
        <span className="flex items-center gap-2"><span className="text-[11px] uppercase tracking-wide opacity-80">Time left</span><span className="font-mono text-2xl font-extrabold tabular-nums">{fmt(remaining)}</span></span>
      </div>

      <div className={`grid gap-4 ${cs && caseOpen ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_240px]' : 'lg:grid-cols-[minmax(0,1fr)_240px]'}`}>
        {cs && caseOpen && (
          <aside className="card max-h-[calc(100vh-9rem)] overflow-auto lg:sticky lg:top-16">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-indigo-600">Case study</p>
              <button className="text-xs text-slate-400 hover:text-slate-600" onClick={() => setCaseOpen(false)}>Hide ✕</button>
            </div>
            <h3 className="mb-2 font-bold text-slate-800">{cs.title}</h3>
            <RichText text={cs.scenario} className="whitespace-pre-line text-sm leading-relaxed text-slate-700" />
            {cs.exhibits?.map((x, i) => <div key={i} className="mt-3 rounded-lg bg-slate-50 p-3 text-xs ring-1 ring-slate-200"><p className="mb-1 font-semibold text-slate-500">Exhibit {i + 1}</p><RichText text={x} className="whitespace-pre-line" /></div>)}
          </aside>
        )}

        <div className="space-y-3">
          <div className="card">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
              <span>Question {idx + 1} of {items.length} · {q.marks} mark{q.marks === 1 ? '' : 's'}</span>
              <span className="flex gap-1.5 text-xs">
                {cs && !caseOpen && <button className="rounded-full bg-indigo-100 px-2 py-0.5 font-semibold text-indigo-700" onClick={() => setCaseOpen(true)}>Show case study</button>}
                <span className="rounded-full bg-slate-100 px-2 py-0.5">{q.section}</span>
              </span>
            </div>
            <RichText text={q.question} className="mb-2 text-lg font-medium leading-relaxed text-slate-800" />
            {q.type === 'multi' && <p className="mb-3 text-xs font-bold uppercase tracking-wide text-amber-600">Select all that apply</p>}
            <div className="mt-3 space-y-2">
              {q.options.map((opt, i) => {
                const on = sel.includes(i);
                return (
                  <button key={i} onClick={() => choose(i)}
                    className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-base transition ${on ? 'border-teal-600 bg-teal-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                    <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center text-xs font-semibold ${q.type === 'multi' ? 'rounded' : 'rounded-full'} ${on ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{on && q.type === 'multi' ? '✓' : String.fromCharCode(65 + i)}</span>
                    <RichText text={opt} className="min-w-0 flex-1" />
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button className="btn-ghost" disabled={idx === 0 || rules.back === false} onClick={() => go(idx - 1)}>← Previous</button>
            <div className="flex items-center gap-2">
              {sel.length > 0 && <button className="btn-ghost text-slate-500" onClick={() => setAnswers({ ...answers, [String(idx)]: [] })}>Clear</button>}
              <button className={`btn-ghost ${marked.includes(idx) ? 'text-violet-700 ring-violet-300' : ''}`} onClick={toggleMark}>{marked.includes(idx) ? '★ Marked' : '☆ Mark for review'}</button>
              {idx < items.length - 1
                ? <button className="btn-primary" onClick={() => go(idx + 1)}>Next →</button>
                : <button className="btn-primary" onClick={() => setConfirm(true)}>Finish & submit</button>}
            </div>
          </div>
        </div>

        <div className="card h-fit lg:sticky lg:top-16">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Questions</p>
            <span className="text-xs text-slate-400">{answered}/{items.length}</span>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {items.map((it, i) => {
              const locked = rules.back === false && i < idx;
              const cls = i === idx ? 'bg-teal-600 text-white ring-2 ring-teal-200'
                : marked.includes(i) ? 'bg-violet-100 text-violet-700'
                : isAns(i) ? 'bg-green-100 text-green-700'
                : i <= furthest ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500';
              return <button key={i} disabled={locked} onClick={() => go(i)} title={it.caseId ? 'Case study' : ''} className={`relative h-9 rounded text-xs font-semibold disabled:opacity-40 ${cls}`}>{i + 1}{it.caseId && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-indigo-400" />}</button>;
            })}
          </div>
          <div className="mt-3 space-y-1 text-xs text-slate-500">
            <Legend cls="bg-green-100">Answered</Legend>
            <Legend cls="bg-violet-100">Marked for review</Legend>
            <Legend cls="bg-amber-50 ring-1 ring-amber-200">Seen, not answered</Legend>
            <Legend cls="bg-slate-100">Not seen</Legend>
            <div className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-indigo-400" /> Case study question</div>
          </div>
          <button className="mt-4 w-full rounded-xl bg-teal-600 py-2.5 font-semibold text-white shadow-sm transition hover:bg-teal-700" onClick={() => setConfirm(true)}>Submit exam</button>
          <p className="mt-2 text-center text-[11px] text-red-500">Auto-submits when time is up. Stay in full screen.</p>
        </div>
      </div>
    </div>
  );
}

function Legend({ cls, children }: { cls: string; children: ReactNode }) {
  return <div className="flex items-center gap-2"><span className={`h-3 w-3 rounded ${cls}`} /> {children}</div>;
}

function Bullet({ n, children, danger }: { n: string; children: ReactNode; danger?: boolean }) {
  return (
    <li className="flex gap-3">
      <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${danger ? 'bg-red-100 text-red-600' : 'bg-teal-100 text-teal-700'}`}>{n}</span>
      <span className={danger ? 'text-red-600' : ''}>{children}</span>
    </li>
  );
}

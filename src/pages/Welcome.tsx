import { ReactNode, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, LoginResponse } from '../api';

export default function Welcome() {
  const navigate = useNavigate();
  const reg = sessionStorage.getItem('kl_reg') || '';
  const [data, setData] = useState<LoginResponse | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!reg) { navigate('/'); return; }
    api.post<LoginResponse>('/api/login', { registrationNumber: reg }).then(setData).catch((e) => setError(e.message));
  }, [reg, navigate]);

  async function start() {
    setBusy(true); setError('');
    try {
      const r = await api.post<{ attemptId: string; completed?: boolean }>('/api/exam/start', { registrationNumber: reg });
      navigate(r.completed ? `/result/${r.attemptId}` : `/quiz/${r.attemptId}`);
    } catch (e: any) { setError(e.message); setBusy(false); }
  }

  if (error) return <div className="mx-auto max-w-lg rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>;
  if (!data) return <p className="text-center text-sm text-slate-400">Loading…</p>;

  const s = data.student;
  const a = data.attempt;
  const sch = data.schedule;
  const blocked = a.state !== 'in_progress' && sch && sch.enabled && !sch.open;

  if (a.state === 'completed') {
    const terminated = a.status === 'terminated';
    return (
      <div className="card mx-auto max-w-lg border-2 border-amber-200 text-center">
        <p className="text-5xl">🔒</p>
        <h1 className="mt-2 text-xl font-bold text-amber-700">Exam already completed</h1>
        <p className="mt-1 text-sm text-slate-600">{s.name} · {s.registrationNumber}</p>
        <p className={`my-3 text-4xl font-bold ${terminated ? 'text-red-700' : 'text-slate-800'}`}>{a.score} / {a.total}</p>
        <p className="text-sm text-slate-500">{terminated ? 'Recorded as 0 — the exam was terminated for a full-screen / focus violation.' : `Your recorded score (${a.percentage}%).`}</p>
        <button className="btn-ghost mt-4" onClick={() => { sessionStorage.removeItem('kl_reg'); navigate('/'); }}>Log out</button>
      </div>
    );
  }

  if (blocked) {
    return (
      <div className="card mx-auto max-w-lg border-2 border-blue-200 text-center">
        <p className="text-5xl">⏳</p>
        <h1 className="mt-2 text-xl font-bold text-blue-700">{sch.reason === 'closed' ? 'Exam closed' : 'Exam not started yet'}</h1>
        <p className="mt-1 text-sm text-slate-600">{s.name} · {s.registrationNumber}</p>
        <p className="mt-3 text-sm text-slate-600">
          {sch.reason === 'closed'
            ? `The exam window closed${sch.endAt ? ' at ' + new Date(sch.endAt).toLocaleString() : ''}.`
            : `The exam opens at ${sch.startAt ? new Date(sch.startAt).toLocaleString() : 'the scheduled time'}. Please come back then.`}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button className="btn-ghost" onClick={() => window.location.reload()}>Refresh</button>
          <button className="btn-ghost" onClick={() => { sessionStorage.removeItem('kl_reg'); navigate('/'); }}>Log out</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <button onClick={() => { sessionStorage.removeItem('kl_reg'); navigate('/'); }}
        className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-teal-700">
        ← Back to login
      </button>
      <div className="grid gap-5 md:grid-cols-[320px_1fr]">
      {/* LEFT: teal profile panel */}
      <aside className="overflow-hidden rounded-3xl bg-gradient-to-b from-teal-600 to-emerald-600 text-white shadow-lg">
        <div className="px-6 pt-7 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-white/15 text-2xl font-bold ring-2 ring-white/30">
            {s.name?.[0] || '?'}
          </div>
          <p className="mt-3 text-lg font-bold leading-tight">{s.name}</p>
          <p className="text-xs text-teal-50/80">Candidate</p>
        </div>
        <div className="mt-5 space-y-px bg-white/10">
          <Row label="Registration No." value={s.registrationNumber} />
          <Row label="Branch" value={s.branch || '—'} />
          <Row label="Section" value={s.section || '—'} />
        </div>
        <div className="grid grid-cols-2 gap-px bg-white/10">
          <Tile big={`${data.quizSize}`} small="Questions" />
          <Tile big={`${data.durationMin} min`} small="Duration" />
        </div>
      </aside>

      {/* RIGHT: instructions */}
      <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70">
        <div className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-3">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-50 text-teal-600">📋</span>
          <h2 className="text-lg font-bold tracking-tight text-slate-800">Exam Instructions</h2>
        </div>
        <ul className="space-y-2.5 text-sm text-slate-600">
          <Bullet n="1">This test has <b className="text-slate-800">{data.quizSize} multiple-choice questions</b>, each with 4 options. Select one answer per question.</Bullet>
          <Bullet n="2">You have <b className="text-slate-800">{data.durationMin} minutes</b>. A countdown timer is shown at the top; the exam <b className="text-slate-800">submits automatically</b> when time ends.</Bullet>
          <Bullet n="3">Use the <b className="text-slate-800">question panel</b> to move between questions. Answered questions are marked <span className="font-semibold text-emerald-600">green</span>.</Bullet>
          <Bullet n="4" danger>The exam runs in <b>full screen</b>. Leaving full screen, switching tabs, or copying is <b>not allowed</b> and will <b>end your exam with 0 marks</b>.</Bullet>
          <Bullet n="5"><b className="text-slate-800">One attempt only.</b> Review your answers and click <b className="text-slate-800">Submit</b> when finished.</Bullet>
        </ul>

        <label className="mt-5 flex cursor-pointer items-center gap-2.5 rounded-xl bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 ring-1 ring-slate-200">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="h-4 w-4 accent-teal-600" />
          I have read and understood the instructions and agree to the exam rules.
        </label>
        {a.state === 'in_progress' && <p className="mt-2 text-xs font-medium text-amber-600">You have an exam in progress — this will resume it.</p>}
        <button
          className="mt-4 w-full rounded-xl bg-teal-600 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-teal-700 focus:ring-4 focus:ring-teal-200 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!agree || busy} onClick={start}>
          {busy ? 'Starting…' : a.state === 'in_progress' ? 'Resume Exam in Full Screen' : 'Start Exam in Full Screen'}
        </button>
      </section>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between bg-teal-700/30 px-6 py-3">
      <span className="text-xs font-medium uppercase tracking-wide text-teal-50/70">{label}</span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}

function Tile({ big, small }: { big: string; small: string }) {
  return (
    <div className="bg-teal-700/30 px-4 py-4 text-center">
      <p className="text-2xl font-extrabold">{big}</p>
      <p className="text-[11px] font-medium uppercase tracking-wide text-teal-50/70">{small}</p>
    </div>
  );
}

function Bullet({ n, children, danger }: { n: string; children: ReactNode; danger?: boolean }) {
  return (
    <li className="flex gap-3">
      <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${danger ? 'bg-red-100 text-red-600' : 'bg-teal-100 text-teal-700'}`}>{n}</span>
      <span className={danger ? 'text-red-600' : ''}>{children}</span>
    </li>
  );
}

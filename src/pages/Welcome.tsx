import { useEffect, useState } from 'react';
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
    <div className="space-y-4">
      {/* friendly top banner */}
      <div className="rounded-2xl bg-gradient-to-r from-sky-400 to-indigo-400 px-5 py-3 text-white shadow">
        <p className="text-sm">Hello 👋</p>
        <p className="text-2xl font-extrabold">{s.name}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-[300px_1fr]">
        {/* LEFT: profile */}
        <div className="space-y-3">
          <div className="rounded-2xl border-2 border-sky-200 bg-white p-4 shadow-sm">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-sky-600">Your profile</p>
            <Row icon="🎓" label="Registration" value={s.registrationNumber} />
            <Row icon="🏫" label="Branch" value={s.branch || '—'} />
            <Row icon="📋" label="Section" value={s.section || '—'} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Tile color="bg-emerald-100 text-emerald-700" big={`${data.quizSize}`} small="Questions" />
            <Tile color="bg-orange-100 text-orange-700" big={`${data.durationMin}m`} small="Time" />
          </div>
        </div>

        {/* RIGHT: instructions */}
        <div className="rounded-2xl border-2 border-indigo-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-extrabold text-indigo-700">📋 Instructions</h2>
          <ul className="space-y-2 text-sm">
            <li className="flex gap-2 rounded-lg bg-emerald-50 p-2"><span>✅</span><span><b>{data.quizSize} questions.</b> Each has 4 options — pick one.</span></li>
            <li className="flex gap-2 rounded-lg bg-orange-50 p-2"><span>⏱️</span><span>You get <b>{data.durationMin} minutes</b>. A <b>timer at the top</b> counts down and the exam <b>auto-submits</b> when time is over.</span></li>
            <li className="flex gap-2 rounded-lg bg-sky-50 p-2"><span>🧭</span><span>Questions show on the screen; the <b>number panel</b> lets you jump around. Answered ones turn <span className="font-semibold text-green-600">green</span>.</span></li>
            <li className="flex gap-2 rounded-lg bg-red-50 p-2 text-red-700"><span>⚠️</span><span>The exam is <b>full screen</b>. If you <b>leave full screen</b> or <b>switch tabs</b>, it <b>ends with 0 marks</b>.</span></li>
            <li className="flex gap-2 rounded-lg bg-violet-50 p-2"><span>1️⃣</span><span><b>One attempt only.</b> Press <b>Submit</b> when you finish.</span></li>
          </ul>

          <label className="mt-4 flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="h-4 w-4" />
            I have read the instructions and agree to the rules.
          </label>
          {a.state === 'in_progress' && <p className="mt-2 text-xs text-amber-600">You already have an exam in progress — this will resume it.</p>}
          <button className="mt-4 w-full rounded-xl bg-indigo-600 py-3 text-base font-bold text-white shadow transition hover:bg-indigo-700 disabled:opacity-50"
            disabled={!agree || busy} onClick={start}>
            {busy ? 'Starting…' : a.state === 'in_progress' ? '▶ Resume exam (full screen)' : '▶ Start exam (full screen)'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-slate-100 py-1.5 last:border-0">
      <span className="text-lg">{icon}</span>
      <div>
        <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
        <p className="font-semibold text-slate-800">{value}</p>
      </div>
    </div>
  );
}

function Tile({ color, big, small }: { color: string; big: string; small: string }) {
  return (
    <div className={`rounded-2xl ${color} p-3 text-center`}>
      <p className="text-2xl font-extrabold">{big}</p>
      <p className="text-xs font-medium">{small}</p>
    </div>
  );
}

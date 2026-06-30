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

  // Already completed — cannot reopen
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

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* Student details */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
        <div className="bg-gradient-to-r from-emerald-500 to-teal-500 px-5 py-3 text-white">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/80">Welcome</p>
          <p className="text-xl font-bold">{s.name}</p>
        </div>
        <div className="grid grid-cols-3 divide-x divide-slate-100 text-center">
          <Detail label="Registration No" value={s.registrationNumber} />
          <Detail label="Branch" value={s.branch || '—'} />
          <Detail label="Section" value={s.section || '—'} />
        </div>
      </div>

      {/* Instructions */}
      <div className="card border-l-4 border-blue-500">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-blue-700">📋 Exam instructions</h2>
        <ul className="space-y-2 text-sm">
          <li className="flex gap-2"><span className="text-blue-600">●</span> The exam has <b>{data.quizSize}</b> multiple-choice questions.</li>
          <li className="flex gap-2"><span className="text-blue-600">●</span> You have <b>{data.durationMin} minutes</b>. A timer is shown; the exam <b>auto-submits</b> when time ends.</li>
          <li className="flex gap-2"><span className="text-emerald-600">●</span> Questions are on the <b>left</b>; the <b>question palette</b> (jump to any question) is on the <b>right</b>.</li>
          <li className="flex gap-2"><span className="text-emerald-600">●</span> Answered questions turn <span className="font-semibold text-green-600">green</span> in the palette.</li>
          <li className="flex gap-2 rounded-lg bg-red-50 p-2 text-red-700"><span>⚠</span> The exam runs in <b>full screen</b>. If you <b>exit full screen</b> or <b>switch tabs/windows</b>, the exam ends immediately and is recorded as <b>0 marks</b>.</li>
          <li className="flex gap-2"><span className="text-violet-600">●</span> You get <b>one attempt only</b>. Click <b>Submit</b> when done.</li>
        </ul>

        <label className="mt-4 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="h-4 w-4" />
          I have read and understood the instructions, and I agree to the exam rules.
        </label>

        {a.state === 'in_progress' && <p className="mt-3 text-xs text-amber-600">You have an exam already in progress — clicking below resumes it.</p>}
        <button className="btn-primary mt-4 w-full py-3 text-base" disabled={!agree || busy} onClick={start}>
          {busy ? 'Starting…' : a.state === 'in_progress' ? 'Resume exam in full screen' : 'Start exam in full screen'}
        </button>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 font-semibold text-slate-800">{value}</p>
    </div>
  );
}

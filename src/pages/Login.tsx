import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, LoginResponse } from '../api';

function Logo({ src, fallback }: { src: string; fallback: string }) {
  return (
    <img src={src} alt={fallback} className="h-12 w-auto object-contain"
      onError={(e) => {
        const s = document.createElement('span');
        s.className = 'grid h-12 min-w-[48px] place-items-center rounded-xl bg-teal-50 px-3 font-bold text-teal-700';
        s.textContent = fallback; e.currentTarget.replaceWith(s);
      }} />
  );
}

export default function Login() {
  const navigate = useNavigate();
  const [reg, setReg] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ticket, setTicket] = useState(false);
  const [tReg, setTReg] = useState('');
  const [tMsg, setTMsg] = useState('');
  const [tDone, setTDone] = useState('');

  async function sendTicket() {
    if (!tMsg.trim()) return;
    try { await api.post('/api/ticket', { registrationNumber: tReg.trim(), message: tMsg.trim() }); setTDone('Ticket sent — the coordinator will help you.'); setTMsg(''); setTimeout(() => { setTicket(false); setTDone(''); }, 2500); }
    catch (e: any) { setError(e.message); }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await api.post<LoginResponse>('/api/login', { registrationNumber: reg.trim() });
      sessionStorage.setItem('kl_reg', reg.trim());
      sessionStorage.setItem('kl_name', r.student.name || '');
      sessionStorage.setItem('kl_branch', r.student.branch || '');
      sessionStorage.setItem('kl_section', r.student.section || '');
      sessionStorage.setItem('kl_domain', r.student.domain || '');
      navigate('/welcome');
    } catch (err: any) { setError(err.message); setBusy(false); }
  }

  return (
    <div className="mx-auto mt-6 max-w-md">
      <div className="overflow-hidden rounded-3xl bg-white shadow-xl ring-1 ring-slate-200/70">
        {/* teal header band with logos */}
        <div className="relative bg-gradient-to-br from-teal-600 to-emerald-600 px-8 pb-10 pt-8 text-center">
          <div className="mx-auto flex w-fit items-center gap-4 rounded-2xl bg-white px-5 py-3 shadow-sm">
            <Logo src="/logo-left.png" fallback="KL" />
            <span className="h-9 w-px bg-slate-200" />
            <Logo src="/logo-right.png" fallback="SKILL" />
          </div>
          <h1 className="mt-5 text-2xl font-bold tracking-tight text-white">Student Login</h1>
          <p className="mt-1 text-sm text-teal-50/90">KL AI QuizApp · Online Examination</p>
        </div>

        {/* form sits slightly over the band */}
        <form onSubmit={submit} className="-mt-5 space-y-4 rounded-t-3xl bg-white px-8 pb-8 pt-7">
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">University Registration Number</label>
            <input
              className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-center text-lg font-semibold tracking-[0.15em] text-slate-800 outline-none transition focus:border-teal-500 focus:bg-white focus:ring-4 focus:ring-teal-100"
              value={reg} autoFocus onChange={(e) => setReg(e.target.value)} placeholder="e.g. 2300032983" required />
          </div>
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">{error}</div>}
          <button
            className="w-full rounded-xl bg-teal-600 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-teal-700 focus:ring-4 focus:ring-teal-200 disabled:opacity-50"
            disabled={busy || !reg.trim()}>
            {busy ? 'Verifying…' : 'Continue'}
          </button>
          <p className="text-center text-xs text-slate-400">Use the registration number from your hall ticket.</p>
          <button type="button" onClick={() => { setTReg(reg); setTicket(true); }} className="w-full text-center text-xs font-medium text-teal-700 hover:underline">Having a problem? Raise a ticket →</button>
        </form>
      </div>

      {ticket && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4" onClick={() => setTicket(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-800">Raise a ticket</h2>
            <p className="mb-3 text-sm text-slate-500">Describe your issue — the exam coordinator will see it.</p>
            {tDone ? <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{tDone}</div> : (
              <div className="space-y-3">
                <input className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-500" value={tReg} onChange={(e) => setTReg(e.target.value)} placeholder="Registration number (optional)" />
                <textarea className="min-h-[90px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-500" value={tMsg} onChange={(e) => setTMsg(e.target.value)} placeholder="What went wrong?" />
                <div className="flex gap-2">
                  <button onClick={() => setTicket(false)} className="flex-1 rounded-xl bg-white py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">Cancel</button>
                  <button onClick={sendTicket} disabled={!tMsg.trim()} className="flex-1 rounded-xl bg-teal-600 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50">Send ticket</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

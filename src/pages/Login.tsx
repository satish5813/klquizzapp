import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, LoginResponse } from '../api';

// Logo with graceful text fallback (same files as the header).
function Logo({ src, fallback }: { src: string; fallback: string }) {
  return (
    <img src={src} alt={fallback} className="h-14 w-auto object-contain"
      onError={(e) => {
        const s = document.createElement('span');
        s.className = 'grid h-14 min-w-[56px] place-items-center rounded-xl bg-indigo-100 px-3 font-bold text-indigo-700';
        s.textContent = fallback; e.currentTarget.replaceWith(s);
      }} />
  );
}

export default function Login() {
  const navigate = useNavigate();
  const [reg, setReg] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.post<LoginResponse>('/api/login', { registrationNumber: reg.trim() });
      sessionStorage.setItem('kl_reg', reg.trim());
      navigate('/welcome');
    } catch (err: any) { setError(err.message); setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="overflow-hidden rounded-3xl bg-white shadow-lg ring-1 ring-slate-100">
        {/* colorful hero with both logos */}
        <div className="bg-gradient-to-br from-sky-500 via-indigo-500 to-violet-500 px-6 py-7 text-center text-white">
          <div className="mb-3 flex items-center justify-center gap-4 rounded-2xl bg-white/95 px-4 py-3">
            <Logo src="/logo-left.png" fallback="KL" />
            <div className="h-10 w-px bg-slate-200" />
            <Logo src="/logo-right.png" fallback="SKILL" />
          </div>
          <h1 className="text-2xl font-extrabold">KL AI QuizApp</h1>
          <p className="text-sm text-white/85">Online Examination Portal</p>
        </div>

        {/* login form */}
        <form onSubmit={submit} className="space-y-4 px-6 py-6">
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">Enter your Registration Number</label>
            <input className="w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-center text-lg font-semibold tracking-widest outline-none focus:border-indigo-500"
              value={reg} autoFocus onChange={(e) => setReg(e.target.value)} placeholder="e.g. 2300032983" required />
          </div>
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <button className="w-full rounded-xl bg-indigo-600 py-3 text-base font-bold text-white shadow transition hover:bg-indigo-700 disabled:opacity-50" disabled={busy || !reg.trim()}>
            {busy ? 'Checking…' : 'Login →'}
          </button>
          <p className="text-center text-xs text-slate-400">Use the registration number from your hall ticket. Trouble logging in? Contact your coordinator.</p>
        </form>
      </div>
    </div>
  );
}

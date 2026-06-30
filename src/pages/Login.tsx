import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, LoginResponse } from '../api';

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
    <div className="card mx-auto max-w-md">
      <h1 className="text-xl font-semibold">Student login</h1>
      <p className="mb-5 text-sm text-slate-500">Enter your university registration number to continue.</p>
      {error && <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label">University registration number</label>
          <input className="input text-center text-lg tracking-widest" value={reg} autoFocus
            onChange={(e) => setReg(e.target.value)} placeholder="e.g. 2100030001" required />
        </div>
        <button className="btn-primary w-full" disabled={busy || !reg.trim()}>{busy ? 'Checking…' : 'Continue'}</button>
      </form>
      <p className="mt-4 text-center text-xs text-slate-400">Not able to log in? Contact your exam coordinator.</p>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { api, ReviewItem } from '../api';

interface Estimate { requests: number; outputTokens: number; usd: number; inr: number; note: string; }
interface Job { status: string; collected: number; target: number; requests: number; error?: string; stats?: any; bankTotal?: number; }
interface Student { id: string; registrationNumber: string; name: string; branch: string; createdAt: string; }
interface Attempt { attemptId: string; registrationNumber: string; name: string; branch: string; score: number | null; total: number; percentage: number | null; status: string; reason: string; startedAt: string; submittedAt: string | null; }

export default function Admin() {
  const [token, setToken] = useState('');
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<'overview' | 'bank' | 'students' | 'results'>('overview');
  const [error, setError] = useState('');

  const [bank, setBank] = useState<{ count: number; topics: string[] }>({ count: 0, topics: [] });
  const [students, setStudents] = useState<Student[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);

  const h = () => ({ 'x-admin-token': token });

  async function loadAll() {
    try {
      const [b, s, a] = await Promise.all([
        api.get<{ count: number; topics: string[] }>('/api/admin/bank/stats', h()),
        api.get<Student[]>('/api/admin/students', h()),
        api.get<Attempt[]>('/api/admin/attempts', h()),
      ]);
      setBank(b); setStudents(s); setAttempts(a);
    } catch (e: any) { setError(e.message); }
  }
  async function login() {
    setError('');
    try { await api.get('/api/admin/bank/stats', h()); setAuthed(true); await loadAll(); }
    catch (e: any) { setError(e.message); }
  }

  if (!authed) {
    return (
      <div className="card mx-auto max-w-sm">
        <h1 className="text-lg font-semibold">Admin sign in</h1>
        <p className="mb-4 text-sm text-slate-500">Enter the admin token (set in <code>server/.env</code>).</p>
        {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <input className="input mb-3" type="password" placeholder="ADMIN_TOKEN" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && login()} />
        <button className="btn-primary w-full" onClick={login}>Continue</button>
      </div>
    );
  }

  const submitted = attempts.filter((a) => a.status === 'submitted').length;
  const terminated = attempts.filter((a) => a.status === 'terminated').length;
  const tabs = [['overview', 'Overview'], ['bank', 'Question Bank'], ['students', 'Students'], ['results', 'Results']] as const;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">KL AI QuizApp — Admin</h1>
        <button className="btn-ghost" onClick={loadAll}>Refresh</button>
      </div>
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-t-lg px-4 py-2 text-sm font-medium ${tab === k ? 'border-b-2 border-brand-600 text-brand-700' : 'text-slate-500 hover:text-slate-700'}`}>{label}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Questions" value={bank.count} />
          <Stat label="Students" value={students.length} />
          <Stat label="Submitted" value={submitted} />
          <Stat label="Terminated" value={terminated} />
        </div>
      )}

      {tab === 'bank' && <BankTab token={token} bank={bank} onChanged={loadAll} setError={setError} />}

      {tab === 'students' && (
        <Table head={['Reg. No', 'Name', 'Branch', 'Registered']} empty="No students yet."
          rows={students.map((s) => [s.registrationNumber, s.name, s.branch, new Date(s.createdAt).toLocaleString()])} />
      )}

      {tab === 'results' && <ResultsTab token={token} attempts={attempts} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="card"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-3xl font-bold">{value}</p></div>;
}

function Table({ head, rows, empty }: { head: string[]; rows: (string | number)[][]; empty: string }) {
  if (!rows.length) return <div className="card text-sm text-slate-400">{empty}</div>;
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-100 bg-slate-50"><tr>{head.map((h) => <th key={h} className="px-3 py-2 text-left font-semibold text-slate-500">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-slate-50">{r.map((c, j) => <td key={j} className="px-3 py-2">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function BankTab({ token, bank, onChanged, setError }: { token: string; bank: { count: number; topics: string[] }; onChanged: () => void; setError: (s: string) => void }) {
  const h = () => ({ 'x-admin-token': token });
  const [syllabus, setSyllabus] = useState('');
  const [count, setCount] = useState('1000');
  const [replace, setReplace] = useState(false);
  const [est, setEst] = useState<Estimate | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [importText, setImportText] = useState('');
  const [importMsg, setImportMsg] = useState('');

  async function estimate() {
    try { setEst(await api.post<Estimate>('/api/admin/estimate', { count: Number(count) }, h())); } catch (e: any) { setError(e.message); }
  }
  async function generate() {
    setBusy(true); setJob(null); setError('');
    try {
      const { jobId } = await api.post<{ jobId: string }>('/api/admin/generate', { syllabus, count: Number(count), replace }, h());
      const poll = async () => {
        const j = await api.get<Job>(`/api/admin/jobs/${jobId}`, h());
        setJob(j);
        if (j.status === 'running') setTimeout(poll, 1500);
        else { setBusy(false); onChanged(); }
      };
      poll();
    } catch (e: any) { setError(e.message); setBusy(false); }
  }
  async function importMcqs() {
    setImportMsg(''); setError('');
    let parsed: any;
    try { parsed = JSON.parse(importText); } catch { setError('Import must be valid JSON (an array of MCQs).'); return; }
    const questions = Array.isArray(parsed) ? parsed : parsed.questions;
    try {
      const r = await api.post<{ added: number; skipped: number; bankTotal: number }>('/api/admin/import', { questions, replace }, h());
      setImportMsg(`Imported ${r.added}, skipped ${r.skipped}. Bank total: ${r.bankTotal}.`);
      setImportText(''); onChanged();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="space-y-4">
      <div className="card"><p className="text-sm text-slate-500">Question bank</p><p className="text-3xl font-bold">{bank.count}</p></div>

      <div className="card space-y-3">
        <h2 className="font-semibold">Generate from syllabus (Claude Haiku)</h2>
        <textarea className="input min-h-[120px]" value={syllabus} onChange={(e) => setSyllabus(e.target.value)} placeholder="Paste the syllabus / topics here…" />
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-28"><label className="label">How many</label><input className="input" type="number" min={1} value={count} onChange={(e) => setCount(e.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace bank</label>
          <button className="btn-ghost" onClick={estimate}>Estimate cost</button>
          <button className="btn-primary" disabled={busy || syllabus.trim().length < 10} onClick={generate}>{busy ? 'Generating…' : 'Generate'}</button>
        </div>
        {est && <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">~{est.requests} API calls · est. <b>${est.usd}</b> (≈ ₹{est.inr}). <span className="text-slate-400">{est.note}</span></div>}
        {job && <div className={`rounded-lg px-3 py-2 text-sm ${job.status === 'error' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
          {job.status === 'running' && <>Generating… {job.collected}/{job.target} ({job.requests} calls)</>}
          {job.status === 'done' && <>✅ Added {job.stats?.generated} (bank {job.bankTotal}). Actual ${job.stats?.actualUsd} (≈ ₹{job.stats?.actualInr}).</>}
          {job.status === 'error' && <>Error: {job.error}</>}
        </div>}
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold">Import model MCQs (JSON)</h2>
        <p className="text-xs text-slate-500">Paste an array like:
          <code className="ml-1">{`[{"question":"…","options":["A","B","C","D"],"answerIndex":1,"topic":"…","difficulty":"EASY","explanation":"…"}]`}</code>.
          You can use <code>"answer":"B"</code> or the option text instead of <code>answerIndex</code>.</p>
        <textarea className="input min-h-[120px] font-mono text-xs" value={importText} onChange={(e) => setImportText(e.target.value)} placeholder='[ { "question": "...", "options": ["...","...","...","..."], "answerIndex": 0 } ]' />
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace bank</label>
          <button className="btn-primary" disabled={!importText.trim()} onClick={importMcqs}>Import</button>
          {importMsg && <span className="text-sm text-green-700">{importMsg}</span>}
        </div>
      </div>

      {!!bank.topics.length && <div className="card"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Topics</p><div className="flex flex-wrap gap-1.5">{bank.topics.map((t) => <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{t}</span>)}</div></div>}
    </div>
  );
}

function ResultsTab({ token, attempts }: { token: string; attempts: Attempt[] }) {
  const [review, setReview] = useState<{ name: string; items: ReviewItem[] } | null>(null);

  async function exportCsv() {
    const res = await fetch('/api/admin/export.csv', { headers: { 'x-admin-token': token } });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'kl-ai-quiz-results.csv'; a.click(); URL.revokeObjectURL(url);
  }
  async function openReview(a: Attempt) {
    const r = await api.get<{ review: ReviewItem[] }>(`/api/result/${a.attemptId}`);
    setReview({ name: `${a.name} (${a.registrationNumber})`, items: r.review });
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end"><button className="btn-ghost" disabled={!attempts.length} onClick={exportCsv}>⬇ Export CSV</button></div>
      {!attempts.length ? <div className="card text-sm text-slate-400">No attempts yet.</div> : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50"><tr>{['Reg. No', 'Name', 'Branch', 'Score', '%', 'Status', 'Submitted', ''].map((hh) => <th key={hh} className="px-3 py-2 text-left font-semibold text-slate-500">{hh}</th>)}</tr></thead>
            <tbody>
              {attempts.map((a) => (
                <tr key={a.attemptId} className={`border-b border-slate-50 ${a.status === 'terminated' ? 'bg-red-50/50' : ''}`}>
                  <td className="px-3 py-2 font-mono text-xs">{a.registrationNumber}</td>
                  <td className="px-3 py-2 font-medium">{a.name}</td>
                  <td className="px-3 py-2">{a.branch}</td>
                  <td className="px-3 py-2">{a.score == null ? '—' : `${a.score}/${a.total}`}</td>
                  <td className="px-3 py-2">{a.percentage == null ? '—' : `${a.percentage}%`}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${a.status === 'submitted' ? 'bg-green-100 text-green-700' : a.status === 'terminated' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{a.status}{a.reason ? ` · ${a.reason}` : ''}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">{a.submittedAt ? new Date(a.submittedAt).toLocaleString() : '—'}</td>
                  <td className="px-3 py-2">{a.status === 'submitted' && <button className="text-xs font-medium text-brand-700 hover:underline" onClick={() => openReview(a)}>Review</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {review && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={() => setReview(null)}>
          <div className="card max-h-[80vh] w-full max-w-2xl overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">{review.name}</h3><button className="btn-ghost" onClick={() => setReview(null)}>Close</button></div>
            <div className="space-y-2">
              {review.items.map((r, i) => (
                <div key={i} className="rounded-lg border border-slate-100 p-2 text-sm">
                  <p className="font-medium">{i + 1}. {r.question}</p>
                  <p className="text-xs text-slate-500">Correct: {String.fromCharCode(65 + r.correctIndex)} · Yours: {r.yourIndex == null ? '—' : String.fromCharCode(65 + r.yourIndex)} {r.correct ? '✅' : '❌'}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

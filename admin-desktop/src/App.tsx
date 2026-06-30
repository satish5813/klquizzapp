import { useEffect, useState } from 'react';
import { api, settings, Student, Attempt, QReport, ReviewItem } from './api';

type Tab = 'overview' | 'users' | 'bank' | 'results' | 'report';

export default function App() {
  const [connected, setConnected] = useState(false);
  const [base, setBase] = useState(settings.base());
  const [token, setToken] = useState(settings.token());
  const [appName, setAppName] = useState('KL AI QuizApp');
  const [connErr, setConnErr] = useState('');

  const [tab, setTab] = useState<Tab>('overview');
  const [error, setError] = useState('');
  const [bank, setBank] = useState<{ count: number; topics: string[] }>({ count: 0, topics: [] });
  const [students, setStudents] = useState<Student[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);

  async function loadAll() {
    setError('');
    try {
      const [b, s, a] = await Promise.all([
        api.get<{ count: number; topics: string[] }>('/api/admin/bank/stats'),
        api.get<Student[]>('/api/admin/students'),
        api.get<Attempt[]>('/api/admin/attempts'),
      ]);
      setBank(b); setStudents(s); setAttempts(a);
    } catch (e: any) { setError(e.message); }
  }

  async function connect() {
    setConnErr('');
    settings.save(base.trim().replace(/\/$/, ''), token.trim());
    try {
      const h = await api.get<{ app: string }>('/api/health', false);
      setAppName(h.app || 'KL AI QuizApp');
      await api.get('/api/admin/bank/stats'); // validates token
      setConnected(true);
      await loadAll();
    } catch (e: any) { setConnErr(e.message); }
  }

  if (!connected) {
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <div className="card w-full max-w-sm">
          <h1 className="text-lg font-semibold">KL AI Quiz — Admin</h1>
          <p className="mb-4 text-sm text-slate-500">Connect to your quiz server.</p>
          {connErr && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{connErr}</div>}
          <label className="label">Server URL</label>
          <input className="input mb-3" value={base} onChange={(e) => setBase(e.target.value)} placeholder="http://localhost:4000" />
          <label className="label">Admin token</label>
          <input className="input mb-4" type="password" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && connect()} placeholder="ADMIN_TOKEN" />
          <button className="btn-primary w-full" onClick={connect}>Connect</button>
          <p className="mt-3 text-xs text-slate-400">For students on other PCs, run the server on this machine and point them to its LAN IP.</p>
        </div>
      </div>
    );
  }

  const submitted = attempts.filter((a) => a.status === 'submitted').length;
  const terminated = attempts.filter((a) => a.status === 'terminated').length;
  const tabs: [Tab, string][] = [['overview', 'Overview'], ['users', 'User management'], ['bank', 'Question bank'], ['results', 'Results'], ['report', 'Question report']];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2 font-semibold">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">KL</span>
            {appName} — Admin
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>{settings.base()}</span>
            <button className="btn-ghost" onClick={loadAll}>Refresh</button>
            <button className="btn-ghost" onClick={() => setConnected(false)}>Disconnect</button>
          </div>
        </div>
        <nav className="flex gap-1 px-6">
          {tabs.map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-t-lg px-4 py-2 text-sm font-medium ${tab === k ? 'border-b-2 border-brand-600 text-brand-700' : 'text-slate-500 hover:text-slate-700'}`}>{label}</button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 p-6">
        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        {tab === 'overview' && (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Questions" value={bank.count} />
            <Stat label="Students" value={students.length} />
            <Stat label="Submitted" value={submitted} />
            <Stat label="Terminated" value={terminated} />
          </div>
        )}

        {tab === 'users' && <UsersTab students={students} attempts={attempts} onChanged={loadAll} setError={setError} />}
        {tab === 'bank' && <BankTab bank={bank} onChanged={loadAll} setError={setError} />}
        {tab === 'results' && <ResultsTab attempts={attempts} onChanged={loadAll} setError={setError} />}
        {tab === 'report' && <ReportTab setError={setError} />}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="card"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-3xl font-bold">{value}</p></div>;
}

function StatusBadge({ status, reason }: { status: string; reason?: string }) {
  const cls = status === 'submitted' ? 'bg-green-100 text-green-700' : status === 'terminated' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{status}{reason ? ` · ${reason}` : ''}</span>;
}

// Parse a roster from CSV or JSON into [{registrationNumber,name,branch,section}].
function parseRoster(text: string): { registrationNumber: string; name: string; branch: string; section: string }[] {
  const t = text.trim();
  if (t.startsWith('[')) {
    const arr = JSON.parse(t);
    return arr.map((s: any) => ({
      registrationNumber: String(s.registrationNumber ?? s.regNo ?? s.roll ?? s.rollNumber ?? '').trim(),
      name: String(s.name ?? '').trim(), branch: String(s.branch ?? '').trim(), section: String(s.section ?? '').trim(),
    }));
  }
  const lines = t.split(/\r?\n/).filter((l) => l.trim());
  const cells = (l: string) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
  const head = cells(lines[0]).map((h) => h.toLowerCase());
  const find = (...names: string[]) => head.findIndex((h) => names.includes(h));
  let iReg = find('registrationnumber', 'regno', 'roll', 'rollnumber', 'registration_number', 'registration number', 'reg. no', 'reg no');
  let iName = find('name', 'studentname', 'student name');
  let iBranch = find('branch'); let iSec = find('section', 'sec');
  let body = lines;
  if (iReg >= 0 || iName >= 0) body = lines.slice(1); // had a header row
  else { iReg = 0; iName = 1; iBranch = 2; iSec = 3; } // no header → assume column order
  return body.map((l) => { const c = cells(l); return { registrationNumber: c[iReg] || '', name: c[iName] || '', branch: iBranch >= 0 ? c[iBranch] || '' : '', section: iSec >= 0 ? c[iSec] || '' : '' }; });
}

// ---------------- User management (roster import + Reopen exam) ----------------
function UsersTab({ students, attempts, onChanged, setError }: { students: Student[]; attempts: Attempt[]; onChanged: () => void; setError: (s: string) => void }) {
  const byReg = new Map(attempts.map((a) => [a.registrationNumber, a]));
  const [rosterText, setRosterText] = useState('');
  const [msg, setMsg] = useState('');
  async function reopen(a: Attempt) {
    if (!window.confirm(`Reopen the exam for ${a.name} (${a.registrationNumber})?\n\nTheir current result will be cleared and they can take the exam again.`)) return;
    try { await api.post(`/api/admin/attempts/${a.attemptId}/reopen`); onChanged(); }
    catch (e: any) { setError(e.message); }
  }
  async function importRoster() {
    setMsg(''); setError('');
    let rows;
    try { rows = parseRoster(rosterText); } catch { setError('Could not parse — paste CSV (header row) or a JSON array.'); return; }
    rows = rows.filter((r) => r.registrationNumber && r.name);
    if (!rows.length) { setError('No valid rows (need at least registration number + name).'); return; }
    try {
      const r = await api.post<{ added: number; updated: number; total: number; skipped: number }>('/api/admin/students/import', { students: rows });
      setMsg(`Imported ${r.added} new, updated ${r.updated}, skipped ${r.skipped}. Roster total: ${r.total}.`);
      setRosterText(''); onChanged();
    } catch (e: any) { setError(e.message); }
  }
  return (
    <div className="space-y-4">
      <div className="card space-y-2">
        <h2 className="font-semibold">Import student roster</h2>
        <p className="text-xs text-slate-500">Paste <b>CSV</b> with a header row <code>registrationNumber,name,branch,section</code> (or a JSON array). Students log in with their registration number only. Re-importing updates existing rows.</p>
        <textarea className="input min-h-[120px] font-mono text-xs" value={rosterText} onChange={(e) => setRosterText(e.target.value)} placeholder={'registrationNumber,name,branch,section\n2100030001,Asha Rao,CSE1,A\n2100030002,Ravi Kumar,ECE,B'} />
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={!rosterText.trim()} onClick={importRoster}>Import roster</button>
          {msg && <span className="text-sm text-green-700">{msg}</span>}
        </div>
      </div>

      {!students.length ? <div className="card text-sm text-slate-400">No students in the roster yet — import above.</div> : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50"><tr>{['Reg. No', 'Name', 'Branch', 'Section', 'Attempt', 'Score', 'Action'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {students.map((s) => {
                const a = byReg.get(s.registrationNumber);
                return (
                  <tr key={s.id} className="border-b border-slate-50">
                    <td className="td font-mono text-xs">{s.registrationNumber}</td>
                    <td className="td font-medium">{s.name}</td>
                    <td className="td">{s.branch}</td>
                    <td className="td">{s.section || '—'}</td>
                    <td className="td">{a ? <StatusBadge status={a.status} reason={a.reason} /> : <span className="text-slate-400">none</span>}</td>
                    <td className="td">{a && a.score != null ? `${a.score}/${a.total}` : '—'}</td>
                    <td className="td">{a && a.status !== 'in_progress' ? <button className="btn-danger" onClick={() => reopen(a)}>Reopen exam</button> : <span className="text-xs text-slate-400">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------- Question bank (generate + import) ----------------
interface Job { status: string; collected: number; target: number; requests: number; error?: string; stats?: any; bankTotal?: number; }
function BankTab({ bank, onChanged, setError }: { bank: { count: number; topics: string[] }; onChanged: () => void; setError: (s: string) => void }) {
  const [syllabus, setSyllabus] = useState('');
  const [count, setCount] = useState('1000');
  const [replace, setReplace] = useState(false);
  const [est, setEst] = useState<any>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [importText, setImportText] = useState('');
  const [importMsg, setImportMsg] = useState('');

  async function estimate() { try { setEst(await api.post('/api/admin/estimate', { count: Number(count) })); } catch (e: any) { setError(e.message); } }
  async function generate() {
    setBusy(true); setJob(null); setError('');
    try {
      const { jobId } = await api.post<{ jobId: string }>('/api/admin/generate', { syllabus, count: Number(count), replace });
      const poll = async () => {
        const j = await api.get<Job>(`/api/admin/jobs/${jobId}`);
        setJob(j);
        if (j.status === 'running') setTimeout(poll, 1500); else { setBusy(false); onChanged(); }
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
      const r = await api.post<{ added: number; skipped: number; bankTotal: number }>('/api/admin/import', { questions, replace });
      setImportMsg(`Imported ${r.added}, skipped ${r.skipped}. Bank total: ${r.bankTotal}.`); setImportText(''); onChanged();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="space-y-4">
      <div className="card"><p className="text-sm text-slate-500">Question bank</p><p className="text-3xl font-bold">{bank.count}</p></div>

      <div className="card space-y-3">
        <h2 className="font-semibold">Generate from syllabus (Claude Haiku)</h2>
        <textarea className="input min-h-[110px]" value={syllabus} onChange={(e) => setSyllabus(e.target.value)} placeholder="Paste the syllabus / topics…" />
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
        <p className="text-xs text-slate-500">Array of <code>{`{"question","options":[4],"answerIndex"}`}</code>. You can use <code>"answer":"B"</code> or the option text instead of <code>answerIndex</code>; add <code>topic</code>, <code>difficulty</code>, <code>explanation</code> optionally.</p>
        <textarea className="input min-h-[110px] font-mono text-xs" value={importText} onChange={(e) => setImportText(e.target.value)} placeholder='[ { "question": "...", "options": ["...","...","...","..."], "answerIndex": 0 } ]' />
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

// ---------------- Results (table + review + CSV + reopen) ----------------
function ResultsTab({ attempts, onChanged, setError }: { attempts: Attempt[]; onChanged: () => void; setError: (s: string) => void }) {
  const [review, setReview] = useState<{ name: string; items: ReviewItem[] } | null>(null);
  async function exportCsv() {
    const res = await api.raw('/api/admin/export.csv');
    const blob = await res.blob(); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'kl-ai-quiz-results.csv'; a.click(); URL.revokeObjectURL(url);
  }
  async function openReview(a: Attempt) {
    try { const r = await api.get<{ review: ReviewItem[] }>(`/api/result/${a.attemptId}`, false); setReview({ name: `${a.name} (${a.registrationNumber})`, items: r.review }); }
    catch (e: any) { setError(e.message); }
  }
  async function reopen(a: Attempt) {
    if (!window.confirm(`Reopen the exam for ${a.name}? Their result will be cleared.`)) return;
    try { await api.post(`/api/admin/attempts/${a.attemptId}/reopen`); onChanged(); } catch (e: any) { setError(e.message); }
  }
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><button className="btn-ghost" disabled={!attempts.length} onClick={exportCsv}>⬇ Export CSV</button></div>
      {!attempts.length ? <div className="card text-sm text-slate-400">No attempts yet.</div> : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50"><tr>{['Reg. No', 'Name', 'Branch', 'Score', '%', 'Status', 'Submitted', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {attempts.map((a) => (
                <tr key={a.attemptId} className={`border-b border-slate-50 ${a.status === 'terminated' ? 'bg-red-50/50' : ''}`}>
                  <td className="td font-mono text-xs">{a.registrationNumber}</td>
                  <td className="td font-medium">{a.name}</td>
                  <td className="td">{a.branch}</td>
                  <td className="td">{a.score == null ? '—' : `${a.score}/${a.total}`}</td>
                  <td className="td">{a.percentage == null ? '—' : `${a.percentage}%`}</td>
                  <td className="td"><StatusBadge status={a.status} reason={a.reason} /></td>
                  <td className="td text-xs text-slate-500">{a.submittedAt ? new Date(a.submittedAt).toLocaleString() : '—'}</td>
                  <td className="td whitespace-nowrap">
                    {a.status === 'submitted' && <button className="mr-2 text-xs font-medium text-brand-700 hover:underline" onClick={() => openReview(a)}>Review</button>}
                    {a.status !== 'in_progress' && <button className="text-xs font-medium text-red-600 hover:underline" onClick={() => reopen(a)}>Reopen</button>}
                  </td>
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
                <div key={i} className={`rounded-lg border p-2 text-sm ${r.correct ? 'border-green-100 bg-green-50/40' : 'border-red-100 bg-red-50/40'}`}>
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

// ---------------- Question-wise report (item analysis) ----------------
function ReportTab({ setError }: { setError: (s: string) => void }) {
  const [data, setData] = useState<{ submittedAttempts: number; questions: QReport[] } | null>(null);
  useEffect(() => { api.get<{ submittedAttempts: number; questions: QReport[] }>('/api/admin/report/questions').then(setData).catch((e) => setError(e.message)); }, [setError]);
  if (!data) return <p className="text-sm text-slate-400">Loading report…</p>;
  function exportCsv() {
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Question', 'Topic', 'Difficulty', 'Answered', 'Correct', 'PercentCorrect'];
    const lines = data!.questions.map((q) => [q.question, q.topic, q.difficulty, q.answered, q.correct, q.pctCorrect ?? ''].map(esc).join(','));
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'kl-ai-question-report.csv'; a.click(); URL.revokeObjectURL(url);
  }
  const color = (p: number | null) => p == null ? 'text-slate-400' : p >= 70 ? 'text-green-700' : p >= 40 ? 'text-amber-600' : 'text-red-600';
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Item analysis across <b>{data.submittedAttempts}</b> submitted attempt(s) — how many got each question right.</p>
        <button className="btn-ghost" onClick={exportCsv}>⬇ Export CSV</button>
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 bg-slate-50"><tr>{['#', 'Question', 'Topic', 'Diff.', 'Answered', 'Correct', '% Correct'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>
            {data.questions.map((q, i) => (
              <tr key={q.id} className="border-b border-slate-50">
                <td className="td text-slate-400">{i + 1}</td>
                <td className="td max-w-md">{q.question}</td>
                <td className="td"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{q.topic}</span></td>
                <td className="td text-xs text-slate-500">{q.difficulty}</td>
                <td className="td">{q.answered}</td>
                <td className="td">{q.correct}</td>
                <td className={`td font-semibold ${color(q.pctCorrect)}`}>{q.pctCorrect == null ? '—' : `${q.pctCorrect}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { api, settings, Student, StudentsPage, Attempt, QReport, ReviewItem } from './api';
import { extractPdfText } from './pdf';

type Tab = 'overview' | 'users' | 'bank' | 'results' | 'report' | 'schedule';

export default function App() {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(!!settings.token());
  const [base, setBase] = useState(settings.base());
  const [token, setToken] = useState(settings.token());
  const [appName, setAppName] = useState('KL AI QuizApp');
  const [connErr, setConnErr] = useState('');

  const [tab, setTab] = useState<Tab>('overview');
  const [error, setError] = useState('');
  const [bank, setBank] = useState<{ count: number; topics: string[]; byDomain?: Record<string, number> }>({ count: 0, topics: [] });
  const [studentStats, setStudentStats] = useState({ total: 0, active: 0, inactive: 0 });
  const [attempts, setAttempts] = useState<Attempt[]>([]);

  async function loadAll() {
    setError('');
    try {
      const [b, sc, a] = await Promise.all([
        api.get<{ count: number; topics: string[]; byDomain?: Record<string, number> }>('/api/admin/bank/stats'),
        api.get<StudentsPage>('/api/admin/students?pageSize=1'),
        api.get<Attempt[]>('/api/admin/attempts'),
      ]);
      setBank(b);
      setStudentStats({ total: sc.allCount, active: sc.activeCount, inactive: sc.inactiveCount });
      setAttempts(a);
    } catch (e: any) { setError(e.message); }
  }

  async function connect() {
    setConnErr(''); setConnecting(true);
    settings.save(base.trim().replace(/\/$/, ''), token.trim());
    try {
      const h = await api.get<{ app: string }>('/api/health', false);
      setAppName(h.app || 'KL AI QuizApp');
      await api.get('/api/admin/bank/stats'); // validates token
      setConnected(true);
      await loadAll();
    } catch (e: any) { setConnErr(e.message); } finally { setConnecting(false); }
  }

  // Auto-connect on launch when a token is already configured (no prompt).
  useEffect(() => {
    if (settings.token()) connect(); else setConnecting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!connected) {
    if (connecting) {
      return (
        <div className="grid min-h-screen place-items-center p-6 text-center">
          <div>
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
            <p className="text-sm text-slate-500">Connecting to {settings.base()}…</p>
          </div>
        </div>
      );
    }
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <div className="card w-full max-w-sm">
          <h1 className="text-lg font-semibold">KL AI Quiz — Admin</h1>
          <p className="mb-4 text-sm text-slate-500">Connect to your quiz server.</p>
          {connErr && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{connErr}</div>}
          <label className="label">Server URL</label>
          <input className="input mb-3" value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://…sslip.io" />
          <label className="label">Admin token</label>
          <input className="input mb-4" type="password" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && connect()} placeholder="ADMIN_TOKEN" />
          <button className="btn-primary w-full" onClick={connect}>Connect</button>
          <p className="mt-3 text-xs text-slate-400">Defaults to the Hostinger API. Set <code>admin-desktop/.env</code> to skip this screen.</p>
        </div>
      </div>
    );
  }

  const submitted = attempts.filter((a) => a.status === 'submitted').length;
  const terminated = attempts.filter((a) => a.status === 'terminated').length;
  const tabs: [Tab, string][] = [['overview', 'Overview'], ['users', 'User management'], ['bank', 'Question bank'], ['schedule', 'Schedule'], ['results', 'Results'], ['report', 'Question report']];

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
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            <Stat label="Questions" value={bank.count} />
            <Stat label="Students" value={studentStats.total} />
            <Stat label="Active" value={studentStats.active} />
            <Stat label="Inactive" value={studentStats.inactive} />
            <Stat label="Submitted" value={submitted} />
            <Stat label="Terminated" value={terminated} />
          </div>
        )}

        {tab === 'users' && <UsersTab attempts={attempts} onChanged={loadAll} setError={setError} />}
        {tab === 'bank' && <BankTab bank={bank} onChanged={loadAll} setError={setError} />}
        {tab === 'schedule' && <ScheduleTab setError={setError} />}
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

// Parse a roster from CSV or JSON into [{registrationNumber,name,branch,section,domain}].
function parseRoster(text: string): { registrationNumber: string; name: string; branch: string; section: string; domain: string }[] {
  const t = text.trim();
  if (t.startsWith('[')) {
    const arr = JSON.parse(t);
    return arr.map((s: any) => ({
      registrationNumber: String(s.registrationNumber ?? s.regNo ?? s.roll ?? s.rollNumber ?? '').trim(),
      name: String(s.name ?? '').trim(), branch: String(s.branch ?? '').trim(), section: String(s.section ?? '').trim(),
      domain: String(s.domain ?? s.hackathonDomain ?? '').trim(),
    }));
  }
  const lines = t.split(/\r?\n/).filter((l) => l.trim());
  const cells = (l: string) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
  const head = cells(lines[0]).map((h) => h.toLowerCase());
  const find = (...names: string[]) => head.findIndex((h) => names.includes(h));
  let iReg = find('registrationnumber', 'regno', 'roll', 'rollnumber', 'registration_number', 'registration number', 'reg. no', 'reg no');
  let iName = find('name', 'studentname', 'student name');
  let iBranch = find('branch'); let iSec = find('section', 'sec');
  const iDom = find('domain', 'hackathon domain', 'hackathondomain');
  let body = lines;
  if (iReg >= 0 || iName >= 0) body = lines.slice(1); // had a header row
  else { iReg = 0; iName = 1; iBranch = 2; iSec = 3; } // no header → assume column order
  return body.map((l) => { const c = cells(l); return { registrationNumber: c[iReg] || '', name: c[iName] || '', branch: iBranch >= 0 ? c[iBranch] || '' : '', section: iSec >= 0 ? c[iSec] || '' : '', domain: iDom >= 0 ? c[iDom] || '' : '' }; });
}

// ---------------- User management (roster import + search/paginate + active + edit) ----------------
function UsersTab({ attempts, onChanged, setError }: { attempts: Attempt[]; onChanged: () => void; setError: (s: string) => void }) {
  const byReg = new Map(attempts.map((a) => [a.registrationNumber, a]));
  const [rosterText, setRosterText] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [msg, setMsg] = useState('');

  const [data, setData] = useState<StudentsPage | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<Student | null>(null);
  const pageSize = 25;

  async function load() {
    try { setData(await api.get<StudentsPage>(`/api/admin/students?search=${encodeURIComponent(query)}&status=${status}&page=${page}&pageSize=${pageSize}`)); }
    catch (e: any) { setError(e.message); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [query, status, page]);

  function doSearch() { setPage(1); setQuery(search.trim()); }
  async function refresh() { await load(); onChanged(); }

  async function toggleActive(s: Student) {
    try { await api.post(`/api/admin/students/${s.id}`, { active: s.active === false }); refresh(); }
    catch (e: any) { setError(e.message); }
  }
  async function saveEdit() {
    if (!edit) return;
    try { await api.post(`/api/admin/students/${edit.id}`, { name: edit.name, branch: edit.branch, section: edit.section, domain: edit.domain || '' }); setEdit(null); refresh(); }
    catch (e: any) { setError(e.message); }
  }
  async function reopen(a: Attempt) {
    if (!window.confirm(`Reopen the exam for ${a.name} (${a.registrationNumber})? Their result will be cleared.`)) return;
    try { await api.post(`/api/admin/attempts/${a.attemptId}/reopen`); refresh(); } catch (e: any) { setError(e.message); }
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
      setRosterText(''); refresh();
    } catch (e: any) { setError(e.message); }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      {/* roster import (collapsible) */}
      <div className="card space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Student roster {data && <span className="text-sm font-normal text-slate-400">· {data.allCount} total · {data.activeCount} active · {data.inactiveCount} inactive</span>}</h2>
          <button className="btn-ghost" onClick={() => setShowImport((v) => !v)}>{showImport ? 'Hide import' : 'Import roster (CSV/JSON)'}</button>
        </div>
        {showImport && (
          <>
            <p className="text-xs text-slate-500">Paste <b>CSV</b> with header <code>registrationNumber,name,branch,section</code> (or a JSON array). Re-importing updates existing rows.</p>
            <textarea className="input min-h-[110px] font-mono text-xs" value={rosterText} onChange={(e) => setRosterText(e.target.value)} placeholder={'registrationNumber,name,branch,section\n2100030001,Asha Rao,CSE1,A'} />
            <div className="flex items-center gap-3">
              <button className="btn-primary" disabled={!rosterText.trim()} onClick={importRoster}>Import roster</button>
              {msg && <span className="text-sm text-green-700">{msg}</span>}
            </div>
          </>
        )}
      </div>

      {/* search + filter */}
      <div className="card flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search reg. no, name, branch, section…" value={search}
          onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doSearch()} />
        <button className="btn-primary" onClick={doSearch}>Search</button>
        {query && <button className="btn-ghost" onClick={() => { setSearch(''); setQuery(''); setPage(1); }}>Clear</button>}
        <div className="ml-auto flex gap-1">
          {(['all', 'active', 'inactive'] as const).map((st) => (
            <button key={st} onClick={() => { setStatus(st); setPage(1); }}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize ${status === st ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{st}</button>
          ))}
        </div>
      </div>

      {/* table */}
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 bg-slate-50"><tr>{['Reg. No', 'Name', 'Branch', 'Section', 'Domain', 'Status', 'Attempt', 'Actions'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>
            {data?.rows.map((s) => {
              const a = byReg.get(s.registrationNumber);
              const active = s.active !== false;
              return (
                <tr key={s.id} className={`border-b border-slate-50 ${!active ? 'bg-slate-50/70 text-slate-400' : ''}`}>
                  <td className="td font-mono text-xs">{s.registrationNumber}</td>
                  <td className="td font-medium">{s.name}</td>
                  <td className="td">{s.branch}</td>
                  <td className="td">{s.section || '—'}</td>
                  <td className="td">{s.domain ? <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">{s.domain}</span> : <span className="text-slate-300">—</span>}</td>
                  <td className="td"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${active ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>{active ? 'active' : 'inactive'}</span></td>
                  <td className="td">{a ? <StatusBadge status={a.status} reason={a.reason} /> : <span className="text-slate-400">none</span>}</td>
                  <td className="td whitespace-nowrap">
                    <button className="mr-2 text-xs font-medium text-brand-700 hover:underline" onClick={() => setEdit({ ...s })}>Edit</button>
                    <button className="mr-2 text-xs font-medium text-slate-600 hover:underline" onClick={() => toggleActive(s)}>{active ? 'Deactivate' : 'Activate'}</button>
                    {a && a.status !== 'in_progress' && <button className="text-xs font-medium text-red-600 hover:underline" onClick={() => reopen(a)}>Reopen</button>}
                  </td>
                </tr>
              );
            })}
            {data && !data.rows.length && <tr><td className="td text-slate-400" colSpan={8}>No students match.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* pagination */}
      {data && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{data.total.toLocaleString()} student(s) · page {data.page} of {totalPages}</span>
          <div className="flex gap-2">
            <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
            <button className="btn-ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next →</button>
          </div>
        </div>
      )}

      {/* edit modal */}
      {edit && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={() => setEdit(null)}>
          <div className="card w-full max-w-sm space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between"><h3 className="font-semibold">Edit profile</h3><button className="btn-ghost" onClick={() => setEdit(null)}>Close</button></div>
            <p className="font-mono text-xs text-slate-400">{edit.registrationNumber}</p>
            <div><label className="label">Name</label><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Branch</label><input className="input" value={edit.branch} onChange={(e) => setEdit({ ...edit, branch: e.target.value })} /></div>
              <div><label className="label">Section</label><input className="input" value={edit.section || ''} onChange={(e) => setEdit({ ...edit, section: e.target.value })} /></div>
            </div>
            <div><label className="label">Hackathon Domain</label><input className="input" value={edit.domain || ''} onChange={(e) => setEdit({ ...edit, domain: e.target.value })} placeholder="e.g. Java Core / Python" /></div>
            <button className="btn-primary w-full" onClick={saveEdit}>Save changes</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Question bank (generate → preview → post + import) ----------------
interface GenQ { question: string; options: string[]; answerIndex: number; topic: string; difficulty: string; explanation?: string; }
interface Job { jobId?: string; status: string; collected: number; target: number; requests: number; error?: string; stats?: any; bankTotal?: number; questions?: GenQ[] }
function BankTab({ bank, onChanged, setError }: { bank: { count: number; topics: string[]; byDomain?: Record<string, number> }; onChanged: () => void; setError: (s: string) => void }) {
  const [syllabus, setSyllabus] = useState('');
  const [count, setCount] = useState('1000');
  const [replace, setReplace] = useState(false);
  const [domain, setDomain] = useState(localStorage.getItem('kl_gen_domain') || 'Java Core');
  const [est, setEst] = useState<any>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [pdfMsg, setPdfMsg] = useState('');
  const [importText, setImportText] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const [claudeKey, setClaudeKey] = useState(settings.claudeKey());
  const [keyMsg, setKeyMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const mcqFileRef = useRef<HTMLInputElement>(null);
  const mcqPdfRef = useRef<HTMLInputElement>(null);

  function saveKey() { settings.saveClaudeKey(claudeKey.trim()); setKeyMsg('Saved on this computer.'); setTimeout(() => setKeyMsg(''), 2500); }

  // Upload a PDF that already contains MCQs → Claude structures them (background job) → into the import box.
  async function onMcqPdf(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    if (mcqPdfRef.current) mcqPdfRef.current.value = '';
    if (!settings.claudeKey()) { setError('Save your Claude API key first (in the section above).'); return; }
    setError(''); setImportMsg('Reading PDF…');
    try {
      const text = await extractPdfText(f);
      if (text.trim().length < 20) { setError('No readable text found in that PDF (it may be scanned images).'); setImportMsg(''); return; }
      setImportMsg('Extracting MCQs with Claude…');
      const { jobId } = await api.post<{ jobId: string }>('/api/admin/parse-mcqs', { text, apiKey: settings.claudeKey() });
      const poll = async () => {
        const j = await api.get<{ status: string; chunk?: number; chunks?: number; found?: number; questions?: any[]; count?: number; error?: string }>(`/api/admin/jobs/${jobId}`);
        if (j.status === 'running') { setImportMsg(`Extracting with Claude… part ${j.chunk || 0}/${j.chunks || '?'} (${j.found || 0} found)`); setTimeout(poll, 1500); }
        else if (j.status === 'ready') { setImportText(JSON.stringify(j.questions || [], null, 2)); setImportMsg(`Extracted ${j.count} MCQ(s) from "${f.name}" — review below, then Import.`); }
        else { setError('Extract failed: ' + (j.error || 'unknown error')); setImportMsg(''); }
      };
      poll();
    } catch (err: any) { setError('Extract failed: ' + err.message); setImportMsg(''); }
  }

  // Upload an MCQ file (.json or .csv) into the import box.
  async function onMcqFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    setError(''); setImportMsg('');
    try {
      const raw = await f.text();
      if (f.name.toLowerCase().endsWith('.csv')) {
        const lines = raw.split(/\r?\n/).filter((l) => l.trim());
        const head = lines[0].split(',').map((h) => h.trim().toLowerCase());
        const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
        const iQ = col('question', 'q'); const iA = col('a', 'optiona', 'option1', 'opt1');
        const iB = col('b', 'optionb', 'option2', 'opt2'); const iC = col('c', 'optionc', 'option3', 'opt3');
        const iD = col('d', 'optiond', 'option4', 'opt4'); const iAns = col('answer', 'correct', 'ans', 'key');
        const cells = (l: string) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
        const arr = lines.slice(1).map((l) => { const c = cells(l); return { question: c[iQ], options: [c[iA], c[iB], c[iC], c[iD]], answer: c[iAns], topic: 'General' }; })
          .filter((x) => x.question && x.options.every(Boolean));
        setImportText(JSON.stringify(arr, null, 2));
        setImportMsg(`Loaded ${arr.length} MCQ(s) from CSV — review, then Import.`);
      } else {
        setImportText(raw.trim());
        setImportMsg(`Loaded "${f.name}" — review, then Import.`);
      }
    } catch (err: any) { setError('Could not read file: ' + err.message); }
    finally { if (mcqFileRef.current) mcqFileRef.current.value = ''; }
  }
  async function onPdf(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    setPdfMsg('Reading PDF…'); setError('');
    try { const text = await extractPdfText(f); setSyllabus(text); setPdfMsg(`Loaded "${f.name}" (${text.length.toLocaleString()} chars).`); }
    catch (err: any) { setError('Could not read PDF: ' + err.message); setPdfMsg(''); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  }
  async function estimate() { try { setEst(await api.post('/api/admin/estimate', { count: Number(count) })); } catch (e: any) { setError(e.message); } }
  async function generate() {
    if (!settings.claudeKey()) { setError('Enter and save your Claude API key first (below).'); return; }
    setBusy(true); setJob(null); setError('');
    try {
      const { jobId } = await api.post<{ jobId: string }>('/api/admin/generate', { syllabus, count: Number(count), replace, domain: domain.trim(), apiKey: settings.claudeKey() });
      const poll = async () => {
        const j = await api.get<Job>(`/api/admin/jobs/${jobId}`);
        setJob({ ...j, jobId });
        if (j.status === 'running') setTimeout(poll, 1500); else setBusy(false);
      };
      poll();
    } catch (e: any) { setError(e.message); setBusy(false); }
  }
  async function publish() {
    if (!job?.jobId) return;
    setBusy(true); setError('');
    try { const r = await api.post<{ added: number; bankTotal: number }>(`/api/admin/generate/${job.jobId}/publish`); setJob({ ...job, status: 'published', bankTotal: r.bankTotal, questions: undefined }); onChanged(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  async function discard() {
    if (!job?.jobId) { setJob(null); return; }
    try { await api.post(`/api/admin/generate/${job.jobId}/discard`); } catch { /* ignore */ }
    setJob(null);
  }
  async function importMcqs() {
    setImportMsg(''); setError('');
    let parsed: any;
    try { parsed = JSON.parse(importText); } catch { setError('Import must be valid JSON (an array of MCQs).'); return; }
    const questions = Array.isArray(parsed) ? parsed : parsed.questions;
    try {
      const r = await api.post<{ added: number; skipped: number; bankTotal: number }>('/api/admin/import', { questions, replace, domain: domain.trim() });
      setImportMsg(`Imported ${r.added}, skipped ${r.skipped}. Bank total: ${r.bankTotal}.`); setImportText(''); onChanged();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <p className="text-sm text-slate-500">Question bank</p>
        <p className="text-3xl font-bold">{bank.count}</p>
        {bank.byDomain && Object.keys(bank.byDomain).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Object.entries(bank.byDomain).map(([d, n]) => (
              <span key={d} className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">{d}: {n}</span>
            ))}
          </div>
        )}
      </div>

      {/* Domain — questions are tagged with this; each student gets their own domain's questions */}
      <div className="card space-y-2">
        <h2 className="font-semibold">Exam domain</h2>
        <p className="text-xs text-slate-500">Questions you generate / import below are tagged with this domain. A student only gets questions from <b>their</b> Hackathon Domain (e.g. <code>Java Core</code>, <code>Python</code>).</p>
        <input className="input max-w-xs" value={domain} onChange={(e) => { setDomain(e.target.value); localStorage.setItem('kl_gen_domain', e.target.value); }} placeholder="e.g. Java Core" list="domain-list" />
        <datalist id="domain-list">{Object.keys(bank.byDomain || {}).map((d) => <option key={d} value={d} />)}</datalist>
      </div>

      <div className="card space-y-2">
        <h2 className="font-semibold">Claude API key</h2>
        <p className="text-xs text-slate-500">Needed only to generate questions. Stored on <b>this computer</b> and sent to your server to call Claude — never shown to students. {settings.claudeKey() ? '✅ A key is currently saved.' : '⚠ No key saved yet.'}</p>
        <div className="flex items-center gap-2">
          <input className="input font-mono text-xs" type="password" value={claudeKey} onChange={(e) => setClaudeKey(e.target.value)} placeholder="sk-ant-..." />
          <button className="btn-primary" disabled={!claudeKey.trim()} onClick={saveKey}>Save key</button>
          {keyMsg && <span className="whitespace-nowrap text-sm text-green-700">{keyMsg}</span>}
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold">Generate from syllabus (Claude Haiku) <span className="ml-1 rounded bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">domain: {domain || '(none)'}</span></h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Paste the syllabus below, or</span>
          <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={onPdf} />
          <button className="btn-ghost" onClick={() => fileRef.current?.click()}>📄 Upload syllabus PDF</button>
          {pdfMsg && <span className="text-xs text-green-700">{pdfMsg}</span>}
        </div>
        <textarea className="input min-h-[110px]" value={syllabus} onChange={(e) => setSyllabus(e.target.value)} placeholder="Paste the syllabus / topics… (or upload a PDF above)" />
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-28"><label className="label">How many</label><input className="input" type="number" min={1} value={count} onChange={(e) => setCount(e.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace bank</label>
          <button className="btn-ghost" onClick={estimate}>Estimate cost</button>
          <button className="btn-primary" disabled={busy || syllabus.trim().length < 10} onClick={generate}>{busy ? 'Working…' : 'Generate'}</button>
        </div>
        {est && <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">~{est.requests} API calls · est. <b>${est.usd}</b> (≈ ₹{est.inr}). <span className="text-slate-400">{est.note}</span></div>}
        {job?.status === 'running' && <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">Generating… {job.collected}/{job.target} ({job.requests} calls)</div>}
        {job?.status === 'error' && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Error: {job.error}</div>}
        {job?.status === 'published' && <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">✅ Posted to the exam. Bank now {job.bankTotal} questions.</div>}
      </div>

      {/* PREVIEW → POST */}
      {job?.status === 'ready' && job.questions && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Preview — {job.questions.length} question(s) generated</h2>
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={discard}>Discard</button>
              <button className="btn-primary" disabled={busy} onClick={publish}>{busy ? 'Posting…' : `Post ${job.questions.length} to exam`}</button>
            </div>
          </div>
          <p className="text-xs text-slate-500">Nothing is saved until you click <b>Post</b>. Correct answer highlighted in green.</p>
          <div className="max-h-[420px] space-y-2 overflow-auto">
            {job.questions.map((q, i) => (
              <div key={i} className="rounded-lg border border-slate-100 p-2 text-sm">
                <p className="font-medium">{i + 1}. {q.question} <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{q.topic} · {q.difficulty}</span></p>
                <div className="mt-1 grid grid-cols-2 gap-1">
                  {q.options.map((o, oi) => (
                    <span key={oi} className={`rounded px-2 py-0.5 text-xs ${oi === q.answerIndex ? 'bg-green-100 font-semibold text-green-700' : 'bg-slate-50 text-slate-600'}`}>{String.fromCharCode(65 + oi)}. {o}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card space-y-3">
        <h2 className="font-semibold">Import ready-made MCQs <span className="ml-1 rounded bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">domain: {domain || '(none)'}</span></h2>
        <p className="text-xs text-slate-500">Upload a <b>.json</b> or <b>.csv</b> file, or paste below. JSON: array of <code>{`{"question","options":[4],"answerIndex"}`}</code> (or use <code>"answer":"B"</code>/option text). CSV header: <code>question,a,b,c,d,answer</code>.</p>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={mcqFileRef} type="file" accept=".json,.csv,text/csv,application/json" className="hidden" onChange={onMcqFile} />
          <button className="btn-ghost" onClick={() => mcqFileRef.current?.click()}>📎 Upload MCQ file (.json / .csv)</button>
          <input ref={mcqPdfRef} type="file" accept="application/pdf" className="hidden" onChange={onMcqPdf} />
          <button className="btn-ghost" onClick={() => mcqPdfRef.current?.click()}>📄 Upload model MCQ PDF (Claude extracts)</button>
        </div>
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
            <thead className="border-b border-slate-100 bg-slate-50"><tr>{['Reg. No', 'Name', 'Branch', 'Score', '%', 'Status', 'Warnings', 'Submitted', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {attempts.map((a) => (
                <tr key={a.attemptId} className={`border-b border-slate-50 ${a.status === 'terminated' ? 'bg-red-50/50' : ''}`}>
                  <td className="td font-mono text-xs">{a.registrationNumber}</td>
                  <td className="td font-medium">{a.name}</td>
                  <td className="td">{a.branch}</td>
                  <td className="td">{a.score == null ? '—' : `${a.score}/${a.total}`}</td>
                  <td className="td">{a.percentage == null ? '—' : `${a.percentage}%`}</td>
                  <td className="td"><StatusBadge status={a.status} reason={a.reason} /></td>
                  <td className="td">{a.violations ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">{a.violations}</span> : <span className="text-slate-300">0</span>}</td>
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

// ---------------- Exam schedule ----------------
const pad = (n: number) => String(n).padStart(2, '0');
const isoToLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
function ScheduleTab({ setError }: { setError: (s: string) => void }) {
  const [enabled, setEnabled] = useState(false);
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<{ enabled: boolean; startAt: string | null; endAt: string | null }>('/api/admin/schedule')
      .then((s) => { setEnabled(s.enabled); setStartAt(isoToLocalInput(s.startAt)); setEndAt(isoToLocalInput(s.endAt)); })
      .catch((e) => setError(e.message));
  }, [setError]);

  async function save() {
    setBusy(true); setMsg(''); setError('');
    try {
      const body = {
        enabled,
        startAt: enabled && startAt ? new Date(startAt).toISOString() : null,
        endAt: enabled && endAt ? new Date(endAt).toISOString() : null,
      };
      await api.post('/api/admin/schedule', body);
      setMsg('Schedule saved.'); setTimeout(() => setMsg(''), 2500);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="card max-w-xl space-y-4">
      <div>
        <h2 className="font-semibold">Exam schedule</h2>
        <p className="text-sm text-slate-500">Restrict when students can start the exam. When off, the exam is always open.</p>
      </div>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
        Enable scheduled window
      </label>
      <div className={`grid gap-3 sm:grid-cols-2 ${enabled ? '' : 'pointer-events-none opacity-50'}`}>
        <div><label className="label">Starts at</label><input type="datetime-local" className="input" value={startAt} onChange={(e) => setStartAt(e.target.value)} /></div>
        <div><label className="label">Ends at</label><input type="datetime-local" className="input" value={endAt} onChange={(e) => setEndAt(e.target.value)} /></div>
      </div>
      <p className="text-xs text-slate-400">Times use this computer's timezone. Students who already started may finish; new starts are blocked outside the window.</p>
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save schedule'}</button>
        {msg && <span className="text-sm text-green-700">{msg}</span>}
      </div>
    </div>
  );
}

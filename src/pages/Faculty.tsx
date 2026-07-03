import { useEffect, useRef, useState } from 'react';
import { api, FacultyResponse, FacAttendee } from '../api';

const STATUS: Record<string, { label: string; cls: string }> = {
  submitted: { label: 'Submitted', cls: 'bg-green-100 text-green-700' },
  in_progress: { label: 'Writing', cls: 'bg-blue-100 text-blue-700' },
  logged_in: { label: 'Logged in', cls: 'bg-amber-100 text-amber-700' },
  absent: { label: 'Absent', cls: 'bg-red-100 text-red-700' },
};

export default function Faculty() {
  const [empId, setEmpId] = useState(sessionStorage.getItem('kl_emp') || '');
  const [data, setData] = useState<FacultyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [auto, setAuto] = useState(true);
  const [updated, setUpdated] = useState('');
  const empRef = useRef(empId);

  async function load(id: string) {
    if (!id.trim()) return;
    setLoading(true); setError('');
    try {
      const r = await api.post<FacultyResponse>('/api/faculty/login', { empId: id.trim() });
      setData(r); empRef.current = id.trim(); sessionStorage.setItem('kl_emp', id.trim());
      setUpdated(new Date().toLocaleTimeString());
    } catch (e: any) { setError(e.message); setData(null); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (!auto || !data) return;
    const t = setInterval(() => load(empRef.current), 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, data]);

  function logout() { setData(null); sessionStorage.removeItem('kl_emp'); }

  function downloadCsv() {
    if (!data) return;
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Reg. No', 'Name', 'Branch', 'Section', 'Present', 'Status', 'Score', 'Total', 'Percentage', 'Started', 'Submitted'];
    const lines = data.students.map((s) => [s.registrationNumber, s.name, s.branch, s.section, s.present ? 'Present' : 'Absent', STATUS[s.status].label, s.score ?? '', s.total ?? '', s.percentage ?? '', s.startedAt || '', s.submittedAt || ''].map(esc).join(','));
    const csv = [head.join(','), ...lines].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `attendance-${data.faculty.section || data.faculty.empId}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  // ---- Login screen ----
  if (!data) {
    return (
      <div className="mx-auto max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-bold text-slate-800">Faculty Attendance</h1>
        <p className="mt-1 text-sm text-slate-500">Enter your Employee ID to view attendance for your section.</p>
        <form onSubmit={(e) => { e.preventDefault(); load(empId); }} className="mt-4 space-y-3">
          <input autoFocus value={empId} onChange={(e) => setEmpId(e.target.value)} placeholder="Employee ID (e.g. 7281)"
            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-base outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100" />
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button disabled={loading} className="w-full rounded-xl bg-teal-600 py-2.5 font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
            {loading ? 'Loading…' : 'View attendance'}
          </button>
        </form>
      </div>
    );
  }

  // ---- Attendance sheet ----
  const f = data.faculty, sm = data.summary;
  const filtered = data.students.filter((s: FacAttendee) => `${s.registrationNumber} ${s.name}`.toLowerCase().includes(q.toLowerCase()));
  const Card = ({ label, value, cls }: { label: string; value: number; cls?: string }) => (
    <div className={`rounded-xl bg-white p-3 text-center shadow-sm ring-1 ring-slate-100 ${cls || ''}`}>
      <div className="text-2xl font-extrabold text-slate-800">{value}</div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-r from-teal-700 to-emerald-600 px-5 py-4 text-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold">{f.name || 'Faculty'} · Section {f.section || '—'}</h1>
            <p className="text-sm text-teal-50/90">Emp ID {f.empId}{f.room ? ` · Room ${f.room}` : ''} · {f.total} students {updated && `· updated ${updated}`}</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto (15s)</label>
            <button onClick={() => load(empRef.current)} className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25">↻ Refresh</button>
            <button onClick={logout} className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25">Logout</button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Card label="Total" value={sm.total} />
        <Card label="Present" value={sm.present} />
        <Card label="Absent" value={sm.absent} />
        <Card label="Writing" value={sm.inProgress} />
        <Card label="Submitted" value={sm.submitted} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reg no / name"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-teal-500" />
        <button onClick={downloadCsv} className="rounded-lg bg-teal-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-teal-700">⬇ Download (CSV / Excel)</button>
      </div>

      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-slate-500">
            <tr>{['#', 'Reg. No', 'Name', 'Present', 'Status', 'Score'].map((h) => <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {filtered.map((s, i) => (
              <tr key={s.registrationNumber} className="border-b border-slate-50">
                <td className="px-3 py-1.5 text-slate-400">{i + 1}</td>
                <td className="px-3 py-1.5 font-mono text-[11px]">{s.registrationNumber}</td>
                <td className="px-3 py-1.5 font-medium text-slate-800">{s.name}</td>
                <td className="px-3 py-1.5">{s.present ? <span className="font-semibold text-green-600">✓</span> : <span className="font-semibold text-red-500">✗</span>}</td>
                <td className="px-3 py-1.5"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS[s.status].cls}`}>{STATUS[s.status].label}</span>{s.autoSubmitted && <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">auto</span>}</td>
                <td className="px-3 py-1.5">{s.score == null ? '—' : `${s.score}/${s.total} (${s.percentage}%)`}</td>
              </tr>
            ))}
            {!filtered.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-400">No students match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

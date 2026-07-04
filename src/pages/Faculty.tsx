import { useEffect, useRef, useState } from 'react';
import { api, FacultyResponse, FacAttendee } from '../api';

const STATUS: Record<string, { label: string; cls: string }> = {
  submitted: { label: 'Took exam', cls: 'bg-green-100 text-green-700' },
  in_progress: { label: 'Writing', cls: 'bg-blue-100 text-blue-700' },
  logged_in: { label: 'Logged in', cls: 'bg-amber-100 text-amber-700' },
  absent: { label: 'No exam', cls: 'bg-slate-100 text-slate-500' },
};

export default function Faculty() {
  const [empId, setEmpId] = useState(sessionStorage.getItem('kl_emp') || '');
  const [data, setData] = useState<FacultyResponse | null>(null);
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const empRef = useRef(empId);

  async function load(id: string) {
    if (!id.trim()) return;
    setLoading(true); setError('');
    try {
      const r = await api.post<FacultyResponse>('/api/faculty/login', { empId: id.trim() });
      setData(r); empRef.current = id.trim(); sessionStorage.setItem('kl_emp', id.trim());
      const init: Record<string, boolean> = {};
      // Default everyone to ABSENT (do NOT pre-fill from exam). Faculty marks Present manually.
      // If already posted, show the faculty's own submitted marks (locked).
      for (const s of r.students) init[s.registrationNumber] = r.attendance.posted && r.attendance.marks ? !!r.attendance.marks[s.registrationNumber] : false;
      setMarks(init);
    } catch (e: any) { setError(e.message); setData(null); }
    finally { setLoading(false); }
  }

  function logout() { setData(null); sessionStorage.removeItem('kl_emp'); }

  async function submit() {
    if (!data) return;
    const present = Object.values(marks).filter(Boolean).length;
    if (!window.confirm(`Submit attendance for Section ${data.faculty.section}?\n\nPresent: ${present}\nAbsent: ${data.faculty.total - present}\n\nThis can be submitted only ONCE and will be locked.`)) return;
    setSubmitting(true); setError('');
    try {
      const r = await api.post<{ postedAt: string }>('/api/faculty/attendance', { empId: empRef.current, marks });
      setMsg(`✓ Attendance submitted and locked at ${new Date(r.postedAt).toLocaleString()}.`);
      await load(empRef.current);
    } catch (e: any) { setError(e.message); } finally { setSubmitting(false); }
  }

  function downloadCsv() {
    if (!data) return;
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Reg. No', 'Name', 'Attendance', 'Took exam', 'Score'];
    const lines = data.students.map((s) => [s.registrationNumber, s.name, marks[s.registrationNumber] ? 'Present' : 'Absent', STATUS[s.status].label, s.score == null ? '' : `${s.score}/${s.total}`].map(esc).join(','));
    const url = URL.createObjectURL(new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `attendance-${data.faculty.section || data.faculty.empId}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  // ---- Login screen ----
  if (!data) {
    return (
      <div className="mx-auto max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-bold text-slate-800">Faculty Attendance</h1>
        <p className="mt-1 text-sm text-slate-500">Enter your Employee ID to mark and submit attendance for your section.</p>
        <form onSubmit={(e) => { e.preventDefault(); load(empId); }} className="mt-4 space-y-3">
          <input autoFocus value={empId} onChange={(e) => setEmpId(e.target.value)} placeholder="Employee ID (e.g. 7281)"
            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-base outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100" />
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button disabled={loading} className="w-full rounded-xl bg-teal-600 py-2.5 font-semibold text-white hover:bg-teal-700 disabled:opacity-50">{loading ? 'Loading…' : 'Open attendance'}</button>
        </form>
      </div>
    );
  }

  const f = data.faculty, att = data.attendance;
  const canMark = att.open && !att.posted;
  const present = Object.values(marks).filter(Boolean).length;
  const filtered = data.students.filter((s: FacAttendee) => `${s.registrationNumber} ${s.name}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-r from-teal-700 to-emerald-600 px-5 py-4 text-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold">{f.name || 'Faculty'} · Section {f.section || '—'}</h1>
            <p className="text-sm text-teal-50/90">Emp ID {f.empId}{f.room ? ` · Room ${f.room}` : ''} · {f.total} students</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => load(empRef.current)} className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25">↻ Refresh</button>
            <button onClick={logout} className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25">Logout</button>
          </div>
        </div>
      </div>

      {/* Attendance state banner */}
      {att.posted ? (
        <div className="rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-800 ring-1 ring-green-200">
          🔒 Attendance for <b>{att.session?.name}</b> already submitted{att.postedAt ? ` at ${new Date(att.postedAt).toLocaleString()}` : ''} — <b>locked</b>. Contact the coordinator to revoke if a change is needed.
        </div>
      ) : att.open ? (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 ring-1 ring-amber-200">
          ✍ Session <b>{att.session?.name}</b> is <b>OPEN</b>. Everyone starts <b>Absent</b> — tap a student to mark them <b>Present</b>, then submit. <b>Only once</b> per session — it locks after that.
        </div>
      ) : (
        <div className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-medium text-slate-600 ring-1 ring-slate-200">
          No attendance session is open right now. Please wait for the coordinator to start one.
        </div>
      )}
      {msg && <div className="rounded-xl bg-teal-50 px-4 py-2.5 text-sm font-semibold text-teal-700">{msg}</div>}
      {error && <div className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}

      {/* counts */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-white p-3 text-center shadow-sm ring-1 ring-slate-100"><div className="text-2xl font-extrabold text-slate-800">{f.total}</div><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Total</div></div>
        <div className="rounded-xl bg-white p-3 text-center shadow-sm ring-1 ring-green-100"><div className="text-2xl font-extrabold text-green-600">{present}</div><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Present</div></div>
        <div className="rounded-xl bg-white p-3 text-center shadow-sm ring-1 ring-red-100"><div className="text-2xl font-extrabold text-red-500">{f.total - present}</div><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Absent</div></div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reg no / name" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-teal-500" />
        <div className="flex gap-2">
          {canMark && <button onClick={() => { const all: Record<string, boolean> = {}; data.students.forEach((s) => (all[s.registrationNumber] = true)); setMarks(all); }} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-200">Mark all present</button>}
          <button onClick={downloadCsv} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-200">⬇ CSV</button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-slate-500"><tr>{['#', 'Reg. No', 'Name', 'Exam', 'Attendance'].map((h) => <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {filtered.map((s, i) => {
              const p = !!marks[s.registrationNumber];
              return (
                <tr key={s.registrationNumber} className="border-b border-slate-50">
                  <td className="px-3 py-1.5 text-slate-400">{i + 1}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px]">{s.registrationNumber}</td>
                  <td className="px-3 py-1.5 font-medium text-slate-800">{s.name}</td>
                  <td className="px-3 py-1.5"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS[s.status].cls}`}>{STATUS[s.status].label}</span></td>
                  <td className="px-3 py-1.5">
                    {canMark ? (
                      <button onClick={() => setMarks((m) => ({ ...m, [s.registrationNumber]: !m[s.registrationNumber] }))}
                        className={`rounded-lg px-3 py-1 text-xs font-bold ${p ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>{p ? 'PRESENT' : 'ABSENT'}</button>
                    ) : (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${p ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>{p ? 'Present' : 'Absent'}</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!filtered.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-400">No students match.</td></tr>}
          </tbody>
        </table>
      </div>

      {canMark && (
        <button onClick={submit} disabled={submitting} className="w-full rounded-xl bg-teal-600 py-3 text-base font-bold text-white shadow-sm hover:bg-teal-700 disabled:opacity-50">
          {submitting ? 'Submitting…' : `Submit attendance (${present} present / ${f.total - present} absent)`}
        </button>
      )}
    </div>
  );
}

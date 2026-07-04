import { useState } from 'react';
import { api, FacultyResponse, FacSession, FacAttendee } from '../api';

const EXAM: Record<string, { label: string; cls: string }> = {
  submitted: { label: 'Took exam', cls: 'bg-green-100 text-green-700' },
  in_progress: { label: 'Writing', cls: 'bg-blue-100 text-blue-700' },
  logged_in: { label: 'Logged in', cls: 'bg-amber-100 text-amber-700' },
  absent: { label: 'No exam', cls: 'bg-slate-100 text-slate-500' },
};

export default function Faculty() {
  const [empId, setEmpId] = useState(sessionStorage.getItem('kl_emp') || '');
  const [data, setData] = useState<FacultyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // modal: which session is open, and whether it's editable (mark) or read-only (view)
  const [modal, setModal] = useState<{ session: FacSession; edit: boolean } | null>(null);
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [q, setQ] = useState('');

  async function load(id: string) {
    if (!id.trim()) return;
    setLoading(true); setError('');
    try {
      const r = await api.post<FacultyResponse>('/api/faculty/login', { empId: id.trim() });
      setData(r); sessionStorage.setItem('kl_emp', id.trim());
    } catch (e: any) { setError(e.message); setData(null); }
    finally { setLoading(false); }
  }
  function logout() { setData(null); sessionStorage.removeItem('kl_emp'); }

  function openModal(session: FacSession) {
    const edit = session.open && !session.posted;
    const init: Record<string, boolean> = {};
    // Editable → everyone starts ABSENT. Read-only (posted) → show submitted marks.
    for (const s of (data?.students || [])) init[s.registrationNumber] = session.posted && session.marks ? !!session.marks[s.registrationNumber] : false;
    setMarks(init); setQ(''); setModal({ session, edit });
  }

  async function submit() {
    if (!modal) return;
    const present = Object.values(marks).filter(Boolean).length;
    if (!window.confirm(`Submit attendance for "${modal.session.name}"?\n\nPresent: ${present}\nAbsent: ${(data?.faculty.total || 0) - present}\n\nThis submits ONCE and locks.`)) return;
    setSubmitting(true); setError('');
    try {
      await api.post('/api/faculty/attendance', { empId: data!.faculty.empId, marks });
      setModal(null);
      await load(data!.faculty.empId);
    } catch (e: any) { setError(e.message); } finally { setSubmitting(false); }
  }

  // ---- Login screen ----
  if (!data) {
    return (
      <div className="mx-auto max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-bold text-slate-800">Faculty Attendance</h1>
        <p className="mt-1 text-sm text-slate-500">Enter your Employee ID to take attendance for your section.</p>
        <form onSubmit={(e) => { e.preventDefault(); load(empId); }} className="mt-4 space-y-3">
          <input autoFocus value={empId} onChange={(e) => setEmpId(e.target.value)} placeholder="Employee ID (e.g. 7281)"
            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-base outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100" />
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button disabled={loading} className="w-full rounded-xl bg-teal-600 py-2.5 font-semibold text-white hover:bg-teal-700 disabled:opacity-50">{loading ? 'Loading…' : 'Open'}</button>
        </form>
      </div>
    );
  }

  const f = data.faculty;
  const present = Object.values(marks).filter(Boolean).length;
  const filtered = (data.students || []).filter((s: FacAttendee) => `${s.registrationNumber} ${s.name}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-r from-teal-700 to-emerald-600 px-5 py-4 text-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold">{f.name || 'Faculty'} · Section {f.section || '—'}</h1>
            <p className="text-sm text-teal-50/90">Emp ID {f.empId}{f.room ? ` · Room ${f.room}` : ''} · {f.total} students</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => load(f.empId)} className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25">↻ Refresh</button>
            <button onClick={logout} className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25">Logout</button>
          </div>
        </div>
      </div>
      {error && <div className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}

      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Attendance sessions</p>
      {!data.sessions.length ? (
        <div className="rounded-2xl bg-white p-6 text-center text-sm text-slate-400 shadow-sm ring-1 ring-slate-200">No attendance session yet. The coordinator will start one.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.sessions.map((ss) => {
            const canMark = ss.open && !ss.posted;
            return (
              <button key={ss.id} onClick={() => openModal(ss)}
                className={`rounded-2xl p-4 text-left shadow-sm ring-1 transition hover:shadow-md ${ss.posted ? 'bg-green-50 ring-green-200' : canMark ? 'bg-amber-50 ring-amber-300 hover:ring-amber-400' : 'bg-slate-50 ring-slate-200'}`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800">{ss.name}</span>
                  {ss.posted ? <span className="text-lg" title="Submitted & locked">🔒</span> : canMark ? <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white">OPEN</span> : <span className="rounded-full bg-slate-300 px-2 py-0.5 text-[10px] font-bold text-white">CLOSED</span>}
                </div>
                {ss.posted ? (
                  <div className="mt-3">
                    <div className="flex gap-3 text-sm"><span className="font-bold text-green-600">{ss.present} present</span><span className="font-bold text-red-500">{ss.absent} absent</span></div>
                    <p className="mt-1 text-[11px] text-slate-400">Submitted {ss.postedAt ? new Date(ss.postedAt).toLocaleString() : ''} · tap to view</p>
                  </div>
                ) : canMark ? (
                  <p className="mt-3 text-sm font-semibold text-amber-700">Tap to take attendance →</p>
                ) : (
                  <p className="mt-3 text-sm text-slate-400">Not submitted · closed</p>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ---- Modal: mark (edit) or view (read-only) ---- */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-0 sm:items-center sm:p-4" onClick={() => setModal(null)}>
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <div>
                <h2 className="font-bold text-slate-800">{modal.session.name} {modal.edit ? '' : '🔒'}</h2>
                <p className="text-xs text-slate-500">{modal.edit ? 'Everyone starts Absent — tap to mark Present, then submit (once).' : `Locked · ${present} present / ${f.total - present} absent`}</p>
              </div>
              <button onClick={() => setModal(null)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-500 hover:bg-slate-100">Close ✕</button>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reg no / name" className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-teal-500" />
              {modal.edit && <button onClick={() => { const all: Record<string, boolean> = {}; data.students.forEach((s) => (all[s.registrationNumber] = true)); setMarks(all); }} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200">All present</button>}
              <span className="text-sm font-bold text-green-600">{present}</span><span className="text-xs text-slate-400">/ {f.total}</span>
            </div>

            <div className="flex-1 overflow-auto">
              <table className="w-full text-sm">
                <tbody>
                  {filtered.map((s, i) => {
                    const p = !!marks[s.registrationNumber];
                    return (
                      <tr key={s.registrationNumber} className="border-b border-slate-50">
                        <td className="px-4 py-2 text-slate-400">{i + 1}</td>
                        <td className="px-2 py-2"><div className="font-medium text-slate-800">{s.name}</div><div className="font-mono text-[11px] text-slate-400">{s.registrationNumber}</div></td>
                        <td className="px-2 py-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${EXAM[s.status].cls}`}>{EXAM[s.status].label}</span></td>
                        <td className="px-4 py-2 text-right">
                          {modal.edit ? (
                            <button onClick={() => setMarks((m) => ({ ...m, [s.registrationNumber]: !m[s.registrationNumber] }))}
                              className={`w-24 rounded-lg py-1.5 text-xs font-bold ${p ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>{p ? 'PRESENT' : 'ABSENT'}</button>
                          ) : (
                            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${p ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>{p ? 'Present' : 'Absent'}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {modal.edit && (
              <div className="border-t border-slate-100 p-4">
                <button onClick={submit} disabled={submitting} className="w-full rounded-xl bg-teal-600 py-3 text-base font-bold text-white shadow-sm hover:bg-teal-700 disabled:opacity-50">
                  {submitting ? 'Submitting…' : `Submit & lock (${present} present / ${f.total - present} absent)`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

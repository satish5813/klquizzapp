import { useMemo, useState } from 'react';
import { api, FacultyReview, ReviewBatch } from '../api';

type Marks = Record<string, { present: boolean; scores: Record<string, number> }>;

export default function Review() {
  const [empId, setEmpId] = useState(sessionStorage.getItem('kl_emp') || '');
  const [data, setData] = useState<FacultyReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [batch, setBatch] = useState<ReviewBatch | null>(null);
  const [marks, setMarks] = useState<Marks>({});
  const [crit, setCrit] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  async function load(id: string) {
    if (!id.trim()) return;
    setLoading(true); setError('');
    try {
      const r = await api.post<FacultyReview>('/api/faculty/review', { empId: id.trim() });
      setData(r); sessionStorage.setItem('kl_emp', id.trim());
    } catch (e: any) { setError(e.message); setData(null); }
    finally { setLoading(false); }
  }
  function logout() { setData(null); sessionStorage.removeItem('kl_emp'); }

  // flatten rubric criteria into a single ordered list for the dropdown
  const flat = useMemo(() => {
    const out: { key: string; table: string; label: string }[] = [];
    (data?.rubric.tables || []).forEach((t, ti) => t.criteria.forEach((c, ci) => out.push({ key: `t${ti}_c${ci}`, table: t.name, label: c })));
    return out;
  }, [data]);

  function openBatch(b: ReviewBatch) {
    const m: Marks = {};
    for (const row of b.rows) m[row.reg] = { present: row.present, scores: { ...row.scores } };
    setMarks(m); setCrit(0); setBatch(b); setMsg('');
  }
  const maxLevel = Math.max(0, ...((data?.rubric.levels.length ? data.rubric.levels : [0])));
  const total = (reg: string) => Object.values(marks[reg]?.scores || {}).reduce((n, v) => n + (Number(v) || 0), 0);
  const pctOf = (reg: string) => { const n = Object.keys(marks[reg]?.scores || {}).length; return n && maxLevel ? Math.round((total(reg) / (n * maxLevel)) * 100) : 0; };
  const grade = (p: number) => (p >= 85 ? 'Outstanding' : p >= 70 ? 'Good' : p >= 50 ? 'Average' : 'Needs work');
  const gradeCls = (p: number) => (p >= 85 ? 'text-emerald-600' : p >= 70 ? 'text-indigo-600' : p >= 50 ? 'text-amber-600' : 'text-red-500');
  const filledFor = (key: string) => batch ? batch.members.filter((m) => marks[m.reg]?.present && marks[m.reg]?.scores[key] != null).length : 0;

  async function submit() {
    if (!data?.review || !batch) return;
    const rows = batch.members.map((m) => ({ reg: m.reg, present: !!marks[m.reg]?.present, scores: marks[m.reg]?.scores || {} }));
    setSubmitting(true); setError('');
    try {
      await api.post('/api/faculty/review/submit', { empId: data.faculty.empId, reviewId: data.review.id, batchId: batch.id, rows });
      setMsg(`✓ Saved marks for Batch ${batch.batchNo}.`); setBatch(null);
      await load(data.faculty.empId);
    } catch (e: any) { setError(e.message); } finally { setSubmitting(false); }
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-bold text-slate-800">Hackathon Review</h1>
        <p className="mt-1 text-sm text-slate-500">Enter your Employee ID to review your batches.</p>
        <form onSubmit={(e) => { e.preventDefault(); load(empId); }} className="mt-4 space-y-3">
          <input autoFocus value={empId} onChange={(e) => setEmpId(e.target.value)} placeholder="Employee ID"
            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-base outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button disabled={loading} className="w-full rounded-xl bg-indigo-600 py-2.5 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">{loading ? 'Loading…' : 'Open'}</button>
        </form>
      </div>
    );
  }

  const f = data.faculty, rev = data.review;
  const c = flat[crit];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-r from-indigo-700 to-violet-600 px-5 py-4 text-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold">{f.name || 'Faculty'} · Section {f.section || '—'}</h1>
            <p className="text-sm text-indigo-50/90">Emp {f.empId}{f.room ? ` · Room ${f.room}` : ''} · {f.batches} batches · {rev ? <b>{rev.name} (open)</b> : 'no review open'}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => load(f.empId)} className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25">↻ Refresh</button>
            <button onClick={logout} className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25">Logout</button>
          </div>
        </div>
      </div>
      {msg && <div className="rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700">{msg}</div>}
      {error && <div className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}
      {!rev && <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">No review is open right now. Marking opens when the coordinator starts a review.</div>}

      {!data.batches.length ? (
        <div className="rounded-2xl bg-white p-6 text-center text-sm text-slate-400 shadow-sm ring-1 ring-slate-200">No batches assigned to your Employee ID yet.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.batches.map((b) => {
            const done = b.rows.filter((r) => r.total > 0 || r.present === false).length;
            return (
              <button key={b.id} onClick={() => openBatch(b)} disabled={!rev}
                className={`rounded-2xl p-4 text-left shadow-sm ring-1 transition hover:shadow-md disabled:opacity-60 ${b.submitted ? 'bg-emerald-50 ring-emerald-200' : 'bg-white ring-slate-200'}`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800">Batch {b.batchNo || '—'}</span>
                  {b.submitted ? <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white">SCORED {done}/{b.members.length}</span> : rev ? <span className="rounded-full bg-indigo-500 px-2 py-0.5 text-[10px] font-bold text-white">TAP TO MARK</span> : null}
                </div>
                <p className="mt-1 line-clamp-2 text-sm font-medium text-slate-700">{b.project || '(no title)'}</p>
                <p className="mt-1 text-xs text-slate-400">{b.ps ? `${b.ps} · ` : ''}{b.members.length} members</p>
                {b.submitted && <div className="mt-2 flex flex-wrap gap-1">{b.rows.filter((r) => r.present).map((r) => <span key={r.reg} className={`rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold ${r.percentage != null ? gradeCls(r.percentage) : ''}`}>{r.name.split(' ')[0]} {r.total}</span>)}</div>}
              </button>
            );
          })}
        </div>
      )}

      {/* marking modal — professional table */}
      {batch && rev && c && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-0 sm:items-center sm:p-4" onClick={() => setBatch(null)}>
          <div className="flex max-h-[95vh] w-full max-w-4xl flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <div>
                <h2 className="font-bold text-slate-800">Batch {batch.batchNo} · {rev.name}</h2>
                <p className="text-xs text-slate-500">{batch.project}{batch.ps ? ` (${batch.ps})` : ''} · {batch.members.length} members</p>
              </div>
              <button onClick={() => setBatch(null)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-500 hover:bg-slate-100">Close ✕</button>
            </div>

            {/* criterion selector */}
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-5 py-3">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Rubric criterion</span>
              <select value={crit} onChange={(e) => setCrit(Number(e.target.value))} className="min-w-[16rem] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-indigo-500">
                {flat.map((x, i) => <option key={x.key} value={i}>{x.table} › {x.label} {filledFor(x.key) === batch.members.filter((m) => marks[m.reg]?.present).length && filledFor(x.key) > 0 ? '✓' : ''}</option>)}
              </select>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-200">{crit + 1} / {flat.length}</span>
            </div>

            {/* students × level table */}
            <div className="flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white shadow-sm">
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="px-3 py-2 text-left font-semibold">Reg No</th>
                    <th className="px-2 py-2 text-left font-semibold">Name</th>
                    <th className="px-2 py-2 text-center font-semibold">Present</th>
                    {data.rubric.levels.map((lv) => <th key={lv} className="px-2 py-2 text-center font-bold text-indigo-600">{lv}</th>)}
                    <th className="px-3 py-2 text-right font-semibold">Total</th>
                    <th className="px-3 py-2 text-right font-semibold">Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.members.map((m) => {
                    const pm = marks[m.reg] || { present: true, scores: {} };
                    const t = total(m.reg); const p = pctOf(m.reg);
                    return (
                      <tr key={m.reg} className={`border-b border-slate-50 ${!pm.present ? 'bg-red-50/50' : ''}`}>
                        <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{m.reg}</td>
                        <td className="px-2 py-2 font-medium text-slate-800">{m.name}</td>
                        <td className="px-2 py-2 text-center">
                          <input type="checkbox" checked={pm.present} onChange={() => setMarks((x) => ({ ...x, [m.reg]: { ...pm, present: !pm.present } }))} className="h-4 w-4 accent-indigo-600" />
                        </td>
                        {data.rubric.levels.map((lv) => (
                          <td key={lv} className="px-2 py-2 text-center">
                            <input type="radio" disabled={!pm.present} name={`${m.reg}_${c.key}`} checked={pm.scores[c.key] === lv}
                              onChange={() => setMarks((x) => { const cur = x[m.reg] || { present: true, scores: {} }; return { ...x, [m.reg]: { ...cur, scores: { ...cur.scores, [c.key]: lv } } }; })}
                              className="h-4 w-4 accent-indigo-600 disabled:opacity-30" />
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right font-bold text-slate-800">{pm.present ? t : '—'}</td>
                        <td className={`px-3 py-2 text-right text-xs font-bold ${pm.present ? gradeCls(p) : 'text-slate-300'}`}>{pm.present ? `${p}% ${grade(p)}` : 'Absent'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-2 border-t border-slate-100 p-4">
              <button onClick={() => setCrit((i) => Math.max(0, i - 1))} disabled={crit === 0} className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-40">← Prev</button>
              <button onClick={() => setCrit((i) => Math.min(flat.length - 1, i + 1))} disabled={crit === flat.length - 1} className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-40">Next →</button>
              <button onClick={submit} disabled={submitting} className="ml-auto rounded-lg bg-indigo-600 px-6 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">{submitting ? 'Saving…' : 'Save all marks'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

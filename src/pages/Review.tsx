import { useMemo, useState } from 'react';
import { api, FacultyReview, ReviewBatch } from '../api';

type Marks = Record<string, { present: boolean; scores: Record<string, number> }>;

export default function Review() {
  const [empId, setEmpId] = useState(sessionStorage.getItem('kl_emp') || '');
  const [data, setData] = useState<FacultyReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [sel, setSel] = useState<ReviewBatch | null>(null);
  const [marks, setMarks] = useState<Marks>({});
  const [crit, setCrit] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  async function load(id: string) {
    if (!id.trim()) return;
    setLoading(true); setError('');
    try {
      const r = await api.post<FacultyReview>('/api/faculty/review', { empId: id.trim() });
      setData(r); sessionStorage.setItem('kl_emp', id.trim());
      if (sel) { const fresh = r.batches.find((b) => b.id === sel.id); if (fresh) openBatch(fresh); }
    } catch (e: any) { setError(e.message); setData(null); }
    finally { setLoading(false); }
  }
  function logout() { setData(null); setSel(null); sessionStorage.removeItem('kl_emp'); }

  const flat = useMemo(() => {
    const out: { key: string; table: string; label: string }[] = [];
    (data?.rubric.tables || []).forEach((t, ti) => t.criteria.forEach((c, ci) => out.push({ key: `t${ti}_c${ci}`, table: t.name, label: c })));
    return out;
  }, [data]);

  function openBatch(b: ReviewBatch) {
    const m: Marks = {};
    for (const row of b.rows) m[row.reg] = { present: row.present, scores: { ...row.scores } };
    setMarks(m); setCrit(0); setSel(b); setMsg('');
  }
  const maxLevel = Math.max(0, ...((data?.rubric.levels.length ? data.rubric.levels : [0])));
  const total = (reg: string) => Object.values(marks[reg]?.scores || {}).reduce((n, v) => n + (Number(v) || 0), 0);
  const pctOf = (reg: string) => { const n = Object.keys(marks[reg]?.scores || {}).length; return n && maxLevel ? Math.round((total(reg) / (n * maxLevel)) * 100) : 0; };
  const grade = (p: number) => (p >= 85 ? 'Outstanding' : p >= 70 ? 'Good' : p >= 50 ? 'Average' : 'Needs work');
  const gradeCls = (p: number) => (p >= 85 ? 'text-emerald-600' : p >= 70 ? 'text-indigo-600' : p >= 50 ? 'text-amber-600' : 'text-red-500');

  async function submit() {
    if (!data?.review || !sel) return;
    const rows = sel.members.map((m) => ({ reg: m.reg, present: !!marks[m.reg]?.present, scores: marks[m.reg]?.scores || {} }));
    setSubmitting(true); setError('');
    try {
      await api.post('/api/faculty/review/submit', { empId: data.faculty.empId, reviewId: data.review.id, batchId: sel.id, rows });
      setMsg(`✓ Saved marks for Batch ${sel.batchNo}.`);
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

  const f = data.faculty, rev = data.review, c = flat[crit];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-r from-indigo-700 to-violet-600 px-5 py-4 text-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold">{f.name || 'Faculty'} · Section {f.section || '—'}</h1>
            <p className="text-sm text-indigo-50/90">Emp {f.empId}{f.room ? ` · Room ${f.room}` : ''} · {f.batches} batches</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-sm font-semibold ${rev ? 'bg-white/20' : 'bg-white/10 text-indigo-100'}`}>{rev ? `● ${rev.name} — OPEN` : '○ No review open'}</span>
            <button onClick={() => load(f.empId)} className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25">↻</button>
            <button onClick={logout} className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25">Logout</button>
          </div>
        </div>
      </div>
      {msg && <div className="rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700">{msg}</div>}
      {error && <div className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}
      {!rev && <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">No review is open. You can see your batches, but marking opens when the coordinator starts a review.</div>}

      {!data.batches.length ? (
        <div className="rounded-2xl bg-white p-6 text-center text-sm text-slate-400 shadow-sm ring-1 ring-slate-200">No batches are assigned to your Employee ID yet. Please contact the coordinator.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[260px_1fr]">
          {/* LEFT: batch list */}
          <div className="space-y-2">
            <p className="px-1 text-xs font-bold uppercase tracking-wide text-slate-400">Batches ({data.batches.length})</p>
            {data.batches.map((b) => {
              const active = sel?.id === b.id;
              return (
                <button key={b.id} onClick={() => openBatch(b)}
                  className={`w-full rounded-xl p-3 text-left ring-1 transition ${active ? 'bg-indigo-600 text-white ring-indigo-600' : b.submitted ? 'bg-emerald-50 ring-emerald-200 hover:ring-emerald-300' : 'bg-white ring-slate-200 hover:ring-indigo-300'}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold">Batch {b.batchNo || '—'}</span>
                    {b.submitted && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? 'bg-white/25' : 'bg-emerald-500 text-white'}`}>✓</span>}
                  </div>
                  <p className={`mt-0.5 line-clamp-1 text-xs ${active ? 'text-indigo-100' : 'text-slate-500'}`}>{b.project || '(no title)'}</p>
                  <p className={`text-[11px] ${active ? 'text-indigo-200' : 'text-slate-400'}`}>{b.members.length} members</p>
                </button>
              );
            })}
          </div>

          {/* RIGHT: marking panel */}
          <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            {!sel ? (
              <div className="grid h-full min-h-[300px] place-items-center p-8 text-center text-sm text-slate-400">← Select a batch from the left to open it{rev ? ' and mark students.' : '.'}</div>
            ) : (
              <div className="flex max-h-[75vh] flex-col">
                <div className="border-b border-slate-100 px-4 py-3">
                  <h2 className="font-bold text-slate-800">Batch {sel.batchNo}{rev ? ` · ${rev.name}` : ''}</h2>
                  <p className="text-xs text-slate-500">{sel.project}{sel.ps ? ` (${sel.ps})` : ''} · {sel.members.length} members</p>
                </div>

                {rev && c && (
                  <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2">
                    <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Criterion</span>
                    <select value={crit} onChange={(e) => setCrit(Number(e.target.value))} className="min-w-[14rem] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 outline-none focus:border-indigo-500">
                      {flat.map((x, i) => <option key={x.key} value={i}>{x.table} › {x.label}</option>)}
                    </select>
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-200">{crit + 1}/{flat.length}</span>
                  </div>
                )}

                <div className="flex-1 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-white shadow-sm">
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="px-3 py-2 text-left font-semibold">Reg No</th>
                        <th className="px-2 py-2 text-left font-semibold">Name</th>
                        <th className="px-2 py-2 text-center font-semibold">Pres</th>
                        {rev && data.rubric.levels.map((lv) => <th key={lv} className="px-2 py-2 text-center font-bold text-indigo-600">{lv}</th>)}
                        <th className="px-3 py-2 text-right font-semibold">Total</th>
                        <th className="px-3 py-2 text-right font-semibold">Grade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sel.members.map((m) => {
                        const pm = marks[m.reg] || { present: true, scores: {} };
                        const t = total(m.reg); const p = pctOf(m.reg);
                        return (
                          <tr key={m.reg} className={`border-b border-slate-50 ${!pm.present ? 'bg-red-50/50' : ''}`}>
                            <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{m.reg}</td>
                            <td className="px-2 py-2 font-medium text-slate-800">{m.name}</td>
                            <td className="px-2 py-2 text-center"><input type="checkbox" disabled={!rev} checked={pm.present} onChange={() => setMarks((x) => ({ ...x, [m.reg]: { ...pm, present: !pm.present } }))} className="h-4 w-4 accent-indigo-600" /></td>
                            {rev && c && data.rubric.levels.map((lv) => (
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

                {rev && (
                  <div className="flex items-center gap-2 border-t border-slate-100 p-3">
                    <button onClick={() => setCrit((i) => Math.max(0, i - 1))} disabled={crit === 0} className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-40">← Prev</button>
                    <button onClick={() => setCrit((i) => Math.min(flat.length - 1, i + 1))} disabled={crit === flat.length - 1} className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-40">Next →</button>
                    <button onClick={submit} disabled={submitting} className="ml-auto rounded-lg bg-indigo-600 px-6 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">{submitting ? 'Saving…' : 'Save all marks'}</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
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

  function openBatch(b: ReviewBatch) {
    const m: Marks = {};
    for (const row of b.rows) m[row.reg] = { present: row.present, scores: { ...row.scores } };
    setMarks(m); setBatch(b); setMsg('');
  }

  const key = (ti: number, ci: number) => `t${ti}_c${ci}`;
  function studentTotal(reg: string) { return Object.values(marks[reg]?.scores || {}).reduce((n, v) => n + (Number(v) || 0), 0); }

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

  // ---- login ----
  if (!data) {
    return (
      <div className="mx-auto max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-bold text-slate-800">Hackathon Review</h1>
        <p className="mt-1 text-sm text-slate-500">Enter your Employee ID to review your batches.</p>
        <form onSubmit={(e) => { e.preventDefault(); load(empId); }} className="mt-4 space-y-3">
          <input autoFocus value={empId} onChange={(e) => setEmpId(e.target.value)} placeholder="Employee ID"
            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-base outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100" />
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button disabled={loading} className="w-full rounded-xl bg-teal-600 py-2.5 font-semibold text-white hover:bg-teal-700 disabled:opacity-50">{loading ? 'Loading…' : 'Open'}</button>
        </form>
      </div>
    );
  }

  const f = data.faculty, rev = data.review, rubric = data.rubric;

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
      {!rev && <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">No review is open right now. You can see your batches, but marking opens when the coordinator starts a review.</div>}

      {!data.batches.length ? (
        <div className="rounded-2xl bg-white p-6 text-center text-sm text-slate-400 shadow-sm ring-1 ring-slate-200">No batches assigned to your Employee ID yet.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.batches.map((b) => (
            <button key={b.id} onClick={() => openBatch(b)} disabled={!rev}
              className={`rounded-2xl p-4 text-left shadow-sm ring-1 transition hover:shadow-md disabled:opacity-60 ${b.submitted ? 'bg-emerald-50 ring-emerald-200' : 'bg-white ring-slate-200'}`}>
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-800">Batch {b.batchNo || '—'}</span>
                {b.submitted ? <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white">SCORED</span> : rev ? <span className="rounded-full bg-indigo-500 px-2 py-0.5 text-[10px] font-bold text-white">TAP TO MARK</span> : null}
              </div>
              <p className="mt-1 line-clamp-2 text-sm font-medium text-slate-700">{b.project || '(no title)'}</p>
              <p className="mt-1 text-xs text-slate-400">{b.ps ? `${b.ps} · ` : ''}{b.members.length} members</p>
            </button>
          ))}
        </div>
      )}

      {/* marking modal */}
      {batch && rev && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-0 sm:items-center sm:p-4" onClick={() => setBatch(null)}>
          <div className="flex max-h-[94vh] w-full max-w-3xl flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <div>
                <h2 className="font-bold text-slate-800">Batch {batch.batchNo} · {rev.name}</h2>
                <p className="text-xs text-slate-500">{batch.project}{batch.ps ? ` (${batch.ps})` : ''}</p>
              </div>
              <button onClick={() => setBatch(null)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-500 hover:bg-slate-100">Close ✕</button>
            </div>

            <div className="flex-1 space-y-4 overflow-auto p-4">
              {batch.members.map((m) => {
                const pm = marks[m.reg] || { present: true, scores: {} };
                return (
                  <div key={m.reg} className="rounded-xl border border-slate-200 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div><span className="font-semibold text-slate-800">{m.name}</span> <span className="font-mono text-[11px] text-slate-400">{m.reg}</span></div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-indigo-600">Total {studentTotal(m.reg)}</span>
                        <button onClick={() => setMarks((x) => ({ ...x, [m.reg]: { ...pm, present: !pm.present } }))}
                          className={`rounded-lg px-3 py-1 text-xs font-bold ${pm.present ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>{pm.present ? 'PRESENT' : 'ABSENT'}</button>
                      </div>
                    </div>
                    {pm.present && (
                      <div className="grid gap-3 md:grid-cols-3">
                        {rubric.tables.map((t, ti) => (
                          <div key={ti} className="rounded-lg bg-slate-50 p-2">
                            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{t.name}</p>
                            {t.criteria.map((c, ci) => (
                              <div key={ci} className="mb-1 flex items-center justify-between gap-2">
                                <span className="flex-1 truncate text-[11px] text-slate-600" title={c}>{c}</span>
                                <select value={pm.scores[key(ti, ci)] ?? ''} onChange={(e) => setMarks((x) => { const cur = x[m.reg] || { present: true, scores: {} }; const scores = { ...cur.scores }; const v = e.target.value; if (v === '') delete scores[key(ti, ci)]; else scores[key(ti, ci)] = Number(v); return { ...x, [m.reg]: { ...cur, scores } }; })}
                                  className="w-14 rounded border border-slate-300 px-1 py-0.5 text-xs outline-none focus:border-indigo-500">
                                  <option value="">–</option>
                                  {rubric.levels.map((lv) => <option key={lv} value={lv}>{lv}</option>)}
                                </select>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="border-t border-slate-100 p-4">
              <button onClick={submit} disabled={submitting} className="w-full rounded-xl bg-indigo-600 py-3 text-base font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">
                {submitting ? 'Saving…' : `Save marks for Batch ${batch.batchNo}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

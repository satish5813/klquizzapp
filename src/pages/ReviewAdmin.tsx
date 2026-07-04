import { useEffect, useRef, useState } from 'react';
import { api, ReviewScores, ReviewInfo, Rubric, AdminBatch, ScoreRow } from '../api';

const LS = 'kl_att_token';
type Tab = 'reviews' | 'rubric' | 'scores' | 'batches';

export default function ReviewAdmin() {
  const [token, setToken] = useState(sessionStorage.getItem(LS) || '');
  const [authed, setAuthed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [tab, setTab] = useState<Tab>('reviews');
  const tokenRef = useRef(token);
  const hdr = () => ({ 'x-admin-token': tokenRef.current });

  const [reviews, setReviews] = useState<ReviewInfo[]>([]);
  const [scores, setScores] = useState<ReviewScores | null>(null);
  const [selReview, setSelReview] = useState('');
  const [rubric, setRubric] = useState<Rubric | null>(null);
  const [batches, setBatches] = useState<AdminBatch[]>([]);
  const [q, setQ] = useState('');

  async function loadAll() {
    try {
      const [r, sc] = await Promise.all([
        api.get<{ reviews: ReviewInfo[] }>('/api/admin/review/reviews', hdr()),
        api.get<ReviewScores>(`/api/admin/review/scores${selReview ? `?reviewId=${selReview}` : ''}`, hdr()),
      ]);
      setReviews(r.reviews); setScores(sc); setAuthed(true); setError('');
      if (!selReview && sc.review) setSelReview(sc.review.id);
      sessionStorage.setItem(LS, tokenRef.current);
    } catch (e: any) {
      if (/401|invalid admin token/i.test(e.message)) { setAuthed(false); setError('Invalid admin token.'); } else setError(e.message);
    }
  }
  async function loadRubric() { try { setRubric(await api.get<Rubric>('/api/admin/review/rubric', hdr())); } catch (e: any) { setError(e.message); } }
  async function loadBatches() { try { const r = await api.get<{ batches: AdminBatch[] }>('/api/admin/review/batches', hdr()); setBatches(r.batches); } catch (e: any) { setError(e.message); } }

  useEffect(() => { if (tokenRef.current) loadAll(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { if (authed) loadAll(); /* eslint-disable-next-line */ }, [selReview]);
  useEffect(() => { if (authed && tab === 'rubric' && !rubric) loadRubric(); if (authed && tab === 'batches' && !batches.length) loadBatches(); /* eslint-disable-next-line */ }, [tab, authed]);

  async function act(url: string, body?: any, confirmMsg?: string, key = url) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(key);
    try { const r = await api.post<any>(url, body, hdr()); await loadAll(); return r; } catch (e: any) { setError(e.message); } finally { setBusy(''); }
  }
  async function newReview() { const name = window.prompt('Name this review (e.g. Review 1 / date):', ''); if (name === null) return; const r = await act('/api/admin/review/reviews/create', { name: name.trim() }, undefined, 'new'); if (r?.id) setSelReview(r.id); }

  async function saveRubric() {
    if (!rubric) return; setBusy('rubric');
    try { const r = await api.post<Rubric>('/api/admin/review/rubric', rubric, hdr()); setRubric(r); window.alert('Rubric saved.'); } catch (e: any) { setError(e.message); } finally { setBusy(''); }
  }

  function downloadCsv() {
    if (!scores) return;
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Section', 'Batch', 'Faculty', 'Emp', 'Project', 'PS', 'Reg No', 'Name', 'Present', 'Total', 'Scored'];
    const lines = scores.rows.map((r: ScoreRow) => [r.section, r.batchNo, r.facultyName, r.empId, r.project, r.ps, r.reg, r.name, r.present == null ? '' : r.present ? 'P' : 'A', r.total ?? '', r.scored ? 'yes' : 'no'].map(esc).join(','));
    const url = URL.createObjectURL(new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `review-${scores.review?.name || 'scores'}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  if (!authed) {
    return (
      <div className="mx-auto max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-bold text-slate-800">Review Admin</h1>
        <form onSubmit={(e) => { e.preventDefault(); tokenRef.current = token.trim(); loadAll(); }} className="mt-4 space-y-3">
          <input autoFocus type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Admin token" className="w-full rounded-xl border border-slate-300 px-4 py-2.5 outline-none focus:border-indigo-500" />
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button className="w-full rounded-xl bg-indigo-600 py-2.5 font-semibold text-white hover:bg-indigo-700">Open panel</button>
        </form>
      </div>
    );
  }

  const filteredBatches = batches.filter((b) => `${b.section} ${b.batchNo} ${b.facultyName} ${b.empId} ${b.project}`.toLowerCase().includes(q.toLowerCase()));
  const filteredRows = (scores?.rows || []).filter((r) => `${r.section} ${r.batchNo} ${r.facultyName} ${r.reg} ${r.name}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-r from-indigo-800 to-violet-700 px-5 py-4 text-white shadow-sm">
        <h1 className="text-lg font-bold">Hackathon Review — Admin</h1>
        <p className="text-sm text-indigo-100/90">Create reviews, edit the rubric, maintain batches, and view scores.</p>
      </div>
      {error && <div className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
      <div className="flex flex-wrap gap-1.5">
        {(['reviews', 'rubric', 'scores', 'batches'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-full px-4 py-1.5 text-sm font-semibold capitalize ${tab === t ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{t}</button>
        ))}
      </div>

      {tab === 'reviews' && (
        <div className="space-y-2">
          <button disabled={busy === 'new'} onClick={newReview} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">＋ New review</button>
          {!reviews.length ? <p className="text-sm text-slate-400">No reviews yet.</p> : reviews.slice().reverse().map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
              <div><span className="font-bold text-slate-800">{r.name}</span> {r.open ? <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-700">OPEN</span> : <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">closed</span>}</div>
              <div className="flex gap-2">
                {r.open ? <button onClick={() => act(`/api/admin/review/reviews/${r.id}/close`, undefined, undefined, 'c' + r.id)} className="rounded-lg bg-red-500 px-3 py-1 text-xs font-semibold text-white hover:bg-red-600">Close</button>
                  : <button onClick={() => act(`/api/admin/review/reviews/${r.id}/open`, undefined, `Open "${r.name}"? Other open review closes.`, 'o' + r.id)} className="rounded-lg bg-green-500 px-3 py-1 text-xs font-semibold text-white hover:bg-green-600">Open</button>}
                <button onClick={() => { setSelReview(r.id); setTab('scores'); }} className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200">Scores</button>
                <button onClick={() => act(`/api/admin/review/reviews/${r.id}/delete`, undefined, `Delete "${r.name}"? (Only if it has no marks.)`, 'd' + r.id)} className="rounded-lg bg-white px-3 py-1 text-xs font-semibold text-red-600 ring-1 ring-red-200 hover:bg-red-50">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'rubric' && rubric && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
            <span className="text-sm font-semibold text-slate-600">Mark levels:</span>
            <input value={rubric.levels.join(', ')} onChange={(e) => setRubric({ ...rubric, levels: e.target.value.split(',').map((x) => Number(x.trim())).filter((n) => !isNaN(n)) })} className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-indigo-500" />
          </div>
          {rubric.tables.map((t, ti) => (
            <div key={ti} className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
              <div className="mb-2 flex items-center gap-2">
                <input value={t.name} onChange={(e) => { const tables = [...rubric.tables]; tables[ti] = { ...t, name: e.target.value }; setRubric({ ...rubric, tables }); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold outline-none focus:border-indigo-500" />
                <button onClick={() => setRubric({ ...rubric, tables: rubric.tables.filter((_, i) => i !== ti) })} className="ml-auto text-xs font-semibold text-red-600 hover:underline">Remove table</button>
              </div>
              {t.criteria.map((c, ci) => (
                <div key={ci} className="mb-1 flex items-center gap-2">
                  <input value={c} onChange={(e) => { const tables = [...rubric.tables]; const cr = [...t.criteria]; cr[ci] = e.target.value; tables[ti] = { ...t, criteria: cr }; setRubric({ ...rubric, tables }); }} className="flex-1 rounded-lg border border-slate-300 px-3 py-1 text-sm outline-none focus:border-indigo-500" />
                  <button onClick={() => { const tables = [...rubric.tables]; tables[ti] = { ...t, criteria: t.criteria.filter((_, i) => i !== ci) }; setRubric({ ...rubric, tables }); }} className="text-xs text-red-500">✕</button>
                </div>
              ))}
              <button onClick={() => { const tables = [...rubric.tables]; tables[ti] = { ...t, criteria: [...t.criteria, 'New criterion'] }; setRubric({ ...rubric, tables }); }} className="mt-1 text-xs font-semibold text-indigo-600 hover:underline">＋ Add criterion</button>
            </div>
          ))}
          <div className="flex gap-2">
            <button onClick={() => setRubric({ ...rubric, tables: [...rubric.tables, { name: `Table ${rubric.tables.length + 1}`, criteria: ['Criterion 1'] }] })} className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200">＋ Add table</button>
            <button disabled={busy === 'rubric'} onClick={saveRubric} className="rounded-lg bg-indigo-600 px-6 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">Save rubric</button>
          </div>
        </div>
      )}

      {tab === 'scores' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select value={selReview} onChange={(e) => setSelReview(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold outline-none focus:border-indigo-500">
              {reviews.slice().reverse().map((r) => <option key={r.id} value={r.id}>{r.name}{r.open ? ' (open)' : ''}</option>)}
            </select>
            {scores && <span className="text-sm text-slate-500">{scores.summary.scored}/{scores.summary.students} scored · {scores.summary.batches} batches</span>}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-indigo-500" />
            <button onClick={downloadCsv} className="ml-auto rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700">⬇ CSV</button>
          </div>
          <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-slate-500"><tr>{['Sec', 'Batch', 'Faculty', 'Reg No', 'Name', 'Present', 'Total'].map((h) => <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>)}</tr></thead>
              <tbody>
                {filteredRows.map((r, i) => (
                  <tr key={r.reg + i} className="border-b border-slate-50">
                    <td className="px-3 py-1.5 font-bold">{r.section}</td>
                    <td className="px-3 py-1.5">{r.batchNo}</td>
                    <td className="px-3 py-1.5 text-slate-600">{r.facultyName}</td>
                    <td className="px-3 py-1.5 font-mono text-[11px]">{r.reg}</td>
                    <td className="px-3 py-1.5">{r.name}</td>
                    <td className="px-3 py-1.5">{r.present == null ? <span className="text-slate-300">—</span> : r.present ? <span className="text-green-600">P</span> : <span className="text-red-500">A</span>}</td>
                    <td className="px-3 py-1.5 font-bold">{r.total == null ? <span className="text-slate-300">—</span> : r.total}</td>
                  </tr>
                ))}
                {!filteredRows.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-400">No batches/scores. Import batches, then create a review.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'batches' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search section / faculty / project" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-indigo-500" />
            <span className="text-sm text-slate-500">{batches.length} batches</span>
            <button onClick={loadBatches} className="ml-auto rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-200">↻ Reload</button>
          </div>
          <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-slate-500"><tr>{['Sec', 'Batch', 'Faculty', 'Project', 'PS', 'Members', ''].map((h) => <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>)}</tr></thead>
              <tbody>
                {filteredBatches.map((b) => (
                  <tr key={b.id} className="border-b border-slate-50 align-top">
                    <td className="px-3 py-1.5 font-bold">{b.section}</td>
                    <td className="px-3 py-1.5">{b.batchNo}</td>
                    <td className="px-3 py-1.5 text-slate-600">{b.facultyName}<div className="font-mono text-[10px] text-slate-400">{b.empId}</div></td>
                    <td className="px-3 py-1.5">{b.project}</td>
                    <td className="px-3 py-1.5 text-slate-500">{b.ps}</td>
                    <td className="px-3 py-1.5 text-[11px] text-slate-500">{(b.members || []).map((m) => m.reg).join(', ')}</td>
                    <td className="px-3 py-1.5"><button onClick={async () => { if (window.confirm('Delete this batch?')) { await api.post(`/api/admin/review/batches/${b.id}/delete`, undefined, hdr()); loadBatches(); } }} className="text-xs font-semibold text-red-600 hover:underline">Delete</button></td>
                  </tr>
                ))}
                {!filteredBatches.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-400">No batches imported yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

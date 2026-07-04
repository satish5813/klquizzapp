import { useEffect, useRef, useState } from 'react';
import { api, AttReport, AttSection } from '../api';

const LS = 'kl_att_token';

export default function AttendanceAdmin() {
  const [token, setToken] = useState(sessionStorage.getItem(LS) || '');
  const [authed, setAuthed] = useState(false);
  const [data, setData] = useState<AttReport | null>(null);
  const [selId, setSelId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [updated, setUpdated] = useState('');
  const [auto, setAuto] = useState(true);
  const [q, setQ] = useState('');
  const tokenRef = useRef(token);
  const selRef = useRef('');

  const hdr = () => ({ 'x-admin-token': tokenRef.current });

  async function load(sessionId?: string) {
    const sid = sessionId ?? selRef.current;
    try {
      const r = await api.get<AttReport>(`/api/admin/attendance/report${sid ? `?sessionId=${encodeURIComponent(sid)}` : ''}`, hdr());
      setData(r); setAuthed(true); setError(''); setUpdated(new Date().toLocaleTimeString());
      const shown = r.session?.id || '';
      setSelId(shown); selRef.current = shown;
      sessionStorage.setItem(LS, tokenRef.current);
    } catch (e: any) {
      if (/401|invalid admin token/i.test(e.message)) { setAuthed(false); setError('Invalid admin token.'); }
      else setError(e.message);
    }
  }
  useEffect(() => { if (tokenRef.current) load(); /* eslint-disable-next-line */ }, []);
  useEffect(() => {
    if (!auto || !authed) return;
    const t = setInterval(() => load(), 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, [auto, authed]);

  async function act(url: string, body?: any, confirmMsg?: string, key = url, reloadSession?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(key);
    try { const r = await api.post<any>(url, body, hdr()); await load(reloadSession ?? (r?.id ?? undefined)); }
    catch (e: any) { setError(e.message); } finally { setBusy(''); }
  }

  async function newSession() {
    const name = window.prompt('Name this attendance session (e.g. a date/time / slot):', '');
    if (name === null) return;
    await act('/api/admin/attendance/sessions/create', { name: name.trim() }, undefined, 'new');
  }

  function selectSession(id: string) { setSelId(id); selRef.current = id; load(id); }

  function downloadCsv() {
    if (!data) return;
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Section', 'Faculty', 'Emp ID', 'Room', 'Students', 'Posted', 'Posted at', 'Present', 'Absent', 'Percent'];
    const lines = data.sections.map((s) => [s.section, s.facultyName, s.empId, s.room, s.total, s.posted ? 'Yes' : 'No', s.postedAt ? new Date(s.postedAt).toLocaleString() : '', s.present, s.absent, s.pct].map(esc).join(','));
    const url = URL.createObjectURL(new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `attendance-${data.session?.name || 'report'}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  // ---- token gate ----
  if (!authed) {
    return (
      <div className="mx-auto max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-bold text-slate-800">Attendance Admin</h1>
        <p className="mt-1 text-sm text-slate-500">Enter the admin token to manage attendance.</p>
        <form onSubmit={(e) => { e.preventDefault(); tokenRef.current = token.trim(); load(); }} className="mt-4 space-y-3">
          <input autoFocus type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Admin token"
            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100" />
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button className="w-full rounded-xl bg-teal-600 py-2.5 font-semibold text-white hover:bg-teal-700">Open panel</button>
        </form>
      </div>
    );
  }

  const s = data?.summary;
  const cur = data?.session;
  const sections = (data?.sections || []).filter((x: AttSection) => `${x.section} ${x.facultyName} ${x.empId}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-r from-slate-800 to-slate-700 px-5 py-4 text-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h1 className="text-lg font-bold">Attendance Admin</h1><p className="text-sm text-slate-300">Create a session, faculty submit, then close. Old sessions are kept.{updated && ` · updated ${updated}`}</p></div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto 10s</label>
            <button onClick={() => load()} className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25">↻ Refresh</button>
            <button disabled={busy === 'new'} onClick={newSession} className="rounded-lg bg-teal-500 px-3 py-1.5 text-sm font-bold hover:bg-teal-600 disabled:opacity-50">＋ New session</button>
          </div>
        </div>
      </div>

      {/* session picker + controls */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        {!data?.sessions.length ? (
          <p className="text-sm text-slate-500">No sessions yet. Click <b>＋ New session</b> to start taking attendance.</p>
        ) : (
          <>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Session</label>
            <select value={selId} onChange={(e) => selectSession(e.target.value)} className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-teal-500">
              {data.sessions.slice().reverse().map((ss) => <option key={ss.id} value={ss.id}>{ss.name}{ss.open ? ' · OPEN' : ''}</option>)}
            </select>
            {cur && (
              <>
                <span className={`rounded-full px-3 py-1 text-sm font-semibold ${cur.open ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{cur.open ? '● OPEN' : '○ closed'}</span>
                {cur.open
                  ? <button disabled={busy.startsWith('close')} onClick={() => act(`/api/admin/attendance/sessions/${cur.id}/close`, undefined, `Close "${cur.name}"? Faculty can no longer submit for it.`, 'close', cur.id)} className="rounded-lg bg-red-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50">■ Close</button>
                  : <button disabled={busy.startsWith('open')} onClick={() => act(`/api/admin/attendance/sessions/${cur.id}/open`, undefined, `Open "${cur.name}" for submissions? Any other open session will be closed.`, 'open', cur.id)} className="rounded-lg bg-green-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-600 disabled:opacity-50">● Open</button>}
                <button disabled={busy.startsWith('del')} onClick={() => act(`/api/admin/attendance/sessions/${cur.id}/delete`, undefined, `Delete "${cur.name}" and all its attendance? Cannot be undone.`, 'del', '')} className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-red-600 ring-1 ring-red-200 hover:bg-red-50 disabled:opacity-50">🗑 Delete</button>
              </>
            )}
          </>
        )}
      </div>

      {data?.sessions.length ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {[['Faculties', s?.faculties], ['Posted', s?.posted], ['Not posted', s?.notPosted], ['Students', s?.totalStudents], ['Present', s?.present], ['Absent', s?.absent]].map(([label, v]) => (
              <div key={label as string} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 text-3xl font-extrabold text-slate-800">{(v ?? 0).toLocaleString()}</p></div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search section / faculty / emp id" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-teal-500" />
            <button onClick={downloadCsv} className="rounded-lg bg-teal-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-teal-700">⬇ Download report (CSV)</button>
          </div>

          <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-slate-500"><tr>{['Section', 'Faculty', 'Room', 'Students', 'Status', 'Present', 'Absent', '%', 'Action'].map((h) => <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>)}</tr></thead>
              <tbody>
                {sections.map((x) => (
                  <tr key={x.empId} className="border-b border-slate-50">
                    <td className="px-3 py-1.5 font-bold text-slate-800">{x.section}</td>
                    <td className="px-3 py-1.5">{x.facultyName}<div className="font-mono text-[10px] text-slate-400">{x.empId}</div></td>
                    <td className="px-3 py-1.5 text-slate-500">{x.room}</td>
                    <td className="px-3 py-1.5">{x.total}</td>
                    <td className="px-3 py-1.5">{x.posted ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700" title={x.postedAt ? new Date(x.postedAt).toLocaleString() : ''}>✓ Posted</span> : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">Pending</span>}</td>
                    <td className="px-3 py-1.5 font-semibold text-green-600">{x.posted ? x.present : '—'}</td>
                    <td className="px-3 py-1.5 font-semibold text-red-500">{x.posted ? x.absent : '—'}</td>
                    <td className="px-3 py-1.5">{x.posted ? `${x.pct}%` : '—'}</td>
                    <td className="px-3 py-1.5">{x.posted && cur && <button disabled={busy === 'revoke' + x.empId} onClick={() => act('/api/admin/attendance/revoke', { sessionId: cur.id, empId: x.empId }, `Revoke ${x.facultyName}'s attendance for "${cur.name}"? They can submit again.`, 'revoke' + x.empId, cur.id)} className="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-red-600 ring-1 ring-red-200 hover:bg-red-50 disabled:opacity-50">Revoke</button>}</td>
                  </tr>
                ))}
                {!sections.length && <tr><td colSpan={9} className="px-3 py-6 text-center text-sm text-slate-400">No faculty/sections found.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

// Faculty portal for Programs: sign in with Emp ID → see YOUR room cards across programs →
// tap an OPEN room to mark attendance (kind="attendance") or enter review marks (kind="review").
import { useEffect, useState } from 'react';
import { api } from '../api';

type Kind = 'attendance' | 'review';
interface Card { programId: string; programTitle: string; sessionId: string; sessionName: string; date: string; startTime: string; endTime: string; room: string; label: string; students: number; open: boolean; posted: boolean; present: number; absent: number; scored: number; postedAt: string | null; }
interface LoginRes { faculty: { empId: string; name: string }; cards: Card[]; }
interface Stu { reg: string; name: string; branch: string; section: string; batchNo: string; project: string; ps: string; present: boolean | null; scored?: boolean; scores?: Record<string, number>; total?: number; }
interface Crit { label: string; max: number; bands: string[]; }
interface RoomRes { program: { id: string; title: string }; session: { id: string; name: string; date: string; startTime: string; endTime: string }; room: string; label: string; open: boolean; posting?: { postedAt: string; present: number; absent: number; total: number; by: string } | null; students: Stu[]; rubric?: { bandLabels: string[]; tables: { name: string; criteria: Crit[] }[] }; maxTotal?: number; }

const when = (c: { date: string; startTime: string; endTime: string }) => [c.date ? new Date(c.date + 'T00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '', c.startTime && c.endTime ? `${c.startTime}–${c.endTime}` : c.startTime].filter(Boolean).join(' · ');

export default function FacultyRooms({ kind }: { kind: Kind }) {
  const isReview = kind === 'review';
  const [empId, setEmpId] = useState(sessionStorage.getItem('kl_emp') || '');
  const [data, setData] = useState<LoginRes | null>(null);
  const [room, setRoom] = useState<RoomRes | null>(null);
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const [rows, setRows] = useState<Record<string, { present: boolean; scores: Record<string, number> }>>({});
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  async function login(id = empId) {
    if (!id.trim()) return;
    setLoading(true); setError('');
    try { const r = await api.post<LoginRes>('/api/faculty/program/login', { empId: id.trim(), kind }); setData(r); sessionStorage.setItem('kl_emp', id.trim()); }
    catch (e: any) { setError(e.message); setData(null); } finally { setLoading(false); }
  }
  // Auto-load a remembered Emp ID, and refresh the room cards every 15 s so an
  // opened room appears without the faculty reloading the page.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (empId) login(empId); }, []);
  useEffect(() => {
    if (!data || room) return;
    const t = setInterval(() => login(data.faculty.empId), 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, room]);

  async function openRoom(c: { sessionId: string; room: string }) {
    setError(''); setNote(''); setQ('');
    try {
      const r = await api.post<RoomRes>('/api/faculty/program/room', { empId: data!.faculty.empId, sessionId: c.sessionId, room: c.room });
      setRoom(r);
      if (isReview) {
        const init: typeof rows = {};
        for (const s of r.students) init[s.reg] = { present: s.present !== false, scores: { ...(s.scores || {}) } };
        setRows(init);
      } else {
        const init: Record<string, boolean> = {};
        for (const s of r.students) init[s.reg] = r.posting ? !!s.present : false; // editable → everyone starts Absent
        setMarks(init);
      }
    } catch (e: any) { setError(e.message); }
  }
  function back() { setRoom(null); if (data) login(data.faculty.empId); }
  function logout() { setData(null); setRoom(null); sessionStorage.removeItem('kl_emp'); }

  async function submitAttendance() {
    if (!room) return;
    const present = Object.values(marks).filter(Boolean).length;
    if (!window.confirm(`Submit attendance for room ${room.label}?\n\nPresent: ${present}\nAbsent: ${room.students.length - present}\n\nThis submits ONCE and locks.`)) return;
    setSaving(true); setError('');
    try { await api.post('/api/faculty/program/attendance', { empId: data!.faculty.empId, sessionId: room.session.id, room: room.room, marks }); await openRoom({ sessionId: room.session.id, room: room.room }); setNote('Attendance submitted ✓'); }
    catch (e: any) { setError(e.message); } finally { setSaving(false); }
  }
  async function saveReview() {
    if (!room) return;
    setSaving(true); setError('');
    try {
      const payload = Object.entries(rows).map(([reg, r]) => ({ reg, present: r.present, scores: r.scores }));
      const res = await api.post<{ saved: number; postedAt: string }>('/api/faculty/program/review', { empId: data!.faculty.empId, sessionId: room.session.id, room: room.room, rows: payload });
      await openRoom({ sessionId: room.session.id, room: room.room });
      setNote(`Saved ${res.saved} student(s) at ${new Date(res.postedAt).toLocaleTimeString('en-IN')} ✓ — you can keep editing while the room is open.`);
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  }

  // ---------- Login ----------
  if (!data) {
    return (
      <div className="mx-auto max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-bold text-slate-800">{isReview ? 'Hackathon Review' : 'Room Attendance'}</h1>
        <p className="mt-1 text-sm text-slate-500">Enter your Employee ID to see your rooms.</p>
        <form onSubmit={(e) => { e.preventDefault(); login(); }} className="mt-4 space-y-3">
          <input autoFocus value={empId} onChange={(e) => setEmpId(e.target.value)} placeholder="Employee ID (e.g. 7281)"
            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-base outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100" />
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button disabled={loading} className="w-full rounded-xl bg-teal-600 py-2.5 font-semibold text-white hover:bg-teal-700 disabled:opacity-50">{loading ? 'Loading…' : 'Open'}</button>
        </form>
      </div>
    );
  }

  const header = (
    <div className="rounded-2xl bg-gradient-to-r from-teal-700 to-emerald-600 px-5 py-4 text-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">{data.faculty.name || 'Faculty'}</h1>
          <p className="text-sm text-teal-50/90">Emp ID {data.faculty.empId} · {isReview ? 'Hackathon review' : 'Room attendance'}</p>
        </div>
        <div className="flex items-center gap-2">
          {room && <button onClick={back} className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25">← My rooms</button>}
          {!room && <button onClick={() => login(data.faculty.empId)} className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25">↻ Refresh</button>}
          <button onClick={logout} className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25">Logout</button>
        </div>
      </div>
    </div>
  );

  // ---------- Room cards ----------
  if (!room) {
    return (
      <div className="space-y-4">
        {header}
        {error && <div className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}
        {!data.cards.length ? (
          <div className="rounded-2xl bg-white p-6 text-center text-sm text-slate-400 shadow-sm ring-1 ring-slate-200">No {isReview ? 'review rounds' : 'sessions'} scheduled for your rooms yet.</div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.cards.map((c) => {
              const canMark = c.open && (isReview || !c.posted);
              return (
                <button key={c.sessionId + c.room} onClick={() => openRoom(c)}
                  className={`rounded-2xl p-4 text-left shadow-sm ring-1 transition hover:shadow-md ${canMark ? 'bg-amber-50 ring-amber-300 hover:ring-amber-400' : c.posted ? 'bg-green-50 ring-green-200' : 'bg-slate-50 ring-slate-200'}`}>
                  <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">{c.programTitle}</p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-lg font-bold text-slate-800">Room {c.label}</span>
                    {canMark ? <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white">OPEN</span>
                      : c.posted ? <span title="Submitted">🔒</span> : <span className="rounded-full bg-slate-300 px-2 py-0.5 text-[10px] font-bold text-white">CLOSED</span>}
                  </div>
                  <p className="text-sm text-slate-600">{c.sessionName}{when(c) ? ` · ${when(c)}` : ''}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    {isReview ? (c.scored ? `${c.scored}/${c.students} scored` : `${c.students} students`)
                      : c.posted ? `${c.present} present · ${c.absent} absent` : `${c.students} students`}
                  </p>
                  <p className={`mt-1 text-sm font-semibold ${canMark ? 'text-amber-700' : 'text-slate-400'}`}>{canMark ? (isReview ? 'Tap to enter marks →' : 'Tap to take attendance →') : c.posted ? 'Tap to view' : 'Not open yet'}</p>
                </button>
              );
            })}
          </div>
        )}
        <p className="text-center text-xs text-slate-400">This page refreshes every 15 seconds — a room appears as OPEN as soon as the coordinator opens it.</p>
      </div>
    );
  }

  // ---------- Room: attendance ----------
  const filtered = room.students.filter((s) => `${s.reg} ${s.name}`.toLowerCase().includes(q.toLowerCase()));
  if (!isReview) {
    const editable = room.open && !room.posting;
    const present = Object.values(marks).filter(Boolean).length;
    return (
      <div className="space-y-3">
        {header}
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{room.program.title}</p>
          <h2 className="text-lg font-bold text-slate-800">Room {room.label} · {room.session.name}</h2>
          <p className="text-sm text-slate-500">{room.posting ? `🔒 Submitted${room.posting.by ? ` by ${room.posting.by}` : ''} at ${new Date(room.posting.postedAt).toLocaleString('en-IN')}` : editable ? 'Everyone starts Absent — tap to mark Present, then submit once.' : 'This room is not open. Please wait for the coordinator to open it.'}</p>
        </div>
        {error && <div className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}
        {note && <div className="rounded-xl bg-green-50 px-4 py-2.5 text-sm font-medium text-green-700">{note}</div>}
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reg no / name" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-500" />
          {editable && <button onClick={() => setMarks(Object.fromEntries(room.students.map((s) => [s.reg, true])))} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200">All present</button>}
          {editable && <button onClick={() => setMarks(Object.fromEntries(room.students.map((s) => [s.reg, false])))} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200">All absent</button>}
          <span className="text-sm"><b className="text-green-600">{present}</b> <span className="text-slate-400">/ {room.students.length} present</span></span>
        </div>
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          {filtered.map((s) => {
            const p = !!marks[s.reg];
            return (
              <div key={s.reg} onClick={() => editable && setMarks({ ...marks, [s.reg]: !p })}
                className={`flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5 ${editable ? 'cursor-pointer hover:bg-slate-50' : ''}`}>
                <div className="min-w-0"><p className="truncate font-medium text-slate-800">{s.name}</p><p className="font-mono text-xs text-slate-400">{s.reg}{s.section ? ` · ${s.section}` : ''}</p></div>
                <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${p ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>{p ? 'Present' : 'Absent'}</span>
              </div>
            );
          })}
        </div>
        {editable && (
          <div className="sticky bottom-3">
            <button disabled={saving} onClick={submitAttendance} className="w-full rounded-xl bg-teal-600 py-3 font-bold text-white shadow-lg hover:bg-teal-700 disabled:opacity-50">{saving ? 'Submitting…' : `Submit attendance (${present} present, ${room.students.length - present} absent)`}</button>
          </div>
        )}
      </div>
    );
  }

  // ---------- Room: review marks ----------
  const crit = (room.rubric?.tables || []).flatMap((t, ti) => t.criteria.map((c, ci) => ({ key: `t${ti}_c${ci}`, ...c })));
  const editable = room.open;
  const totalOf = (reg: string) => (rows[reg]?.present ? Object.values(rows[reg].scores || {}).reduce((n, v) => n + (Number(v) || 0), 0) : 0);
  const setScore = (reg: string, key: string, max: number, v: string) => {
    const n = v === '' ? NaN : Math.max(0, Math.min(max, Math.round(Number(v))));
    setRows((r) => { const cur = r[reg] || { present: true, scores: {} }; const scores = { ...cur.scores }; if (isNaN(n)) delete scores[key]; else scores[key] = n; return { ...r, [reg]: { ...cur, scores } }; });
  };
  const batches = [...new Set(filtered.map((s) => s.batchNo || ''))];
  return (
    <div className="space-y-3">
      {header}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{room.program.title}</p>
        <h2 className="text-lg font-bold text-slate-800">Room {room.label} · {room.session.name}</h2>
        <p className="text-sm text-slate-500">{editable ? `Enter marks for each student (max ${room.maxTotal}). Save anytime — you can edit until the room is closed.` : 'This room is closed — marks are read-only.'}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">{crit.map((c) => <span key={c.key} title={c.bands.join(' | ')} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{c.label} /{c.max}</span>)}</div>
      </div>
      {error && <div className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}
      {note && <div className="rounded-xl bg-green-50 px-4 py-2.5 text-sm font-medium text-green-700">{note}</div>}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reg no / name" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-500" />
      {batches.map((b) => {
        const group = filtered.filter((s) => (s.batchNo || '') === b);
        return (
          <div key={b || 'none'} className="space-y-2">
            {b && <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Batch {b}{group[0]?.project ? ` · ${group[0].project}` : ''}{group[0]?.ps ? ` · ${group[0].ps}` : ''}</p>}
            {group.map((s) => {
              const r = rows[s.reg] || { present: true, scores: {} };
              return (
                <div key={s.reg} className={`rounded-2xl p-3.5 shadow-sm ring-1 ${r.present ? 'bg-white ring-slate-200' : 'bg-slate-50 ring-slate-200 opacity-80'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0"><p className="truncate font-medium text-slate-800">{s.name}</p><p className="font-mono text-xs text-slate-400">{s.reg}</p></div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold tabular-nums text-slate-700">{totalOf(s.reg)}<span className="font-normal text-slate-400">/{room.maxTotal}</span></span>
                      <button disabled={!editable} onClick={() => setRows({ ...rows, [s.reg]: { ...r, present: !r.present } })}
                        className={`rounded-full px-3 py-1 text-xs font-bold ${r.present ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'} disabled:opacity-60`}>{r.present ? 'Present' : 'Absent'}</button>
                    </div>
                  </div>
                  {r.present && (
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {crit.map((c) => (
                        <label key={c.key} className="block">
                          <span className="block truncate text-[11px] text-slate-500" title={c.label}>{c.label} <span className="text-slate-400">/{c.max}</span></span>
                          <input type="number" inputMode="numeric" min={0} max={c.max} disabled={!editable} value={r.scores[c.key] ?? ''}
                            onChange={(e) => setScore(s.reg, c.key, c.max, e.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm tabular-nums outline-none focus:border-teal-500 disabled:bg-slate-50" />
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      {editable && (
        <div className="sticky bottom-3">
          <button disabled={saving} onClick={saveReview} className="w-full rounded-xl bg-teal-600 py-3 font-bold text-white shadow-lg hover:bg-teal-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save marks'}</button>
        </div>
      )}
    </div>
  );
}

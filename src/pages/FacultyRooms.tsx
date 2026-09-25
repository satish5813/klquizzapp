// Faculty portal for Programs: sign in with email / Emp ID + the OTP emailed to you → see YOUR room cards across programs →
// tap an OPEN room to mark attendance (kind="attendance") or enter review marks (kind="review").
import { useEffect, useState } from 'react';
import { api } from '../api';

type Kind = 'attendance' | 'review';
interface Card { programId: string; programTitle: string; sessionId: string; sessionName: string; date: string; startTime: string; endTime: string; room: string; label: string; students: number; batches?: number; open: boolean; posted: boolean; present: number; absent: number; scored: number; postedAt: string | null; }
interface LoginRes { faculty: { name: string }; cards: Card[]; }
interface Stu { reg: string; name: string; branch: string; section: string; batchNo: string; project: string; ps: string; present: boolean | null; scored?: boolean; scores?: Record<string, number>; total?: number; }
interface Crit { label: string; max: number; bands: string[]; }
interface RoomRes { program: { id: string; title: string }; session: { id: string; name: string; date: string; startTime: string; endTime: string }; room: string; label: string; open: boolean; posting?: { postedAt: string; present: number; absent: number; total: number; by: string } | null; students: Stu[]; rubric?: { bandLabels: string[]; tables: { name: string; criteria: Crit[] }[] }; maxTotal?: number; }

const when = (c: { date: string; startTime: string; endTime: string }) => [c.date ? new Date(c.date + 'T00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '', c.startTime && c.endTime ? `${c.startTime}–${c.endTime}` : c.startTime].filter(Boolean).join(' · ');

export default function FacultyRooms({ kind }: { kind: Kind }) {
  const isReview = kind === 'review';
  const [id, setId] = useState(localStorage.getItem('kl_fac_id') || '');
  const [token, setToken] = useState(localStorage.getItem('kl_fac_token') || '');
  const [otpMode, setOtpMode] = useState<boolean | null>(null);
  const [otpSent, setOtpSent] = useState<string>(''); // masked email the code went to
  const [code, setCode] = useState('');
  const [data, setData] = useState<LoginRes | null>(null);
  const [room, setRoom] = useState<RoomRes | null>(null);
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const [rows, setRows] = useState<Record<string, { present: boolean; scores: Record<string, number>; project: string }>>({});
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  /** Faculty API call: the session token (OTP mode) or the email / Emp ID (no-OTP mode). */
  async function call<T>(path: string, body: Record<string, unknown>, tok = token): Promise<T> {
    try { return await api.post<T>(path, { ...body, id }, tok ? { 'x-faculty-token': tok } : undefined); }
    catch (e: any) {
      if (/sign in with the OTP/i.test(e.message)) { localStorage.removeItem('kl_fac_token'); setToken(''); setData(null); setRoom(null); setOtpSent(''); }
      throw e;
    }
  }
  async function loadCards(tok = token, quiet = false) {
    if (!quiet) { setLoading(true); setError(''); }
    try { setData(await call<LoginRes>('/api/faculty/program/login', { kind }, tok)); }
    catch (e: any) { if (!quiet) { setError(e.message); setData(null); } } finally { if (!quiet) setLoading(false); }
  }
  // Which sign-in does the server use? Then resume a remembered sign-in.
  useEffect(() => {
    api.get<{ otp: boolean }>('/api/faculty/auth-mode').then((r) => {
      setOtpMode(r.otp);
      if ((r.otp && token) || (!r.otp && id)) loadCards();
    }).catch((e) => { setOtpMode(false); setError(e.message); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Refresh the room cards every 15 s so an opened room appears without reloading the page.
  useEffect(() => {
    if (!data || room) return;
    const t = setInterval(() => loadCards(token, true), 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, room]);

  async function requestOtp() {
    if (!id.trim()) return;
    setLoading(true); setError('');
    try {
      const r = await api.post<{ to: string; debugCode?: string }>('/api/faculty/otp/request', { id: id.trim() });
      localStorage.setItem('kl_fac_id', id.trim());
      setOtpSent(r.to); setCode(r.debugCode || '');
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }
  async function verifyOtp() {
    if (code.trim().length < 6) return;
    setLoading(true); setError('');
    try {
      const r = await api.post<{ token: string }>('/api/faculty/otp/verify', { id: id.trim(), code: code.trim() });
      localStorage.setItem('kl_fac_token', r.token); setToken(r.token); setCode('');
      await loadCards(r.token);
    } catch (e: any) { setError(e.message); setLoading(false); }
  }
  async function plainLogin() {
    if (!id.trim()) return;
    localStorage.setItem('kl_fac_id', id.trim());
    await loadCards();
  }

  async function openRoom(c: { sessionId: string; room: string }) {
    setError(''); setNote(''); setQ('');
    try {
      const r = await call<RoomRes>('/api/faculty/program/room', { sessionId: c.sessionId, room: c.room });
      setRoom(r);
      if (isReview) {
        const init: typeof rows = {};
        for (const s of r.students) init[s.reg] = { present: s.present !== false, scores: { ...(s.scores || {}) }, project: s.project || '' };
        setRows(init);
      } else {
        const init: Record<string, boolean> = {};
        for (const s of r.students) init[s.reg] = r.posting ? !!s.present : false; // editable → everyone starts Absent
        setMarks(init);
      }
    } catch (e: any) { setError(e.message); }
  }
  function back() { setRoom(null); if (data) loadCards(); }
  function logout() {
    if (token) api.post('/api/faculty/logout', {}, { 'x-faculty-token': token }).catch(() => {});
    localStorage.removeItem('kl_fac_token'); setToken(''); setData(null); setRoom(null); setOtpSent(''); setCode('');
  }

  async function submitAttendance() {
    if (!room) return;
    const present = Object.values(marks).filter(Boolean).length;
    if (!window.confirm(`Submit attendance for room ${room.label}?\n\nPresent: ${present}\nAbsent: ${room.students.length - present}\n\nThis submits ONCE and locks.`)) return;
    setSaving(true); setError('');
    try { await call('/api/faculty/program/attendance', { sessionId: room.session.id, room: room.room, marks }); await openRoom({ sessionId: room.session.id, room: room.room }); setNote('Attendance submitted ✓'); }
    catch (e: any) { setError(e.message); } finally { setSaving(false); }
  }
  async function saveReview() {
    if (!room) return;
    setSaving(true); setError('');
    try {
      // only the students you actually touched — the rest stay "not scored"
      const payload = Object.entries(rows)
        .filter(([, r]) => !r.present || Object.keys(r.scores || {}).length > 0 || (r.project || '').trim())
        .map(([reg, r]) => ({ reg, present: r.present, scores: r.scores, project: r.project }));
      const res = await call<{ saved: number; postedAt: string }>('/api/faculty/program/review', { sessionId: room.session.id, room: room.room, rows: payload });
      await openRoom({ sessionId: room.session.id, room: room.room });
      setNote(`Saved ${res.saved} student(s) at ${new Date(res.postedAt).toLocaleTimeString('en-IN')} ✓ — you can keep editing while the room is open.`);
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  }

  // ---------- Login ----------
  if (!data) {
    return (
      <div className="mx-auto max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-bold text-slate-800">{isReview ? 'Hackathon Review' : 'Room Attendance'}</h1>
        {otpMode === null ? <p className="mt-3 text-sm text-slate-400">Loading…</p> : otpSent ? (
          <form onSubmit={(e) => { e.preventDefault(); verifyOtp(); }} className="mt-4 space-y-3">
            <p className="text-sm text-slate-600">We sent a 6-digit code to <b>{otpSent}</b>. It is valid for 10 minutes (check Junk/Spam too).</p>
            <input autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="••••••"
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-center text-2xl font-bold tracking-[0.5em] outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100" />
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button disabled={loading || code.length < 6} className="w-full rounded-xl bg-teal-600 py-2.5 font-semibold text-white hover:bg-teal-700 disabled:opacity-50">{loading ? 'Verifying…' : 'Verify & sign in'}</button>
            <div className="flex justify-between text-sm">
              <button type="button" onClick={() => { setOtpSent(''); setCode(''); setError(''); }} className="text-slate-500 hover:underline">← Change</button>
              <button type="button" disabled={loading} onClick={requestOtp} className="font-semibold text-teal-700 hover:underline">Resend code</button>
            </div>
          </form>
        ) : (
          <>
            <p className="mt-1 text-sm text-slate-500">{otpMode ? 'Enter your email (or Employee ID). We will email you a sign-in code.' : 'Enter your Employee ID to see your rooms.'}</p>
            <form onSubmit={(e) => { e.preventDefault(); if (otpMode) requestOtp(); else plainLogin(); }} className="mt-4 space-y-3">
              <input autoFocus value={id} onChange={(e) => setId(e.target.value)} placeholder={otpMode ? "name@kluniversity.in or Emp ID" : "Employee ID (e.g. 7281)"}
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-base outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100" />
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <button disabled={loading || !id.trim()} className="w-full rounded-xl bg-teal-600 py-2.5 font-semibold text-white hover:bg-teal-700 disabled:opacity-50">{loading ? 'Please wait…' : otpMode ? 'Send OTP' : 'Open'}</button>
            </form>
          </>
        )}
      </div>
    );
  }

  const header = (
    <div className="rounded-2xl bg-gradient-to-r from-teal-700 to-emerald-600 px-5 py-4 text-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">{data.faculty.name || 'Faculty'}</h1>
          <p className="text-sm text-teal-50/90">{isReview ? 'Hackathon review' : 'Room attendance'}</p>
        </div>
        <div className="flex items-center gap-2">
          {room && <button onClick={back} className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25">← My rooms</button>}
          {!room && <button onClick={() => loadCards()} className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25">↻ Refresh</button>}
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
                    {isReview ? `${c.batches ? `Your ${c.batches} batch${c.batches === 1 ? '' : 'es'} · ` : ''}${c.scored ? `${c.scored}/${c.students} scored` : `${c.students} students`}`
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

  // ---------- Room: review marks (one row per student, batch rows merged, band chips) ----------
  const crit = (room.rubric?.tables || []).flatMap((t, ti) => t.criteria.map((c, ci) => ({ key: `t${ti}_c${ci}`, ...c })));
  const bands = room.rubric?.bandLabels?.length ? room.rubric.bandLabels : ['Poor', 'Below Avg', 'Good', 'Excellent'];
  // one chip per rubric band (plus 0) — e.g. a criterion out of 10 → 0 · 3 · 5 · 8 · 10
  const choicesOf = (max: number) => {
    const out = [{ v: 0, band: 'Not attempted' }];
    bands.forEach((b, i) => { const v = Math.round((max * (i + 1)) / bands.length); if (!out.some((o) => o.v === v)) out.push({ v, band: b }); });
    return out;
  };
  const editable = room.open;
  const totalOf = (reg: string) => (rows[reg]?.present ? Object.values(rows[reg].scores || {}).reduce((n, v) => n + (Number(v) || 0), 0) : 0);
  const setScore = (reg: string, key: string, v: number) =>
    setRows((r) => { const cur = r[reg] || { present: true, scores: {}, project: '' }; const scores = { ...cur.scores }; if (scores[key] === v) delete scores[key]; else scores[key] = v; return { ...r, [reg]: { ...cur, scores } }; });
  const isDone = (s: Stu) => rows[s.reg]?.present === false || Object.keys(rows[s.reg]?.scores || {}).length >= crit.length;
  const done = room.students.filter(isDone).length;
  // a colour per rubric criterion, so each column reads at a glance
  const TONE = [
    { head: 'bg-teal-50 text-teal-800', on: 'bg-teal-600 text-white ring-teal-600', off: 'text-teal-700 ring-teal-200 hover:bg-teal-50' },
    { head: 'bg-indigo-50 text-indigo-800', on: 'bg-indigo-600 text-white ring-indigo-600', off: 'text-indigo-700 ring-indigo-200 hover:bg-indigo-50' },
    { head: 'bg-amber-50 text-amber-800', on: 'bg-amber-500 text-white ring-amber-500', off: 'text-amber-700 ring-amber-200 hover:bg-amber-50' },
    { head: 'bg-rose-50 text-rose-800', on: 'bg-rose-500 text-white ring-rose-500', off: 'text-rose-700 ring-rose-200 hover:bg-rose-50' },
    { head: 'bg-emerald-50 text-emerald-800', on: 'bg-emerald-600 text-white ring-emerald-600', off: 'text-emerald-700 ring-emerald-200 hover:bg-emerald-50' },
    { head: 'bg-sky-50 text-sky-800', on: 'bg-sky-600 text-white ring-sky-600', off: 'text-sky-700 ring-sky-200 hover:bg-sky-50' },
    { head: 'bg-violet-50 text-violet-800', on: 'bg-violet-600 text-white ring-violet-600', off: 'text-violet-700 ring-violet-200 hover:bg-violet-50' },
    { head: 'bg-orange-50 text-orange-800', on: 'bg-orange-500 text-white ring-orange-500', off: 'text-orange-700 ring-orange-200 hover:bg-orange-50' },
  ];
  // students of one batch stay together as one block
  const groups: { batch: string; list: Stu[] }[] = [];
  for (const s of filtered) {
    const b = s.batchNo || '—';
    const g = groups[groups.length - 1];
    if (g && g.batch === b) g.list.push(s); else groups.push({ batch: b, list: [s] });
  }
  return (
    <div className="space-y-3 pb-16">
      {header}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="mr-auto">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{room.program.title}</p>
            <h2 className="text-lg font-bold text-slate-800">Room {room.label} · {room.session.name}</h2>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{done}/{room.students.length} done</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reg no / name / batch"
            className="w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-500" />
        </div>
        <p className="mt-1 text-sm text-slate-500">{editable ? `Tap a mark for each heading (max ${room.maxTotal}). Tap it again to clear. Save anytime — you can edit until the room is closed.` : 'This room is closed — marks are read-only.'}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Marks scale</span>
          {bands.map((b) => <span key={b} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">{b}</span>)}
        </div>
      </div>
      {error && <div className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}
      {note && <div className="rounded-xl bg-green-50 px-4 py-2.5 text-sm font-medium text-green-700">{note}</div>}
      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="sticky top-0 z-10 bg-white text-[11px] uppercase tracking-wide text-slate-500 shadow-[0_1px_0_rgba(0,0,0,0.06)]">
            <tr>
              <th className="px-2 py-2 text-left font-semibold">Batch</th>
              <th className="px-2 py-2 text-left font-semibold">Reg No</th>
              <th className="px-2 py-2 text-left font-semibold">Student</th>
              <th className="px-2 py-2 text-left font-semibold">Project</th>
              {crit.map((c, i) => <th key={c.key} title={`${c.label} (max ${c.max})`} className={`px-2 py-2 text-center text-[10px] font-semibold leading-tight ${TONE[i % TONE.length].head}`}>{c.label}<span className="block font-normal normal-case opacity-70">max {c.max}</span></th>)}
              <th className="px-2 py-2 text-center font-semibold">Total</th>
              <th className="px-2 py-2 text-center font-semibold">P/A</th>
            </tr>
          </thead>
          {groups.map((g, gi) => (
            <tbody key={g.batch + gi} className={`border-t-4 border-slate-100 ${gi % 2 ? 'bg-slate-50/50' : ''}`}>
              {g.list.map((s, ri) => {
                const r = rows[s.reg] || { present: true, scores: {}, project: '' };
                const t = totalOf(s.reg);
                return (
                  <tr key={s.reg} className={`border-t border-slate-100 ${r.present ? '' : 'bg-rose-50/50 text-slate-400'}`}>
                    {ri === 0 && (
                      <td rowSpan={g.list.length} className="border-r border-slate-100 px-2 py-1.5 align-middle">
                        <span className="rounded-lg bg-teal-600 px-2 py-1 text-xs font-bold text-white">{g.batch}</span>
                        <span className="mt-1 block text-[10px] text-slate-400">{g.list.length} students</span>
                      </td>
                    )}
                    <td className="px-2 py-1.5 font-mono text-xs text-slate-600">{s.reg}</td>
                    <td className="max-w-[210px] truncate px-2 py-1.5 font-medium text-slate-800" title={s.name}>{s.name}</td>
                    <td className="px-2 py-1.5">
                      <input value={r.project} disabled={!editable} placeholder="Project title"
                        onChange={(e) => setRows({ ...rows, [s.reg]: { ...r, project: e.target.value } })}
                        className="w-36 rounded-md border border-slate-200 px-2 py-1 text-xs outline-none focus:border-teal-500 disabled:bg-transparent" />
                    </td>
                    {crit.map((c, i) => {
                      const tone = TONE[i % TONE.length];
                      return (
                        <td key={c.key} className="px-1.5 py-1.5">
                          <div className="flex justify-center gap-0.5">
                            {choicesOf(c.max).map((o) => {
                              const on = r.scores[c.key] === o.v;
                              return (
                                <button key={o.v} type="button" disabled={!editable || !r.present} title={`${o.band} — ${o.v}/${c.max}`}
                                  onClick={() => setScore(s.reg, c.key, o.v)}
                                  className={`h-6 w-6 rounded-md text-[11px] font-bold ring-1 transition disabled:opacity-40 ${on ? tone.on : `bg-white ${tone.off}`}`}>{o.v}</button>
                              );
                            })}
                          </div>
                        </td>
                      );
                    })}
                    <td className={`px-2 py-1.5 text-center text-sm font-bold tabular-nums ${isDone(s) && r.present ? 'text-teal-700' : 'text-slate-400'}`}>{t}</td>
                    <td className="px-2 py-1.5 text-center">
                      <button disabled={!editable} onClick={() => setRows({ ...rows, [s.reg]: { ...r, present: !r.present } })}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${r.present ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'} disabled:opacity-60`}>{r.present ? 'P' : 'A'}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
        {!filtered.length && <p className="p-6 text-center text-sm text-slate-400">No student matches "{q}".</p>}
      </div>
      {editable && (
        <div className="sticky bottom-3">
          <button disabled={saving} onClick={saveReview} className="w-full rounded-xl bg-teal-600 py-3 font-bold text-white shadow-lg hover:bg-teal-700 disabled:opacity-50">{saving ? 'Saving…' : `Save marks (${done}/${room.students.length} done)`}</button>
        </div>
      )}
    </div>
  );
}

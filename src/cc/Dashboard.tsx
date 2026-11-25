// Coordinator dashboard for one hackathon: overview, live rooms, students, faculty & batches,
// projects, schedule, rubric and downloads.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Board, BoardRoom, byNatural, cc, Check, Detail, FacultyRow, roomKey, Session, Stu } from './ccApi';
import { Timeline } from './editors';
import { phaseOf, rubricTotal, windowOf } from './plan';
import { downloadXlsx, safeName } from './sheets';
import { Badge, Btn, Card, cx, Empty, errMsg, Field, fmtDate, fmtTime, Input, Modal, Note, Select, Spinner, Stat, toast } from './ui';
import { ProjectsStep, RoomsStep, RubricStep, ScheduleStep } from './Wizard';

const TABS = [
  { id: '', label: 'Overview', icon: '◎' },
  { id: 'live', label: 'Live rooms', icon: '●' },
  { id: 'students', label: 'Students', icon: '👥' },
  { id: 'faculty', label: 'Faculty & batches', icon: '🧑‍🏫' },
  { id: 'projects', label: 'Projects', icon: '🧩' },
  { id: 'schedule', label: 'Schedule', icon: '🗓' },
  { id: 'rubric', label: 'Rubric', icon: '📐' },
  { id: 'downloads', label: 'Downloads', icon: '⬇' },
];

export default function Dashboard() {
  const { id = '', '*': rest = '' } = useParams();
  const tab = rest.split('/')[0];
  const nav = useNavigate();
  const [d, setD] = useState<Detail | null>(null); const [err, setErr] = useState('');
  const load = useCallback(async () => { try { setD(await cc.get<Detail>(`/api/admin/programs/${id}`)); } catch (e) { setErr(errMsg(e)); } }, [id]);
  useEffect(() => { load(); }, [load]);
  if (err) return <div className="space-y-3"><Note tone="error">{err}</Note><Link to="/coordinator" className="text-sm text-indigo-600 hover:underline">← My hackathons</Link></div>;
  if (!d) return <Spinner label="Loading the hackathon…" />;
  const m = d.program.meta || {};
  const props = { d, reload: load, next: () => {}, embedded: true };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Link to="/coordinator" className="text-xs font-semibold text-indigo-600 hover:underline">← My hackathons</Link>
          <h2 className="mt-1 truncate text-2xl font-bold tracking-tight text-slate-900">{d.program.title}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            {m.status === 'live' ? <Badge tone="green">● Live</Badge> : <Badge tone="amber">In setup</Badge>}
            <span>{[m.courseCode, m.courseName].filter(Boolean).join(' · ')}</span>
            {m.academicYear && <span>· {m.academicYear}{m.semester ? ` ${m.semester} sem` : ''}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn size="sm" onClick={() => nav(`/coordinator/p/${id}/setup/1`)}>Edit course details</Btn>
          {m.status !== 'live' && <Btn size="sm" kind="primary" onClick={() => nav(`/coordinator/p/${id}/setup/${m.step || 1}`)}>Continue setup →</Btn>}
        </div>
      </div>
      <nav className="-mx-1 flex gap-1 overflow-x-auto rounded-2xl bg-white p-1 shadow-sm ring-1 ring-slate-200/70">
        {TABS.map((t) => (
          <Link key={t.id} to={`/coordinator/p/${id}${t.id ? `/${t.id}` : ''}`} className={cx('flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition', tab === t.id ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50')}>
            <span className={cx('text-xs', t.id === 'live' && tab !== 'live' && 'text-emerald-500')}>{t.icon}</span>{t.label}
          </Link>
        ))}
      </nav>
      {tab === '' && <Overview d={d} />}
      {tab === 'live' && <Live d={d} />}
      {tab === 'students' && <Students d={d} reload={load} />}
      {tab === 'faculty' && <FacultyTab d={d} reload={load} />}
      {tab === 'projects' && <ProjectsStep {...props} />}
      {tab === 'schedule' && <ScheduleStep {...props} />}
      {tab === 'rubric' && <RubricStep {...props} />}
      {tab === 'downloads' && <Downloads d={d} />}
    </div>
  );
}

// ---------------- overview ----------------
function Overview({ d }: { d: Detail }) {
  const nav = useNavigate();
  const [checks, setChecks] = useState<Check[] | null>(null);
  useEffect(() => { cc.get<{ checks: Check[] }>(`/api/admin/programs/${d.program.id}/checks`).then((r) => setChecks(r.checks)).catch(() => setChecks([])); }, [d.program.id]);
  const sessions = [...d.sessions].sort((a, b) => (windowOf(a)?.start || 0) - (windowOf(b)?.start || 0));
  const now = sessions.find((s) => phaseOf(s) === 'live');
  const upcoming = sessions.find((s) => phaseOf(s) === 'upcoming');
  const faculty = new Set(d.rooms.flatMap((r) => r.faculty.map((f) => f.key))).size;
  const noMail = new Set(d.rooms.flatMap((r) => r.faculty.filter((f) => !f.hasEmail).map((f) => f.key))).size;
  const batches = d.rooms.reduce((n, r) => n + r.batches, 0);
  const issues = (checks || []).filter((c) => c.level !== 'ok');
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Students" value={d.students} sub={`${d.rooms.length} rooms`} tone="indigo" />
        <Stat label="Faculty" value={faculty} sub={noMail ? `${noMail} without email` : 'all can sign in'} tone={noMail ? 'amber' : 'green'} />
        <Stat label="Batches" value={batches} sub={`${d.program.meta?.batchSize || d.batchSize} per batch`} />
        <Stat label="Projects" value={d.projects} sub={d.projects ? 'own list' : 'course register'} />
        <Stat label="Rubric" value={rubricTotal(d.rubric)} sub="marks per review" />
      </div>
      {now ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-4 text-white shadow-sm">
          <div><div className="text-xs font-semibold uppercase tracking-wide text-emerald-100">Happening now</div><div className="text-lg font-bold">{now.name}</div><div className="text-sm text-emerald-50">{now.kind === 'review' ? 'Review' : 'Attendance'} · until {fmtTime(now.endTime)} · {(now.openRooms || []).length} of {d.rooms.length} rooms open</div></div>
          <Btn kind="dark" onClick={() => nav(`/coordinator/p/${d.program.id}/live?s=${now.id}`)}>Open live rooms →</Btn>
        </div>
      ) : upcoming ? (
        <Note tone="info">Next: <b>{upcoming.name}</b> on {fmtDate(upcoming.date)} at {fmtTime(upcoming.startTime)}{upcoming.auto ? ': rooms open automatically.' : ': open the rooms by hand from Live rooms.'}</Note>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card title="Timeline" hint="Every attendance check and review" right={<Btn size="sm" onClick={() => nav(`/coordinator/p/${d.program.id}/schedule`)}>Edit</Btn>}>
          {sessions.length ? <Timeline rows={sessions} /> : <Empty icon="🗓" title="No sessions yet">Add them in the Schedule tab.</Empty>}
          <div className="mt-4 divide-y divide-slate-100">
            {sessions.map((s) => { const p = phaseOf(s); return (
              <div key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0"><span className="font-medium text-slate-800">{s.name}</span><span className="ml-2 text-xs text-slate-500">{fmtDate(s.date)} · {fmtTime(s.startTime)}–{fmtTime(s.endTime)}</span></div>
                <div className="flex shrink-0 items-center gap-1.5">{s.auto && <Badge tone="sky">auto</Badge>}<Badge tone={s.kind === 'review' ? 'indigo' : 'slate'}>{s.kind}</Badge><Badge tone={p === 'live' ? 'green' : p === 'over' ? 'slate' : 'amber'}>{p === 'live' ? 'now' : p === 'over' ? 'done' : p === 'upcoming' ? 'upcoming' : 'no time'}</Badge></div>
              </div>
            ); })}
          </div>
        </Card>
        <Card title="Health check" hint={checks ? (issues.length ? `${issues.length} thing(s) to look at` : 'Everything looks ready') : 'Checking…'}>
          {!checks ? <Spinner /> : (
            <div className="space-y-2">
              {(issues.length ? issues : checks).slice(0, 12).map((c, i) => <Note key={i} tone={c.level === 'ok' ? 'ok' : c.level === 'warn' ? 'warn' : 'error'}><b>{c.area}:</b> {c.text}</Note>)}
            </div>
          )}
        </Card>
      </div>
      <Card title="Rooms" hint="Students, faculty and review load per room" pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2">Room</th><th className="px-4 py-2">Students</th><th className="px-4 py-2">Batches</th><th className="px-4 py-2">Faculty · batches each</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {d.rooms.map((r) => (
                <tr key={r.room}><td className="px-4 py-2.5 font-semibold text-slate-800">{r.label}</td><td className="px-4 py-2.5 tabular-nums">{r.students}</td><td className="px-4 py-2.5 tabular-nums">{r.batches || '—'}</td>
                  <td className="px-4 py-2.5"><div className="flex flex-wrap gap-1">{r.faculty.length ? r.faculty.map((f) => { const rv = r.reviewers.find((x) => x.key === f.key); return <Badge key={f.key} tone={f.hasEmail ? 'indigo' : 'amber'}>{f.name}{rv ? ` · ${rv.batches}` : ''}{!f.hasEmail ? ' · no email' : ''}</Badge>; }) : <Badge tone="red">no faculty</Badge>}</div></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ---------------- live rooms ----------------
function Live({ d }: { d: Detail }) {
  const sessions = useMemo(() => [...d.sessions].sort((a, b) => (windowOf(a)?.start || 0) - (windowOf(b)?.start || 0)), [d.sessions]);
  const initial = new URLSearchParams(window.location.search).get('s') || sessions.find((s) => phaseOf(s) === 'live')?.id || sessions.find((s) => phaseOf(s) === 'upcoming')?.id || sessions[sessions.length - 1]?.id || '';
  const [sid, setSid] = useState(initial);
  const [b, setB] = useState<Board | null>(null); const [busy, setBusy] = useState(false); const [q, setQ] = useState('');
  const [room, setRoom] = useState<BoardRoom | null>(null);
  const load = useCallback(async () => { if (!sid) return; try { setB(await cc.get<Board>(`/api/admin/program-sessions/${sid}/board`)); } catch (e) { toast(errMsg(e), 'error'); } }, [sid]);
  useEffect(() => { setB(null); load(); const t = setInterval(load, 20_000); return () => clearInterval(t); }, [load]);
  const setOpen = async (open: boolean, rooms: string[] | 'ALL') => {
    setBusy(true);
    try { await cc.post(`/api/admin/program-sessions/${sid}/rooms`, { open, rooms }); await load(); toast(open ? 'Opened' : 'Closed'); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  if (!sessions.length) return <Empty icon="🗓" title="No sessions yet">Add attendance checks and reviews in the Schedule tab.</Empty>;
  const s = b?.session; const isRev = s?.kind === 'review';
  const shown = (b?.rooms || []).filter((r) => !q || `${r.label} ${r.faculty.map((f) => f.name).join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={sid} onChange={(e) => setSid(e.target.value)} className="max-w-md">
          {sessions.map((x) => { const p = phaseOf(x); return <option key={x.id} value={x.id}>{p === 'live' ? '● ' : ''}{x.name} · {x.kind} · {fmtDate(x.date)} {fmtTime(x.startTime)}</option>; })}
        </Select>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a room or faculty" className="max-w-xs" />
        <span className="ml-auto" />
        <Btn size="sm" onClick={load}>↻ Refresh</Btn>
        <Btn size="sm" kind="primary" disabled={busy || !b} onClick={() => setOpen(true, 'ALL')}>Open all rooms</Btn>
        <Btn size="sm" kind="danger" disabled={busy || !b} onClick={() => window.confirm('Close every room for this session?') && setOpen(false, 'ALL')}>Close all</Btn>
      </div>
      {!b ? <Spinner label="Loading the rooms…" /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Rooms open" value={`${b.summary.open} / ${b.summary.rooms}`} tone={b.summary.open ? 'green' : 'slate'} sub={s?.auto ? `auto: ${fmtTime(s.startTime)}–${fmtTime(s.endTime)}` : 'opened by hand'} />
            <Stat label={isRev ? 'Rooms with marks' : 'Rooms posted'} value={`${b.summary.posted} / ${b.summary.rooms}`} tone="indigo" />
            {isRev ? <Stat label="Students marked" value={`${b.summary.scored} / ${b.summary.students}`} sub={`out of ${b.maxTotal} marks`} tone="indigo" />
              : <Stat label="Present" value={b.summary.present} sub={`${b.summary.absent} absent`} tone="green" />}
            <Stat label="Rooms without faculty" value={b.summary.noFaculty} tone={b.summary.noFaculty ? 'red' : 'slate'} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((r) => (
              <div key={r.room} className={cx('rounded-2xl bg-white p-4 shadow-sm ring-1 transition', r.open ? 'ring-emerald-300' : 'ring-slate-200/70')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><div className="text-base font-bold text-slate-900">{r.label}</div><div className="truncate text-xs text-slate-500">{r.faculty.map((f) => f.name).join(', ') || 'no faculty'}</div></div>
                  {r.open ? <Badge tone="green">● Open</Badge> : <Badge>Closed</Badge>}
                </div>
                <div className="mt-3 flex items-center gap-3 text-sm">
                  <span className="tabular-nums text-slate-600">{r.students} students</span>
                  {r.posted ? (isRev ? <Badge tone="indigo">{r.scored} marked · avg {r.avg ?? '—'}</Badge> : <Badge tone="indigo">{r.present} P · {r.absent} A</Badge>) : <Badge tone="amber">{isRev ? 'no marks yet' : 'not posted'}</Badge>}
                </div>
                {r.postedBy && <div className="mt-1 text-[11px] text-slate-400">by {r.postedBy}{r.postedAt ? ` · ${new Date(r.postedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : ''}</div>}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Btn size="sm" kind={r.open ? 'danger' : 'primary'} disabled={busy} onClick={() => setOpen(!r.open, [r.room])}>{r.open ? 'Close' : 'Open'}</Btn>
                  <Btn size="sm" onClick={() => setRoom(r)}>View</Btn>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {room && s && <RoomModal session={s} room={room} onClose={() => setRoom(null)} onChanged={load} />}
    </div>
  );
}

interface RoomStu extends Stu { reviewerName: string; present: boolean | null; scored?: boolean; total?: number | null; percentage?: number | null; grade?: string }
function RoomModal({ session, room, onClose, onChanged }: { session: Session; room: BoardRoom; onClose: () => void; onChanged: () => void }) {
  const [x, setX] = useState<{ students: RoomStu[]; maxTotal?: number; posting?: { facultyName: string; postedAt: string } | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => cc.get<typeof x>(`/api/admin/program-sessions/${session.id}/rooms/${encodeURIComponent(room.room)}`).then(setX).catch((e) => toast(errMsg(e), 'error')), [session.id, room.room]);
  useEffect(() => { load(); }, [load]);
  const isRev = session.kind === 'review';
  const revoke = async () => {
    if (!window.confirm(isRev ? `Clear all marks in ${room.label} for ${session.name}? Faculty can then mark again.` : `Clear the attendance posted for ${room.label}? Faculty can then post again.`)) return;
    setBusy(true);
    try { await cc.post(`/api/admin/program-sessions/${session.id}/rooms/${encodeURIComponent(room.room)}/revoke`); toast('Cleared: faculty can submit again'); await load(); onChanged(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  const download = () => x && downloadXlsx(`${safeName(room.label)}_${safeName(session.name)}.xlsx`, [{ name: room.label.slice(0, 30), title: `${room.label} · ${session.name}`, rows: x.students.map((s) => ({ 'Reg No': s.reg, Name: s.name, Batch: s.batchNo, Reviewer: s.reviewerName, Project: s.project, ...(isRev ? { Present: s.present == null ? 'Not scored' : s.present ? 'Present' : 'Absent', Total: s.total ?? '', '%': s.percentage ?? '', Grade: s.grade || '' } : { Status: s.present == null ? 'Not posted' : s.present ? 'Present' : 'Absent' }) })) }]);
  const posted = isRev ? x?.students.some((s) => s.scored) : !!x?.posting;
  return (
    <Modal open wide title={`${room.label} · ${session.name}`} onClose={onClose}
      footer={<><Btn kind="danger" disabled={busy || !posted} onClick={revoke}>{isRev ? 'Clear marks' : 'Clear attendance'}</Btn><span className="mr-auto" /><Btn disabled={!x} onClick={download}>Download</Btn><Btn kind="primary" onClick={onClose}>Done</Btn></>}>
      {!x ? <Spinner /> : (
        <div className="space-y-3">
          {!isRev && x.posting && <Note tone="ok">Posted by {x.posting.facultyName} at {new Date(x.posting.postedAt).toLocaleString('en-IN')}.</Note>}
          {!posted && <Note tone="warn">{isRev ? 'No marks have been entered yet.' : 'Attendance has not been posted yet.'}</Note>}
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"><tr><th className="py-1.5">Reg No</th><th>Name</th><th>Batch</th>{isRev ? <><th>Reviewer</th><th className="text-right">Marks</th><th className="text-right">Grade</th></> : <th className="text-right">Status</th>}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {x.students.map((s) => (
                <tr key={s.reg}><td className="py-1.5 font-mono text-xs">{s.reg}</td><td>{s.name}</td><td>{s.batchNo || '—'}</td>
                  {isRev ? <><td className="text-xs text-slate-500">{s.reviewerName || '—'}</td><td className="text-right tabular-nums">{s.present === false ? <Badge tone="red">absent</Badge> : s.total ?? '—'}{s.total != null && x.maxTotal ? <span className="text-slate-400"> / {x.maxTotal}</span> : ''}</td><td className="text-right text-xs">{s.grade || ''}</td></>
                    : <td className="text-right">{s.present == null ? <span className="text-slate-400">—</span> : s.present ? <Badge tone="green">Present</Badge> : <Badge tone="red">Absent</Badge>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

// ---------------- students ----------------
function Students({ d, reload }: { d: Detail; reload: () => Promise<void> }) {
  const [list, setList] = useState<Stu[] | null>(null); const [q, setQ] = useState(''); const [roomF, setRoomF] = useState('');
  const [edit, setEdit] = useState<Partial<Stu> & { isNew?: boolean } | null>(null); const [busy, setBusy] = useState(false);
  const load = useCallback(() => cc.get<{ students: Stu[] }>(`/api/admin/programs/${d.program.id}/students`).then((r) => setList(r.students.sort((a, b) => byNatural(a.room, b.room) || byNatural(a.batchNo, b.batchNo) || byNatural(a.reg, b.reg)))).catch((e) => toast(errMsg(e), 'error')), [d.program.id]);
  useEffect(() => { load(); }, [load]);
  const rooms = d.rooms.map((r) => r.label);
  const shown = (list || []).filter((s) => (!roomF || roomKey(s.room) === roomKey(roomF)) && (!q || `${s.reg} ${s.name} ${s.batchNo} ${s.project} ${s.branch} ${s.section}`.toLowerCase().includes(q.toLowerCase())));
  const save = async () => {
    if (!edit) return; setBusy(true);
    try {
      const body = { name: edit.name, branch: edit.branch, section: edit.section, room: edit.room, batchNo: edit.batchNo, project: edit.project, courseCode: edit.courseCode, courseName: edit.courseName };
      if (edit.isNew) { await cc.post(`/api/admin/programs/${d.program.id}/student-add`, { reg: edit.reg, ...body }); toast(`${edit.reg} added`); }
      else { const r = await cc.post<{ moved: boolean }>(`/api/admin/programs/${d.program.id}/student/${encodeURIComponent(edit.reg || '')}`, body); toast(r.moved ? 'Moved: the new room’s faculty now review this student' : 'Saved'); }
      setEdit(null); await load(); await reload();
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  const remove = async (s: Stu) => {
    if (!window.confirm(`Remove ${s.reg} ${s.name} from this hackathon?`)) return;
    try { await cc.post(`/api/admin/programs/${d.program.id}/student/${encodeURIComponent(s.reg)}/delete`); toast('Removed'); await load(); await reload(); } catch (e) { toast(errMsg(e), 'error'); }
  };
  const names = useMemo(() => new Map(d.rooms.flatMap((r) => r.faculty.map((f) => [f.key, f.name] as const))), [d.rooms]);
  return (
    <Card title={`Students (${list?.length ?? '…'})`} hint="Edit, move to another room, add or remove. Moving a student gives them the new room’s faculty automatically." pad={false}
      right={<><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reg, name, batch, project" className="w-64 py-1.5 text-xs" /><Select value={roomF} onChange={(e) => setRoomF(e.target.value)} className="w-40 py-1.5 text-xs"><option value="">All rooms</option>{rooms.map((r) => <option key={r}>{r}</option>)}</Select><Btn size="sm" kind="primary" onClick={() => setEdit({ isNew: true, room: roomF || rooms[0] || '', reg: '', name: '' })}>＋ Add student</Btn></>}>
      {!list ? <div className="p-5"><Spinner /></div> : !shown.length ? <div className="p-5"><Empty title="No students match" /></div> : (
        <div className="max-h-[640px] overflow-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2">Reg No</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">Branch · Sec</th><th className="px-4 py-2">Room</th><th className="px-4 py-2">Batch</th><th className="px-4 py-2">Reviewer</th><th className="px-4 py-2">Project</th><th className="px-4 py-2" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {shown.slice(0, 600).map((s) => (
                <tr key={s.reg} className="hover:bg-slate-50/60">
                  <td className="px-4 py-2 font-mono text-xs">{s.reg}</td><td className="px-4 py-2 font-medium text-slate-800">{s.name}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{[s.branch, s.section].filter(Boolean).join(' · ')}</td><td className="px-4 py-2">{s.room}</td>
                  <td className="px-4 py-2">{s.batchNo ? <Badge tone="indigo">{s.batchNo}</Badge> : <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-2 text-xs">{names.get(s.reviewer) || <span className="text-slate-300">—</span>}</td>
                  <td className="max-w-[220px] truncate px-4 py-2 text-xs text-slate-600" title={s.project}>{s.project || <span className="text-slate-300">—</span>}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right"><button className="mr-3 text-xs font-semibold text-indigo-600 hover:underline" onClick={() => setEdit({ ...s })}>Edit</button><button className="text-xs font-semibold text-rose-600 hover:underline" onClick={() => remove(s)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length > 600 && <div className="p-3 text-center text-xs text-slate-500">Showing 600 of {shown.length}: search to narrow down.</div>}
        </div>
      )}
      <Modal open={!!edit} title={edit?.isNew ? 'Add a student' : `Edit ${edit?.reg}`} onClose={() => setEdit(null)}
        footer={<><Btn onClick={() => setEdit(null)}>Cancel</Btn><Btn kind="primary" disabled={busy || !edit?.reg?.trim() || !edit?.name?.trim()} onClick={save}>{busy ? 'Saving…' : 'Save'}</Btn></>}>
        {edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Reg No *"><Input value={edit.reg || ''} disabled={!edit.isNew} onChange={(e) => setEdit({ ...edit, reg: e.target.value.trim() })} /></Field>
            <Field label="Name *"><Input value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Branch"><Input value={edit.branch || ''} onChange={(e) => setEdit({ ...edit, branch: e.target.value })} /></Field>
            <Field label="Section"><Input value={edit.section || ''} onChange={(e) => setEdit({ ...edit, section: e.target.value })} /></Field>
            <Field label="Room" hint="Faculty follow the room."><Select value={rooms.find((r) => roomKey(r) === roomKey(edit.room || '')) || edit.room || ''} onChange={(e) => setEdit({ ...edit, room: e.target.value })}>{rooms.map((r) => <option key={r}>{r}</option>)}</Select></Field>
            <Field label="Batch" hint="Same batch number = same team."><Input value={edit.batchNo || ''} onChange={(e) => setEdit({ ...edit, batchNo: e.target.value.toUpperCase() })} placeholder="B3" /></Field>
            <Field label="Project" className="sm:col-span-2"><Input value={edit.project || ''} onChange={(e) => setEdit({ ...edit, project: e.target.value })} /></Field>
            <Field label="Course code"><Input value={edit.courseCode || ''} onChange={(e) => setEdit({ ...edit, courseCode: e.target.value.toUpperCase() })} /></Field>
            <Field label="Course name"><Input value={edit.courseName || ''} onChange={(e) => setEdit({ ...edit, courseName: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </Card>
  );
}

// ---------------- faculty & batches ----------------
function FacultyTab({ d, reload }: { d: Detail; reload: () => Promise<void> }) {
  const [fac, setFac] = useState<FacultyRow[] | null>(null); const [students, setStudents] = useState<Stu[]>([]);
  const load = useCallback(async () => {
    const [f, s] = await Promise.all([cc.get<{ faculty: FacultyRow[] }>(`/api/admin/programs/${d.program.id}/faculty`), cc.get<{ students: Stu[] }>(`/api/admin/programs/${d.program.id}/students`)]);
    setFac(f.faculty); setStudents(s.students);
  }, [d.program.id]);
  useEffect(() => { load().catch((e) => toast(errMsg(e), 'error')); }, [load, d]);
  const batches = useMemo(() => {
    const m = new Map<string, { room: string; label: string; batchNo: string; n: number; reviewer: string }>();
    for (const s of students) if (s.batchNo) { const k = `${roomKey(s.room)}|${s.batchNo}`; const b = m.get(k) || { room: roomKey(s.room), label: s.room, batchNo: s.batchNo, n: 0, reviewer: s.reviewer }; b.n++; m.set(k, b); }
    return [...m.values()].sort((a, b) => byNatural(a.label, b.label) || byNatural(a.batchNo, b.batchNo));
  }, [students]);
  const setReviewer = async (b: { room: string; batchNo: string }, reviewer: string) => {
    try { await cc.post(`/api/admin/programs/${d.program.id}/batch-reviewer`, { room: b.room, batchNo: b.batchNo, reviewer }); toast(`Batch ${b.batchNo} handed over`); await load(); await reload(); } catch (e) { toast(errMsg(e), 'error'); }
  };
  return (
    <div className="space-y-5">
      <Card title="Faculty access" hint="Faculty sign in with their Emp ID or this email; a code is sent there." pad={false}>
        {!fac ? <div className="p-5"><Spinner /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2">Faculty</th><th className="px-4 py-2">Emp ID</th><th className="px-4 py-2">Email</th><th className="px-4 py-2">Rooms</th><th className="px-4 py-2">Students</th><th className="px-4 py-2">Review load</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {fac.map((f) => (
                  <tr key={f.key}><td className="px-4 py-2.5 font-semibold text-slate-800">{f.name}</td><td className="px-4 py-2.5 font-mono text-xs">{f.empId || '—'}</td>
                    <td className="px-4 py-2.5 text-xs">{f.email || <Badge tone="amber">no email: cannot sign in</Badge>}</td>
                    <td className="px-4 py-2.5 text-xs">{f.rooms.join(', ')}</td><td className="px-4 py-2.5 tabular-nums">{f.students}</td>
                    <td className="px-4 py-2.5">{f.batches ? <Badge tone={f.reviewStudents > 45 ? 'amber' : 'green'}>{f.batches} batches · {f.reviewStudents} students</Badge> : <span className="text-xs text-slate-400">—</span>}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <RoomsStep d={d} reload={async () => { await reload(); await load(); }} next={() => {}} embedded />
      <Card title="Batch reviewers" hint="Batches are shared equally among each room’s faculty. Hand a batch to another faculty of the same room here." pad={false}>
        {!batches.length ? <div className="p-5"><Empty icon="🧩" title="No batches yet">{d.program.meta?.autoBatch === false ? 'Faculty form the batches during the review.' : 'Make them in setup step 5.'}</Empty></div> : (
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2">Room</th><th className="px-4 py-2">Batch</th><th className="px-4 py-2">Members</th><th className="px-4 py-2">Reviewer</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {batches.map((b) => { const r = d.rooms.find((x) => x.room === b.room); return (
                  <tr key={b.room + b.batchNo}><td className="px-4 py-2 font-medium">{b.label}</td><td className="px-4 py-2"><Badge tone="indigo">{b.batchNo}</Badge></td><td className="px-4 py-2 tabular-nums">{b.n}</td>
                    <td className="px-4 py-2"><Select value={b.reviewer} onChange={(e) => setReviewer(b, e.target.value)} className="max-w-xs py-1.5 text-xs"><option value="" disabled>— pick —</option>{(r?.faculty || []).map((f) => <option key={f.key} value={f.key}>{f.name}</option>)}</Select></td></tr>
                ); })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------- downloads ----------------
interface RepStu { reg: string; name: string; branch: string; section: string; room: string; batchNo: string; project: string; reviewer: string; faculty: string; attendance: Record<string, string>; present: number; posted: number; attendancePct: number | null; scores: Record<string, { present: boolean; total: number; pct: number | null; grade: string } | null>; avg: number | null; avgPct: number | null; grade: string }
interface Report { students: RepStu[]; sessions: { attendance: { id: string; name: string }[]; review: { id: string; name: string }[] }; perSession: Record<string, unknown>[]; rooms: { key: string; label: string; students: number; attendancePct: number | null; marked: number; avgMarks: number | null; avgPct: number | null }[]; maxTotal: number }
function Downloads({ d }: { d: Detail }) {
  const [busy, setBusy] = useState(''); const base = safeName(d.program.title);
  const run = async (k: string, f: () => Promise<void>) => { setBusy(k); try { await f(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(''); } };
  const roster = () => run('roster', async () => {
    const { students } = await cc.get<{ students: Stu[] }>(`/api/admin/programs/${d.program.id}/students`);
    const names = new Map(d.rooms.flatMap((r) => r.faculty.map((f) => [f.key, f.name] as const)));
    const rows = students.sort((a, b) => byNatural(a.room, b.room) || byNatural(a.batchNo, b.batchNo) || byNatural(a.reg, b.reg)).map((s) => ({ 'Reg No': s.reg, Name: s.name, Branch: s.branch, Section: s.section, Room: s.room, Faculty: s.facultyList.join(', '), Batch: s.batchNo, Reviewer: names.get(s.reviewer) || '', Project: s.project, 'Project ID': s.ps, 'Course Code': s.courseCode, 'Course Name': s.courseName }));
    const rooms = d.rooms.map((r) => ({ Room: r.label, Students: r.students, Batches: r.batches, Faculty: r.faculty.map((f) => f.name).join(', '), 'Batches per faculty': r.reviewers.map((x) => `${x.name}: ${x.batches}`).join('; ') }));
    downloadXlsx(`${base}_students.xlsx`, [{ name: 'Students', title: d.program.title, rows }, { name: 'Rooms', rows: rooms }]);
  });
  const facultySheet = () => run('faculty', async () => {
    const { faculty } = await cc.get<{ faculty: FacultyRow[] }>(`/api/admin/programs/${d.program.id}/faculty`);
    const me = await cc.get<{ facultyUrl: string }>('/api/cc/me');
    const url = me.facultyUrl || window.location.origin;
    downloadXlsx(`${base}_faculty_signin.xlsx`, [{ name: 'Faculty', title: `${d.program.title}: faculty sign in at ${url}/attendance and ${url}/hackathon-review with Emp ID or email`, rows: faculty.map((f) => ({ Faculty: f.name, 'Emp ID': f.empId, Email: f.email || 'MISSING: cannot sign in', Rooms: f.rooms.join(', '), Students: f.students, 'Review batches': f.batches, 'Review students': f.reviewStudents })) },
      { name: 'Schedule', rows: [...d.sessions].sort((a, b) => (windowOf(a)?.start || 0) - (windowOf(b)?.start || 0)).map((s) => ({ Session: s.name, Type: s.kind, Date: s.date, Start: s.startTime, End: s.endTime, 'Opens automatically': s.auto ? 'Yes' : 'No' })) }]);
  });
  const session = (s: Session) => run(s.id, async () => {
    const r = await cc.get<{ rows: Record<string, unknown>[] }>(`/api/admin/program-sessions/${s.id}/export`);
    downloadXlsx(`${base}_${safeName(s.name)}.xlsx`, [{ name: s.name.slice(0, 30), title: `${d.program.title} · ${s.name} (${s.date} ${s.startTime}–${s.endTime})`, rows: r.rows }]);
  });
  const full = () => run('full', async () => {
    const r = await cc.get<Report>(`/api/admin/programs/${d.program.id}/report`);
    const att = r.sessions.attendance, rev = r.sessions.review;
    const rows = r.students.map((s) => {
      const o: Record<string, unknown> = { 'Reg No': s.reg, Name: s.name, Branch: s.branch, Section: s.section, Room: s.room, Batch: s.batchNo, Project: s.project, Reviewer: s.reviewer };
      for (const a of att) o[a.name] = s.attendance[a.id] || '';
      o['Attendance %'] = s.attendancePct ?? '';
      for (const v of rev) { const m = s.scores[v.id]; o[`${v.name} (/${r.maxTotal})`] = m ? (m.present ? m.total : 'Absent') : ''; }
      o['Average'] = s.avg ?? ''; o['Average %'] = s.avgPct ?? ''; o.Grade = s.grade || '';
      return o;
    });
    downloadXlsx(`${base}_consolidated.xlsx`, [
      { name: 'Consolidated', title: d.program.title, rows },
      { name: 'Sessions', rows: r.perSession },
      { name: 'Rooms', rows: r.rooms.map((x) => ({ Room: x.key, Faculty: x.label, Students: x.students, 'Attendance %': x.attendancePct ?? '', Marked: x.marked, 'Average marks': x.avgMarks ?? '', 'Average %': x.avgPct ?? '' })) },
    ]);
  });
  const sessions = [...d.sessions].sort((a, b) => (windowOf(a)?.start || 0) - (windowOf(b)?.start || 0));
  const Item = ({ k, title, sub, onClick }: { k: string; title: string; sub: string; onClick: () => void }) => (
    <button onClick={onClick} disabled={!!busy} className="flex items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200/70 transition hover:-translate-y-0.5 hover:shadow-md disabled:opacity-60">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-lg text-emerald-700">{busy === k ? '…' : '⬇'}</span>
      <span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-800">{title}</span><span className="block truncate text-xs text-slate-500">{sub}</span></span>
    </button>
  );
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        <Item k="full" title="Consolidated report" sub="Attendance + every review, per student, room and session" onClick={full} />
        <Item k="roster" title="Students, rooms & batches" sub="Who is where, their batch, reviewer and project" onClick={roster} />
        <Item k="faculty" title="Faculty sign-in sheet" sub="Emp ID, email, rooms, load and the schedule" onClick={facultySheet} />
      </div>
      <Card title="Per session" hint="Attendance status or review marks for every student">
        {!sessions.length ? <Empty title="No sessions yet" /> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{sessions.map((s) => <Item key={s.id} k={s.id} title={s.name} sub={`${s.kind === 'review' ? 'Review marks' : 'Attendance'} · ${fmtDate(s.date)} ${fmtTime(s.startTime)}`} onClick={() => session(s)} />)}</div>}
      </Card>
    </div>
  );
}

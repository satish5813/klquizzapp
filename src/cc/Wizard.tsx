// Setup wizard: course → schedule → students → rooms & faculty → reviews & batches → projects → rubric → go live.
import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { byNatural, cc, Check, Detail, FacultyRow, Meta, Project, roomKey, Rubric, Stu } from './ccApi';
import { FacIn, FacultyChips, RubricEditor, ScheduleEditor } from './editors';
import { academicYearNow, batchShare, PlanRow, planIssues, rubricTotal, semesterNow } from './plan';
import { guessColumns, readSheet, Row, Sheet } from './sheets';
import { Badge, Btn, Card, cx, Empty, errMsg, Field, FileDrop, Input, Note, Select, Spinner, toast } from './ui';

export const STEPS = [
  { n: 1, title: 'Course & hackathon', sub: 'Code, name, year, semester, title' },
  { n: 2, title: 'Schedule', sub: 'Attendance checks and reviews' },
  { n: 3, title: 'Students', sub: 'Upload the student list' },
  { n: 4, title: 'Rooms & faculty', sub: 'Map sections to rooms and faculty' },
  { n: 5, title: 'Reviews & batches', sub: 'Team size, shared among faculty' },
  { n: 6, title: 'Projects', sub: 'Upload and map to batches' },
  { n: 7, title: 'Rubric', sub: 'How the reviews are marked' },
  { n: 8, title: 'Check & go live', sub: 'Final checks' },
];

export default function Wizard() {
  const { id, step } = useParams(); const nav = useNavigate();
  const n = id ? Math.max(1, Math.min(8, Number(step) || 1)) : 1;
  const [d, setD] = useState<Detail | null>(null); const [err, setErr] = useState('');
  const load = useCallback(async () => { if (!id) { setD(null); return; } try { setD(await cc.get<Detail>(`/api/admin/programs/${id}`)); } catch (e) { setErr(errMsg(e)); } }, [id]);
  useEffect(() => { load(); }, [load]);
  const go = useCallback(async (k: number, pid = id) => {
    if (!pid) return;
    const reached = Math.max(k, d?.program.meta?.step || 1);
    if (d && reached !== d.program.meta?.step) { await cc.post(`/api/admin/programs/${pid}`, { meta: { step: reached } }).catch(() => {}); await load(); }
    nav(`/coordinator/p/${pid}/setup/${k}`); window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [d, id, nav, load]);
  if (err) return <Note tone="error">{err}</Note>;
  if (id && !d) return <Spinner label="Loading…" />;
  const reached = d?.program.meta?.step || 1;
  const done = (k: number) => !!d && (k < reached || (k === 8 && d.program.meta?.status === 'live'));
  const props = { d: d as Detail, reload: load, next: () => go(n + 1) };
  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200/70">
          <div className="px-2 pb-2 pt-1">
            <div className="truncate text-sm font-semibold text-slate-800">{d?.program.title || 'New hackathon'}</div>
            <div className="text-[11px] text-slate-500">{d?.program.meta?.status === 'live' ? 'Live — editing settings' : 'Setup'}</div>
          </div>
          <ol className="flex gap-1 overflow-x-auto lg:block lg:space-y-0.5">
            {STEPS.map((s) => {
              const can = !!id && s.n <= Math.max(reached, n);
              return (
                <li key={s.n} className="shrink-0">
                  <button disabled={!can} onClick={() => go(s.n)} title={s.title} className={cx('flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition', s.n === n ? 'bg-indigo-50' : can ? 'hover:bg-slate-50' : 'opacity-50')}>
                    <span className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold', s.n === n ? 'bg-indigo-600 text-white' : done(s.n) ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500')}>{done(s.n) && s.n !== n ? '✓' : s.n}</span>
                    <span className={cx('min-w-0', s.n === n ? 'block' : 'hidden lg:block')}><span className={cx('block truncate text-sm font-semibold', s.n === n ? 'text-indigo-800' : 'text-slate-700')}>{s.title}</span><span className="hidden truncate text-[11px] text-slate-400 lg:block">{s.sub}</span></span>
                  </button>
                </li>
              );
            })}
          </ol>
          {id && d?.program.meta?.status === 'live' && <Btn kind="soft" size="sm" className="mt-2 w-full" onClick={() => nav(`/coordinator/p/${id}`)}>← Back to dashboard</Btn>}
        </div>
      </aside>
      <main className="min-w-0">
        {n === 1 && <CourseStep d={d} onSaved={(pid) => go(2, pid)} reload={load} />}
        {n === 2 && d && <ScheduleStep {...props} />}
        {n === 3 && d && <StudentsStep {...props} />}
        {n === 4 && d && <RoomsStep {...props} />}
        {n === 5 && d && <BatchStep {...props} />}
        {n === 6 && d && <ProjectsStep {...props} />}
        {n === 7 && d && <RubricStep {...props} />}
        {n === 8 && d && <GoLiveStep {...props} />}
      </main>
    </div>
  );
}

type StepProps = { d: Detail; reload: () => Promise<void>; next: () => void; embedded?: boolean };
function StepCard({ n, children, actions, title, hint }: { n?: number; children: ReactNode; actions?: ReactNode; title?: string; hint?: ReactNode }) {
  const s = STEPS.find((x) => x.n === n);
  return (
    <Card title={title || (s && <span><span className="mr-2 text-indigo-600">Step {s.n}.</span>{s.title}</span>)} hint={hint || s?.sub}>
      <div className="space-y-5">{children}</div>
      {actions && <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">{actions}</div>}
    </Card>
  );
}

// ---------------- 1. course ----------------
function CourseStep({ d, onSaved, reload }: { d: Detail | null; onSaved: (id: string) => void; reload: () => Promise<void> }) {
  const m = d?.program.meta || {};
  const [f, setF] = useState<Meta & { title: string }>({ title: d?.program.title || '', courseCode: m.courseCode || '', courseName: m.courseName || '', academicYear: m.academicYear || academicYearNow(), semester: m.semester || semesterNow(), department: m.department || '', venue: m.venue || '' });
  const [titleTouched, setTitleTouched] = useState(!!d?.program.title);
  const [busy, setBusy] = useState(false);
  const suggested = [f.courseName || f.courseCode, 'Hackathon', '–', f.academicYear, f.semester && `${f.semester} Sem`].filter(Boolean).join(' ').replace(' – ', ' – ');
  const set = (p: Partial<typeof f>) => setF((x) => { const n = { ...x, ...p }; if (!titleTouched) n.title = [n.courseName || n.courseCode, 'Hackathon', n.academicYear && `– ${n.academicYear}`, n.semester && `${n.semester} Sem`].filter(Boolean).join(' '); return n; });
  const ok = f.title.trim() && f.courseCode?.trim() && f.courseName?.trim();
  const save = async () => {
    setBusy(true);
    try {
      const meta = { courseCode: f.courseCode, courseName: f.courseName, academicYear: f.academicYear, semester: f.semester, department: f.department, venue: f.venue, step: Math.max(2, m.step || 1) };
      if (d) { await cc.post(`/api/admin/programs/${d.program.id}`, { title: f.title, meta }); await reload(); onSaved(d.program.id); }
      else { const p = await cc.post<{ id: string }>('/api/admin/programs', { title: f.title, meta: { ...meta, status: 'draft' } }); onSaved(p.id); }
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <StepCard n={1} actions={<Btn kind="primary" disabled={!ok || busy} onClick={save}>{busy ? 'Saving…' : 'Save & continue →'}</Btn>}>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Course code *"><Input value={f.courseCode} placeholder="26CA5101E" onChange={(e) => set({ courseCode: e.target.value.toUpperCase() })} /></Field>
        <Field label="Course name *" className="md:col-span-2"><Input value={f.courseName} placeholder="Python Programming - 1" onChange={(e) => set({ courseName: e.target.value })} /></Field>
        <Field label="Academic year"><Input value={f.academicYear} placeholder="2026-27" onChange={(e) => set({ academicYear: e.target.value })} /></Field>
        <Field label="Semester"><Select value={f.semester} onChange={(e) => set({ semester: e.target.value })}>{['Odd', 'Even', 'Summer'].map((s) => <option key={s}>{s}</option>)}</Select></Field>
        <Field label="Department / programme"><Input value={f.department} placeholder="MCA, BBA…" onChange={(e) => set({ department: e.target.value })} /></Field>
        <Field label="Hackathon title *" className="md:col-span-2" hint={!titleTouched ? 'Filled in from the course — edit it if you like.' : undefined}>
          <Input value={f.title} placeholder={suggested} onChange={(e) => { setTitleTouched(true); setF({ ...f, title: e.target.value }); }} />
        </Field>
        <Field label="Venue (optional)"><Input value={f.venue} placeholder="S Block" onChange={(e) => set({ venue: e.target.value })} /></Field>
      </div>
    </StepCard>
  );
}

// ---------------- 2. schedule ----------------
const toPlan = (d: Detail): PlanRow[] => d.sessions.map((s) => ({ id: s.id, kind: s.kind, name: s.name, date: s.date, startTime: s.startTime, endTime: s.endTime, auto: s.auto }));
export function ScheduleStep({ d, reload, next, embedded }: StepProps) {
  const [rows, setRows] = useState<PlanRow[]>(() => toPlan(d));
  const [reviews, setReviews] = useState<number>(d.program.meta?.reviews ?? (d.sessions.filter((s) => s.kind === 'review').length || 1));
  const [busy, setBusy] = useState(false);
  const issues = planIssues(rows); const bad = Object.keys(issues).length;
  const revCount = rows.filter((r) => r.kind === 'review').length;
  const save = async (andNext: boolean) => {
    setBusy(true);
    try {
      const r = await cc.post<{ kept: string[] }>(`/api/admin/programs/${d.program.id}/schedule`, { sessions: rows });
      await cc.post(`/api/admin/programs/${d.program.id}`, { meta: { reviews, attendanceCount: rows.filter((x) => x.kind === 'attendance').length } });
      if (r.kept?.length) toast(`Kept because they already hold data: ${r.kept.join(', ')}`, 'error'); else toast('Schedule saved');
      await reload(); if (andNext) next();
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <StepCard n={embedded ? undefined : 2} title={embedded ? 'Schedule' : undefined} hint={embedded ? 'Changing a time re-arms the automatic open / close.' : undefined}
      actions={<>{revCount !== reviews && <span className="mr-auto text-xs text-amber-700">You plan {reviews} review(s) but {revCount} are scheduled.</span>}<Btn disabled={busy || !!bad} onClick={() => save(false)}>Save</Btn>{!embedded && <Btn kind="primary" disabled={busy || !!bad || !rows.length} onClick={() => save(true)}>Save & continue →</Btn>}</>}>
      <ScheduleEditor rows={rows} onChange={setRows} reviews={reviews} onReviews={setReviews} />
      <Note tone="info">Sessions marked <b>Auto</b> open every room at the start time and close them at the end; faculty get an email 5 minutes before. You can still open or close a single room by hand.</Note>
    </StepCard>
  );
}

// ---------------- 3. students ----------------
const STU_FIELDS = ['reg', 'name', 'section', 'branch', 'room', 'courseCode', 'courseName', 'facultyName', 'empId', 'email', 'batchNo'] as const;
const STU_LABEL: Record<string, string> = { reg: 'Reg / University ID *', name: 'Name *', section: 'Section', branch: 'Branch / programme', room: 'Room', courseCode: 'Course code', courseName: 'Course name', facultyName: 'Faculty name', empId: 'Faculty Emp ID', email: 'Faculty email', batchNo: 'Batch / team' };
interface Loaded { sheet: Sheet; map: Record<string, string>; branch: string }
export interface StuIn { reg: string; name: string; branch: string; section: string; room: string; courseCode: string; courseName: string; batchNo: string; faculty: FacIn[] }

function StudentsStep({ d, reload, next }: StepProps) {
  const m = d.program.meta || {};
  const [files, setFiles] = useState<Loaded[]>([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const add = async (fs: File[]) => {
    setErr('');
    try {
      const out: Loaded[] = [];
      for (const f of fs) {
        const sheet = await readSheet(f);
        const map = guessColumns(sheet.headers, [...STU_FIELDS]);
        // a file called "MCA.xlsx" with no branch column → branch MCA
        const branch = map.branch ? '' : f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\b(student|list|final|students|slot|\d+)\b/gi, '').trim().slice(0, 30);
        out.push({ sheet, map, branch });
      }
      setFiles((x) => [...x, ...out]);
    } catch (e) { setErr(`Could not read the file: ${errMsg(e)}`); }
  };
  const merged = useMemo(() => {
    const rows: StuIn[] = []; const seen = new Map<string, string>(); const dups: string[] = []; let invalid = 0;
    for (const f of files) for (const r of f.sheet.rows) {
      const g = (k: string) => (f.map[k] ? r[f.map[k]] || '' : '');
      const reg = g('reg').replace(/\.0$/, '').trim(), name = g('name');
      if (!reg || !name) { invalid++; continue; }
      if (seen.has(reg)) { dups.push(`${reg} (${f.sheet.file} & ${seen.get(reg)})`); continue; }
      seen.set(reg, f.sheet.file);
      const branch = g('branch') || f.branch, section = g('section');
      const fac = g('facultyName') ? g('facultyName').split(/[,;/&]|\band\b/).map((x) => x.trim()).filter(Boolean).map((nm, i) => ({ name: nm, empId: i === 0 ? g('empId') : '', email: i === 0 ? g('email').toLowerCase() : '' })) : [];
      rows.push({ reg, name, branch, section, room: g('room') || [branch, section].filter(Boolean).join(' ') || 'Group 1', courseCode: (g('courseCode') || m.courseCode || '').toUpperCase(), courseName: g('courseName') || m.courseName || '', batchNo: g('batchNo'), faculty: fac });
    }
    const groups = new Map<string, number>(); for (const r of rows) groups.set(r.room, (groups.get(r.room) || 0) + 1);
    return { rows, dups, invalid, groups: [...groups.entries()].sort((a, b) => byNatural(a[0], b[0])) };
  }, [files, m.courseCode, m.courseName]);
  const missing = files.filter((f) => !f.map.reg || !f.map.name);
  const save = async () => {
    if (d.program.meta?.status === 'live' && !window.confirm('This hackathon is live. Replacing the student list keeps attendance already posted, but batches and room faculty will be rebuilt. Continue?')) return;
    setBusy(true);
    try {
      const r = await cc.post<{ total: number; rooms: number; warnings: string[] }>(`/api/admin/programs/${d.program.id}/students/import`, { students: merged.rows.map((s) => ({ ...s, faculty: s.faculty.length ? s.faculty : undefined, facultyName: '' })), replace: true });
      toast(`${r.total} students loaded into ${r.rooms} group(s)`);
      await reload(); next();
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <StepCard n={3} actions={<>{d.students > 0 && !files.length && <Btn kind="primary" onClick={next}>Keep the {d.students} students & continue →</Btn>}{files.length > 0 && <Btn kind="primary" disabled={busy || !merged.rows.length || missing.length > 0} onClick={save}>{busy ? 'Uploading…' : `Upload ${merged.rows.length} students →`}</Btn>}</>}>
      {d.students > 0 && !files.length && <Note tone="ok">{d.students} students are loaded in {d.rooms.length} room(s). Upload again only to replace the list.</Note>}
      <FileDrop onFiles={add} label="Drop the student list(s): one file per programme is fine" />
      {err && <Note tone="error">{err}</Note>}
      {files.map((f, i) => (
        <div key={i} className="rounded-2xl ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
            <div className="text-sm font-semibold text-slate-800">📄 {f.sheet.file} <span className="font-normal text-slate-500">· {f.sheet.rows.length} rows</span></div>
            <button className="text-xs text-rose-600 hover:underline" onClick={() => setFiles(files.filter((_, k) => k !== i))}>Remove</button>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            {STU_FIELDS.map((k) => (
              <Field key={k} label={STU_LABEL[k]}>
                <Select value={f.map[k] || ''} onChange={(e) => setFiles(files.map((x, j) => (j === i ? { ...x, map: { ...x.map, [k]: e.target.value } } : x)))} className={cx(!f.map[k] && (k === 'reg' || k === 'name') && 'border-rose-300')}>
                  <option value="">— not in file —</option>{f.sheet.headers.map((h) => <option key={h}>{h}</option>)}
                </Select>
              </Field>
            ))}
            {!f.map.branch && <Field label="Branch for every row" hint="Taken from the file name"><Input value={f.branch} onChange={(e) => setFiles(files.map((x, j) => (j === i ? { ...x, branch: e.target.value } : x)))} /></Field>}
          </div>
          <Preview rows={f.sheet.rows.slice(0, 4)} headers={Object.values(f.map).filter(Boolean)} />
        </div>
      ))}
      {files.length > 0 && (
        <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
          <div className="space-y-2">
            <Note tone={merged.rows.length ? 'ok' : 'warn'}><b>{merged.rows.length}</b> students ready{merged.invalid ? `, ${merged.invalid} row(s) without a Reg No or name skipped` : ''}.</Note>
            {merged.dups.length > 0 && <Note tone="warn">{merged.dups.length} duplicate Reg No(s) kept once: {merged.dups.slice(0, 4).join('; ')}{merged.dups.length > 4 ? '…' : ''}</Note>}
            {missing.length > 0 && <Note tone="error">Pick the Reg No and Name columns for: {missing.map((f) => f.sheet.file).join(', ')}.</Note>}
            {!m.courseCode && <Note tone="warn">No course code yet: set it in step 1 or map the column.</Note>}
          </div>
          <div className="rounded-2xl ring-1 ring-slate-200">
            <div className="border-b border-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Groups found ({merged.groups.length}). You give each a room and faculty next.</div>
            <div className="flex flex-wrap gap-2 p-3">{merged.groups.map(([g, c]) => <Badge key={g} tone="indigo">{g} · {c}</Badge>)}</div>
          </div>
        </div>
      )}
    </StepCard>
  );
}
function Preview({ rows, headers }: { rows: Row[]; headers: string[] }) {
  if (!rows.length || !headers.length) return null;
  return (
    <div className="overflow-x-auto border-t border-slate-100">
      <table className="w-full text-xs"><thead className="bg-slate-50/60 text-left text-slate-500"><tr>{headers.map((h) => <th key={h} className="whitespace-nowrap px-3 py-1.5 font-semibold">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-50">{rows.map((r, i) => <tr key={i}>{headers.map((h) => <td key={h} className="whitespace-nowrap px-3 py-1.5 text-slate-700">{r[h]}</td>)}</tr>)}</tbody></table>
    </div>
  );
}

// ---------------- 4. rooms & faculty ----------------
interface Group { key: string; label: string; room: string; students: number; branch: string; section: string; faculty: FacIn[]; how?: string }
const looksLikeRoom = (s: string) => /^[A-Z]{0,3}\d{2,4}[A-Z]?$/i.test(s.replace(/[\s-]/g, ''));
export function RoomsStep({ d, reload, next, embedded }: StepProps) {
  const [students, setStudents] = useState<Stu[] | null>(null);
  const [dir, setDir] = useState<FacultyRow[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [pool, setPool] = useState<FacIn[]>([]);
  const [busy, setBusy] = useState(false); const [warn, setWarn] = useState<string[]>([]); const [info, setInfo] = useState('');
  useEffect(() => {
    (async () => {
      const [s, f] = await Promise.all([cc.get<{ students: Stu[] }>(`/api/admin/programs/${d.program.id}/students`), cc.get<{ faculty: FacultyRow[] }>(`/api/admin/programs/${d.program.id}/faculty`)]);
      setStudents(s.students); setDir(f.faculty);
      const byKey = new Map(f.faculty.map((x) => [x.key, x]));
      const m = new Map<string, Group>();
      for (const st of s.students) {
        const k = roomKey(st.room);
        let g = m.get(k);
        if (!g) { g = { key: k, label: st.room, room: looksLikeRoom(st.room) ? st.room : '', students: 0, branch: st.branch, section: st.section, faculty: [] }; m.set(k, g); }
        g.students++;
        for (const n of st.facultyList || []) {
          const fk = n.toLowerCase().replace(/\b(dr|mr|mrs|ms|miss|prof|smt)\b\.?/g, ' ').replace(/[^a-z]/g, '');
          if (!g.faculty.some((x) => x.name === n)) { const r = byKey.get(fk); g.faculty.push({ name: n, empId: r?.empId || '', email: r?.email || '' }); }
        }
      }
      setGroups([...m.values()].sort((a, b) => byNatural(a.branch + a.section, b.branch + b.section) || byNatural(a.label, b.label)));
    })().catch((e) => toast(errMsg(e), 'error'));
  }, [d.program.id]);

  /** Faculty list → rooms: by section (and branch), else by room number, else by listing order. */
  const loadFaculty = async (fs: File[]) => {
    try {
      const sh = await readSheet(fs[0]);
      const c = guessColumns(sh.headers, ['empId', 'facultyName', 'email', 'room', 'section', 'branch', 'phone']);
      if (!c.facultyName) { toast('Could not find a faculty name column in that file.', 'error'); return; }
      const list = sh.rows.map((r) => ({ name: r[c.facultyName], empId: (c.empId ? r[c.empId] : '').replace(/\.0$/, ''), email: (c.email ? r[c.email] : '').toLowerCase(), room: c.room ? r[c.room].toUpperCase().replace(/\s+/g, '') : '', section: c.section ? r[c.section] : '', branch: c.branch ? r[c.branch] : '' })).filter((x) => x.name);
      setPool(list.map(({ name, empId, email }) => ({ name, empId, email })));
      const ng = groups.map((g) => ({ ...g }));
      const used = new Set<number>(); let byOrder = 0;
      const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/MA$/, '');
      // 1) section (+ branch) match
      for (const g of ng) {
        const hits = list.map((x, i) => ({ x, i })).filter(({ x }) => x.section && norm(x.section) === norm(g.section) && (!x.branch || !g.branch || norm(x.branch) === norm(g.branch)));
        if (hits.length) { g.faculty = hits.map(({ x }) => ({ name: x.name, empId: x.empId, email: x.email })); g.room = hits.find(({ x }) => x.room)?.x.room || g.room; g.how = 'matched by section'; hits.forEach(({ i }) => used.add(i)); }
      }
      // 2) room number match
      for (const g of ng) {
        if (g.how) continue;
        const target = roomKey(g.room || g.label);
        const hits = list.map((x, i) => ({ x, i })).filter(({ x, i }) => !used.has(i) && x.room && x.room === target);
        if (hits.length) { g.faculty = hits.map(({ x }) => ({ name: x.name, empId: x.empId, email: x.email })); g.room = hits[0].x.room; g.how = 'matched by room'; hits.forEach(({ i }) => used.add(i)); }
      }
      // 3) by order: each branch's rooms (in listing order) to its sections (in order)
      const rest = list.map((x, i) => ({ x, i })).filter(({ i }) => !used.has(i) && list[i].room);
      for (const b of [...new Set(ng.filter((g) => !g.how).map((g) => g.branch))]) {
        const gs = ng.filter((g) => !g.how && g.branch === b);
        const mine = rest.filter(({ x }) => !x.branch || !b || norm(x.branch) === norm(b));
        const rooms = [...new Set(mine.map(({ x }) => x.room))];
        if (!rooms.length || rooms.length !== gs.length) continue;
        gs.forEach((g, k) => { const hits = mine.filter(({ x }) => x.room === rooms[k]); g.faculty = hits.map(({ x }) => ({ name: x.name, empId: x.empId, email: x.email })); g.room = rooms[k]; g.how = 'matched by order: please check'; byOrder++; });
      }
      setGroups(ng);
      const unmatched = ng.filter((g) => !g.how).length;
      setInfo(`${list.length} faculty read from ${sh.file}. ${ng.length - unmatched} group(s) filled${byOrder ? `, ${byOrder} of them by listing order (the file does not say which section sits where: please check)` : ''}${unmatched ? `; ${unmatched} still need faculty` : ''}.`);
    } catch (e) { toast(errMsg(e), 'error'); }
  };
  const setG = (k: string, p: Partial<Group>) => setGroups((gs) => gs.map((g) => (g.key === k ? { ...g, ...p, how: p.faculty || p.room !== undefined ? undefined : g.how } : g)));
  const options = useMemo(() => { const m = new Map<string, FacIn>(); for (const f of [...pool, ...dir.map((x) => ({ name: x.name, empId: x.empId, email: x.email }))]) m.set(f.name.toLowerCase(), f); return [...m.values()]; }, [pool, dir]);
  const shared = useMemo(() => { const c = new Map<string, string[]>(); for (const g of groups) { const r = roomKey(g.room || g.label); c.set(r, [...(c.get(r) || []), g.label]); } return [...c.entries()].filter(([, v]) => v.length > 1); }, [groups]);
  const problems = groups.filter((g) => !g.faculty.length || !(g.room || g.label).trim()).length;
  const noMail = groups.flatMap((g) => g.faculty).filter((f) => !f.email && !dir.find((x) => x.name === f.name)?.email).length;
  const save = async (andNext: boolean) => {
    if (!students) return;
    setBusy(true); setWarn([]);
    try {
      const gm = new Map(groups.map((g) => [g.key, g]));
      const rows = students.map((s) => { const g = gm.get(roomKey(s.room))!; return { reg: s.reg, name: s.name, branch: s.branch, section: s.section, room: (g.room || g.label).trim(), courseCode: s.courseCode, courseName: s.courseName, batchNo: s.batchNo, project: s.project, ps: s.ps, faculty: g.faculty }; });
      const r = await cc.post<{ rooms: number; roomsWithoutFaculty: string[]; warnings: string[] }>(`/api/admin/programs/${d.program.id}/students/import`, { students: rows, replace: false });
      setWarn(r.warnings || []);
      toast(`Saved ${r.rooms} room(s)`);
      await reload();
      if (andNext && !(r.warnings || []).length) next();
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  if (!students) return <Spinner label="Loading the rooms…" />;
  if (!students.length) return <StepCard n={4}><Empty icon="🧑‍🎓" title="Upload the students first">Go back to step 3.</Empty></StepCard>;
  return (
    <StepCard n={embedded ? undefined : 4} title={embedded ? 'Rooms & faculty' : undefined} hint={embedded ? 'Change a room’s faculty; batches are re-shared among the new faculty automatically.' : undefined}
      actions={<><span className="mr-auto text-xs text-slate-500">{problems ? `${problems} group(s) still need a room and faculty.` : `All ${groups.length} rooms have faculty.`}</span><Btn disabled={busy || !!problems} onClick={() => save(false)}>Save</Btn>{!embedded && <Btn kind="primary" disabled={busy || !!problems} onClick={() => save(true)}>Save & continue →</Btn>}</>}>
      <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
        <FileDrop multiple={false} onFiles={loadFaculty} label="Drop the faculty list (Emp ID, name, email, room / section)" />
        <div className="space-y-2 text-sm text-slate-600">
          <p className="font-semibold text-slate-800">How faculty are matched</p>
          <ul className="list-disc space-y-1 pl-5 text-xs">
            <li>By <b>section</b> when the faculty list has a section column, else by <b>room number</b>, else in listing order (flagged for you to check).</li>
            <li>A faculty member already registered is matched by <b>Emp ID or email</b>, so they never get a second login.</li>
            <li>Two or more faculty in a room share its batches equally.</li>
          </ul>
        </div>
      </div>
      {info && <Note tone="info" onClose={() => setInfo('')}>{info}</Note>}
      {shared.map(([r, gs]) => <Note key={r} tone="warn">{gs.join(' and ')} are both in {r}: they become one room with one attendance sheet.</Note>)}
      {noMail > 0 && <Note tone="warn">{noMail} faculty have no email yet: they need one to sign in. Add it on the chip or in the faculty file.</Note>}
      {warn.length > 0 && <Note tone="warn"><div className="font-semibold">Saved, with notes:</div><ul className="mt-1 list-disc pl-5 text-xs">{warn.map((w) => <li key={w}>{w}</li>)}</ul>{!embedded && <Btn size="sm" kind="soft" className="mt-2" onClick={next}>OK, continue →</Btn>}</Note>}
      <div className="overflow-x-auto rounded-2xl ring-1 ring-slate-200">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Group</th><th className="px-3 py-2">Students</th><th className="w-36 px-3 py-2">Room no.</th><th className="px-3 py-2">Faculty (access)</th><th className="px-3 py-2">Load</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {groups.map((g) => {
              const load = g.faculty.length ? Math.round(g.students / g.faculty.length) : 0;
              return (
                <tr key={g.key} className={!g.faculty.length ? 'bg-amber-50/40' : ''}>
                  <td className="px-3 py-2.5"><div className="font-semibold text-slate-800">{g.label}</div><div className="text-[11px] text-slate-500">{[g.branch, g.section].filter(Boolean).join(' · ')}</div>{g.how && <div className={cx('mt-0.5 text-[10px] font-semibold', /check/.test(g.how) ? 'text-amber-600' : 'text-emerald-600')}>{g.how}</div>}</td>
                  <td className="px-3 py-2.5 tabular-nums">{g.students}</td>
                  <td className="px-3 py-2.5"><Input value={g.room} placeholder={g.label} onChange={(e) => setG(g.key, { room: e.target.value.toUpperCase() })} /></td>
                  <td className="px-3 py-2.5"><FacultyChips value={g.faculty} options={options} onChange={(v) => setG(g.key, { faculty: v })} /></td>
                  <td className="px-3 py-2.5">{g.faculty.length ? <Badge tone={load > 45 ? 'amber' : 'green'}>{load} per faculty</Badge> : <Badge tone="red">no faculty</Badge>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </StepCard>
  );
}

// ---------------- 5. reviews & batches ----------------
function BatchStep({ d, reload, next }: StepProps) {
  const m = d.program.meta || {};
  const [size, setSize] = useState<number>(m.batchSize || d.batchSize || 4);
  const [auto, setAuto] = useState<boolean>(m.autoBatch ?? true);
  const [busy, setBusy] = useState(false);
  const reviews = m.reviews ?? d.sessions.filter((s) => s.kind === 'review').length;
  const save = async () => {
    setBusy(true);
    try {
      const r = await cc.post<{ batches: number }>(`/api/admin/programs/${d.program.id}/batches`, auto ? { batchSize: size, reset: true } : { batchSize: size, clear: true });
      await cc.post(`/api/admin/programs/${d.program.id}`, { meta: { batchSize: size, autoBatch: auto } });
      toast(auto ? `${r.batches} batches made and shared among the faculty` : 'Faculty will form the batches during the review');
      await reload(); next();
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  const total = d.rooms.reduce((n, r) => n + batchShare(r.students, r.faculty.length, size).batches, 0);
  return (
    <StepCard n={5} actions={<Btn kind="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save & continue →'}</Btn>}>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Reviews to conduct" hint="Set in the schedule step"><div className="flex h-[38px] items-center rounded-xl bg-slate-50 px-3 text-sm font-semibold text-slate-800">{reviews} review{reviews === 1 ? '' : 's'}</div></Field>
        <Field label="Students per batch (team)"><Select value={size} onChange={(e) => setSize(Number(e.target.value))}>{[2, 3, 4, 5, 6, 7, 8, 10].map((n) => <option key={n} value={n}>{n} per batch</option>)}</Select></Field>
        <Field label="Who forms the batches?">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
            {[[true, 'Make them now'], [false, 'Faculty, live']].map(([v, l]) => <button key={String(v)} onClick={() => setAuto(v as boolean)} className={cx('rounded-lg py-1.5 text-xs font-semibold transition', auto === v ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500')}>{l as string}</button>)}
          </div>
        </Field>
      </div>
      <Note tone="info">{auto ? <>Each room is split into batches of about {size} (sizes differ by at most one; never across rooms), and <b>whole batches are shared equally</b> among that room’s faculty. Each faculty reviews only their own batches.</> : <>Faculty type the batch number for each team during the review; the faculty who types it becomes that team’s reviewer.</>}</Note>
      {auto && (
        <div className="overflow-x-auto rounded-2xl ring-1 ring-slate-200">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Room</th><th className="px-3 py-2">Students</th><th className="px-3 py-2">Batches</th><th className="px-3 py-2">Team size</th><th className="px-3 py-2">Share per faculty</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {d.rooms.map((r) => { const b = batchShare(r.students, r.faculty.length, size); return (
                <tr key={r.room}><td className="px-3 py-2 font-semibold text-slate-800">{r.label}</td><td className="px-3 py-2 tabular-nums">{r.students}</td><td className="px-3 py-2 tabular-nums">{b.batches}</td><td className="px-3 py-2 text-slate-600">{b.min === b.max ? b.min : `${b.min}–${b.max}`}</td>
                  <td className="px-3 py-2"><div className="flex flex-wrap gap-1">{r.faculty.length ? r.faculty.map((f, i) => <Badge key={f.key} tone="indigo">{f.name}: {b.perFaculty[i]}</Badge>) : <Badge tone="red">no faculty</Badge>}</div></td></tr>
              ); })}
            </tbody>
            <tfoot><tr className="bg-slate-50 font-semibold"><td className="px-3 py-2">Total</td><td className="px-3 py-2">{d.students}</td><td className="px-3 py-2">{total}</td><td colSpan={2} /></tr></tfoot>
          </table>
        </div>
      )}
    </StepCard>
  );
}

// ---------------- 6. projects ----------------
interface BatchRow { room: string; label: string; batchNo: string; members: Stu[]; reviewer: string; project: string; ps: string }
export function ProjectsStep({ d, reload, next, embedded }: StepProps) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [students, setStudents] = useState<Stu[]>([]);
  const [upload, setUpload] = useState<{ sheet: Sheet; map: Record<string, string> } | null>(null);
  const [busy, setBusy] = useState(false); const [q, setQ] = useState('');
  const load = useCallback(async () => {
    const [p, s] = await Promise.all([cc.get<{ projects: Project[] }>(`/api/admin/programs/${d.program.id}/projects`), cc.get<{ students: Stu[] }>(`/api/admin/programs/${d.program.id}/students`)]);
    setProjects(p.projects); setStudents(s.students);
  }, [d.program.id]);
  useEffect(() => { load().catch((e) => toast(errMsg(e), 'error')); }, [load]);
  const names = useMemo(() => new Map(d.rooms.flatMap((r) => r.faculty.map((f) => [f.key, f.name] as const))), [d.rooms]);
  const batches = useMemo(() => {
    const m = new Map<string, BatchRow>();
    for (const s of students) if (s.batchNo) { const k = `${roomKey(s.room)}|${s.batchNo}`; let b = m.get(k); if (!b) { b = { room: roomKey(s.room), label: s.room, batchNo: s.batchNo, members: [], reviewer: s.reviewer, project: s.project, ps: s.ps }; m.set(k, b); } b.members.push(s); }
    return [...m.values()].sort((a, b) => byNatural(a.label, b.label) || byNatural(a.batchNo, b.batchNo));
  }, [students]);
  const shown = batches.filter((b) => !q || `${b.label} ${b.batchNo} ${b.project} ${b.members.map((m) => m.name + m.reg).join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  const pick = async (fs: File[]) => { try { const sheet = await readSheet(fs[0]); setUpload({ sheet, map: guessColumns(sheet.headers, ['projectId', 'title', 'domain', 'courseCode']) }); } catch (e) { toast(errMsg(e), 'error'); } };
  const saveList = async () => {
    if (!upload) return; setBusy(true);
    try {
      const g = (r: Row, k: string) => (upload.map[k] ? r[upload.map[k]] || '' : '');
      const r = await cc.post<{ total: number }>(`/api/admin/programs/${d.program.id}/projects`, { rows: upload.sheet.rows.map((x) => ({ projectId: g(x, 'projectId'), title: g(x, 'title'), domain: g(x, 'domain'), courseCode: g(x, 'courseCode') })) });
      toast(`${r.total} projects saved`); setUpload(null); await load();
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  const assign = async (overwrite: boolean) => {
    setBusy(true);
    try { const r = await cc.post<{ assigned: number; maxPerProject: number }>(`/api/admin/programs/${d.program.id}/projects/assign`, { overwrite }); toast(`${r.assigned} batch(es) given a project (at most ${r.maxPerProject} batches per project)`); await load(); }
    catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  const setBatch = async (b: BatchRow, projectId: string) => {
    try { await cc.post(`/api/admin/programs/${d.program.id}/batch-project`, { room: b.room, batchNo: b.batchNo, projectId }); await load(); } catch (e) { toast(errMsg(e), 'error'); }
  };
  if (!projects) return <Spinner label="Loading projects…" />;
  const without = batches.filter((b) => !b.project).length;
  return (
    <StepCard n={embedded ? undefined : 6} title={embedded ? 'Projects' : undefined} hint={embedded ? 'The list faculty pick from, and each batch’s project.' : undefined}
      actions={!embedded && <>{!projects.length && <Btn onClick={() => { reload(); next(); }}>Skip: faculty will type titles</Btn>}<Btn kind="primary" disabled={busy} onClick={() => { reload(); next(); }}>Continue →</Btn></>}>
      <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
        <FileDrop multiple={false} onFiles={pick} label={projects.length ? `Replace the project list (${projects.length} now)` : 'Drop the project list (ID, title, domain)'} />
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2 text-center">
            {[['Projects', projects.length], ['Batches', batches.length], ['Without project', without]].map(([l, v]) => <div key={l as string} className="rounded-xl bg-slate-50 py-2.5"><div className="text-xl font-bold tabular-nums text-slate-800">{v}</div><div className="text-[10px] font-semibold uppercase text-slate-400">{l}</div></div>)}
          </div>
          {projects.length > 0 && batches.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <Btn kind="primary" size="sm" disabled={busy || !without} onClick={() => assign(false)}>✨ Auto-assign to the {without} without one</Btn>
              <Btn size="sm" disabled={busy} onClick={() => window.confirm('Re-assign every batch? Projects already chosen are replaced.') && assign(true)}>Re-assign all</Btn>
            </div>
          )}
          {!batches.length && <Note tone="info">There are no batches yet{d.program.meta?.autoBatch === false ? ': the faculty form them during the review and pick a project from this list.' : '. Make them in step 5.'}</Note>}
          <p className="text-[11px] text-slate-500">Auto-assign gives every project out about the same number of times, keeps one room’s batches on different projects, mixes domains, and respects the course code when the list has one.</p>
        </div>
      </div>
      {upload && (
        <div className="rounded-2xl ring-1 ring-indigo-200">
          <div className="grid gap-3 p-4 sm:grid-cols-4">
            {[['projectId', 'Project ID'], ['title', 'Title *'], ['domain', 'Domain'], ['courseCode', 'Course code']].map(([k, l]) => (
              <Field key={k} label={l}><Select value={upload.map[k] || ''} onChange={(e) => setUpload({ ...upload, map: { ...upload.map, [k]: e.target.value } })}><option value="">— not in file —</option>{upload.sheet.headers.map((h) => <option key={h}>{h}</option>)}</Select></Field>
            ))}
          </div>
          <Preview rows={upload.sheet.rows.slice(0, 5)} headers={Object.values(upload.map).filter(Boolean)} />
          <div className="flex justify-end gap-2 border-t border-slate-100 p-3"><Btn size="sm" onClick={() => setUpload(null)}>Cancel</Btn><Btn size="sm" kind="primary" disabled={busy || !upload.map.title} onClick={saveList}>Save {upload.sheet.rows.length} projects</Btn></div>
        </div>
      )}
      {batches.length > 0 && (
        <div className="rounded-2xl ring-1 ring-slate-200">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Batch → project</span><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search room, batch, student, project" className="max-w-xs py-1.5 text-xs" /></div>
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Room</th><th className="px-3 py-2">Batch</th><th className="px-3 py-2">Members</th><th className="px-3 py-2">Reviewer</th><th className="px-3 py-2">Project</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((b) => (
                  <tr key={b.room + b.batchNo}>
                    <td className="px-3 py-2 font-medium">{b.label}</td><td className="px-3 py-2"><Badge tone="indigo">{b.batchNo}</Badge></td>
                    <td className="px-3 py-2 text-xs text-slate-600" title={b.members.map((m) => `${m.reg} ${m.name}`).join('\n')}>{b.members.length} · {b.members.slice(0, 2).map((m) => m.name.split(' ')[0]).join(', ')}{b.members.length > 2 ? '…' : ''}</td>
                    <td className="px-3 py-2 text-xs">{names.get(b.reviewer) || <span className="text-slate-400">—</span>}</td>
                    <td className="px-3 py-2">
                      {projects.length ? (
                        <Select value={b.ps || ''} onChange={(e) => setBatch(b, e.target.value)} className={cx('py-1.5 text-xs', !b.project && 'border-amber-300')}>
                          <option value="">{b.project && !b.ps ? b.project : '— none —'}</option>
                          {projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.projectId} · {p.title}{p.domain ? ` (${p.domain})` : ''}</option>)}
                        </Select>
                      ) : <span className="text-xs text-slate-600">{b.project || '—'}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </StepCard>
  );
}

// ---------------- 7. rubric ----------------
export function RubricStep({ d, reload, next, embedded }: StepProps) {
  const [r, setR] = useState<Rubric | null>(null); const [own, setOwn] = useState(false); const [busy, setBusy] = useState(false);
  const [scored, setScored] = useState(false);
  useEffect(() => {
    cc.get<{ rubric: Rubric; own: boolean }>(`/api/admin/programs/${d.program.id}/rubric`).then((x) => { setR(x.rubric); setOwn(x.own); }).catch((e) => toast(errMsg(e), 'error'));
    cc.get<{ checks: Check[] }>(`/api/admin/programs/${d.program.id}/checks`).catch(() => null);
    setScored(d.sessions.some((s) => s.kind === 'review' && s.autoState === 'closed'));
  }, [d.program.id, d.sessions]);
  const save = async (reset = false) => {
    setBusy(true);
    try { const x = await cc.post<{ rubric: Rubric; own: boolean }>(`/api/admin/programs/${d.program.id}/rubric`, reset ? { reset: true } : { rubric: r }); setR(x.rubric); setOwn(x.own); toast(reset ? 'Using the university default rubric' : 'Rubric saved'); await reload(); if (!reset && !embedded) next(); }
    catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  if (!r) return <Spinner label="Loading the rubric…" />;
  const bad = r.tables.some((t) => t.criteria.some((c) => !c.label.trim())) || !r.tables.some((t) => t.criteria.length);
  return (
    <StepCard n={embedded ? undefined : 7} title={embedded ? 'Rubric' : undefined} hint={own ? 'This hackathon’s own rubric.' : 'Using the university default rubric. Change it here for this hackathon only.'}
      actions={<>{own && <Btn kind="danger" disabled={busy} onClick={() => save(true)}>Use the university default</Btn>}<span className="mr-auto" />{!embedded && <Btn disabled={busy} onClick={next}>Keep as is →</Btn>}<Btn kind="primary" disabled={busy || bad} onClick={() => save(false)}>{embedded ? 'Save rubric' : 'Save & continue →'}</Btn></>}>
      <RubricEditor rubric={r} onChange={setR} structureLocked={scored} />
      <p className="text-xs text-slate-500">Total {rubricTotal(r)} marks. Faculty see the band descriptions as a guide while marking; grades: Outstanding ≥ 85%, Good ≥ 70%, Average ≥ 50%.</p>
    </StepCard>
  );
}

// ---------------- 8. go live ----------------
function GoLiveStep({ d, reload }: StepProps) {
  const nav = useNavigate();
  const [checks, setChecks] = useState<Check[] | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { cc.get<{ checks: Check[] }>(`/api/admin/programs/${d.program.id}/checks`).then((r) => setChecks(r.checks)).catch((e) => toast(errMsg(e), 'error')); }, [d.program.id]);
  const errors = (checks || []).filter((c) => c.level === 'error');
  const live = async () => {
    if (errors.length && !window.confirm(`${errors.length} problem(s) are still open. Go live anyway?`)) return;
    setBusy(true);
    try { await cc.post(`/api/admin/programs/${d.program.id}`, { meta: { status: 'live', step: 8 } }); await reload(); toast('The hackathon is live'); nav(`/coordinator/p/${d.program.id}`); }
    catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  const m = d.program.meta || {};
  const faculty = new Set(d.rooms.flatMap((r) => r.faculty.map((f) => f.key))).size;
  return (
    <StepCard n={8} actions={<Btn kind="primary" disabled={busy || !checks} onClick={live}>{d.program.meta?.status === 'live' ? 'Back to the dashboard →' : '🚀 Go live'}</Btn>}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[['Course', `${m.courseCode || '—'}`, m.courseName], ['Students', d.students, `${d.rooms.length} rooms`], ['Faculty', faculty, 'with access'], ['Sessions', d.sessions.length, `${d.sessions.filter((s) => s.kind === 'review').length} review(s)`]].map(([l, v, s]) => (
          <div key={l as string} className="rounded-2xl bg-slate-50 p-4"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{l}</div><div className="mt-1 truncate text-xl font-bold text-slate-900">{v}</div><div className="truncate text-xs text-slate-500">{s}</div></div>
        ))}
      </div>
      {!checks ? <Spinner label="Checking everything…" /> : (
        <div className="space-y-2">
          {checks.map((c, i) => <Note key={i} tone={c.level === 'ok' ? 'ok' : c.level === 'warn' ? 'warn' : 'error'}><b>{c.area}:</b> {c.text}</Note>)}
        </div>
      )}
      <Note tone="info">After going live, faculty sign in at <b>{window.location.origin}/attendance</b> and <b>/hackathon-review</b> with their Emp ID or KL email. Download their sign-in sheet from the dashboard.</Note>
    </StepCard>
  );
}

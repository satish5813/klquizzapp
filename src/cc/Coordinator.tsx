// Course Coordinator portal: sign-in (email code), my hackathons, setup wizard, dashboard.
import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { cc, ccToken, Coordinator as CC, Program, ReauthError, setCcToken } from './ccApi';
import Wizard from './Wizard';
import Dashboard from './Dashboard';
import { Badge, Btn, Card, Empty, errMsg, Input, Note, Spinner, Toasts } from './ui';

export default function Coordinator() {
  const [me, setMe] = useState<CC | null>(null);
  const [checking, setChecking] = useState(!!ccToken());
  useEffect(() => {
    if (!ccToken()) return;
    cc.get<{ coordinator: CC }>('/api/cc/me').then((r) => setMe(r.coordinator)).catch(() => setCcToken('')).finally(() => setChecking(false));
  }, []);
  // any call that finds the session expired sends the coordinator back to sign-in
  useEffect(() => {
    const h = (e: PromiseRejectionEvent) => { if (e.reason instanceof ReauthError) setMe(null); };
    window.addEventListener('unhandledrejection', h); return () => window.removeEventListener('unhandledrejection', h);
  }, []);
  const out = useCallback(async () => { try { await cc.post('/api/cc/logout'); } catch { /* ignore */ } setCcToken(''); setMe(null); }, []);

  if (checking) return <div className="grid min-h-[50vh] place-items-center"><Spinner label="Opening the coordinator console…" /></div>;
  if (!me) return <SignIn onIn={setMe} />;
  return (
    <div className="mx-auto max-w-7xl">
      <Toasts />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link to="/coordinator" className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-lg text-white shadow-sm">🎛</span>
          <div className="leading-tight">
            <div className="text-lg font-bold tracking-tight text-slate-900">Hackathon Coordinator</div>
            <div className="text-xs text-slate-500">Set up and run your course hackathons</div>
          </div>
        </Link>
        <div className="flex items-center gap-3">
          <div className="text-right leading-tight">
            <div className="text-sm font-semibold text-slate-800">{me.name}</div>
            <div className="text-[11px] text-slate-500">{[me.empId && `Emp ${me.empId}`, me.department].filter(Boolean).join(' · ') || me.email}</div>
          </div>
          <Btn size="sm" onClick={out}>Sign out</Btn>
        </div>
      </div>
      <Routes>
        <Route index element={<Home />} />
        <Route path="new" element={<Wizard />} />
        <Route path="p/:id/setup/:step" element={<Wizard />} />
        <Route path="p/:id/*" element={<Dashboard />} />
        <Route path="*" element={<Navigate to="/coordinator" replace />} />
      </Routes>
    </div>
  );
}

function SignIn({ onIn }: { onIn: (c: CC) => void }) {
  const [id, setId] = useState(''); const [code, setCode] = useState('');
  const [sent, setSent] = useState<{ to: string; debugCode?: string } | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const send = async () => {
    setBusy(true); setErr('');
    try { const r = await api.post<{ to: string; debugCode?: string }>('/api/cc/otp/request', { id: id.trim() }); setSent(r); if (r.debugCode) setCode(r.debugCode); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true); setErr('');
    try { const r = await api.post<{ token: string; coordinator: CC }>('/api/cc/otp/verify', { id: id.trim(), code }); setCcToken(r.token); onIn(r.coordinator); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="mx-auto grid max-w-4xl overflow-hidden rounded-3xl bg-white shadow-xl ring-1 ring-slate-200 md:grid-cols-2">
      <div className="relative hidden flex-col justify-between bg-gradient-to-br from-indigo-700 via-indigo-600 to-violet-600 p-8 text-white md:flex">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-200">KL Skill Development</div>
          <h1 className="mt-3 text-3xl font-bold leading-tight">Hackathon<br />Coordinator Console</h1>
          <p className="mt-3 text-sm text-indigo-100">Set up a course hackathon in minutes: students, rooms, faculty, reviews, projects and rubric. Then run it live.</p>
        </div>
        <ul className="space-y-2 text-sm text-indigo-50">
          {['Columns in your Excel recognised automatically', 'Batches shared equally among each room’s faculty', 'Projects assigned to batches for you', 'Rooms open and close on schedule'].map((t) => <li key={t} className="flex gap-2"><span className="text-emerald-300">✓</span>{t}</li>)}
        </ul>
      </div>
      <div className="p-8">
        <h2 className="text-xl font-bold text-slate-900">Sign in</h2>
        <p className="mt-1 text-sm text-slate-500">Use the Emp ID or KL email the admin registered for you. A 6-digit code is sent to your email.</p>
        <div className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Emp ID or KL email</label>
            <Input value={id} onChange={(e) => { setId(e.target.value); setSent(null); }} placeholder="e.g. 4957 or name@kluniversity.in" onKeyDown={(e) => e.key === 'Enter' && id.trim() && !sent && send()} disabled={busy} />
          </div>
          {sent && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Code sent to {sent.to}</label>
              <Input value={code} inputMode="numeric" maxLength={6} autoFocus onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="6-digit code" className="text-center text-lg font-bold tracking-[0.4em]" onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && verify()} />
              {sent.debugCode && <p className="mt-1 text-[11px] text-amber-600">Test mode: the code is filled in for you.</p>}
            </div>
          )}
          {err && <Note tone="error">{err}</Note>}
          {!sent ? <Btn kind="primary" className="w-full" disabled={!id.trim() || busy} onClick={send}>{busy ? 'Sending…' : 'Send code'}</Btn>
            : <div className="flex gap-2"><Btn className="flex-1" disabled={busy} onClick={send}>Resend</Btn><Btn kind="primary" className="flex-[2]" disabled={code.length !== 6 || busy} onClick={verify}>{busy ? 'Checking…' : 'Sign in'}</Btn></div>}
        </div>
        <p className="mt-6 text-[11px] text-slate-400">No login yet? Ask the Skill Development admin to add you as a coordinator.</p>
      </div>
    </div>
  );
}

function Home() {
  const nav = useNavigate();
  const [list, setList] = useState<Program[] | null>(null); const [err, setErr] = useState('');
  useEffect(() => { cc.get<{ programs: Program[] }>('/api/admin/programs').then((r) => setList(r.programs)).catch((e) => setErr(errMsg(e))); }, []);
  if (err) return <Note tone="error">{err}</Note>;
  if (!list) return <Spinner label="Loading your hackathons…" />;
  const live = list.filter((p) => p.meta?.status === 'live'), drafts = list.filter((p) => p.meta?.status !== 'live');
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-2xl font-bold tracking-tight text-slate-900">My hackathons</h2><p className="text-sm text-slate-500">{list.length ? `${live.length} live · ${drafts.length} in setup` : 'Create your first one: it takes about ten minutes.'}</p></div>
        <Btn kind="primary" onClick={() => nav('/coordinator/new')}>＋ New hackathon</Btn>
      </div>
      {!list.length && <Empty icon="🚀" title="No hackathons yet">Press “New hackathon”. The wizard asks for the course, schedule, students, rooms and faculty, reviews, projects and rubric, one step at a time.</Empty>}
      {[['Live', live], ['In setup', drafts]].map(([t, ps]) => (ps as Program[]).length ? (
        <div key={t as string}>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t as string}</div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{(ps as Program[]).map((p) => <ProgramCard key={p.id} p={p} />)}</div>
        </div>
      ) : null)}
    </div>
  );
}

function ProgramCard({ p }: { p: Program }) {
  const nav = useNavigate(); const live = p.meta?.status === 'live';
  const go = () => nav(live ? `/coordinator/p/${p.id}` : `/coordinator/p/${p.id}/setup/${Math.max(1, Math.min(8, (p.meta?.step || 1)))}`);
  return (
    <Card className="cursor-pointer transition hover:-translate-y-0.5 hover:shadow-md" pad={false}>
      <button onClick={go} className="block w-full p-5 text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-slate-900">{p.title}</div>
            <div className="mt-0.5 truncate text-xs text-slate-500">{[p.meta?.courseCode, p.meta?.courseName].filter(Boolean).join(' · ') || 'Course not set'}</div>
          </div>
          {live ? <Badge tone="green">● Live</Badge> : <Badge tone="amber">Step {p.meta?.step || 1} / 8</Badge>}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          {[['Students', p.students || 0], ['Rooms', p.rooms || 0], ['Sessions', (p.attendanceSessions || 0) + (p.reviewSessions || 0)]].map(([l, v]) => (
            <div key={l as string} className="rounded-xl bg-slate-50 py-2"><div className="text-lg font-bold tabular-nums text-slate-800">{v}</div><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{l}</div></div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
          <span>{[p.meta?.academicYear, p.meta?.semester && `${p.meta.semester} sem`].filter(Boolean).join(' · ')}</span>
          {(p.openRooms || 0) > 0 && <Badge tone="indigo">{p.openRooms} room(s) open now</Badge>}
        </div>
      </button>
    </Card>
  );
}

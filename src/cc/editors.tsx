// Editors shared by the setup wizard and the dashboard: schedule plan, rubric, faculty chips.
import { useMemo, useState } from 'react';
import type { Rubric } from './ccApi';
import { PlanRow, planIssues, RUBRIC_TEMPLATES, rubricTotal, skillPalaverTemplate, suggestPlan, windowOf } from './plan';
import { Badge, Btn, cx, Field, fmtDate, fmtTime, Input, inputCls, Select } from './ui';

// ---------------- schedule ----------------
export function ScheduleEditor({ rows, onChange, reviews, onReviews, locked = new Set<string>() }: { rows: PlanRow[]; onChange: (r: PlanRow[]) => void; reviews: number; onReviews: (n: number) => void; locked?: Set<string> }) {
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const [g, setG] = useState({ date: rows[0]?.date || today, start: '19:00', hours: 16, attendance: Math.max(1, rows.filter((r) => r.kind === 'attendance').length || 4) });
  const issues = useMemo(() => planIssues(rows), [rows]);
  const set = (i: number, p: Partial<PlanRow>) => onChange(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const sorted = rows.map((r, i) => ({ r, i })).sort((a, b) => (windowOf(a.r)?.start ?? 9e15) - (windowOf(b.r)?.start ?? 9e15));
  const generate = () => onChange(suggestPlan({ date: g.date, start: g.start, hours: g.hours, attendance: g.attendance, reviews }).map((r) => keepIds(r, rows)));
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-indigo-50 to-sky-50 p-4 ring-1 ring-indigo-100">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-indigo-900"><span>✨</span> Build the timetable automatically</div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <Field label="Starts on"><Input type="date" value={g.date} onChange={(e) => setG({ ...g, date: e.target.value })} /></Field>
          <Field label="At"><Input type="time" value={g.start} onChange={(e) => setG({ ...g, start: e.target.value })} /></Field>
          <Field label="Runs for (hours)"><Input type="number" min={1} max={72} value={g.hours} onChange={(e) => setG({ ...g, hours: Math.max(1, Number(e.target.value) || 1) })} /></Field>
          <Field label="Attendance checks"><Input type="number" min={0} max={12} value={g.attendance} onChange={(e) => setG({ ...g, attendance: Math.max(0, Number(e.target.value) || 0) })} /></Field>
          <Field label="Reviews to conduct"><Input type="number" min={0} max={6} value={reviews} onChange={(e) => onReviews(Math.max(0, Math.min(6, Number(e.target.value) || 0)))} /></Field>
          <div className="flex items-end gap-2">
            <Btn kind="primary" className="flex-1" onClick={generate}>Suggest</Btn>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-indigo-900/70">
          Or start from:
          <button className="rounded-lg bg-white px-2.5 py-1 font-semibold text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50" onClick={() => { onChange(skillPalaverTemplate(g.date).map((r) => keepIds(r, rows))); onReviews(1); }}>Skill Palaver overnight (7 PM → next noon)</button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl ring-1 ring-slate-200">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <tr><th className="px-3 py-2">Type</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">From</th><th className="px-3 py-2">To</th><th className="px-3 py-2" title="Rooms open and close on their own">Auto</th><th /></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map(({ r, i }) => {
              const lock = !!(r.id && locked.has(r.id));
              return (
                <tr key={i} className={issues[i] ? 'bg-rose-50/40' : ''}>
                  <td className="px-3 py-2">
                    <Select value={r.kind} disabled={lock} onChange={(e) => set(i, { kind: e.target.value as PlanRow['kind'] })} className="w-36">
                      <option value="attendance">🕒 Attendance</option><option value="review">⭐ Review</option>
                    </Select>
                  </td>
                  <td className="px-3 py-2"><Input value={r.name} onChange={(e) => set(i, { name: e.target.value })} />{issues[i] && <div className="mt-1 text-[11px] font-medium text-rose-600">{issues[i]}</div>}</td>
                  <td className="px-3 py-2"><Input type="date" value={r.date} onChange={(e) => set(i, { date: e.target.value })} /></td>
                  <td className="px-3 py-2"><Input type="time" value={r.startTime} onChange={(e) => set(i, { startTime: e.target.value })} /></td>
                  <td className="px-3 py-2"><Input type="time" value={r.endTime} onChange={(e) => set(i, { endTime: e.target.value })} /></td>
                  <td className="px-3 py-2"><input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={r.auto} onChange={(e) => set(i, { auto: e.target.checked })} /></td>
                  <td className="px-3 py-2 text-right">{lock ? <Badge tone="amber">has data</Badge> : <button className="rounded-lg px-2 py-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Remove" onClick={() => onChange(rows.filter((_, k) => k !== i))}>✕</button>}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-400">No sessions yet — press “Suggest” or add one.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Btn size="sm" onClick={() => onChange([...rows, { kind: 'attendance', name: `Attendance ${rows.filter((r) => r.kind === 'attendance').length + 1}`, date: rows[rows.length - 1]?.date || g.date, startTime: '10:00', endTime: '10:45', auto: true }])}>+ Attendance</Btn>
          <Btn size="sm" onClick={() => onChange([...rows, { kind: 'review', name: `Review ${rows.filter((r) => r.kind === 'review').length + 1}`, date: rows[rows.length - 1]?.date || g.date, startTime: '09:00', endTime: '12:00', auto: true }])}>+ Review</Btn>
        </div>
        <Timeline rows={rows} />
      </div>
    </div>
  );
}
const keepIds = (r: PlanRow, old: PlanRow[]) => { const m = old.find((o) => o.id && o.kind === r.kind && o.name === r.name); return m ? { ...r, id: m.id } : r; };

/** A compact visual of the plan: one bar per session on a shared time axis. */
export function Timeline({ rows }: { rows: { kind: string; name: string; date: string; startTime: string; endTime: string }[] }) {
  const ws = rows.map((r) => ({ r, w: windowOf(r) })).filter((x) => x.w) as { r: PlanRow; w: { start: number; end: number } }[];
  if (!ws.length) return null;
  const a = Math.min(...ws.map((x) => x.w.start)), b = Math.max(...ws.map((x) => x.w.end));
  const span = Math.max(1, b - a);
  return (
    <div className="min-w-[280px] flex-1 md:max-w-md">
      <div className="relative h-8 rounded-lg bg-slate-100">
        {ws.map(({ r, w }, i) => (
          <div key={i} title={`${r.name} · ${fmtDate(r.date)} ${fmtTime(r.startTime)}–${fmtTime(r.endTime)}`}
            className={cx('absolute top-1 h-6 rounded-md', r.kind === 'review' ? 'bg-amber-400/90' : 'bg-indigo-500/90')}
            style={{ left: `${((w.start - a) / span) * 100}%`, width: `${Math.max(1.2, ((w.end - w.start) / span) * 100)}%` }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400"><span>{new Date(a).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span><span className="flex gap-3"><span className="text-indigo-600">■ attendance</span><span className="text-amber-600">■ review</span></span><span>{new Date(b).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span></div>
    </div>
  );
}

// ---------------- rubric ----------------
export function RubricEditor({ rubric, onChange, structureLocked }: { rubric: Rubric; onChange: (r: Rubric) => void; structureLocked?: boolean }) {
  const total = rubricTotal(rubric);
  const setT = (ti: number, p: Partial<Rubric['tables'][number]>) => onChange({ ...rubric, tables: rubric.tables.map((t, i) => (i === ti ? { ...t, ...p } : t)) });
  const setC = (ti: number, ci: number, p: Partial<Rubric['tables'][number]['criteria'][number]>) => setT(ti, { criteria: rubric.tables[ti].criteria.map((c, i) => (i === ci ? { ...c, ...p } : c)) });
  return (
    <div className="space-y-4">
      {!structureLocked && (
        <div className="flex flex-wrap gap-2">
          {RUBRIC_TEMPLATES.map((t) => (
            <button key={t.id} onClick={() => onChange(JSON.parse(JSON.stringify(t.rubric)))} className="rounded-xl bg-white px-3 py-2 text-left ring-1 ring-slate-200 transition hover:ring-indigo-300">
              <div className="text-xs font-semibold text-slate-800">{t.name}</div><div className="text-[11px] text-slate-500">{t.note}</div>
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Band names (low → high)" className="flex-1">
          <div className="grid grid-cols-4 gap-2">{[0, 1, 2, 3].map((i) => <Input key={i} value={rubric.bandLabels[i] || ''} onChange={(e) => { const b = [...rubric.bandLabels]; b[i] = e.target.value; onChange({ ...rubric, bandLabels: b }); }} />)}</div>
        </Field>
        <div className="rounded-xl bg-slate-900 px-4 py-2 text-center text-white"><div className="text-[10px] uppercase tracking-wide text-slate-300">Total</div><div className="text-xl font-bold tabular-nums">{total}</div></div>
      </div>
      {rubric.tables.map((t, ti) => (
        <div key={ti} className="rounded-2xl ring-1 ring-slate-200">
          <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
            <input className="flex-1 bg-transparent text-sm font-semibold text-slate-800 outline-none" value={t.name} onChange={(e) => setT(ti, { name: e.target.value })} />
            <span className="text-xs text-slate-500">{t.criteria.reduce((n, c) => n + (Number(c.max) || 0), 0)} marks</span>
          </div>
          <div className="divide-y divide-slate-100">
            {t.criteria.map((c, ci) => (
              <div key={ci} className="grid gap-2 p-3 md:grid-cols-[1.4fr_90px_3fr_auto]">
                <Input value={c.label} placeholder="Criterion" onChange={(e) => setC(ti, ci, { label: e.target.value })} />
                <Input type="number" min={1} max={100} value={c.max} title="Max marks" disabled={structureLocked} onChange={(e) => setC(ti, ci, { max: Math.max(1, Number(e.target.value) || 1) })} />
                <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">{[0, 1, 2, 3].map((b) => <input key={b} className={cx(inputCls, 'py-1.5 text-xs')} placeholder={rubric.bandLabels[b] || `Band ${b + 1}`} value={c.bands[b] || ''} onChange={(e) => { const bands = [...c.bands]; bands[b] = e.target.value; setC(ti, ci, { bands }); }} />)}</div>
                {!structureLocked && <button className="self-center rounded-lg px-2 py-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => setT(ti, { criteria: t.criteria.filter((_, i) => i !== ci) })}>✕</button>}
              </div>
            ))}
          </div>
          {!structureLocked && <div className="p-3"><Btn size="sm" onClick={() => setT(ti, { criteria: [...t.criteria, { label: '', max: 10, bands: [] }] })}>+ Criterion</Btn></div>}
        </div>
      ))}
      {structureLocked && <p className="text-xs text-amber-700">Marks are already entered, so criteria and marks are fixed. Names and band descriptions can still be edited.</p>}
    </div>
  );
}

// ---------------- faculty chips ----------------
export interface FacIn { name: string; empId: string; email: string }
export function FacultyChips({ value, onChange, options = [] }: { value: FacIn[]; onChange: (v: FacIn[]) => void; options?: FacIn[] }) {
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState<FacIn>({ name: '', empId: '', email: '' });
  const listId = useMemo(() => `fac-${Math.random().toString(36).slice(2)}`, []);
  const add = (x: FacIn) => { if (!x.name.trim()) return; if (value.some((v) => (x.empId && v.empId === x.empId) || v.name.toLowerCase() === x.name.toLowerCase())) return; onChange([...value, x]); setF({ name: '', empId: '', email: '' }); setAdding(false); };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((v, i) => (
        <span key={i} className="group inline-flex items-center gap-1.5 rounded-full bg-indigo-50 py-1 pl-2.5 pr-1 text-xs font-medium text-indigo-800 ring-1 ring-indigo-200" title={`${v.empId ? 'Emp ' + v.empId : 'no Emp ID'} · ${v.email || 'no email'}`}>
          {v.name}{v.empId && <span className="text-indigo-400">· {v.empId}</span>}{!v.email && <span className="text-amber-600" title="No email">⚠</span>}
          <button className="grid h-4 w-4 place-items-center rounded-full text-indigo-400 hover:bg-indigo-200 hover:text-indigo-700" onClick={() => onChange(value.filter((_, k) => k !== i))}>×</button>
        </span>
      ))}
      {adding ? (
        <span className="inline-flex flex-wrap items-center gap-1">
          <input list={listId} autoFocus placeholder="Name" className={cx(inputCls, 'w-40 py-1 text-xs')} value={f.name} onChange={(e) => { const o = options.find((x) => x.name === e.target.value); setF(o ? { ...o } : { ...f, name: e.target.value }); }} />
          <datalist id={listId}>{options.map((o, i) => <option key={i} value={o.name}>{o.empId} {o.email}</option>)}</datalist>
          <input placeholder="Emp ID" className={cx(inputCls, 'w-20 py-1 text-xs')} value={f.empId} onChange={(e) => setF({ ...f, empId: e.target.value })} />
          <input placeholder="KL email" className={cx(inputCls, 'w-44 py-1 text-xs')} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && add(f)} />
          <Btn size="sm" kind="primary" onClick={() => add(f)}>Add</Btn><Btn size="sm" onClick={() => setAdding(false)}>Cancel</Btn>
        </span>
      ) : <button onClick={() => setAdding(true)} className="rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-500 hover:border-indigo-300 hover:text-indigo-600">+ faculty</button>}
    </div>
  );
}

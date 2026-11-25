// The "automatic" part of the portal: schedule suggestions, batch previews, rubric templates.
import type { Rubric, Session } from './ccApi';

export interface PlanRow { id?: string; kind: 'attendance' | 'review'; name: string; date: string; startTime: string; endTime: string; auto: boolean }

const pad = (n: number) => String(n).padStart(2, '0');
const istParts = (ms: number) => { const d = new Date(ms + 5.5 * 3600_000); return { date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` }; };
export const istMs = (date: string, time: string) => Date.parse(`${date}T${time.padStart(5, '0')}:00+05:30`);
const round15 = (ms: number) => Math.round(ms / 900_000) * 900_000;

/** Suggest sessions for a hackathon running from start to end (Indian time).
 *  Attendance checks are spread evenly (first at the start, last before the end); reviews sit at
 *  the end, earlier rounds spread through the event, each window sized to the event length. */
export function suggestPlan(o: { date: string; start: string; hours: number; attendance: number; reviews: number }): PlanRow[] {
  const s = istMs(o.date, o.start); const e = s + o.hours * 3600_000;
  if (!Number.isFinite(s) || o.hours <= 0) return [];
  const rows: PlanRow[] = [];
  const att = Math.max(0, Math.min(12, o.attendance)); const rev = Math.max(0, Math.min(6, o.reviews));
  const attLen = 45 * 60_000;
  for (let i = 0; i < att; i++) {
    const at = round15(att === 1 ? s : s + ((e - s - attLen) * i) / (att - 1));
    const a = istParts(at), b = istParts(at + attLen);
    const part = Number(a.time.slice(0, 2));
    const when = part < 6 ? 'Early Morning' : part < 12 ? 'Morning' : part < 17 ? 'Afternoon' : part < 21 ? 'Evening' : 'Night';
    let name = `Day${dayNo(o.date, a.date)}_${when}`;
    while (rows.some((r) => r.name === name)) name += '+';
    rows.push({ kind: 'attendance', name, date: a.date, startTime: a.time, endTime: b.time, auto: true });
  }
  const revLen = Math.min(4 * 3600_000, Math.max(3600_000, (o.hours * 3600_000) / Math.max(4, rev * 3)));
  for (let i = 0; i < rev; i++) {
    const end = rev === 1 ? e : s + ((e - s) * (i + 1)) / rev;
    const at = round15(end - revLen);
    const a = istParts(at), b = istParts(round15(end));
    rows.push({ kind: 'review', name: rev === 1 ? 'Final Review' : i === rev - 1 ? `Review ${i + 1} (Final)` : `Review ${i + 1}`, date: a.date, startTime: a.time, endTime: b.time, auto: true });
  }
  return rows.sort((x, y) => istMs(x.date, x.startTime) - istMs(y.date, y.startTime));
}
const dayNo = (first: string, d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000) + 1;

/** The Skill Palaver template the university already uses (overnight, evening to next noon). */
export function skillPalaverTemplate(date: string): PlanRow[] {
  const next = istParts(istMs(date, '12:00') + 86_400_000).date;
  return [
    { kind: 'attendance', name: 'Day1_Evening', date, startTime: '19:00', endTime: '19:45', auto: true },
    { kind: 'attendance', name: 'Day1_Night', date, startTime: '23:00', endTime: '23:45', auto: true },
    { kind: 'attendance', name: 'Day2_Early Morning', date: next, startTime: '03:00', endTime: '03:45', auto: true },
    { kind: 'review', name: 'Final Review', date: next, startTime: '08:00', endTime: '11:55', auto: true },
    { kind: 'attendance', name: 'Day2_Morning', date: next, startTime: '10:30', endTime: '11:15', auto: true },
  ];
}

export interface Window { start: number; end: number }
export function windowOf(r: { date: string; startTime: string; endTime: string }): Window | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || '') || !/^\d{1,2}:\d{2}$/.test(r.startTime || '') || !/^\d{1,2}:\d{2}$/.test(r.endTime || '')) return null;
  const start = istMs(r.date, r.startTime); let end = istMs(r.date, r.endTime);
  if (end <= start) end += 86_400_000;
  return { start, end };
}
export function phaseOf(s: Pick<Session, 'date' | 'startTime' | 'endTime'>, now = Date.now()): 'live' | 'upcoming' | 'over' | 'no-time' {
  const w = windowOf(s); if (!w) return 'no-time';
  return now < w.start ? 'upcoming' : now < w.end ? 'live' : 'over';
}
/** Problems with a plan, per row index (shown inline). */
export function planIssues(rows: PlanRow[]): Record<number, string> {
  const out: Record<number, string> = {};
  rows.forEach((r, i) => { if (!r.name.trim()) out[i] = 'Give it a name.'; else if (!windowOf(r)) out[i] = 'Set the date and both times.'; });
  const timed = rows.map((r, i) => ({ r, i, w: windowOf(r) })).filter((x) => x.w).sort((a, b) => a.w!.start - b.w!.start);
  for (let k = 1; k < timed.length; k++) {
    const a = timed[k - 1], b = timed[k];
    if (a.r.kind === b.r.kind && b.w!.start < a.w!.end) out[b.i] = out[b.i] || `Overlaps ${a.r.name}.`;
  }
  const names = new Map<string, number>();
  rows.forEach((r, i) => { const k = r.kind + '|' + r.name.trim().toLowerCase(); if (names.has(k)) out[i] = out[i] || 'Same name as another session.'; names.set(k, i); });
  return out;
}

/** How a room splits into batches of ~size and how whole batches share among its faculty. */
export function batchShare(students: number, faculty: number, size: number) {
  const k = students ? Math.max(1, Math.round(students / size)) : 0;
  const per = Array.from({ length: Math.max(1, faculty) }, (_, i) => Math.floor(k / Math.max(1, faculty)) + (i < k % Math.max(1, faculty) ? 1 : 0));
  return { batches: k, min: Math.floor(students / Math.max(1, k)), max: Math.ceil(students / Math.max(1, k)), perFaculty: per };
}

// ---------- rubric templates ----------
const B4 = (a: string, b: string, c: string, d: string) => [a, b, c, d];
export const RUBRIC_TEMPLATES: { id: string; name: string; note: string; rubric: Rubric }[] = [
  {
    id: 'hack100', name: 'Hackathon — 100 marks', note: 'Idea, build, demo, presentation, teamwork',
    rubric: { bandLabels: ['Beginning', 'Developing', 'Proficient', 'Exemplary'], tables: [{ name: 'Hackathon Rubric', criteria: [
      { label: 'Innovativeness of the Idea', max: 20, bands: B4('Generic idea, no novelty', 'Slight variation of a known solution', 'Creative with original elements', 'Highly innovative and impactful') },
      { label: 'Technical Building Competence', max: 20, bands: B4('Non-functional or very basic', 'Partial build, major bugs', 'Working with minor issues', 'Clean, robust, well-structured') },
      { label: 'Functionality & Demonstration', max: 20, bands: B4('Demo fails, features missing', 'Core features partly working', 'Most features work', 'Fully functional, impressive demo') },
      { label: 'Presentation & Clarity', max: 20, bands: B4('Unclear communication', 'Basic, lacks confidence', 'Clear with good flow', 'Outstanding, handles Q&A well') },
      { label: 'Teamwork & Collaboration', max: 20, bands: B4('One member did the work', 'Uneven contribution', 'Good coordination', 'Every member contributed and can explain') },
    ] }] },
  },
  {
    id: 'review50', name: 'Progress review — 50 marks', note: 'For Review 1 / mid reviews',
    rubric: { bandLabels: ['Beginning', 'Developing', 'Proficient', 'Exemplary'], tables: [{ name: 'Progress Review', criteria: [
      { label: 'Problem Understanding', max: 10, bands: B4('Problem not clear', 'Partly understood', 'Clearly understood', 'Deep insight, users identified') },
      { label: 'Design / Approach', max: 15, bands: B4('No plan', 'Rough idea only', 'Sound design', 'Well-reasoned design with alternatives') },
      { label: 'Progress Made', max: 15, bands: B4('Nothing built', 'Started', 'On track', 'Ahead of plan') },
      { label: 'Communication', max: 10, bands: B4('Cannot explain', 'Explains with help', 'Explains clearly', 'Confident and precise') },
    ] }] },
  },
  {
    id: 'pbl', name: 'Project-based learning — 4 × 10', note: 'Short rubric for course projects',
    rubric: { bandLabels: ['1–3', '4–6', '7–8', '9–10'], tables: [{ name: 'Project Rubric', criteria: [
      { label: 'Concept & Relevance', max: 10, bands: B4('Weak', 'Fair', 'Good', 'Excellent') },
      { label: 'Implementation', max: 10, bands: B4('Weak', 'Fair', 'Good', 'Excellent') },
      { label: 'Testing & Results', max: 10, bands: B4('Weak', 'Fair', 'Good', 'Excellent') },
      { label: 'Viva & Documentation', max: 10, bands: B4('Weak', 'Fair', 'Good', 'Excellent') },
    ] }] },
  },
];
export const rubricTotal = (r: Rubric) => r.tables.reduce((n, t) => n + t.criteria.reduce((m, c) => m + (Number(c.max) || 0), 0), 0);

/** Current academic year: June onwards is the new year (2026-27). */
export function academicYearNow(d = new Date()) { const y = d.getFullYear(); const s = d.getMonth() >= 5 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, '0')}`; }
export function semesterNow(d = new Date()) { const m = d.getMonth(); return m >= 6 && m <= 11 ? 'Odd' : 'Even'; }

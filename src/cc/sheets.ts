// Spreadsheet helpers for the coordinator portal: read any Excel/CSV, find the header row and
// recognise the columns by their names, and write multi-sheet Excel downloads.
import * as XLSX from 'xlsx';

export type Row = Record<string, string>;
export interface Sheet { file: string; headers: string[]; rows: Row[] }

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/** What each field is usually called in university sheets (compared without spaces/punctuation). */
export const FIELD_HINTS: Record<string, string[]> = {
  reg: ['universityid', 'regno', 'regdno', 'registrationnumber', 'registrationno', 'registerno', 'regnumber', 'reg', 'rollno', 'rollnumber', 'studentid', 'idno', 'htno', 'hallticketno', 'admissionno', 'id'],
  name: ['studentname', 'name', 'nameofthestudent', 'fullname'],
  section: ['section', 'sec', 'sectionname', 'class'],
  branch: ['branch', 'program', 'programme', 'dept', 'department', 'stream', 'specialization'],
  room: ['roomno', 'room', 'roomnumber', 'venue', 'lab', 'classroom', 'labno'],
  courseCode: ['coursecode', 'subjectcode', 'code'],
  courseName: ['coursedesc', 'coursename', 'coursedescription', 'subject', 'subjectname', 'course'],
  empId: ['empid', 'employeeid', 'empno', 'staffid', 'employeeno', 'emp', 'eid'],
  facultyName: ['empname', 'facultyname', 'faculty', 'employeename', 'nameofthefaculty', 'mentor', 'mentorname', 'staffname'],
  email: ['emailid', 'email', 'mail', 'mailid', 'officialemail', 'klemail'],
  phone: ['phoneno', 'phone', 'mobile', 'mobileno', 'contact'],
  batchNo: ['batchno', 'batch', 'team', 'teamno', 'group', 'groupno'],
  projectId: ['projectid', 'psid', 'psno', 'problemstatementid', 'projectno', 'projectcode', 'id'],
  title: ['projecttitle', 'title', 'project', 'problemstatement', 'projectname', 'topic'],
  domain: ['domain', 'track', 'theme', 'area', 'category'],
};

/** Best column for a field: exact name match first, then a name that contains the hint. */
export function guessColumn(headers: string[], field: string, taken: Set<string> = new Set()): string {
  const hints = FIELD_HINTS[field] || [];
  for (const h of hints) { const c = headers.find((x) => !taken.has(x) && norm(x) === h); if (c) return c; }
  for (const h of hints.filter((x) => x.length > 3)) { const c = headers.find((x) => !taken.has(x) && norm(x).includes(h)); if (c) return c; }
  return '';
}
export function guessColumns(headers: string[], fields: string[]): Record<string, string> {
  const taken = new Set<string>(); const out: Record<string, string> = {};
  for (const f of fields) { const c = guessColumn(headers, f, taken); out[f] = c; if (c) taken.add(c); }
  return out;
}

/** Read the first sheet of a file. The header row is the first row with 2+ recognisable names. */
export async function readSheet(file: File): Promise<Sheet> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: false }) as unknown[][];
  const known = new Set(Object.values(FIELD_HINTS).flat());
  let at = 0;
  for (let i = 0; i < Math.min(grid.length, 15); i++) {
    const hits = (grid[i] || []).filter((c) => known.has(norm(clean(c)))).length;
    if (hits >= 2) { at = i; break; }
  }
  const raw = (grid[at] || []).map(clean);
  const headers = raw.map((h, i) => h || `Column ${i + 1}`);
  const rows: Row[] = [];
  for (const r of grid.slice(at + 1)) {
    const o: Row = {}; let any = false;
    headers.forEach((h, i) => { const v = clean((r as unknown[])[i]); o[h] = v; if (v) any = true; });
    if (any) rows.push(o);
  }
  return { file: file.name, headers, rows };
}

/** Save several sheets as one .xlsx. Column widths follow the content. */
export function downloadXlsx(filename: string, sheets: { name: string; rows: Record<string, unknown>[]; title?: string }[]) {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const s of sheets) {
    let name = s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet';
    while (used.has(name)) name = name.slice(0, 28) + '_' + used.size;
    used.add(name);
    const ws = s.title ? XLSX.utils.aoa_to_sheet([[s.title], []]) : XLSX.utils.aoa_to_sheet([]);
    XLSX.utils.sheet_add_json(ws, s.rows.length ? s.rows : [{ Note: 'No rows' }], { origin: s.title ? 'A3' : 'A1' });
    const keys = Object.keys(s.rows[0] || { Note: '' });
    ws['!cols'] = keys.map((k) => ({ wch: Math.min(60, Math.max(k.length + 2, ...s.rows.slice(0, 300).map((r) => String(r[k] ?? '').length + 1))) }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}
export const safeName = (s: string) => s.replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_').slice(0, 60) || 'hackathon';

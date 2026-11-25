// Course Coordinator portal: API calls carry the coordinator's session token (never the admin token).
import { api } from '../api';

const KEY = 'kl_cc_token';
export const ccToken = () => localStorage.getItem(KEY) || '';
export const setCcToken = (t: string) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));
const H = () => ({ 'x-cc-token': ccToken() });

/** Thrown when the session has expired; the portal shows the sign-in screen again. */
export class ReauthError extends Error {}
async function wrap<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) {
    const m = (e as Error).message || '';
    if (/sign in again/i.test(m)) { setCcToken(''); throw new ReauthError(m); }
    throw e;
  }
}
export const cc = {
  get: <T>(path: string) => wrap(api.get<T>(path, H())),
  post: <T>(path: string, body?: unknown) => wrap(api.post<T>(path, body ?? {}, H())),
};

// ---------- shapes ----------
export interface Coordinator { id: string; name: string; email: string; empId: string; department: string; active: boolean }
export interface Meta {
  courseCode?: string; courseName?: string; academicYear?: string; semester?: string; department?: string; venue?: string;
  startDate?: string; endDate?: string; status?: string; notes?: string; reviews?: number; attendanceCount?: number; batchSize?: number; step?: number; autoBatch?: boolean;
}
export interface Program { id: string; title: string; createdAt: string; ownerCc: string; meta: Meta; students?: number; rooms?: number; attendanceSessions?: number; reviewSessions?: number; openRooms?: number; batchSize?: number }
export interface Session { id: string; programId: string; kind: 'attendance' | 'review'; name: string; date: string; startTime: string; endTime: string; openRooms: string[]; auto: boolean; autoState: string; createdAt?: string }
export interface Fac { key: string; name: string; empId: string; hasEmail: boolean }
export interface Room { room: string; label: string; students: number; batches: number; faculty: Fac[]; reviewers: { key: string; name: string; batches: number; students: number }[] }
export interface Stu { id: string; reg: string; name: string; branch: string; section: string; room: string; facultyList: string[]; facultyName: string; batchNo: string; reviewer: string; project: string; ps: string; courseCode: string; courseName: string }
export interface Crit { label: string; max: number; bands: string[] }
export interface Rubric { bandLabels: string[]; tables: { name: string; criteria: Crit[] }[] }
export interface Check { level: 'ok' | 'warn' | 'error'; area: string; text: string }
export interface Detail { program: Program; rubric: Rubric; batchSize: number; students: number; rooms: Room[]; sessions: Session[]; projects: number; auth: { mode: string; otp: boolean; smtp: boolean } }
export interface BoardRoom { room: string; label: string; students: number; faculty: Fac[]; open: boolean; posted: boolean; present?: number; absent?: number; postedBy?: string | null; postedAt?: string | null; scored?: number; avg?: number }
export interface Board { program: Program; session: Session; rooms: BoardRoom[]; summary: { rooms: number; open: number; posted: number; students: number; present: number; absent: number; scored: number; noFaculty: number }; maxTotal: number }
export interface Project { id: string; projectId: string; title: string; domain: string; courseCode: string; batches?: number }
export interface FacultyRow { key: string; name: string; rooms: string[]; students: number; batches: number; reviewStudents: number; email: string; empId: string }

export const roomKey = (r: string) => String(r || '').trim().toUpperCase().replace(/\s+/g, '') || '(NO ROOM)';
export const facultyKey = (name: string) => String(name || '').toLowerCase().replace(/\b(dr|mr|mrs|ms|miss|prof|smt)\b\.?/g, ' ').replace(/[^a-z]/g, '');
export const byNatural = (a: string, b: string) => String(a).localeCompare(String(b), undefined, { numeric: true });

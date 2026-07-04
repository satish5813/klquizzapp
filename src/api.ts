// In local dev this is '' (Vite proxies /api → backend). On Vercel set
// VITE_API_URL to the Hostinger API origin, e.g. https://quiz-api.yourdomain.com
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
export const apiBase = API_BASE;
// Authenticated binary download (e.g. .xlsx) — fetches with headers and saves the blob.
export async function downloadFile(path: string, filename: string, headers?: Record<string, string>) {
  const res = await fetch(API_BASE + path, { headers });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON (e.g. an HTML error page) */ }
  if (body === null && text.trim().startsWith('<')) {
    throw new Error(`Server returned an error page (HTTP ${res.status}). Please try again or contact the coordinator.`);
  }
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  get: <T>(p: string, headers?: Record<string, string>) => req<T>(p, { method: 'GET', headers }),
  post: <T>(p: string, b?: unknown, headers?: Record<string, string>) =>
    req<T>(p, { method: 'POST', headers, body: b === undefined ? undefined : JSON.stringify(b) }),
};

export interface QuizQuestion { id: string; question: string; options: string[]; topic: string; difficulty: string; }
export interface ReviewItem { question: string; options: string[]; correctIndex: number; yourIndex: number | null; correct: boolean; explanation: string; }
export interface StudentInfo { registrationNumber: string; name: string; branch: string; section: string; domain?: string; }
export interface AttemptInfo { state: 'none' | 'in_progress' | 'completed'; attemptId?: string; status?: string; score?: number; total?: number; percentage?: number; }
export interface ScheduleInfo { open: boolean; reason?: 'open' | 'not_scheduled' | 'not_started' | 'closed'; domain?: string; startAt?: string | null; endAt?: string | null; }
export interface LoginResponse { student: StudentInfo; attempt: AttemptInfo; quizSize: number; durationMin: number; schedule: ScheduleInfo; }
export interface FacAttendee { registrationNumber: string; name: string; branch: string; section: string; loggedIn: boolean; present: boolean; status: 'submitted' | 'in_progress' | 'logged_in' | 'absent'; autoSubmitted: boolean; score: number | null; total: number | null; percentage: number | null; startedAt: string | null; submittedAt: string | null; }
export interface FacSession { id: string; name: string; open: boolean; createdAt: string; posted: boolean; postedAt: string | null; present: number; absent: number; total: number; marks: Record<string, boolean> | null; }
export interface FacultyResponse { faculty: { empId: string; name: string; section: string; room: string; total: number }; summary: { total: number; present: number; absent: number; submitted: number; inProgress: number }; sessions: FacSession[]; students: FacAttendee[]; }
export interface AttSessionInfo { id: string; name: string; createdAt: string; openedAt: string | null; closedAt: string | null; open: boolean; }
export interface AttSection { empId: string; facultyName: string; section: string; room: string; total: number; posted: boolean; postedAt: string | null; present: number; absent: number; pct: number; }
export interface AttReport { sessions: AttSessionInfo[]; session: AttSessionInfo | null; summary: { faculties: number; posted: number; notPosted: number; totalStudents: number; present: number; absent: number }; sections: AttSection[]; }
// ---- Review system ----
export interface RubricTable { name: string; criteria: string[]; }
export interface Rubric { levels: number[]; tables: RubricTable[]; }
export interface ReviewMemberRow { reg: string; name: string; present: boolean; scores: Record<string, number>; total: number; percentage: number | null; grade: string; }
export interface ReviewBatch { id: string; batchNo: string; project: string; ps: string; members: { reg: string; name: string }[]; submitted: boolean; rows: ReviewMemberRow[]; }
export interface FacultyReview { faculty: { empId: string; name: string; section: string; room: string; batches: number }; review: { id: string; name: string } | null; rubric: Rubric; maxTotal: number; batches: ReviewBatch[]; }
export interface AnalyticsAgg { key: string; students: number; scored: number; present: number; absent: number; avg: number; }
export interface ReviewAnalytics { review: ReviewInfo | null; rubric: Rubric; summary: { review: string; batches: number; students: number; scored: number; present: number; absent: number; avg: number; maxTotal: number }; bySection: AnalyticsAgg[]; byFaculty: AnalyticsAgg[]; students: { section: string; batchNo: string; facultyName: string; reg: string; name: string; present: boolean | null; total: number | null; percentage: number | null; grade: string; scored: boolean }[]; }
export interface ReviewInfo { id: string; name: string; open: boolean; createdAt: string; }
export interface AdminBatch { id: string; section: string; batchNo: string; empId: string; facultyName: string; room: string; project: string; ps: string; members: { reg: string; name: string }[]; }
export interface ScoreRow { section: string; batchNo: string; empId: string; facultyName: string; project: string; ps: string; reg: string; name: string; present: boolean | null; total: number | null; scored: boolean; }
export interface ReviewScores { reviews: ReviewInfo[]; review: ReviewInfo | null; rubric: Rubric; summary: { batches: number; students: number; scored: number }; rows: ScoreRow[]; }

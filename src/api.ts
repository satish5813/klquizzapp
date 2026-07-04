// In local dev this is '' (Vite proxies /api → backend). On Vercel set
// VITE_API_URL to the Hostinger API origin, e.g. https://quiz-api.yourdomain.com
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

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
export interface FacAttendance { session: { id: string; name: string } | null; open: boolean; posted: boolean; postedAt: string | null; marks: Record<string, boolean> | null; }
export interface FacultyResponse { faculty: { empId: string; name: string; section: string; room: string; total: number }; summary: { total: number; present: number; absent: number; submitted: number; inProgress: number }; attendance: FacAttendance; students: FacAttendee[]; }
export interface AttSessionInfo { id: string; name: string; createdAt: string; openedAt: string | null; closedAt: string | null; open: boolean; }
export interface AttSection { empId: string; facultyName: string; section: string; room: string; total: number; posted: boolean; postedAt: string | null; present: number; absent: number; pct: number; }
export interface AttReport { sessions: AttSessionInfo[]; session: AttSessionInfo | null; summary: { faculties: number; posted: number; notPosted: number; totalStudents: number; present: number; absent: number }; sections: AttSection[]; }

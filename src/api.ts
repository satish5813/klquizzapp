// In local dev this is '' (Vite proxies /api → backend). On Vercel set
// VITE_API_URL to the Hostinger API origin, e.g. https://quiz-api.yourdomain.com
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
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
export interface StudentInfo { registrationNumber: string; name: string; branch: string; section: string; }
export interface AttemptInfo { state: 'none' | 'in_progress' | 'completed'; attemptId?: string; status?: string; score?: number; total?: number; percentage?: number; }
export interface LoginResponse { student: StudentInfo; attempt: AttemptInfo; quizSize: number; durationMin: number; }

// The desktop app talks directly to the quiz backend (CORS is enabled there).
// Base URL + admin token are configurable and persisted locally.
const LS_BASE = 'kl_admin_base';
const LS_TOKEN = 'kl_admin_token';

export const settings = {
  base: () => localStorage.getItem(LS_BASE) || 'http://localhost:4000',
  token: () => localStorage.getItem(LS_TOKEN) || '',
  save: (base: string, token: string) => { localStorage.setItem(LS_BASE, base); localStorage.setItem(LS_TOKEN, token); },
};

async function req<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.headers as any) };
  if (auth) headers['x-admin-token'] = settings.token();
  const res = await fetch(settings.base() + path, { ...init, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  get: <T>(p: string, auth = true) => req<T>(p, { method: 'GET' }, auth),
  post: <T>(p: string, b?: unknown, auth = true) => req<T>(p, { method: 'POST', body: b === undefined ? undefined : JSON.stringify(b) }, auth),
  raw: (p: string) => fetch(settings.base() + p, { headers: { 'x-admin-token': settings.token() } }),
};

export interface Student { id: string; registrationNumber: string; name: string; branch: string; section?: string; createdAt: string; }
export interface Attempt { attemptId: string; registrationNumber: string; name: string; branch: string; score: number | null; total: number; percentage: number | null; status: string; reason: string; startedAt: string; submittedAt: string | null; }
export interface QReport { id: string; question: string; topic: string; difficulty: string; answered: number; correct: number; pctCorrect: number | null; }
export interface ReviewItem { question: string; options: string[]; correctIndex: number; yourIndex: number | null; correct: boolean; explanation: string; }

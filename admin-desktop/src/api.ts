// The desktop app talks directly to the quiz backend (CORS is enabled there).
// Base URL + admin token are configurable and persisted locally.
const LS_BASE = 'kl_admin_base';
const LS_TOKEN = 'kl_admin_token';
const LS_CLAUDE = 'kl_claude_key';

// Defaults can be baked in via admin-desktop/.env (git-ignored):
//   VITE_API_URL=http://...   VITE_ADMIN_TOKEN=...
// The Hostinger API is the default server (not localhost).
const ENV_BASE = (import.meta.env.VITE_API_URL || 'http://p3azuzswx8ewrgojju6xhm1k.187.127.135.148.sslip.io').replace(/\/$/, '');
const ENV_TOKEN = import.meta.env.VITE_ADMIN_TOKEN || '';

export const settings = {
  base: () => localStorage.getItem(LS_BASE) || ENV_BASE,
  token: () => localStorage.getItem(LS_TOKEN) || ENV_TOKEN,
  save: (base: string, token: string) => { localStorage.setItem(LS_BASE, base); localStorage.setItem(LS_TOKEN, token); },
  // Claude API key — stored locally on this machine only, sent to your own server for generation.
  claudeKey: () => localStorage.getItem(LS_CLAUDE) || '',
  saveClaudeKey: (k: string) => localStorage.setItem(LS_CLAUDE, k),
};

async function req<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.headers as any) };
  if (auth) headers['x-admin-token'] = settings.token();
  const res = await fetch(settings.base() + path, { ...init, headers });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON (e.g. an HTML error page) */ }
  if (body === null && text.trim().startsWith('<')) {
    throw new Error(res.status === 404
      ? `This feature isn't on the server yet (HTTP 404). Redeploy the API in Coolify to enable it.`
      : `Server returned an error page (HTTP ${res.status}).`);
  }
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  get: <T>(p: string, auth = true) => req<T>(p, { method: 'GET' }, auth),
  post: <T>(p: string, b?: unknown, auth = true) => req<T>(p, { method: 'POST', body: b === undefined ? undefined : JSON.stringify(b) }, auth),
  raw: (p: string) => fetch(settings.base() + p, { headers: { 'x-admin-token': settings.token() } }),
};

export interface Student { id: string; registrationNumber: string; name: string; branch: string; section?: string; active?: boolean; createdAt: string; }
export interface StudentsPage { rows: Student[]; total: number; page: number; pageSize: number; activeCount: number; inactiveCount: number; allCount: number; }
export interface Attempt { attemptId: string; registrationNumber: string; name: string; branch: string; score: number | null; total: number; percentage: number | null; status: string; reason: string; violations?: number; startedAt: string; submittedAt: string | null; }
export interface QReport { id: string; question: string; topic: string; difficulty: string; answered: number; correct: number; pctCorrect: number | null; }
export interface ReviewItem { question: string; options: string[]; correctIndex: number; yourIndex: number | null; correct: boolean; explanation: string; }

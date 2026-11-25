// Small UI kit for the coordinator portal (Tailwind only).
import { ReactNode, useEffect, useState } from 'react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Card({ title, hint, right, children, className, pad = true }: { title?: ReactNode; hint?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx('rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70', className)}>
      {(title || right) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <div>
            {title && <h3 className="text-[15px] font-semibold text-slate-800">{title}</h3>}
            {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
          </div>
          {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
        </header>
      )}
      <div className={pad ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

type BtnKind = 'primary' | 'ghost' | 'danger' | 'soft' | 'dark';
export function Btn({ kind = 'ghost', size = 'md', className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: BtnKind; size?: 'sm' | 'md' }) {
  const k = {
    primary: 'bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 focus-visible:ring-indigo-300',
    dark: 'bg-slate-900 text-white hover:bg-slate-800 focus-visible:ring-slate-300',
    ghost: 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 focus-visible:ring-indigo-200',
    soft: 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 focus-visible:ring-indigo-200',
    danger: 'bg-white text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50 focus-visible:ring-rose-200',
  }[kind];
  const s = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-4 py-2 text-sm';
  return <button {...p} className={cx('inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold outline-none transition focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-50', k, s, className)} />;
}

export function Badge({ tone = 'slate', children }: { tone?: 'slate' | 'green' | 'amber' | 'red' | 'indigo' | 'sky'; children: ReactNode }) {
  const t = { slate: 'bg-slate-100 text-slate-600', green: 'bg-emerald-50 text-emerald-700 ring-emerald-200', amber: 'bg-amber-50 text-amber-700 ring-amber-200', red: 'bg-rose-50 text-rose-700 ring-rose-200', indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200', sky: 'bg-sky-50 text-sky-700 ring-sky-200' }[tone];
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-transparent', t)}>{children}</span>;
}

export function Stat({ label, value, sub, tone = 'slate' }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'slate' | 'indigo' | 'green' | 'amber' | 'red' }) {
  const bar = { slate: 'bg-slate-300', indigo: 'bg-indigo-500', green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-rose-500' }[tone];
  return (
    <div className="relative overflow-hidden rounded-2xl bg-white px-4 py-3.5 shadow-sm ring-1 ring-slate-200/70">
      <span className={cx('absolute inset-y-0 left-0 w-1', bar)} />
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}
export const inputCls = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-50';
export const Input = (p: React.InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, p.className)} />;
export const Select = (p: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(inputCls, 'pr-8', p.className)} />;

export function Modal({ open, title, onClose, children, wide, footer }: { open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-[8vh] backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('w-full rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200', wide ? 'max-w-3xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h3 className="text-base font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">✕</button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** A message strip: errors, warnings, success. */
export function Note({ tone = 'info', children, onClose }: { tone?: 'info' | 'ok' | 'warn' | 'error'; children: ReactNode; onClose?: () => void }) {
  const t = { info: 'bg-sky-50 text-sky-800 ring-sky-200', ok: 'bg-emerald-50 text-emerald-800 ring-emerald-200', warn: 'bg-amber-50 text-amber-800 ring-amber-200', error: 'bg-rose-50 text-rose-800 ring-rose-200' }[tone];
  const i = { info: 'ℹ', ok: '✓', warn: '!', error: '✕' }[tone];
  return (
    <div className={cx('flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-sm ring-1', t)}>
      <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/70 text-xs font-bold">{i}</span>
      <div className="min-w-0 flex-1">{children}</div>
      {onClose && <button onClick={onClose} className="text-xs opacity-60 hover:opacity-100">✕</button>}
    </div>
  );
}

/** Toast messages from anywhere: toast('Saved'). */
type T = { id: number; text: string; tone: 'ok' | 'error' };
let push: (t: T) => void = () => {};
export const toast = (text: string, tone: 'ok' | 'error' = 'ok') => push({ id: Date.now() + Math.random(), text, tone });
export function Toasts() {
  const [list, setList] = useState<T[]>([]);
  useEffect(() => { push = (t) => { setList((l) => [...l, t]); setTimeout(() => setList((l) => l.filter((x) => x.id !== t.id)), t.tone === 'error' ? 7000 : 3500); }; }, []);
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-80 flex-col gap-2">
      {list.map((t) => (
        <div key={t.id} className={cx('pointer-events-auto rounded-xl px-4 py-3 text-sm font-medium shadow-lg ring-1', t.tone === 'ok' ? 'bg-slate-900 text-white ring-slate-800' : 'bg-rose-600 text-white ring-rose-700')}>{t.text}</div>
      ))}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return <div className="flex items-center gap-2 text-sm text-slate-500"><span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />{label}</div>;
}

export function Empty({ icon = '📭', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center">
      <div className="text-3xl">{icon}</div>
      <div className="mt-2 text-sm font-semibold text-slate-700">{title}</div>
      {children && <div className="mt-1 max-w-md text-xs text-slate-500">{children}</div>}
    </div>
  );
}

/** Drop zone for spreadsheets. */
export function FileDrop({ onFiles, label = 'Drop Excel / CSV files here or click to choose', multiple = true }: { onFiles: (f: File[]) => void; label?: string; multiple?: boolean }) {
  const [over, setOver] = useState(false);
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = [...e.dataTransfer.files]; if (f.length) onFiles(f); }}
      className={cx('flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition', over ? 'border-indigo-400 bg-indigo-50' : 'border-slate-300 bg-slate-50/50 hover:border-indigo-300 hover:bg-indigo-50/40')}>
      <span className="grid h-11 w-11 place-items-center rounded-xl bg-white text-xl shadow-sm ring-1 ring-slate-200">📄</span>
      <span className="mt-2 text-sm font-semibold text-slate-700">{label}</span>
      <span className="text-xs text-slate-400">.xlsx, .xls or .csv</span>
      <input type="file" className="hidden" accept=".xlsx,.xls,.csv" multiple={multiple} onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ''; if (f.length) onFiles(f); }} />
    </label>
  );
}

export const fmtDate = (d: string) => (d ? new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : '—');
export const fmtTime = (t: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); if (!m) return '—'; const h = Number(m[1]); return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`; };
export const errMsg = (e: unknown) => (e as Error)?.message || String(e);

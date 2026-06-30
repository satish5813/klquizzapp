import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ReviewItem } from '../api';
import RichText from '../RichText';

interface ResultData { score: number; total: number; percentage: number; status: string; terminated: boolean; reason: string; review: ReviewItem[]; }

function Logo({ src, fallback }: { src: string; fallback: string }) {
  return (
    <img src={src} alt={fallback} className="h-12 w-auto object-contain"
      onError={(e) => { const s = document.createElement('span'); s.className = 'grid h-12 min-w-[48px] place-items-center rounded-lg bg-teal-50 px-3 font-bold text-teal-700'; s.textContent = fallback; e.currentTarget.replaceWith(s); }} />
  );
}

export default function Result() {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<ResultData | null>(null);
  const [error, setError] = useState('');

  const name = sessionStorage.getItem('kl_name') || 'Candidate';
  const reg = sessionStorage.getItem('kl_reg') || '';
  const branch = sessionStorage.getItem('kl_branch') || '';
  const section = sessionStorage.getItem('kl_section') || '';
  const domain = sessionStorage.getItem('kl_domain') || '';
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const back = () => { ['kl_reg', 'kl_name', 'kl_branch', 'kl_section', 'kl_domain'].forEach((k) => sessionStorage.removeItem(k)); navigate('/'); };

  useEffect(() => {
    api.get<ResultData>(`/api/result/${attemptId}`).then(setData).catch((e) => setError(e.message));
  }, [attemptId]);

  if (error) return <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>;
  if (!data) return <p className="text-sm text-slate-400">Loading result…</p>;

  if (data.terminated) {
    return (
      <div className="card mx-auto max-w-md border-2 border-red-200 text-center">
        <p className="text-5xl">⛔</p>
        <h1 className="mt-2 text-xl font-bold text-red-700">Exam terminated</h1>
        <p className="mt-1 text-sm text-slate-600">Your exam was ended due to a full-screen / focus violation ({data.reason}). It is recorded as <b>0 marks</b>.</p>
        <p className="my-3 text-5xl font-bold text-red-700">0 / {data.total}</p>
        <button onClick={back} className="mt-2 rounded-xl bg-teal-600 px-6 py-2.5 font-semibold text-white hover:bg-teal-700">← Back to Login</button>
      </div>
    );
  }

  const PASS_MARK = 75;
  const passed = data.percentage >= PASS_MARK;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* CERTIFICATE */}
      <div className="relative overflow-hidden rounded-2xl bg-white p-1 shadow-xl ring-1 ring-slate-200 print:shadow-none">
        <div className="rounded-xl border-[3px] border-double border-teal-600/40 px-6 py-8 text-center sm:px-10">
          <div className="mb-5 flex items-center justify-center gap-6">
            <Logo src="/logo-left.png" fallback="KL" />
            <Logo src="/logo-right.png" fallback="SKILL" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-teal-700">Certificate of Completion</p>
          <div className="mx-auto my-3 h-px w-24 bg-teal-600/40" />
          <p className="text-sm text-slate-500">This is to certify that</p>
          <h1 className="mt-1 font-serif text-3xl font-bold tracking-wide text-slate-800">{name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {branch && <>Branch <b className="text-slate-700">{branch}</b></>}{section && <> · Section <b className="text-slate-700">{section}</b></>}{reg && <> · Reg. No <b className="text-slate-700">{reg}</b></>}
          </p>
          <p className="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-slate-600">
            has successfully completed the <b>KL AI QuizApp{domain ? ` — ${domain}` : ''}</b> online examination on {today}, achieving the result below.
          </p>

          <div className="mx-auto mt-5 flex max-w-sm items-stretch justify-center gap-3">
            <div className="flex-1 rounded-xl bg-teal-50 py-3">
              <p className="text-3xl font-extrabold text-teal-700">{data.percentage}%</p>
              <p className="text-[11px] font-medium uppercase tracking-wide text-teal-600/80">Score</p>
            </div>
            <div className="flex-1 rounded-xl bg-slate-50 py-3">
              <p className="text-3xl font-extrabold text-slate-800">{data.score}/{data.total}</p>
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Correct</p>
            </div>
            <div className={`flex-1 rounded-xl py-3 ${passed ? 'bg-green-50' : 'bg-red-50'}`}>
              <p className={`text-3xl font-extrabold ${passed ? 'text-green-700' : 'text-red-600'}`}>{passed ? 'Pass' : 'Fail'}</p>
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Result (pass ≥ {PASS_MARK}%)</p>
            </div>
          </div>

          <div className="mt-7 flex items-end justify-between text-xs text-slate-400">
            <div className="text-left"><p className="border-t border-slate-300 pt-1 font-medium text-slate-500">Date: {today}</p></div>
            <div className="text-right"><p className="border-t border-slate-300 pt-1 font-medium text-slate-500">KL AI QuizApp</p></div>
          </div>
        </div>
      </div>

      <div className="flex justify-center gap-3 print:hidden">
        <button onClick={() => window.print()} className="rounded-xl bg-teal-600 px-6 py-2.5 font-semibold text-white shadow-sm hover:bg-teal-700">⬇ Print / Save certificate</button>
        <button onClick={back} className="rounded-xl bg-white px-6 py-2.5 font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">← Back to Login</button>
      </div>

      {/* REVIEW */}
      <div className="print:hidden">
        <p className="mb-2 text-sm font-semibold text-slate-700">Answer review</p>
        <div className="space-y-3">
          {data.review.map((r, i) => (
            <div key={i} className="card">
              <RichText text={`${i + 1}. ${r.question}`} className="mb-2 font-medium" />
              <div className="space-y-1.5">
                {r.options.map((opt, oi) => {
                  const isCorrect = oi === r.correctIndex;
                  const isYours = oi === r.yourIndex;
                  return (
                    <div key={oi} className={`flex items-start gap-2 rounded-lg border px-3 py-1.5 text-sm ${isCorrect ? 'border-green-300 bg-green-50' : isYours ? 'border-red-300 bg-red-50' : 'border-slate-100'}`}>
                      <span className="mt-0.5 font-mono text-xs text-slate-400">{String.fromCharCode(65 + oi)}</span>
                      <RichText text={opt} className="min-w-0 flex-1" />
                      {isCorrect && <span className="ml-auto whitespace-nowrap text-xs font-semibold text-green-700">correct</span>}
                      {isYours && !isCorrect && <span className="ml-auto whitespace-nowrap text-xs font-semibold text-red-700">your answer</span>}
                    </div>
                  );
                })}
              </div>
              {r.explanation && <p className="mt-2 text-xs text-slate-500">{r.explanation}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

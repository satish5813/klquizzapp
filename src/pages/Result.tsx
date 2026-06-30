import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ReviewItem } from '../api';

interface ResultData { score: number; total: number; percentage: number; status: string; terminated: boolean; reason: string; review: ReviewItem[]; }

export default function Result() {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<ResultData | null>(null);
  const [error, setError] = useState('');
  const back = () => { sessionStorage.removeItem('kl_reg'); navigate('/'); };
  const BackBtn = () => (
    <button onClick={back} className="mt-4 rounded-xl bg-teal-600 px-6 py-2.5 font-semibold text-white shadow-sm transition hover:bg-teal-700">← Back to Login</button>
  );

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
        <p className="mt-1 text-sm text-slate-600">
          Your exam was ended due to a full-screen / focus violation ({data.reason}). It is recorded as <b>0 marks</b>.
        </p>
        <p className="my-3 text-5xl font-bold text-red-700">0 / {data.total}</p>
        <BackBtn />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="card text-center">
        <p className="text-sm text-slate-500">Your score</p>
        <p className="my-1 text-5xl font-bold text-brand-700">{data.percentage}%</p>
        <p className="text-slate-600">{data.score} / {data.total} correct</p>
        <BackBtn />
      </div>
      <p className="text-sm font-semibold text-slate-700">Review</p>
      <div className="space-y-3">
        {data.review.map((r, i) => (
          <div key={i} className="card">
            <p className="mb-2 font-medium">{i + 1}. {r.question}</p>
            <div className="space-y-1.5">
              {r.options.map((opt, oi) => {
                const isCorrect = oi === r.correctIndex;
                const isYours = oi === r.yourIndex;
                return (
                  <div key={oi} className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${isCorrect ? 'border-green-300 bg-green-50' : isYours ? 'border-red-300 bg-red-50' : 'border-slate-100'}`}>
                    <span className="font-mono text-xs text-slate-400">{String.fromCharCode(65 + oi)}</span>
                    <span>{opt}</span>
                    {isCorrect && <span className="ml-auto text-xs font-semibold text-green-700">correct</span>}
                    {isYours && !isCorrect && <span className="ml-auto text-xs font-semibold text-red-700">your answer</span>}
                  </div>
                );
              })}
            </div>
            {r.explanation && <p className="mt-2 text-xs text-slate-500">{r.explanation}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

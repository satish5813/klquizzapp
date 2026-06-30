import { Link, Navigate, Route, Routes } from 'react-router-dom';
import Login from './pages/Login';
import Welcome from './pages/Welcome';
import Quiz from './pages/Quiz';
import Result from './pages/Result';

// Two logos: drop your images at public/logo-left.png and public/logo-right.png.
// If a file is missing it falls back to a styled badge so the layout never breaks.
function Logo({ src, fallback }: { src: string; fallback: string }) {
  return (
    <img
      src={src}
      alt={fallback}
      className="h-10 w-auto object-contain"
      onError={(e) => {
        const el = e.currentTarget;
        const span = document.createElement('span');
        span.className = 'grid h-10 min-w-[40px] place-items-center rounded-lg bg-teal-50 px-3 text-sm font-bold text-teal-700';
        span.textContent = fallback;
        el.replaceWith(span);
      }}
    />
  );
}

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2.5">
          <Logo src="/logo-left.png" fallback="KL" />
          <Link to="/" className="text-center leading-tight">
            <div className="text-base font-bold tracking-tight text-slate-800">KL AI QuizApp</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-teal-600">Online Examination</div>
          </Link>
          <Logo src="/logo-right.png" fallback="SKILL" />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/quiz/:attemptId" element={<Quiz />} />
          <Route path="/result/:attemptId" element={<Result />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

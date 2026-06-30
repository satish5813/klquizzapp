import { Link, Navigate, Route, Routes } from 'react-router-dom';
import Login from './pages/Login';
import Welcome from './pages/Welcome';
import Quiz from './pages/Quiz';
import Result from './pages/Result';
import Admin from './pages/Admin';

// Two logos: drop your images at public/logo-left.png and public/logo-right.png.
// If a file is missing it falls back to a styled badge so the layout never breaks.
function Logo({ src, fallback }: { src: string; fallback: string }) {
  return (
    <img
      src={src}
      alt={fallback}
      className="h-11 w-auto object-contain"
      onError={(e) => {
        const el = e.currentTarget;
        const span = document.createElement('span');
        span.className = 'grid h-11 min-w-[44px] place-items-center rounded-xl bg-white/20 px-3 text-sm font-bold text-white';
        span.textContent = fallback;
        el.replaceWith(span);
      }}
    />
  );
}

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="bg-gradient-to-r from-blue-700 via-indigo-600 to-violet-600 text-white shadow-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Logo src="/logo-left.png" fallback="KL" />
          <Link to="/" className="text-center leading-tight">
            <div className="text-lg font-bold tracking-wide">KL AI QuizApp</div>
            <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/80">Online Examination</div>
          </Link>
          <Logo src="/logo-right.png" fallback="AI" />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/quiz/:attemptId" element={<Quiz />} />
          <Route path="/result/:attemptId" element={<Result />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="pb-6 text-center text-xs text-slate-400">
        <Link to="/admin" className="hover:text-slate-600">Admin</Link>
      </footer>
    </div>
  );
}

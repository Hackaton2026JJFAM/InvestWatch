import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router-dom';
import { LiveProvider, useLive } from './live.jsx';
const Alerts = lazy(() => import('./pages/Alerts.jsx'));
const Calibration = lazy(() => import('./pages/Calibration.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Entities = lazy(() => import('./pages/Entities.jsx'));
const Entity = lazy(() => import('./pages/Entity.jsx'));
const Material = lazy(() => import('./pages/Material.jsx'));
const Results = lazy(() => import('./pages/Results.jsx'));
const Scan = lazy(() => import('./pages/Scan.jsx'));
const Search = lazy(() => import('./pages/Search.jsx'));
import './styles.css';

function Shell() {
  const { connected, unread, threshold, toasts } = useLive();
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">
          <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#1d5fa8" /><path d="M7 20l6-6 4 4 8-8" stroke="#ffd166" strokeWidth="3" fill="none" strokeLinecap="round" /></svg>
          <div>InvestWatch<small>monitoring reklam inwestycyjnych</small></div>
        </div>
        <nav className="nav">
          <NavLink to="/" end>Pulpit</NavLink>
          <NavLink to="/materials">Wyniki analiz</NavLink>
          <NavLink to="/alerts">Alerty {unread > 0 && <span className="badge">{unread}</span>}</NavLink>
          <NavLink to="/entities">Podmioty</NavLink>
          <NavLink to="/search">Wyszukiwarka</NavLink>
          <NavLink to="/calibration">Kalibracja</NavLink>
          <NavLink to="/scan">Skanowanie i źródła</NavLink>
        </nav>
        <div className="foot">
          <div><span className={`dot ${connected ? 'on' : ''}`} />{connected ? 'Na żywo (WebSocket)' : 'Brak połączenia'}</div>
          <div style={{ marginTop: 6 }}>Próg ryzyka: <b>{threshold ?? '–'}</b></div>
          <div style={{ marginTop: 10 }}>Wyniki są sygnałem do weryfikacji, nie stwierdzeniem naruszenia.</div>
        </div>
      </aside>
      <main className="main">
        <Suspense fallback={<div className="empty">Ładowanie…</div>}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/materials" element={<Results />} />
          <Route path="/materials/:id" element={<Material />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/entities" element={<Entities />} />
          <Route path="/entities/:id" element={<Entity />} />
          <Route path="/search" element={<Search />} />
          <Route path="/calibration" element={<Calibration />} />
          <Route path="/scan" element={<Scan />} />
          <Route path="*" element={<div className="empty">Nie znaleziono strony</div>} />
        </Routes>
        </Suspense>
      </main>
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'alert' ? '' : 'info'}`}>
            <b>{t.title}</b>
            <div className="truncate" style={{ maxWidth: 300 }}>{t.href ? <Link to={t.href}>{t.text}</Link> : t.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <LiveProvider><Shell /></LiveProvider>
    </BrowserRouter>
  </StrictMode>,
);

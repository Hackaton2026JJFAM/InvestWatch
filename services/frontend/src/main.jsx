import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import ServiceStatus from './components/ServiceStatus.jsx';
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { AdminLogin, useAdmin } from './components/AdminAuth.jsx';
import { LiveProvider, useLive } from './live.jsx';
import { applyTheme, readTheme, ThemeToggle } from './theme.jsx';
import { HelpTip } from './components/HelpTip.jsx';
const Alerts = lazy(() => import('./pages/Alerts.jsx'));
const Calibration = lazy(() => import('./pages/Calibration.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Entities = lazy(() => import('./pages/Entities.jsx'));
const Entity = lazy(() => import('./pages/Entity.jsx'));
const Material = lazy(() => import('./pages/Material.jsx'));
const Results = lazy(() => import('./pages/Results.jsx'));
const Scan = lazy(() => import('./pages/Scan.jsx'));
const Search = lazy(() => import('./pages/Search.jsx'));
const Reserves = lazy(() => import('./pages/Reserves.jsx'));
const Monitor = lazy(() => import('./pages/Monitor.jsx'));
import './styles.css';
import './enterprise.css';
import './readability.css';

applyTheme(readTheme()); // przed pierwszym renderem – bez mignięcia jasnego motywu

function Shell() {
  const { connected, unread, threshold, toasts } = useLive();
  const admin = useAdmin();
  return (
    <div className="app">
      <a className="skip-link" href="#main-content">Przejdź do treści</a>
      <aside className="sidebar">
        <div className="logo">
          <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#1d5fa8" /><path d="M7 20l6-6 4 4 8-8" stroke="#ffd166" strokeWidth="3" fill="none" strokeLinecap="round" /></svg>
          <div>InvestWatch<small>monitoring reklam inwestycyjnych</small></div>
        </div>
        <nav className="nav">
          <div className="nav-group">
            <span className="nav-heading">Przegląd</span>
            <NavLink to="/" end>Pulpit</NavLink>
            <NavLink to="/materials">Wyniki analiz</NavLink>
            <NavLink to="/alerts">Alerty {unread > 0 && <span className="badge">{unread}</span>}</NavLink>
          </div>
          <div className="nav-group">
            <span className="nav-heading">Monitoring</span>
            <NavLink to="/monitor">Monitoring wideo</NavLink>
            <NavLink to="/scan">Skanowanie i źródła</NavLink>
          </div>
          <div className="nav-group">
            <span className="nav-heading">Podmioty i narzędzia</span>
            <NavLink to="/entities">Podmioty</NavLink>
            <NavLink to="/search">Wyszukiwarka KRS / LEI</NavLink>
            <NavLink to="/reserves">Rezerwy giełd</NavLink>
            <NavLink to="/calibration">Kalibracja</NavLink>
          </div>
        </nav>
        <div className="foot">
          <div><span className={`dot ${connected ? 'on' : ''}`} />{connected ? 'Aktualizacje na żywo' : 'Brak połączenia'} {connected && <HelpTip term="websocket" label="aktualizacje na żywo" />}</div>
          <div className="foot-line">Próg ryzyka: <b>{threshold ?? '–'}</b> <HelpTip term="risk_threshold" label="próg ryzyka" /></div>
          <div className="foot-line">
            {admin.admin ? <>Administrator · <button className="linkbtn" onClick={admin.logout}>wyloguj</button></> : admin.enabled ? 'Tryb analityka' : 'Operacje admin. wyłączone'}
          </div>
          <ThemeToggle />
          <div className="disclaimer">Wyniki są sygnałem do weryfikacji, nie stwierdzeniem naruszenia.</div>
        </div>
      </aside>
      <main className="main" id="main-content">
        <ServiceStatus />
        <Suspense fallback={<div className="empty">Ładowanie…</div>}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/materials" element={<Results />} />
          <Route path="/materials/:id" element={<Material />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/entities" element={<Entities />} />
          <Route path="/entities/:id" element={<Entity />} />
          <Route path="/search" element={<Search />} />
          <Route path="/reserves" element={<Reserves />} />
          <Route path="/monitor" element={<Monitor />} />
          <Route path="/registries" element={<Navigate to="/search?tab=external" replace />} />
          <Route path="/calibration" element={<Calibration />} />
          <Route path="/scan" element={<Scan />} />
          <Route path="*" element={<div className="empty">Nie znaleziono strony</div>} />
        </Routes>
        </Suspense>
      </main>
      <AdminLogin onChange={admin.refresh} />
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

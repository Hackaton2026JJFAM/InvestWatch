// Okno logowania administratora (próg, źródła, próbki, usuwanie) i status w panelu bocznym.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, setAdminState, setLoginHandler } from '../api.js';

export function AdminLogin({ onChange }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const pending = useRef(null);

  useEffect(() => {
    setLoginHandler(() => new Promise((resolve) => {
      pending.current = resolve;
      setError(null);
      setPassword('');
      setOpen(true);
    }));
    return () => setLoginHandler(null);
  }, []);

  const close = (ok) => {
    setOpen(false);
    pending.current?.(ok);
    pending.current = null;
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/auth/login', { password });
      setAdminState(true);
      onChange?.();
      close(true);
    } catch (err) {
      setError(err.message);
    }
  };

  if (!open) return null;
  return (
    <div className="modal-bg" role="dialog" aria-modal="true" aria-labelledby="admin-login-title">
      <form className="panel modal" onSubmit={submit}>
        <h2 id="admin-login-title">Logowanie administratora</h2>
        <p className="small muted">Zmiana progu, źródeł, ładowanie próbek i usuwanie materiałów wymagają uprawnień administratora.</p>
        <input type="password" autoFocus placeholder="Hasło (ADMIN_PASSWORD)" value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: '100%' }} />
        {error && <p className="small" style={{ color: 'var(--high)' }}>{error}</p>}
        <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="btn" onClick={() => close(false)}>Anuluj</button>
          <button type="submit" className="btn primary" disabled={!password}>Zaloguj</button>
        </div>
      </form>
    </div>
  );
}

export function useAdmin() {
  const [state, setState] = useState({ admin: false, enabled: false });
  const refresh = useCallback(() => api.get('/auth/me').then((s) => { setAdminState(s.admin); setState(s); }).catch(() => {}), []);
  useEffect(() => { refresh(); }, [refresh]);
  const logout = () => api.post('/auth/logout').then(refresh);
  return { ...state, refresh, logout };
}

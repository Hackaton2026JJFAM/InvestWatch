// Motyw: 'system' | 'light' | 'dark'. Zapis w localStorage, atrybut data-theme na <html>.
import { useEffect, useState } from 'react';

const KEY = 'iw-theme';
const EVENT = 'iw-themechange';

export function readTheme() {
  try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; }
}

export function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  try { localStorage.setItem(KEY, mode); } catch { /* tryb prywatny – bez zapisu */ }
  window.dispatchEvent(new Event(EVENT));
}

// Rozstrzygnięty motyw ('light' | 'dark') – zmienia się przy przełączeniu i przy zmianie motywu systemu.
export function useResolvedTheme() {
  const resolve = () => {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr) return attr;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };
  const [theme, setTheme] = useState(resolve);
  useEffect(() => {
    const update = () => setTheme(resolve());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    window.addEventListener(EVENT, update);
    mq.addEventListener('change', update);
    return () => { window.removeEventListener(EVENT, update); mq.removeEventListener('change', update); };
  }, []);
  return theme;
}

export function ThemeToggle() {
  const [mode, setMode] = useState(readTheme);
  const set = (m) => { setMode(m); applyTheme(m); };
  return (
    <div className="theme-toggle" role="group" aria-label="Motyw">
      {[['system', 'Auto'], ['light', 'Jasny'], ['dark', 'Ciemny']].map(([k, v]) => (
        <button key={k} type="button" className={mode === k ? 'active' : ''} aria-pressed={mode === k} onClick={() => set(k)}>{v}</button>
      ))}
    </div>
  );
}

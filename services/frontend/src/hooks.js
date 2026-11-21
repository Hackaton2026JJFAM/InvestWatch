import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

// Pobiera dane z API; `refreshKey` (np. licznik zdarzeń WebSocket) wymusza ponowne pobranie.
export function useData(path, refreshKey) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(() => {
    if (!path) return;
    let alive = true;
    api.get(path)
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState((s) => ({ ...s, error, loading: false })));
    return () => { alive = false; };
  }, [path]);
  useEffect(() => load(), [load, refreshKey]);
  return { ...state, reload: load };
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

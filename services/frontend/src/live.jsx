// Kontekst czasu rzeczywistego: Socket.io, licznik nieprzeczytanych alertów, toasty, próg.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api } from './api.js';

// Jedno połączenie na całą aplikację (singleton modułu).
const socket = io({ path: '/socket.io', transports: ['websocket', 'polling'] });

const LiveCtx = createContext(null);
export const useLive = () => useContext(LiveCtx);

export function LiveProvider({ children }) {
  const [connected, setConnected] = useState(false);
  const [unread, setUnread] = useState(0);
  const [threshold, setThreshold] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [tick, setTick] = useState(0); // zmienia się przy każdym zdarzeniu -> odświeżenie widoków
  const listeners = useRef(new Set());

  const refreshCounters = useCallback(() => {
    api.get('/dashboard/stats').then((s) => { setUnread(s.totals.unread); setThreshold(s.threshold); }).catch(() => {});
  }, []);

  const toast = useCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((xs) => [...xs.slice(-3), { id, ...t }]);
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), 7000);
  }, []);

  useEffect(() => {
    refreshCounters();
    const bump = (event) => (payload) => {
      setTick((t) => t + 1);
      listeners.current.forEach((fn) => fn(event, payload));
    };
    // Efekt tylko podpina/odpina słuchaczy – samo połączenie jest jedno na aplikację,
    // więc podwójne montowanie (StrictMode) nie zrywa łączącego się WebSocketu.
    const handlers = {
      connect: () => setConnected(true),
      disconnect: () => setConnected(false),
      'alert:new': (a) => {
        setUnread((n) => n + 1);
        toast({ kind: 'alert', title: `Wysokie ryzyko (${Math.round(a.score)}/100)`, text: a.title || a.url, href: `/materials/${a.materialId}` });
        bump('alert:new')(a);
      },
      'alert:update': () => { refreshCounters(); bump('alert:update')(); },
      'material:new': bump('material:new'),
      'material:status': bump('material:status'),
      'material:deleted': () => { refreshCounters(); bump('material:deleted')(); },
      'scan:update': bump('scan:update'),
      'settings:update': (s) => { setThreshold(s.threshold); bump('settings:update')(s); },
    };
    Object.entries(handlers).forEach(([ev, fn]) => socket.on(ev, fn));
    setConnected(socket.connected);
    return () => Object.entries(handlers).forEach(([ev, fn]) => socket.off(ev, fn));
  }, [refreshCounters, toast]);

  const subscribe = useCallback((fn) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }, []);

  return (
    <LiveCtx.Provider value={{ connected, unread, threshold, setThreshold, tick, toast, toasts, subscribe, refreshCounters }}>
      {children}
    </LiveCtx.Provider>
  );
}

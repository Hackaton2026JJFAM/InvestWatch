// Ostrzeżenie o wyłączonych funkcjach analizy (brak Chromium, OCR, Whispera) – zamiast cichego „nie oceniono”.
import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function ServiceStatus() {
  const [h, setH] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.get('/health').then((d) => alive && setH(d)).catch(() => alive && setH({ scraper: null }));
    load();
    const t = setInterval(load, 60000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (!h) return null;
  const s = h.scraper;
  const issues = [];
  const notes = [];
  if (!s) issues.push('Scraper nie odpowiada – nowe materiały nie będą pobierane. Sprawdź, czy usługa działa.');
  else {
    if (s.busy) notes.push('Scraper jest zajęty przetwarzaniem wideo (transkrypcja i OCR) – nowe materiały mogą pojawiać się z opóźnieniem.');
    if (s.video && s.video.transcribe === false) notes.push('Transkrypcja mowy wyłączona (VIDEO_TRANSCRIBE=false) – z filmów analizowane są tylko napisy na ekranie i opis.');
    if (!s.playwright) issues.push(`Render stron wyłączony (${s.playwright_error ?? 'Playwright niedostępny'}) – reguły wizualne 4–8 będą „nie ocenione”.`);
    if (!s.ocr) issues.push('OCR niedostępny (brak Tesseracta) – obrazy, banery i napisy w wideo nie są odczytywane; działa w obrazie Docker.');
    if (s.video && !s.video.whisper) issues.push('Transkrypcja wideo niedostępna (brak faster-whisper).');
  }
  if (!h.analyzer && h.scraper !== undefined) issues.push('Analizator nie odpowiada.');
  if (!issues.length && !notes.length) return null;
  return (
    <>
      {issues.length > 0 && (
        <div className="notice" role="status" style={{ marginBottom: 14, borderLeftColor: 'var(--mid)' }}>
          <b>Ograniczona analiza:</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{issues.map((i) => <li key={i}>{i}</li>)}</ul>
        </div>
      )}
      {notes.length > 0 && (
        <div className="notice" role="status" style={{ marginBottom: 14 }}>
          {notes.map((n) => <div key={n} className="small">{n}</div>)}
        </div>
      )}
    </>
  );
}

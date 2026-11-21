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
  if (!s) issues.push('Scraper nie odpowiada – nowe materiały nie będą pobierane.');
  else {
    if (!s.playwright) issues.push(`Render stron wyłączony (${s.playwright_error ?? 'Playwright niedostępny'}) – reguły wizualne 4–8 będą „nie ocenione”.`);
    if (!s.ocr) issues.push('OCR niedostępny (brak Tesseracta) – obrazy, banery i napisy w wideo nie są odczytywane; działa w obrazie Docker.');
    if (s.video && !s.video.whisper) issues.push('Transkrypcja wideo niedostępna (brak faster-whisper).');
  }
  if (!h.analyzer && h.scraper !== undefined) issues.push('Analizator nie odpowiada.');
  if (!issues.length) return null;
  return (
    <div className="notice" role="status" style={{ marginBottom: 14, borderLeftColor: 'var(--mid)' }}>
      <b>Ograniczona analiza:</b>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{issues.map((i) => <li key={i}>{i}</li>)}</ul>
    </div>
  );
}

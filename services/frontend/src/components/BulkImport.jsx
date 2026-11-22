// Import wielu plików naraz (np. próbki od UKNF): .html/.htm, .txt, .json, .csv z adresami URL.
// labels.json ({ "plik.html": { "ground_truth": true } }) dodaje etykiety do kalibracji.
import { useState } from 'react';
import { api, uploadFile } from '../api.js';
import { Panel, RecordDetails } from './ui.jsx';

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff'];
const MAX_IMAGE = 10 * 1024 * 1024;
const VIDEO_EXT = ['mp4', 'm4v', 'webm', 'mov', 'mkv', 'avi', '3gp'];
const MAX_VIDEO = 250 * 1024 * 1024;

const readDataUrl = (f) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(f);
});

const URL_RE = /^https?:\/\/\S+$/i;

async function toItems(files) {
  const items = [];
  let labels = {};
  for (const f of files) {
    const name = f.name;
    const ext = name.toLowerCase().split('.').pop();
    if (IMAGE_EXT.includes(ext)) {
      // zrzut / grafika reklamy – OCR w scraperze (Tesseract)
      if (f.size > MAX_IMAGE) items.push({ name, error: 'obraz większy niż 10 MB' });
      else items.push({ name, kind: 'image', image: await readDataUrl(f) });
      continue;
    }
    if (VIDEO_EXT.includes(ext)) {
      // reels / nagranie reklamy – transkrypcja mowy (Whisper) + OCR napisów z klatek
      if (f.size > MAX_VIDEO) items.push({ name, error: 'wideo większe niż 250 MB' });
      else items.push({ name, kind: 'video', file: f });
      continue;
    }
    const body = await f.text();
    if (name.toLowerCase() === 'labels.json') {
      try { labels = JSON.parse(body); } catch { /* pominięte – niepoprawny JSON */ }
      continue;
    }
    if (ext === 'html' || ext === 'htm') {
      items.push({ name, kind: 'html', html: body });
    } else if (ext === 'json') {
      let data;
      try { data = JSON.parse(body); } catch { items.push({ name, error: 'niepoprawny JSON' }); continue; }
      const list = Array.isArray(data) ? data : [data];
      list.forEach((d, i) => {
        const n = list.length > 1 ? `${name}#${i + 1}` : name;
        if (d && typeof d === 'object' && (d.text || d.html)) items.push({ name: n, kind: d.html ? 'html' : 'text', ...d });
        else if (d && typeof d === 'object' && d.url) items.push({ name: n, kind: 'url', url: d.url });
        else items.push({ name: n, error: 'brak pól text/html/url' });
      });
    } else if (ext === 'csv' || ext === 'txt') {
      const lines = body.split(/\r?\n/).map((l) => l.split(/[;,\t]/)[0].trim()).filter(Boolean);
      const urls = lines.filter((l) => URL_RE.test(l));
      if (urls.length && urls.length >= lines.length * 0.6) urls.forEach((u) => items.push({ name: u, kind: 'url', url: u }));
      else items.push({ name, kind: 'text', text: body });
    } else {
      items.push({ name, error: `nieobsługiwany format .${ext}` });
    }
  }
  return items.map((it) => {
    const label = labels[it.name] ?? labels[it.name.split('#')[0]];
    return label && typeof label.ground_truth === 'boolean' ? { ...it, ground_truth: label.ground_truth, url: it.url ?? label.url } : it;
  });
}

async function send(it) {
  if (it.kind === 'url') return api.post('/scans', { url: it.url });
  const meta = Object.fromEntries(Object.entries({
    url: it.url || `upload://${it.name}`, title: it.title, author: it.author, platform: it.platform, ground_truth: it.ground_truth,
  }).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  if (it.kind === 'video') {
    return uploadFile('/scans/video', it.file, { ...meta, ground_truth: meta.ground_truth === undefined ? undefined : String(meta.ground_truth) });
  }
  const body = it.kind === 'html' ? { html: it.html } : it.kind === 'image' ? { image: it.image } : { text: it.text };
  return api.post('/scans/upload', { ...body, ...meta });
}

export default function BulkImport({ onDone }) {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  const run = async (fileList) => {
    const files = [...fileList];
    if (!files.length) return;
    setBusy(true);
    const items = await toItems(files);
    setRows(items.map((it) => ({ name: it.name, status: it.error ? `pominięto: ${it.error}` : 'w kolejce', ok: !it.error, gt: it.ground_truth })));
    let sent = 0;
    for (let i = 0; i < items.length; i++) {
      if (items[i].error) continue;
      try {
        await send(items[i]);
        sent++;
        setRows((rs) => rs.map((r, k) => (k === i ? { ...r, status: 'wysłano do analizy' } : r)));
      } catch (e) {
        setRows((rs) => rs.map((r, k) => (k === i ? { ...r, status: `błąd: ${e.message}`, ok: false } : r)));
      }
    }
    setBusy(false);
    onDone?.(sent);
  };

  return (
    <Panel title="Import wielu plików (np. próbki UKNF)">
      <div className={`drop ${drag ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); run(e.dataTransfer.files); }}>
        <p>Przeciągnij pliki tutaj albo wybierz:</p>
        <input type="file" multiple disabled={busy} accept=".html,.htm,.txt,.json,.csv,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff,.mp4,.m4v,.webm,.mov,.mkv,.avi,.3gp" onChange={(e) => run(e.target.files)} />
        <RecordDetails label="Obsługiwane formaty i limity">
          <ul><li>Wideo .mp4/.webm/.mov — transkrypcja mowy i OCR napisów, do 250 MB.</li>
            <li>Obrazy .png/.jpg/.webp — OCR, do 10 MB.</li>
            <li>.html/.htm oraz .txt — treść lub lista URL.</li><li>.csv — adres URL w pierwszej kolumnie.</li>
            <li>.json — obiekt lub tablica z polami text/html/url, title, author, platform.</li>
            <li><code>labels.json</code> — etykiety do kalibracji.</li></ul>
        </RecordDetails>
      </div>
      {rows.length > 0 && (
        <div className="table-wrap" style={{ maxHeight: 260, overflow: 'auto', marginTop: 10 }}>
          <table><thead><tr><th>Plik / materiał</th><th>Status importu</th></tr></thead><tbody>{rows.map((r, i) => (
            <tr key={i}><td><b>{r.name}</b><RecordDetails context={r.name} fields={ [['Etykieta kalibracyjna', r.gt === undefined ? 'brak' : r.gt ? 'ryzykowny' : 'poprawny']] }>{!r.ok && <p className="record-error">{r.status}</p>}</RecordDetails></td>
              <td><span className={`chip ${r.ok ? 'neutral' : 'fail'}`}>{r.ok ? r.status : r.status.startsWith('pominięto') ? 'pominięto' : 'błąd importu'}</span></td></tr>))}
          </tbody></table>
        </div>
      )}
    </Panel>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Empty, fmtDate, Panel } from '../components/ui.jsx';
import { useData } from '../hooks.js';
import { useLive } from '../live.jsx';

const JOB = { queued: 'na', running: 'mid', done: 'pass', duplicate: 'neutral', failed: 'fail' };
const JOB_LABEL = { queued: 'w kolejce', running: 'w toku', done: 'gotowe', duplicate: 'duplikat', failed: 'błąd' };

export default function Scan() {
  const { tick, toast } = useLive();
  const [urls, setUrls] = useState('');
  const [upload, setUpload] = useState({ mode: 'text', body: '', url: '', title: '', author: '', platform: 'web' });
  const [source, setSource] = useState('');
  const [err, setErr] = useState(null);
  const jobs = useData('/scans', tick);
  const sources = useData('/sources', tick);

  const run = (p) => p.then(() => setErr(null)).catch((e) => setErr(e.details?.map((d) => d.message).join('; ') || e.message));
  const submitUrls = () => {
    const list = urls.split(/\s+/).map((u) => u.trim()).filter(Boolean);
    if (!list.length) return;
    run(api.post('/scans', list.length === 1 ? { url: list[0] } : { urls: list }).then(() => { setUrls(''); toast({ title: 'Dodano do kolejki', text: `${list.length} adres(ów)` }); }));
  };
  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    f.text().then((body) => setUpload((u) => ({ ...u, body, mode: f.name.endsWith('.html') || f.name.endsWith('.htm') ? 'html' : 'text', title: u.title || f.name })));
  };
  const submitUpload = () => {
    const { mode, body, ...meta } = upload;
    run(api.post('/scans/upload', { [mode]: body, ...Object.fromEntries(Object.entries(meta).filter(([, v]) => v)) })
      .then(() => { setUpload({ mode: 'text', body: '', url: '', title: '', author: '', platform: 'web' }); toast({ title: 'Materiał dodany', text: 'Analiza w toku' }); }));
  };

  return (
    <>
      <div className="page-head">
        <div><h1>Skanowanie i źródła</h1><p>Ręczne dodawanie adresów, import materiałów, źródła monitorowane cyklicznie</p></div>
        <div className="btn-row">
          <button className="btn" onClick={() => run(api.post('/sources/run').then((r) => toast({ title: 'Uruchomiono harmonogram', text: `${r.queued} zadań` })))}>Uruchom skan źródeł teraz</button>
          <button className="btn" onClick={() => run(api.post('/seed').then((r) => toast({ title: 'Próbki demo', text: `${r.queued} materiałów w kolejce` })))}>Załaduj próbki demo</button>
        </div>
      </div>
      {err && <div className="notice" style={{ marginBottom: 12, color: 'var(--high)' }}>{err}</div>}
      <div className="grid g2">
        <Panel title="Analiza adresów URL">
          <textarea placeholder={'https://przyklad.pl/oferta\nhttps://www.tiktok.com/@konto/video/…'} value={urls} onChange={(e) => setUrls(e.target.value)} />
          <div className="btn-row" style={{ marginTop: 8, justifyContent: 'space-between' }}>
            <span className="small muted">Jeden adres w linii (maks. 50). Adresy prywatne/lokalne są blokowane (SSRF).</span>
            <button className="btn primary" onClick={submitUrls}>Analizuj</button>
          </div>
        </Panel>
        <Panel title="Import materiału (HTML / tekst / transkrypcja)">
          <div className="filters">
            <input type="file" accept=".html,.htm,.txt" onChange={onFile} />
            <select value={upload.mode} onChange={(e) => setUpload({ ...upload, mode: e.target.value })}><option value="text">tekst</option><option value="html">HTML</option></select>
            <select value={upload.platform} onChange={(e) => setUpload({ ...upload, platform: e.target.value })}>{['web', 'facebook', 'instagram', 'tiktok', 'youtube', 'x'].map((p) => <option key={p}>{p}</option>)}</select>
          </div>
          <div className="filters">
            <input placeholder="URL źródłowy" value={upload.url} onChange={(e) => setUpload({ ...upload, url: e.target.value })} />
            <input placeholder="Tytuł" value={upload.title} onChange={(e) => setUpload({ ...upload, title: e.target.value })} />
            <input placeholder="Autor / profil" value={upload.author} onChange={(e) => setUpload({ ...upload, author: e.target.value })} />
          </div>
          <textarea placeholder="Wklej treść posta, transkrypcję lub HTML…" value={upload.body} onChange={(e) => setUpload({ ...upload, body: e.target.value })} />
          <div className="btn-row" style={{ marginTop: 8, justifyContent: 'flex-end' }}><button className="btn primary" disabled={!upload.body} onClick={submitUpload}>Dodaj i analizuj</button></div>
        </Panel>
      </div>
      <div className="grid g2" style={{ marginTop: 16 }}>
        <Panel title="Kolejka zadań" meta="na żywo">
          {jobs.data?.length ? <div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}><table>
            <thead><tr><th>#</th><th>Adres</th><th>Wyzwalacz</th><th>Status</th><th>Próby</th><th>Utworzono</th></tr></thead>
            <tbody>{jobs.data.map((j) => (
              <tr key={j.id}><td>{j.id}</td>
                <td className="truncate" style={{ maxWidth: 260 }}>{j.material_id ? <Link to={`/materials/${j.material_id}`}>{j.url || '(import)'}</Link> : (j.url || '(import)')}{j.error && <div className="small" style={{ color: 'var(--high)' }}>{j.error}</div>}</td>
                <td className="small">{j.trigger}</td><td><span className={`chip ${JOB[j.status]}`}>{JOB_LABEL[j.status] ?? j.status}</span></td><td>{j.attempts}</td><td className="small muted">{fmtDate(j.created_at)}</td></tr>))}
            </tbody></table></div> : <Empty>Brak zadań.</Empty>}
        </Panel>
        <Panel title="Źródła monitorowane (harmonogram)">
          <div className="filters">
            <input placeholder="https://… (strona, profil, kanał)" value={source} onChange={(e) => setSource(e.target.value)} style={{ flex: 1 }} />
            <button className="btn primary" onClick={() => run(api.post('/sources', { url: source }).then(() => setSource('')))}>Dodaj źródło</button>
          </div>
          {sources.data?.length ? <table><tbody>{sources.data.map((s) => (
            <tr key={s.id}><td className="truncate" style={{ maxWidth: 280 }}>{s.url}</td><td className="small muted">{s.last_run_at ? fmtDate(s.last_run_at) : 'nie uruchamiano'}</td>
              <td className="btn-row"><button className="btn" onClick={() => run(api.patch(`/sources/${s.id}`, { enabled: !s.enabled }))}>{s.enabled ? 'Wyłącz' : 'Włącz'}</button>
                <button className="btn danger" onClick={() => run(api.del(`/sources/${s.id}`))}>Usuń</button></td></tr>))}
          </tbody></table> : <Empty>Brak źródeł. Harmonogram (cron) skanuje je cyklicznie i wyszukuje podstrony z ofertami.</Empty>}
        </Panel>
      </div>
    </>
  );
}

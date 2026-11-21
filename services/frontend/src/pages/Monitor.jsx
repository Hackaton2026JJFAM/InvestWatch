// Proaktywny monitoring popularnych wideo: tagi, wyszukiwanie kandydatów z progiem zasięgu,
// zapisane zapytania uruchamiane według harmonogramu (WATCH_CRON).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Empty, fmtCount, fmtDate, Panel } from '../components/ui.jsx';
import { useData } from '../hooks.js';
import { useLive } from '../live.jsx';

const PLATFORMS = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', x: 'X (Twitter)', facebook: 'Facebook' };
const KINDS = {
  youtube: [['hashtag', '#hashtag'], ['search', 'fraza'], ['profile', 'kanał (@nazwa lub URL)']],
  tiktok: [['hashtag', '#hashtag'], ['search', 'fraza'], ['profile', 'profil (@nazwa lub URL)']],
  instagram: [['hashtag', '#hashtag'], ['search', 'fraza']],
  x: [['hashtag', '#hashtag'], ['search', 'fraza']],
  facebook: [['hashtag', '#hashtag'], ['search', 'fraza']],
};
const MIN_VIEWS = [0, 1000, 10000, 50000, 100000, 1000000];
const fmtDur = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '–');

export default function Monitor() {
  const { tick, toast } = useLive();
  const tags = useData('/tags/popular?days=90', tick);
  const watches = useData('/watch', tick);
  const [form, setForm] = useState({ platform: 'youtube', kind: 'hashtag', query: '', sort: 'views', min_views: 10000, limit: 20, polish: true });
  const [packPlatforms, setPackPlatforms] = useState(new Set(['youtube', 'tiktok', 'instagram', 'x']));
  const [res, setRes] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v,
    ...(k === 'platform' ? { kind: KINDS[v].some(([kk]) => kk === f.kind) ? f.kind : KINDS[v][0][0], min_views: v === 'youtube' ? f.min_views : 0 } : {}) }));
  const createPack = async (preset) => {
    try {
      const r = await api.post('/watch/preset', { preset, platforms: [...packPlatforms], min_views: 0, max_per_run: 5 });
      toast({ kind: 'info', title: 'Monitoring', text: `Dodano ${r.created} zapytań – będą uruchamiane automatycznie.` });
      watches.reload();
    } catch (e) { toast({ kind: 'error', title: 'Monitoring', text: e.message }); }
  };

  const search = async (override) => {
    const body = { ...form, ...override };
    if (!body.query.trim()) return;
    setForm(body);
    setBusy(true);
    setRes(null);
    try {
      const r = await api.post('/discover/video', body);
      setRes(r);
      setSel(new Set(r.items.filter((i) => i.passes && !i.known).map((i) => i.url)));
    } catch (e) { toast({ kind: 'error', title: 'Wyszukiwanie', text: e.message }); } finally { setBusy(false); }
  };
  const analyse = async () => {
    const items = res.items.filter((i) => sel.has(i.url)).map((i) => ({ url: i.url, views: i.views ?? null, title: i.title ?? null }));
    if (!items.length) return;
    const r = await api.post('/discover/video/enqueue', { items });
    toast({ kind: 'info', title: 'Monitoring', text: `Dodano ${r.jobs.length} filmów do analizy (najpopularniejsze pierwsze).` });
    setSel(new Set());
  };
  const saveWatch = async () => {
    try {
      await api.post('/watch', { platform: form.platform, kind: form.kind, query: form.query, sort: form.sort, min_views: Number(form.min_views), max_per_run: 10, polish: form.polish });
      toast({ kind: 'info', title: 'Monitoring', text: 'Zapisano – zapytanie będzie uruchamiane automatycznie.' });
      watches.reload();
    } catch (e) { toast({ kind: 'error', title: 'Monitoring', text: e.message }); }
  };
  const run = async (w) => {
    try {
      const r = await api.post(`/watch/${w.id}/run`);
      toast({ kind: 'info', title: `Monitoring: ${w.query}`, text: `Znaleziono ${r.found}, do analizy: ${r.queued}` });
    } catch (e) { toast({ kind: 'error', title: 'Monitoring', text: e.message }); }
    watches.reload();
  };
  const toggle = async (w) => { await api.patch(`/watch/${w.id}`, { enabled: !w.enabled }); watches.reload(); };
  const remove = async (w) => { await api.del(`/watch/${w.id}`); watches.reload(); };

  const dbTags = tags.data?.tags ?? [];
  const presets = (tags.data?.presets ?? []).filter((t) => !dbTags.some((d) => d.tag === t));

  return (
    <>
      <div className="page-head"><div><h1>Monitoring wideo</h1>
        <p className="muted">Proaktywne wyszukiwanie popularnych filmów o inwestowaniu – najpierw same metadane (zasięg), potem transkrypcja i OCR tylko dla treści powyżej progu wyświetleń.</p></div></div>

      <Panel title="Popularne hashtagi" meta={`kliknij, aby wyszukać na: ${PLATFORMS[form.platform]} · liczby z bazy z 90 dni`}>
        <div className="tag-cloud">
          {dbTags.map((t) => (
            <button key={t.tag} onClick={() => search({ kind: 'hashtag', query: t.tag })} title={`${t.materials} materiałów · ${fmtCount(t.views)} wyświetleń · śr. wynik ${t.avg_score ?? '–'}`}>
              #{t.tag} <span className="muted">{t.materials}</span>{t.scams > 0 && <span style={{ color: 'var(--high)' }}> ⚠{t.scams}</span>}
            </button>))}
          {presets.map((t) => <button key={t} onClick={() => search({ kind: 'hashtag', query: t })}>#{t}</button>)}
        </div>
      </Panel>

      <Panel title="Przynęty oszustów (frazy PL)" meta={`kliknij, aby wyszukać frazę na: ${PLATFORMS[form.platform]}`}>
        <div className="tag-cloud">
          {(tags.data?.phrases ?? []).map((p) => <button key={p} onClick={() => search({ kind: 'search', query: p, ...(form.kind === 'profile' ? {} : {}) })}>„{p}”</button>)}
        </div>
        <div className="btn-row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
          <span className="small muted">Monitoruj stale na:</span>
          {Object.entries(PLATFORMS).map(([k, l]) => (
            <label key={k} className="toggle"><input type="checkbox" checked={packPlatforms.has(k)}
              onChange={(e) => setPackPlatforms((s) => { const n = new Set(s); e.target.checked ? n.add(k) : n.delete(k); return n; })} />{l}</label>))}
          <button className="btn" disabled={!packPlatforms.size} onClick={() => createPack('pl_scam')}>+ wszystkie frazy-przynęty</button>
          <button className="btn" disabled={!packPlatforms.size} onClick={() => createPack('pl_tags')}>+ hashtagi finansowe PL</button>
        </div>
      </Panel>

      <Panel title="Wyszukaj kandydatów">
        <div className="filters">
          <label className="f">Platforma<select value={form.platform} onChange={(e) => set('platform', e.target.value)}>{Object.entries(PLATFORMS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="f">Rodzaj<select value={form.kind} onChange={(e) => set('kind', e.target.value)}>{KINDS[form.platform].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="f">Zapytanie<input value={form.query} onChange={(e) => set('query', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder={form.kind === 'hashtag' ? 'kryptowaluty' : form.kind === 'search' ? 'pasywny dochód krypto' : '@nazwa'} style={{ minWidth: 220 }} /></label>
          {form.platform === 'youtube' && form.kind === 'search' && <label className="f">Kolejność<select value={form.sort} onChange={(e) => set('sort', e.target.value)}><option value="views">najwięcej wyświetleń</option><option value="date">najnowsze</option><option value="relevance">trafność</option></select></label>}
          <label className="f">Min. wyświetleń<select value={form.min_views} onChange={(e) => set('min_views', Number(e.target.value))}>{MIN_VIEWS.map((v) => <option key={v} value={v}>{v ? `≥ ${fmtCount(v)}` : 'bez progu'}</option>)}</select></label>
          <label className="f">Liczba<select value={form.limit} onChange={(e) => set('limit', Number(e.target.value))}>{[10, 20, 30, 50].map((v) => <option key={v}>{v}</option>)}</select></label>
          <label className="toggle"><input type="checkbox" checked={form.polish} onChange={(e) => set('polish', e.target.checked)} /> tylko polskie</label>
          <button className="btn primary" disabled={busy || !form.query.trim()} onClick={() => search()}>{busy ? 'Szukam…' : 'Szukaj'}</button>
          <button className="btn" disabled={!form.query.trim()} onClick={saveWatch} title="Zapytanie będzie uruchamiane automatycznie (harmonogram)">Monitoruj stale</button>
        </div>
        {form.platform !== 'youtube' && form.kind !== 'profile' && <p className="small muted">{PLATFORMS[form.platform]}: hashtagi i frazy z publicznego indeksu wyszukiwarki (region PL; strony tagów platformy wymagają logowania). Zasięg dociągany z metadanych posta – gdy platforma go nie udostępnia, post nie jest odrzucany przez próg.</p>}
        {res && (res.items.length ? (
          <>
            <div className="table-wrap" style={{ marginTop: 10 }}><table>
              <thead><tr><th /><th>Post / film</th><th>Twórca</th><th>Zasięg</th><th>Język</th><th>Status</th></tr></thead>
              <tbody>{res.items.map((i) => (
                <tr key={i.url} style={{ opacity: i.passes ? 1 : 0.55 }}>
                  <td><input type="checkbox" disabled={i.known || i.live} checked={sel.has(i.url)} onChange={(e) => setSel((s) => { const n = new Set(s); e.target.checked ? n.add(i.url) : n.delete(i.url); return n; })} /></td>
                  <td><a href={i.url} target="_blank" rel="noreferrer noopener">{i.title || i.url}</a></td>
                  <td className="small">{i.author ?? '–'}{i.followers != null && <div className="muted">{fmtCount(i.followers)} obs.</div>}</td>
                  <td>{i.views != null ? <b>{fmtCount(i.views)}</b> : i.likes != null ? <span className="small">{fmtCount(i.likes)} polub.</span> : <span className="small muted">nieznany</span>}
                    <div className="small muted">{i.live ? 'na żywo' : i.duration ? fmtDur(i.duration) : ''}</div></td>
                  <td>{i.lang === 'pl' ? <span className="chip low">PL</span> : <span className="small muted">?</span>}</td>
                  <td className="small">{i.known ? <Link to={`/materials?q=${encodeURIComponent(i.url)}`}>już w bazie</Link> : i.passes ? 'kandydat' : (form.polish && i.lang !== 'pl' ? 'nie po polsku' : 'poniżej progu')}</td>
                </tr>))}
              </tbody></table></div>
            <div className="btn-row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
              <span className="small muted">{res.items.length} wyników · zaznaczono {sel.size} (powyżej progu, nowe)</span>
              <button className="btn primary" disabled={!sel.size} onClick={analyse}>Analizuj zaznaczone ({sel.size})</button>
            </div>
          </>
        ) : <Empty>Brak wyników.</Empty>)}
      </Panel>

      <Panel title="Stały monitoring" meta="uruchamiany automatycznie według harmonogramu; nowe filmy powyżej progu trafiają do analizy">
        {watches.data?.length ? <div className="table-wrap"><table>
          <thead><tr><th>Zapytanie</th><th>Próg</th><th>Ostatnie uruchomienie</th><th>Materiały</th><th>Akcje</th></tr></thead>
          <tbody>{watches.data.map((w) => (
            <tr key={w.id} style={{ opacity: w.enabled ? 1 : 0.55 }}>
              <td><b>{w.kind === 'hashtag' ? `#${w.query}` : `„${w.query}”`}</b><div className="small muted">{PLATFORMS[w.platform] ?? w.platform} · {w.kind}{w.polish ? ' · PL' : ''}</div></td>
              <td className="small">≥ {fmtCount(w.min_views)} · maks. {w.max_per_run}/przebieg</td>
              <td className="small">{w.last_run_at ? fmtDate(w.last_run_at) : 'jeszcze nie'}{w.last_run_at && !w.last_error && <div className="muted">znaleziono {w.last_found}, do analizy {w.last_queued}</div>}
                {w.last_error && <div style={{ color: 'var(--high)' }}>{w.last_error}</div>}</td>
              <td className="small"><Link to={`/materials?watch=${w.id}&sort=priority`}>{w.materials} materiałów</Link>{w.scams > 0 && <div style={{ color: 'var(--high)' }}>{w.scams} podejrzeń oszustwa</div>}</td>
              <td className="btn-row"><button className="btn" onClick={() => run(w)}>Uruchom teraz</button><button className="btn" onClick={() => toggle(w)}>{w.enabled ? 'Wstrzymaj' : 'Wznów'}</button><button className="btn danger" onClick={() => remove(w)}>Usuń</button></td>
            </tr>))}
          </tbody></table></div> : <Empty>Brak zapisanych zapytań – wyszukaj tag lub profil i kliknij „Monitoruj stale”.</Empty>}
      </Panel>
    </>
  );
}

// Proaktywny monitoring: ranking hashtagów aktualizowany automatycznie wg popularności, wyszukiwanie
// kandydatów naraz na wszystkich platformach (YouTube, TikTok, Instagram, X, Facebook) z progiem zasięgu
// i zapisane zapytania uruchamiane według harmonogramu (WATCH_CRON).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Empty, fmtCount, fmtDate, Panel, RecordDetails } from '../components/ui.jsx';
import { useData } from '../hooks.js';
import { useLive } from '../live.jsx';

const PLATFORMS = { all: 'wszystkie platformy', youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', x: 'X', facebook: 'Facebook' };
const KINDS = [['hashtag', '#hashtag'], ['search', 'fraza'], ['profile', 'profil (@nazwa lub URL – YouTube, TikTok)']];
const MIN_VIEWS = [0, 1000, 10000, 50000, 100000, 1000000];
const TREND = { rośnie: ['▲', 'var(--low)'], maleje: ['▼', 'var(--muted)'], nowy: ['●', 'var(--brand-2)'], stały: ['', ''] };
const fmtDur = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');

export default function Monitor() {
  const { tick, toast } = useLive();
  const tags = useData('/tags/popular?days=90', tick);
  const watches = useData('/watch', tick);
  const [form, setForm] = useState({ kind: 'hashtag', query: '', sort: 'views', min_views: 0, limit: 20, polish: true });
  const [res, setRes] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const search = async (override) => {
    const body = { ...form, ...override, platform: 'all' };
    if (!body.query.trim()) return;
    setForm(({ ...f }) => ({ ...f, ...override }));
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
    toast({ kind: 'info', title: 'Monitoring', text: `Dodano ${r.jobs.length} materiałów do analizy (najpopularniejsze pierwsze).` });
    setSel(new Set());
  };
  const saveWatch = async () => {
    try {
      await api.post('/watch', { platform: 'all', kind: form.kind, query: form.query, sort: form.sort, min_views: Number(form.min_views), max_per_run: 10, polish: form.polish });
      toast({ kind: 'info', title: 'Monitoring', text: 'Zapisano – zapytanie będzie uruchamiane automatycznie na wszystkich platformach.' });
      watches.reload();
    } catch (e) { toast({ kind: 'error', title: 'Monitoring', text: e.message }); }
  };
  const createPack = async () => {
    try {
      const r = await api.post('/watch/preset', { preset: 'pl_scam', platforms: ['all'], min_views: 0, max_per_run: 5 });
      toast({ kind: 'info', title: 'Monitoring', text: `Dodano ${r.created} fraz – uruchamiane automatycznie na wszystkich platformach.` });
      watches.reload();
    } catch (e) { toast({ kind: 'error', title: 'Monitoring', text: e.message }); }
  };
  const refreshRanking = async () => {
    try {
      const r = await api.post('/tags/refresh');
      toast({ kind: 'info', title: 'Ranking hashtagów', text: `Przeliczono. Monitorowane automatycznie: ${r.top?.map((t) => `#${t}`).join(', ') || 'brak'}` });
      tags.reload(); watches.reload();
    } catch (e) { toast({ kind: 'error', title: 'Ranking hashtagów', text: e.message }); }
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

  const trending = tags.data?.trending ?? [];
  const auto = new Set((watches.data ?? []).filter((w) => w.auto && w.enabled).map((w) => w.query));

  return (
    <>
      <div className="page-head"><div><h1>Monitoring wideo i postów</h1>
        <p className="muted">Profilaktycznie: najpopularniejsze hashtagi są wyliczane z danych i automatycznie monitorowane na YouTube, TikToku, Instagramie, X i Facebooku. Najpierw same metadane (zasięg), transkrypcja i OCR tylko dla treści powyżej progu.</p></div></div>

      <Panel title="Popularne hashtagi" meta="ranking aktualizowany automatycznie (zasięg × liczba × ryzyko, trend tydzień do tygodnia) · ● = monitorowany automatycznie"
        actions={<button className="btn" onClick={refreshRanking}>Przelicz teraz</button>}>
        {trending.length ? (
          <div className="tag-cloud">
            {trending.map((t) => {
              const [arrow, color] = TREND[t.trend] ?? ['', ''];
              return (
                <button key={t.tag} className={auto.has(t.tag) ? 'on' : ''} onClick={() => search({ kind: 'hashtag', query: t.tag })}
                  title={`${t.materials} materiałów · ${fmtCount(t.views)} wyświetleń · śr. wynik ${t.avg_score ?? '–'} · ostatnie 7 dni: ${t.recent}, poprzednie: ${t.previous}`}>
                  {auto.has(t.tag) && '● '}#{t.tag} <span className="muted">{fmtCount(t.views)}</span>
                  {arrow && <span style={{ color }}> {arrow}</span>}{t.scams > 0 && <span style={{ color: 'var(--high)' }}> ⚠{t.scams}</span>}
                </button>
              );
            })}
          </div>
        ) : <Empty>Ranking pojawi się po pierwszych analizach – do tego czasu automatyczny monitoring startuje od polskich tagów finansowych.</Empty>}
      </Panel>

      <Panel title="Przynęty oszustów (frazy PL)" meta="kliknij, aby wyszukać na wszystkich platformach"
        actions={<button className="btn" onClick={createPack}>Monitoruj wszystkie frazy</button>}>
        <div className="tag-cloud">
          {(tags.data?.phrases ?? []).map((p) => <button key={p} onClick={() => search({ kind: 'search', query: p })}>„{p}”</button>)}
        </div>
      </Panel>

      <Panel title="Wyszukaj kandydatów" meta="YouTube, TikTok, Instagram, X i Facebook naraz">
        <div className="filters">
          <label className="f">Rodzaj<select value={form.kind} onChange={(e) => set('kind', e.target.value)}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="f">Zapytanie<input value={form.query} onChange={(e) => set('query', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder={form.kind === 'hashtag' ? 'darmowakasa' : form.kind === 'search' ? 'szybki zarobek' : '@nazwa albo adres profilu'} style={{ minWidth: 240 }} /></label>
          <label className="f">Min. wyświetleń<select value={form.min_views} onChange={(e) => set('min_views', Number(e.target.value))}>{MIN_VIEWS.map((v) => <option key={v} value={v}>{v ? `≥ ${fmtCount(v)}` : 'bez progu'}</option>)}</select></label>
          <label className="f">Liczba<select value={form.limit} onChange={(e) => set('limit', Number(e.target.value))}>{[10, 20, 30, 50].map((v) => <option key={v}>{v}</option>)}</select></label>
          <label className="toggle"><input type="checkbox" checked={form.polish} onChange={(e) => set('polish', e.target.checked)} /> tylko polskie</label>
          <button className="btn primary" disabled={busy || !form.query.trim()} onClick={() => search()}>{busy ? 'Szukam na 5 platformach…' : 'Szukaj'}</button>
          <button className="btn" disabled={!form.query.trim()} onClick={saveWatch} title="Zapytanie będzie uruchamiane automatycznie (harmonogram)">Monitoruj stale</button>
        </div>
        <p className="small muted">YouTube – bezpośrednio (region PL); TikTok, Instagram, X, Facebook – z publicznego indeksu wyszukiwarki (strony tagów platform wymagają logowania). Gdy platforma nie podaje zasięgu, post nie jest odrzucany przez próg.</p>
        {res && Object.keys(res.errors ?? {}).length > 0 && (
          <div className="notice" style={{ marginBottom: 8 }}>{Object.entries(res.errors).map(([p, e]) => <div key={p}><b>{PLATFORMS[p] ?? p}:</b> {e}</div>)}</div>
        )}
        {res && (res.items.length ? (
          <>
            <div className="table-wrap" style={{ marginTop: 10 }}><table>
              <thead><tr><th aria-label="Zaznacz materiał" /><th>Post / film</th><th>Zasięg</th><th>Status</th></tr></thead>
              <tbody>{res.items.map((i) => (
                <tr key={i.url} className={i.passes ? '' : 'inactive-record'}>
                  <td><input type="checkbox" disabled={i.known || i.live} checked={sel.has(i.url)} onChange={(e) => setSel((s) => { const n = new Set(s); e.target.checked ? n.add(i.url) : n.delete(i.url); return n; })} /></td>
                  <td><a href={i.url} target="_blank" rel="noreferrer noopener">{i.title || i.url}</a>
                    <RecordDetails context={i.title || i.url} fields={[
                      ['Platforma', PLATFORMS[i.platform] ?? i.platform], ['Twórca', i.author],
                      ['Adres', i.url], ['Obserwujący', fmtCount(i.followers)],
                      ['Długość', i.live ? 'na żywo' : fmtDur(i.duration) || '–'], ['Język', i.lang || 'nieustalony'],
                      ['Polubienia', fmtCount(i.likes)],
                    ]} />
                  </td>
                  <td>{i.views != null ? <b>{fmtCount(i.views)}</b> : i.likes != null ? <span>{fmtCount(i.likes)} polub.</span> : 'nieznany'}</td>
                  <td>{i.known ? <Link to={`/materials?q=${encodeURIComponent(i.url)}`}>już w bazie</Link> : i.passes ? 'kandydat' : (form.polish && i.lang !== 'pl' ? 'nie po polsku' : 'poniżej progu')}</td>
                </tr>))}
              </tbody></table></div>
            <div className="btn-row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
              <span className="small muted">{res.items.length} wyników z {res.platforms?.length ?? 1} platform · zaznaczono {sel.size}</span>
              <button className="btn primary" disabled={!sel.size} onClick={analyse}>Analizuj zaznaczone ({sel.size})</button>
            </div>
          </>
        ) : <Empty>Brak wyników.</Empty>)}
      </Panel>

      <Panel title="Stały monitoring" meta="uruchamiany według harmonogramu; „auto” = dodane i wstrzymywane automatycznie na podstawie popularności hashtagów">
        {watches.data?.length ? <div className="table-wrap"><table>
          <thead><tr><th>Zapytanie</th><th>Status</th><th>Materiały</th><th>Akcje</th></tr></thead>
          <tbody>{watches.data.map((w) => (
            <tr key={w.id} className={w.enabled ? '' : 'inactive-record'}>
              <td><b>{w.kind === 'hashtag' ? `#${w.query}` : `„${w.query}”`}</b>
                <RecordDetails context={w.query} label={w.last_error ? 'Szczegóły i błąd monitoringu' : 'Szczegóły'} fields={[
                  ['Platforma', PLATFORMS[w.platform] ?? w.platform], ['Rodzaj', w.kind],
                  ['Język', w.polish ? 'tylko polski' : 'wszystkie'], ['Popularność', w.popularity != null ? Math.round(w.popularity) : '–'],
                  ['Próg wyświetleń', fmtCount(w.min_views)], ['Limit na przebieg', w.max_per_run],
                  ['Ostatnie uruchomienie', w.last_run_at ? fmtDate(w.last_run_at) : 'jeszcze nie'],
                  ['Ostatnio znaleziono', w.last_found], ['Przekazano do analizy', w.last_queued],
                  ['Tryb', w.auto ? 'automatyczny' : 'ręcznie zapisane zapytanie'],
                ]}>{w.last_error && <p className="record-error">{w.last_error}</p>}</RecordDetails>
              </td>
              <td><span className={`chip ${w.last_error ? 'warn' : 'neutral'}`}>{w.last_error ? 'błąd uruchomienia' : w.enabled ? 'aktywny' : 'wstrzymany'}</span>{w.last_error && !w.enabled && <span className="chip neutral">wstrzymany</span>}</td>
              <td><Link to={`/materials?watch=${w.id}&sort=priority`}>{w.materials} materiałów</Link>{w.scams > 0 && <div className="record-error">{w.scams} podejrzeń oszustwa</div>}</td>
              <td className="btn-row"><button className="btn" onClick={() => run(w)}>Uruchom teraz</button><button className="btn" onClick={() => toggle(w)}>{w.enabled ? 'Wstrzymaj' : 'Wznów'}</button><button className="btn danger" onClick={() => remove(w)}>Usuń</button></td>
            </tr>))}
          </tbody></table></div> : <Empty>Brak zapisanych zapytań.</Empty>}
      </Panel>
    </>
  );
}

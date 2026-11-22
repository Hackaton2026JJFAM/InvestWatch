// Proaktywny monitoring: jedno pole wyszukiwania (#hashtag / fraza / @profil / link do filmu) na wszystkich
// platformach naraz, podpowiedzi (popularne hashtagi, frazy-przynęty) tuż pod polem, wyniki od razu pod spodem,
// a niżej zapytania monitorowane stale według harmonogramu (WATCH_CRON) i ranking hashtagów.
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Empty, fmtCount, fmtDate, Panel } from '../components/ui.jsx';
import { useData } from '../hooks.js';
import { useLive } from '../live.jsx';

const PLATFORMS = { all: 'wszystkie platformy', youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', x: 'X', facebook: 'Facebook' };
const KIND_LABEL = { hashtag: 'hashtag', search: 'fraza', profile: 'profil', url: 'link do filmu / posta' };
const MIN_VIEWS = [0, 1000, 10000, 50000, 100000, 1000000];
const TREND = { rośnie: ['▲', 'var(--low)'], maleje: ['▼', 'var(--muted)'], nowy: ['●', 'var(--brand-2)'], stały: ['', ''] };
const fmtDur = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');

// rodzaj zapytania rozpoznawany z wpisanego tekstu – bez osobnej listy wyboru
export function parseQuery(raw) {
  const t = raw.trim();
  if (!t) return { kind: null, query: '' };
  if (/^https?:\/\//i.test(t) || /^(www\.)?(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|x\.com|twitter\.com|facebook\.com|fb\.watch)\//i.test(t)) {
    // link do profilu (bez konkretnego filmu) = profil, link do filmu/posta = analiza tego materiału
    const profile = /(youtube\.com\/(@|channel\/|c\/)[^/?#]+\/?(videos|shorts)?\/?$|tiktok\.com\/@[^/?#]+\/?$)/i.test(t);
    return { kind: profile ? 'profile' : 'url', query: /^https?:\/\//i.test(t) ? t : `https://${t}` };
  }
  if (t.startsWith('@')) return { kind: 'profile', query: t };
  if (t.startsWith('#')) return { kind: 'hashtag', query: t.replace(/^#+/, '').split(/\s+/)[0] };
  return { kind: 'search', query: t };
}

export default function Monitor() {
  const { tick, toast } = useLive();
  const tags = useData('/tags/popular?days=90', tick);
  const watches = useData('/watch', tick);
  const [text, setText] = useState('');
  const [opts, setOpts] = useState({ min_views: 0, limit: 20, polish: true, sort: 'views', exclude: '' });
  const excl = useData('/settings/exclude-keywords', tick);
  const [editExcl, setEditExcl] = useState(false);
  const [newWord, setNewWord] = useState('');
  const [showExcluded, setShowExcluded] = useState(false);
  const words = excl.data?.words ?? [];
  const saveWords = async (list) => {
    try { await api.put('/settings/exclude-keywords', { words: list }); excl.reload(); } catch (e) { toast({ kind: 'error', title: 'Wykluczenia', text: e.message }); }
  };
  const addWord = () => {
    const w = newWord.trim().replace(/^#+/, '').toLowerCase();
    if (w) saveWords([...words, ...w.split(/[,\s]+/).filter(Boolean)]);
    setNewWord('');
  };
  const [hints, setHints] = useState('tags');
  const [res, setRes] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const resultsRef = useRef(null);
  const parsed = parseQuery(text);

  const search = async (raw = text) => {
    const p = parseQuery(raw);
    setText(raw);
    if (!p.kind) return;
    if (p.kind === 'url') {
      // pojedynczy film/post – od razu do analizy (transkrypcja + OCR)
      try {
        const r = await api.post('/discover/video/enqueue', { items: [{ url: p.query }] });
        toast({ kind: 'info', title: 'Dodano do analizy', text: 'Pobieranie, transkrypcja i OCR trwają zwykle 0,5–3 min. Postęp: „Skanowanie i źródła”, wynik: „Wyniki analiz”.' });
        setText('');
      } catch (e) { toast({ kind: 'error', title: 'Nie dodano', text: e.message }); }
      return;
    }
    setBusy(true);
    setRes(null);
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    try {
      const extra = opts.exclude.split(/[,\s]+/).map((x) => x.trim().replace(/^#+/, '')).filter(Boolean);
      const r = await api.post('/discover/video', { ...opts, exclude: extra, kind: p.kind, query: p.query, platform: 'all' });
      setRes({ ...r, kind: p.kind, query: p.query });
      setSel(new Set(r.items.filter((i) => i.passes && !i.known).map((i) => i.url)));
    } catch (e) { toast({ kind: 'error', title: 'Wyszukiwanie', text: e.message }); } finally { setBusy(false); }
  };
  const analyse = async () => {
    const items = res.items.filter((i) => sel.has(i.url)).map((i) => ({ url: i.url, views: i.views ?? null, title: i.title ?? null }));
    if (!items.length) return;
    const r = await api.post('/discover/video/enqueue', { items });
    toast({ kind: 'info', title: 'Dodano do analizy', text: `${r.jobs.length} materiałów (najpopularniejsze pierwsze). Postęp: „Skanowanie i źródła”, wyniki: „Wyniki analiz”.` });
    setSel(new Set());
  };
  const saveWatch = async (kind = res?.kind ?? parsed.kind, query = res?.query ?? parsed.query) => {
    if (!kind || kind === 'url') return;
    try {
      await api.post('/watch', { platform: 'all', kind, query, sort: opts.sort, min_views: Number(opts.min_views), max_per_run: 10, polish: opts.polish });
      toast({ kind: 'info', title: 'Monitorowane stale', text: `${kind === 'hashtag' ? '#' : ''}${query} – sprawdzane automatycznie na wszystkich platformach.` });
      watches.reload();
    } catch (e) { toast({ kind: 'error', title: 'Monitoring', text: e.message }); }
  };
  const createPack = async () => {
    try {
      const r = await api.post('/watch/preset', { preset: 'pl_scam', platforms: ['all'], min_views: 0, max_per_run: 5 });
      toast({ kind: 'info', title: 'Monitoring', text: `Dodano ${r.created} fraz – sprawdzane automatycznie na wszystkich platformach.` });
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
      toast({ kind: 'info', title: `Sprawdzono: ${w.query}`, text: `Znaleziono ${r.found}, do analizy: ${r.queued}` });
    } catch (e) { toast({ kind: 'error', title: 'Monitoring', text: e.message }); }
    watches.reload();
  };
  const toggle = async (w) => { await api.patch(`/watch/${w.id}`, { enabled: !w.enabled }); watches.reload(); };
  const remove = async (w) => { await api.del(`/watch/${w.id}`); watches.reload(); };

  const trending = tags.data?.trending ?? [];
  const phrases = tags.data?.phrases ?? [];
  const watched = new Set((watches.data ?? []).filter((w) => w.enabled).map((w) => `${w.kind}:${w.query}`));
  const auto = new Set((watches.data ?? []).filter((w) => w.auto && w.enabled).map((w) => w.query));
  const isWatched = (kind, q) => watched.has(`${kind}:${q}`);
  const button = { tags: 'Popularne hashtagi', phrases: 'Frazy oszustów' };

  return (
    <>
      <div className="page-head"><div><h1>Monitoring wideo i postów</h1>
        <p className="muted">Szukaj treści na YouTube, TikToku, Instagramie, X i Facebooku naraz, wybierz te do analizy albo ustaw stały monitoring.</p></div></div>

      <Panel className="monitor-search">
        <ol className="steps">
          <li><b>Wpisz</b> #hashtag, frazę, @profil albo wklej link do filmu</li>
          <li><b>Zaznacz</b> wyniki i kliknij „Analizuj zaznaczone”</li>
          <li><b>Monitoruj stale</b>, żeby system sam sprawdzał to zapytanie</li>
        </ol>
        <div className="search-row">
          <input className="big-search" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="#darmowakasa   ·   szybki zarobek   ·   @nazwa_profilu   ·   https://www.tiktok.com/@…/video/…" aria-label="Zapytanie" />
          <button className="btn primary" disabled={busy || !parsed.kind} onClick={() => search()}>
            {busy ? 'Szukam…' : parsed.kind === 'url' ? 'Analizuj ten link' : 'Szukaj'}</button>
          {parsed.kind && parsed.kind !== 'url' && (
            <button className="btn" onClick={() => saveWatch(parsed.kind, parsed.query)} disabled={isWatched(parsed.kind, parsed.query)}
              title="System będzie sam sprawdzał to zapytanie według harmonogramu">{isWatched(parsed.kind, parsed.query) ? '✓ monitorowane' : 'Monitoruj stale'}</button>
          )}
        </div>
        <div className="search-meta small muted">
          {parsed.kind ? <>Rozpoznano: <b>{KIND_LABEL[parsed.kind]}</b>{parsed.kind === 'hashtag' && <> <code>#{parsed.query}</code></>}
            {parsed.kind === 'url' && ' – film zostanie pobrany, przepisany (Whisper) i odczytany (OCR)'} · </> : null}
          <label className="inline">zasięg <select value={opts.min_views} onChange={(e) => setOpts((o) => ({ ...o, min_views: Number(e.target.value) }))}>
            {MIN_VIEWS.map((v) => <option key={v} value={v}>{v ? `≥ ${fmtCount(v)} wyśw.` : 'dowolny'}</option>)}</select></label>
          <label className="inline">wyników <select value={opts.limit} onChange={(e) => setOpts((o) => ({ ...o, limit: Number(e.target.value) }))}>
            {[10, 20, 30, 50].map((v) => <option key={v}>{v}</option>)}</select></label>
          <label className="inline"><input type="checkbox" checked={opts.polish} onChange={(e) => setOpts((o) => ({ ...o, polish: e.target.checked }))} /> tylko po polsku</label>
          <label className="inline">wyklucz też <input value={opts.exclude} onChange={(e) => setOpts((o) => ({ ...o, exclude: e.target.value }))} placeholder="np. minecraft, skrzynki" style={{ width: 170 }} title="Dodatkowe słowa tylko dla tego wyszukiwania" /></label>
          <button type="button" className="linkish" onClick={() => setEditExcl((v) => !v)} title="Słowa, przy których wynik jest pomijany w wyszukiwaniu i stałym monitoringu">
            stałe wykluczenia: {words.length ? words.slice(0, 4).join(', ') + (words.length > 4 ? ` +${words.length - 4}` : '') : 'brak'} ✎</button>
        </div>
        {editExcl && (
          <div className="exclude-edit">
            <div className="small muted">Wyniki zawierające te słowa (w tytule, opisie, autorze, tagach – także jako początek słowa: „gta5” wyklucza „gta5rp”) nie trafiają do analizy ani do stałego monitoringu.</div>
            <div className="exclude-chips">
              {words.map((w) => <span key={w} className="chip neutral">{w}<button type="button" aria-label={`Usuń ${w}`} onClick={() => saveWords(words.filter((x) => x !== w))}>×</button></span>)}
            </div>
            <div className="btn-row">
              <input value={newWord} onChange={(e) => setNewWord(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addWord()} placeholder="dodaj słowo, np. gta6" style={{ width: 200 }} />
              <button className="btn" onClick={addWord} disabled={!newWord.trim()}>Dodaj</button>
              <button className="btn" onClick={() => saveWords(excl.data?.defaults ?? [])} title="Przywróć domyślną listę (gry)">Przywróć domyślne</button>
              <button className="btn" onClick={() => setEditExcl(false)}>Zamknij</button>
            </div>
          </div>
        )}

        <div className="hints">
          <div className="seg" role="tablist">
            {Object.entries(button).map(([k, l]) => <button key={k} role="tab" aria-selected={hints === k} className={hints === k ? 'active' : ''} onClick={() => setHints(k)}>{l}</button>)}
          </div>
          <span className="small muted">kliknij, żeby wyszukać</span>
        </div>
        {hints === 'tags' && (trending.length ? (
          <div className="tag-cloud">
            {trending.map((t) => {
              const [arrow, color] = TREND[t.trend] ?? ['', ''];
              return (
                <button key={t.tag} className={auto.has(t.tag) ? 'on' : ''} onClick={() => search(`#${t.tag}`)}
                  title={`${t.materials} materiałów · ${fmtCount(t.views)} wyświetleń · śr. wynik ${t.avg_score ?? '–'} · ostatnie 7 dni: ${t.recent}, poprzednie: ${t.previous}${auto.has(t.tag) ? ' · monitorowany automatycznie' : ''}`}>
                  #{t.tag} <span className="muted">{fmtCount(t.views)}</span>
                  {arrow && <span style={{ color }}> {arrow}</span>}{t.scams > 0 && <span style={{ color: 'var(--high)' }}> ⚠{t.scams}</span>}
                </button>
              );
            })}
          </div>
        ) : <Empty>Ranking pojawi się po pierwszych analizach.</Empty>)}
        {hints === 'phrases' && (
          <>
            <div className="tag-cloud">{phrases.map((p) => <button key={p} onClick={() => search(p)}>„{p}”</button>)}</div>
            <div className="btn-row" style={{ marginTop: 8 }}><button className="btn" onClick={createPack}>Monitoruj stale wszystkie frazy</button></div>
          </>
        )}
      </Panel>

      <div ref={resultsRef} />
      {(busy || res) && (
        <Panel title={res ? `Wyniki: ${res.kind === 'hashtag' ? '#' : ''}${res.query}` : 'Wyszukiwanie…'}
          meta={res ? `${res.items.length} wyników z ${res.platforms?.length ?? 1} platform` : 'YouTube, TikTok, Instagram, X, Facebook – to może potrwać do minuty'}
          actions={res && <span className="btn-row">
            <button className="btn" onClick={() => saveWatch()} disabled={isWatched(res.kind, res.query)}>{isWatched(res.kind, res.query) ? '✓ monitorowane' : 'Monitoruj stale'}</button>
            <button className="btn primary" disabled={!sel.size} onClick={analyse}>Analizuj zaznaczone ({sel.size})</button>
          </span>}>
          {busy && <Empty>Szukam na 5 platformach…</Empty>}
          {res && Object.keys(res.errors ?? {}).length > 0 && (
            <div className="notice" style={{ marginBottom: 8 }}>
              <b>Nie wszystkie platformy odpowiedziały</b> (pozostałe wyniki są poniżej):
              {Object.entries(Object.entries(res.errors).reduce((acc, [p, e]) => {
                const msg = String(e).replace(/^scraper:\s*/, '');
                (acc[msg] ??= []).push(PLATFORMS[p] ?? p);
                return acc;
              }, {})).map(([msg, plats]) => <div key={msg} className="small"><b>{plats.join(', ')}:</b> {msg}</div>)}
            </div>
          )}
          {res && res.items.some((i) => i.excluded) && (
            <div className="small muted" style={{ marginBottom: 6 }}>
              Pominięto {res.items.filter((i) => i.excluded).length} wyników z wykluczonymi słowami ({[...new Set(res.items.filter((i) => i.excluded).map((i) => i.excluded))].join(', ')}).{' '}
              <button type="button" className="linkish" onClick={() => setShowExcluded((v) => !v)}>{showExcluded ? 'ukryj' : 'pokaż'}</button>
            </div>
          )}
          {res && (res.items.filter((i) => showExcluded || !i.excluded).length ? (
            <div className="table-wrap monitor-results-wrap"><table className="monitor-results">
              <thead><tr><th /><th>Platforma</th><th>Film / post</th><th>Twórca</th><th>Zasięg</th><th>Język</th><th>Status</th></tr></thead>
              <tbody>{res.items.filter((i) => showExcluded || !i.excluded).map((i) => (
                <tr key={i.url} style={{ opacity: i.passes ? 1 : 0.55 }}>
                  <td><input type="checkbox" aria-label="Zaznacz do analizy" disabled={i.known || i.live || Boolean(i.excluded)} checked={sel.has(i.url)} onChange={(e) => setSel((s) => { const n = new Set(s); e.target.checked ? n.add(i.url) : n.delete(i.url); return n; })} /></td>
                  <td><span className="chip neutral">{PLATFORMS[i.platform] ?? i.platform}</span></td>
                  <td><a href={i.url} target="_blank" rel="noreferrer noopener">{i.title || i.url}</a></td>
                  <td className="small">{i.author ?? '–'}{i.followers != null && <div className="muted">{fmtCount(i.followers)} obs.</div>}</td>
                  <td>{i.views != null ? <b>{fmtCount(i.views)}</b> : i.likes != null ? <span className="small">{fmtCount(i.likes)} polub.</span> : <span className="small muted">nieznany</span>}
                    <div className="small muted">{i.live ? 'na żywo' : fmtDur(i.duration)}</div></td>
                  <td>{i.lang === 'pl' ? <span className="chip low">PL</span> : <span className="small muted">?</span>}</td>
                  <td className="small">{i.known ? <Link to={`/materials?q=${encodeURIComponent(i.url)}`}>już przeanalizowany</Link> : i.excluded ? `wykluczone („${i.excluded}”)` : i.passes ? 'do analizy' : (opts.polish && i.lang !== 'pl' ? 'nie po polsku' : 'za mały zasięg')}</td>
                </tr>))}
              </tbody></table></div>
          ) : <Empty>Nic nie znaleziono. Spróbuj innego hashtagu albo frazy, albo zdejmij próg zasięgu.</Empty>)}
        </Panel>
      )}

      <Panel title="Monitorowane stale" meta="system sam sprawdza te zapytania według harmonogramu · „auto” = dodane automatycznie z rankingu hashtagów"
        actions={<button className="btn" onClick={refreshRanking} title="Przelicz ranking hashtagów i zaktualizuj automatyczny monitoring">Przelicz ranking</button>}>
        {watches.data?.length ? <div className="table-wrap monitor-watches-wrap"><table className="monitor-watches">
          <thead><tr><th>Zapytanie</th><th>Próg</th><th>Ostatnio sprawdzono</th><th>Znalezione materiały</th><th>Akcje</th></tr></thead>
          <tbody>{watches.data.map((w) => (
            <tr key={w.id} style={{ opacity: w.enabled ? 1 : 0.55 }}>
              <td><b>{w.kind === 'hashtag' ? `#${w.query}` : w.kind === 'profile' ? w.query : `„${w.query}”`}</b> {w.auto && <span className="chip info">auto</span>} {!w.enabled && <span className="chip neutral">wstrzymane</span>}
                <div className="small muted">{KIND_LABEL[w.kind] ?? w.kind} · {PLATFORMS[w.platform] ?? w.platform}{w.polish ? ' · tylko PL' : ''}</div></td>
              <td className="small">≥ {fmtCount(w.min_views)} wyśw. · maks. {w.max_per_run} na raz</td>
              <td className="small">{w.last_run_at ? fmtDate(w.last_run_at) : 'jeszcze nie'}{w.last_run_at && !w.last_error && <div className="muted">znaleziono {w.last_found}, do analizy {w.last_queued}</div>}
                {w.last_error && <div style={{ color: 'var(--high)' }}>{w.last_error}</div>}</td>
              <td className="small"><Link to={`/materials?watch=${w.id}&sort=priority`}>{w.materials} materiałów</Link>{w.scams > 0 && <div style={{ color: 'var(--high)' }}>{w.scams} podejrzeń oszustwa</div>}</td>
              <td className="btn-row"><button className="btn" onClick={() => run(w)}>Sprawdź teraz</button><button className="btn" onClick={() => toggle(w)}>{w.enabled ? 'Wstrzymaj' : 'Wznów'}</button><button className="btn danger" onClick={() => remove(w)}>Usuń</button></td>
            </tr>))}
          </tbody></table></div> : <Empty>Nic nie jest jeszcze monitorowane. Wyszukaj coś powyżej i kliknij „Monitoruj stale”.</Empty>}
      </Panel>
    </>
  );
}

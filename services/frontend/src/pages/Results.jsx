import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { qs } from '../api.js';
import { Empty, fmtCount, fmtDate, MAT_STATUS, ModuleChips, Panel, PROFILE, ProfileChip, RiskBadge, Score, ScoreBar } from '../components/ui.jsx';
import { useData, useDebounced } from '../hooks.js';
import { useLive } from '../live.jsx';

const PLATFORMS = ['web', 'facebook', 'instagram', 'tiktok', 'youtube', 'x', 'threads', 'linkedin', 'vimeo', 'reddit'];
const VIEWS = [['', 'dowolny zasięg'], ['1000', '≥ 1 tys.'], ['10000', '≥ 10 tys.'], ['100000', '≥ 100 tys.'], ['1000000', '≥ 1 mln']];

export default function Results() {
  const { tick } = useLive();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const q = useDebounced(text);
  const f = Object.fromEntries(params.entries());
  const set = (k, v) => { const p = new URLSearchParams(params); v ? p.set(k, v) : p.delete(k); if (k !== 'page') p.delete('page'); setParams(p); };
  const { data, error, reload } = useData(`/materials${qs({ ...f, q })}`, tick);
  const activeFilters = Object.entries(f).filter(([key, value]) => value && !['page', 'sort', 'dir'].includes(key));
  const sort = (col) => {
    const p = new URLSearchParams(params);
    p.set('sort', col);
    p.set('dir', f.sort === col && f.dir !== 'asc' ? 'asc' : 'desc');
    setParams(p);
  };
  const clearFilters = () => {
    setText('');
    setParams({});
  };
  const sortButton = (label, col) => (
    <button type="button" className="sort-btn" onClick={() => sort(col)} aria-label={`Sortuj według: ${label}`}>
      {label}{f.sort === col ? (f.dir === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
    </button>
  );

  return (
    <>
<<<<<<< HEAD
      <div className="page-head"><div><h1>Wyniki analiz</h1><p>Filtrowanie po dacie, źródle, module, ryzyku, typie publikującego i zasięgu</p></div>
        <span className="btn-row">
          <label className="toggle"><input type="checkbox" checked={f.demo === '1'} onChange={(e) => set('demo', e.target.checked ? '1' : '')} /> pokaż próbki demo</label>
          <label className="toggle"><input type="checkbox" checked={Boolean(f.above)} onChange={(e) => set('above', e.target.checked ? '1' : '')} /> tylko powyżej progu ({data?.threshold ?? '–'})</label>
        </span>
=======
        <div className="page-head"><div><h1>Wyniki analiz</h1><p>Materiały z sygnałami do sprawdzenia. Filtruj po źródle, typie publikującego, zasięgu i wyniku.</p></div>
        <label className="toggle"><input type="checkbox" checked={Boolean(f.above)} onChange={(e) => set('above', e.target.checked ? '1' : '')} /> tylko powyżej progu ({data?.threshold ?? '–'})</label>
>>>>>>> origin/frontend
      </div>
      <Panel>
        <div className="filters">
          <label className="f search-filter">Szukaj materiału<input aria-label="Szukaj w tytule lub adresie" placeholder="Tytuł lub adres URL" value={text} onChange={(e) => setText(e.target.value)} /></label>
          <label className="f">Od<input type="date" value={f.from ?? ''} onChange={(e) => set('from', e.target.value)} /></label>
          <label className="f">Do<input type="date" value={f.to ?? ''} onChange={(e) => set('to', e.target.value)} /></label>
          <label className="f">Źródło<select value={f.platform ?? ''} onChange={(e) => set('platform', e.target.value)}><option value="">wszystkie</option>{PLATFORMS.map((p) => <option key={p}>{p}</option>)}</select></label>
          <label className="f">Obszar analizy<select value={f.module ?? ''} onChange={(e) => set('module', e.target.value)}><option value="">wszystkie</option><option value="m1">M1 Promocja i autor</option><option value="m2">M2 Informacja o ryzyku</option><option value="m3">M3 Oferta doradcza</option></select></label>
          <label className="f">Ryzyko<select value={f.risk ?? ''} onChange={(e) => set('risk', e.target.value)}><option value="">wszystkie</option><option>wysokie</option><option>średnie</option><option>niskie</option></select></label>
          <label className="f">Status<select value={f.status ?? ''} onChange={(e) => set('status', e.target.value)}><option value="">wszystkie</option>{Object.entries(MAT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="f">Typ<select value={f.profile ?? ''} onChange={(e) => set('profile', e.target.value)}><option value="">wszystkie</option>{Object.entries(PROFILE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
          <label className="f">Rodzaj<select value={f.media ?? ''} onChange={(e) => set('media', e.target.value)}><option value="">wszystkie</option><option value="video">wideo</option><option value="image">obraz (OCR)</option><option value="web">strona / tekst</option></select></label>
          <label className="f">Zasięg<select value={f.min_views ?? ''} onChange={(e) => set('min_views', e.target.value)}>{VIEWS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="f">Język<select value={f.lang ?? ''} onChange={(e) => set('lang', e.target.value)}><option value="">wszystkie</option><option value="pl">polski</option><option value="other">inne</option></select></label>
<<<<<<< HEAD
          <label className="f">Tag<input placeholder="#kryptowaluty" value={f.tag ?? ''} onChange={(e) => set('tag', e.target.value.replace(/^#/, ''))} style={{ width: 130 }} /></label>
          <label className="f">Sortuj<select value={f.sort ?? 'fetched_at'} onChange={(e) => set('sort', e.target.value)}><option value="fetched_at">najnowsze (pobrane)</option><option value="published_at">data publikacji</option><option value="score">wynik</option><option value="views">zasięg</option><option value="priority">priorytet (ryzyko × zasięg)</option></select></label>
=======
          <label className="f">Tag<input aria-label="Filtruj po tagu" placeholder="#kryptowaluty" value={f.tag ?? ''} onChange={(e) => set('tag', e.target.value.replace(/^#/, ''))} style={{ width: 130 }} /></label>
          <label className="f">Sortuj<select value={f.sort ?? 'fetched_at'} onChange={(e) => set('sort', e.target.value)}><option value="fetched_at">najnowsze</option><option value="score">wynik</option><option value="views">zasięg</option><option value="priority">priorytet (ryzyko × zasięg)</option></select></label>
          {activeFilters.length > 0 && <button className="btn clear-filters" type="button" onClick={clearFilters}>Wyczyść filtry ({activeFilters.length})</button>}
>>>>>>> origin/frontend
        </div>
        {error && <div className="notice error-notice" role="alert">Nie udało się pobrać wyników. {error.message} <button className="btn" onClick={reload}>Spróbuj ponownie</button></div>}
        {data && (data.items.length ? (
          <>
            <div className="table-wrap"><table>
              <thead><tr>
<<<<<<< HEAD
                <th onClick={() => sort('title')} style={{ cursor: 'pointer' }}>Materiał</th><th>Źródło</th><th>Typ</th><th onClick={() => sort('views')} style={{ cursor: 'pointer' }}>Zasięg ↕</th><th>Moduły</th>
                <th onClick={() => sort('score')} style={{ cursor: 'pointer' }}>Wynik ↕</th><th>Ryzyko</th><th>Status</th>
                <th onClick={() => sort('published_at')} style={{ cursor: 'pointer' }}>Opublikowano ↕</th>
                <th onClick={() => sort('fetched_at')} style={{ cursor: 'pointer' }}>Pobrano ↕</th>
              </tr></thead>
              <tbody>{data.items.map((m) => (
                <tr key={m.id} className="click" onClick={() => nav(`/materials/${m.id}`)}>
                  <td><div className="truncate">{m.title || '(bez tytułu)'}{m.demo && <span className="chip neutral" style={{ marginLeft: 6 }} title="Próbka kalibracyjna (dane demonstracyjne)">próbka</span>}{m.near_duplicate_of && <span className="chip mid" style={{ marginLeft: 6 }} title={`Prawie duplikat materiału #${m.near_duplicate_of}`}>duplikat #{m.near_duplicate_of}</span>}</div><div className="small muted truncate">{m.url}</div></td>
=======
                <th>{sortButton('Materiał', 'title')}</th><th>Źródło</th><th>Typ</th><th>{sortButton('Zasięg', 'views')}</th><th>Obszary analizy</th>
                <th>{sortButton('Wynik', 'score')}</th><th>Poziom ryzyka</th><th>Status przeglądu</th>
                <th>{sortButton('Data pobrania', 'fetched_at')}</th>
              </tr></thead>
              <tbody>{data.items.map((m) => (
                <tr key={m.id}>
                  <td><div className="truncate"><Link to={`/materials/${m.id}`}>{m.title || '(bez tytułu)'}</Link>{m.near_duplicate_of && <span className="chip mid" style={{ marginLeft: 6 }} title={`Podobny do materiału #${m.near_duplicate_of}`}>podobny #{m.near_duplicate_of}</span>}</div><div className="small muted truncate">{m.url}</div></td>
>>>>>>> origin/frontend
                  <td><span className="chip neutral">{m.platform}</span>{m.author && <div className="small muted">{m.author}</div>}</td>
                  <td><ProfileChip type={m.profile_type} />{m.is_video && <div className="small muted">wideo</div>}</td>
                  <td className="small">{m.views != null ? <><b>{fmtCount(m.views)}</b> wyśw.</> : '–'}{m.followers != null && <div className="muted">{fmtCount(m.followers)} obs.</div>}
                    {m.tags?.length > 0 && <div className="muted truncate" style={{ maxWidth: 140 }}>{m.tags.slice(0, 3).map((t) => `#${t}`).join(' ')}</div>}</td>
                  <td><ModuleChips modules={m.modules} /></td>
                  <td style={{ minWidth: 90 }}><Score score={m.score} threshold={data.threshold} />{m.reviewed && <span className="small muted" title={`Wynik po weryfikacji analityka (automat: ${Math.round(m.classifier_score)})`}> ✎</span>}<ScoreBar score={m.score} threshold={data.threshold} /></td>
                  <td><RiskBadge risk={m.risk} /></td>
                  <td className="small">{MAT_STATUS[m.status]}</td>
                  <td className="small">{m.published_at ? fmtDate(m.published_at) : <span className="muted">–</span>}</td>
                  <td className="small muted">{fmtDate(m.fetched_at)}</td>
                </tr>))}
              </tbody>
            </table></div>
            <div className="btn-row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
              <span className="small muted">{data.total} materiałów</span>
              <span className="btn-row">
                <button className="btn" disabled={data.page <= 1} onClick={() => set('page', data.page - 1)}>‹ Poprzednia</button>
                <button className="btn" disabled={data.page * data.size >= data.total} onClick={() => set('page', data.page + 1)}>Następna ›</button>
              </span>
            </div>
          </>
        ) : <Empty>Brak wyników dla wybranych filtrów.</Empty>)}
      </Panel>
    </>
  );
}

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { qs } from '../api.js';
import { Empty, fmtCount, fmtDate, MAT_STATUS, ModuleChips, Panel, PROFILE, ProfileChip, RecordDetails, RiskBadge, Score, ScoreBar } from '../components/ui.jsx';
import { useData, useDebounced } from '../hooks.js';
import { useLive } from '../live.jsx';

const PLATFORMS = ['web', 'facebook', 'instagram', 'tiktok', 'youtube', 'x', 'threads', 'linkedin', 'vimeo', 'reddit'];
const VIEWS = [['', 'dowolny zasięg'], ['1000', '≥ 1 tys.'], ['10000', '≥ 10 tys.'], ['100000', '≥ 100 tys.'], ['1000000', '≥ 1 mln']];

export default function Results() {
  const { tick } = useLive();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const urlQuery = params.get('q') ?? '';
  useEffect(() => { setText(urlQuery); }, [urlQuery]);
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
        <div className="page-head"><div><h1>Wyniki analiz</h1><p>Materiały z sygnałami do sprawdzenia. Filtruj po źródle, typie publikującego, zasięgu i wyniku.</p></div>
        <span className="btn-row"><label className="toggle"><input type="checkbox" checked={f.repeat === '1'} onChange={(e) => set('repeat', e.target.checked ? '1' : '')} /> tylko konta z historią naruszeń</label><label className="toggle"><input type="checkbox" checked={f.demo === '1'} onChange={(e) => set('demo', e.target.checked ? '1' : '')} /> pokaż próbki demo</label>
        <label className="toggle"><input type="checkbox" checked={Boolean(f.above)} onChange={(e) => set('above', e.target.checked ? '1' : '')} /> tylko powyżej progu ({data?.threshold ?? '–'})</label></span>
      </div>
      <Panel>
        <div className="filters">
          <label className="f search-filter">Szukaj materiału<input aria-label="Szukaj w tytule lub adresie" placeholder="Tytuł lub adres URL" value={text} onChange={(e) => { setText(e.target.value); set('q', e.target.value); }} /></label>
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
          <label className="f">Tag<input aria-label="Filtruj po tagu" placeholder="#kryptowaluty" value={f.tag ?? ''} onChange={(e) => set('tag', e.target.value.replace(/^#/, ''))} style={{ width: 130 }} /></label>
          <label className="f">Sortuj<select value={f.sort ?? 'fetched_at'} onChange={(e) => set('sort', e.target.value)}><option value="fetched_at">najnowsze (pobrane)</option><option value="published_at">data publikacji</option><option value="score">wynik</option><option value="views">zasięg</option><option value="priority">priorytet (ryzyko × zasięg)</option></select></label>
          {activeFilters.length > 0 && <button className="btn clear-filters" type="button" onClick={clearFilters}>Wyczyść filtry ({activeFilters.length})</button>}
        </div>
        {error && <div className="notice error-notice" role="alert">Nie udało się pobrać wyników. {error.message} <button className="btn" onClick={reload}>Spróbuj ponownie</button></div>}
        {data && (data.items.length ? (
          <>
            <div className="table-wrap"><table>
              <thead><tr>
                <th>{sortButton('Materiał', 'title')}</th><th>{sortButton('Zasięg', 'views')}</th>
                <th>{sortButton('Ryzyko / wynik', 'score')}</th><th>Status</th>
              </tr></thead>
              <tbody>{data.items.map((m) => (
                <tr key={m.id}>
                  <td className="material-cell"><Link to={`/materials/${m.id}`}>{m.title || '(bez tytułu)'}</Link>
                    {m.demo && <span className="chip neutral" style={{ marginLeft: 6 }}>próbka</span>}
                    <RecordDetails context={m.title || m.url} fields={[
                      ['Źródło', m.platform], ['Autor', m.author], ['Adres', m.url],
                      ['Data publikacji', m.published_at ? fmtDate(m.published_at) : 'brak danych'],
                      ['Pobrano', fmtDate(m.fetched_at)], ['Rodzaj', m.is_video ? 'wideo' : 'strona / tekst / obraz'],
                      ['Obserwujący', fmtCount(m.followers)], ['Tagi', m.tags?.map((t) => `#${t}`).join(' ') || '–'],
                      ['Sygnały oszustwa', m.scam_score >= 30 ? `${Math.round(m.scam_score)}/100` : 'brak silnych sygnałów'],
                      ['Wynik automatyczny', m.reviewed ? `${Math.round(m.classifier_score)}/100` : 'bez korekty analityka'],
                    ]}>
                      <ProfileChip type={m.profile_type} /><ModuleChips modules={m.modules} />
                      {m.near_duplicate_of && <Link to={`/materials/${m.near_duplicate_of}`}>Podobny materiał #{m.near_duplicate_of} →</Link>}
                      {m.account_others > 0 && <Link to={`/materials?account=${encodeURIComponent(m.account_key)}&demo=1`}>+{m.account_others} materiałów tego konta →</Link>}
                    </RecordDetails>
                  </td>
                  <td>{m.views != null ? <><b>{fmtCount(m.views)}</b> wyśw.</> : '–'}</td>
                  <td style={{ minWidth: 130 }}><RiskBadge risk={m.risk} /> <Score score={m.score} threshold={data.threshold} /><ScoreBar score={m.score} threshold={data.threshold} /></td>
                  <td>{MAT_STATUS[m.status]}</td>
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

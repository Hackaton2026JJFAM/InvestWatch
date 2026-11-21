import { Fragment, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Empty, Evidence, fmtDate, MAT_STATUS, MODULES, ModuleChips, Panel, pct, RiskBadge, Score, ScoreBar, StatusChip } from '../components/ui.jsx';
import { useData } from '../hooks.js';
import { REG } from './Entities.jsx';
import { useLive } from '../live.jsx';

const TABS = ['Podsumowanie', 'Reguły zgodności (M2)', 'Finfluencerzy (M1)', 'Shadow Advisory (M3)', 'Materiał', 'Historia'];

function FindingsTable({ findings }) {
  const [onlyIssues, setOnlyIssues] = useState(false);
  const rows = onlyIssues ? findings.filter((f) => f.status === 'fail' || f.status === 'warn') : findings;
  return (
    <>
      <label className="small"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> tylko niespełnione i do weryfikacji</label>
      <div className="table-wrap"><table style={{ marginTop: 8 }}>
        <thead><tr><th>ID</th><th>Reguła</th><th>Wynik</th><th>Uzasadnienie i fragmenty</th><th>Podstawa prawna</th></tr></thead>
        <tbody>{rows.map((f) => (
          <tr key={f.id ?? f.rule_id}>
            <td className="mono"><b>{f.rule_id}</b></td>
            <td style={{ minWidth: 160 }}>{f.title}</td>
            <td><StatusChip status={f.status} /></td>
            <td style={{ minWidth: 320 }}>{f.explanation}<Evidence items={(f.evidence ?? []).slice(0, 3)} /></td>
            <td className="small muted" style={{ minWidth: 140 }}>{f.legal_basis ?? '–'}</td>
          </tr>))}
        </tbody>
      </table></div>
    </>
  );
}

// Zrzut strony z nałożonymi ramkami bloków (współrzędne z renderu Playwright, viewport desktop).
function AnnotatedShot({ src, vp, boxes }) {
  const W = vp?.width ?? 1366;
  const H = vp?.screenshot_height;
  return (
    <div className="shot-wrap">
      <img className="shot" src={src} alt="Zrzut ekranu materiału" />
      {H && boxes.filter((b) => b.y < H).map((b, i) => (
        <div key={i} className={`hl ${b.kind}`} title={`${b.text}${b.issues.length ? `\n⚠ ${b.issues.join(', ')}` : ''}`}
          style={{ left: `${(b.x / W) * 100}%`, top: `${(b.y / H) * 100}%`, width: `${(b.w / W) * 100}%`, height: `${(Math.min(b.h, H - b.y) / H) * 100}%` }}>
          {b.issues.length > 0 && <span className="hl-tag">{b.issues.join(' · ')}</span>}
        </div>
      ))}
    </div>
  );
}

function Summary({ materialId, analysis, tick }) {
  const { data, reload } = useData(`/summary/${materialId}`, `${tick}-${analysis?.id}`);
  return (
    <Panel title="Podsumowanie AI" meta={data ? `silnik: ${data.engine}` : ''} actions={<button className="btn" onClick={() => api.get(`/summary/${materialId}?refresh=1`).then(reload)}>Odśwież</button>}>
      <div className="notice" style={{ marginBottom: 10 }}>Podsumowanie powstaje wyłącznie z ustrukturyzowanych przesłanek; każde zdanie odwołuje się do reguły [ID]. To sygnał do weryfikacji, nie ocena prawna.</div>
      <div className="summary-text">{data?.summary ?? 'Generowanie…'}</div>
    </Panel>
  );
}

export default function Material() {
  const { id } = useParams();
  const { tick, toast } = useLive();
  const [tab, setTab] = useState(TABS[0]);
  const nav = useNavigate();
  const { data, error, reload } = useData(`/materials/${id}`, tick);
  if (error) return <Empty>{error.message}</Empty>;
  if (!data) return <Empty>Ładowanie…</Empty>;
  const { material: m, analysis: a, findings, entities, history, threshold, risk, similar = [] } = data;
  const r = a?.result ?? {};
  const byModule = (mod) => findings.filter((f) => f.module === mod);
  const setStatus = (status) => api.patch(`/materials/${id}/status`, { status }).then(reload);
  // usunięcie materiału (operacja administratora – okno logowania pojawi się automatycznie)
  const remove = () => {
    if (!window.confirm(`Usunąć materiał „${m.title || m.url}” wraz z analizami i alertami? Tej operacji nie można cofnąć.`)) return;
    api.del(`/materials/${id}`)
      .then(() => { toast({ kind: 'info', title: 'Usunięto materiał', text: m.title || m.url }); nav('/materials'); })
      .catch((err) => { if (err.auth !== 'cancelled') toast({ kind: 'alert', title: 'Nie usunięto materiału', text: err.message }); });
  };
  const reanalyze = () => api.post(`/materials/${id}/reanalyze`).then(() => { toast({ title: 'Ponowna analiza zakończona', text: m.title }); reload(); });
  const label = (gt) => api.patch(`/materials/${id}/label`, { ground_truth: gt }).then(reload);

  return (
    <>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1>{m.title || '(bez tytułu)'}</h1>
          <p className="truncate" style={{ maxWidth: 760 }}><a href={m.final_url || m.url} target="_blank" rel="noreferrer noopener">{m.final_url || m.url}</a></p>
        </div>
        <div className="btn-row">
          {['REVIEWED', 'ESCALATED', 'DISMISSED'].map((s) => (
            <button key={s} className={`btn ${s === 'ESCALATED' ? 'primary' : ''}`} disabled={m.status === s} onClick={() => setStatus(s)}>{MAT_STATUS[s]}</button>
          ))}
          <button className="btn" onClick={reanalyze}>Analizuj ponownie</button>
          <button className="btn danger" onClick={remove}>Usuń</button>
        </div>
      </div>

      <div className="grid g4">
        <div className="panel stat"><span className="label">Wynik punktowy</span><span className="value"><Score score={a?.score} threshold={threshold} /><span className="muted small"> /100</span></span><ScoreBar score={a?.score} threshold={threshold} /></div>
        <div className="panel stat"><span className="label">Poziom ryzyka (próg {threshold})</span><span><RiskBadge risk={risk} /></span><span className="sub">Moduły: <ModuleChips modules={a?.modules} /></span></div>
        <div className="panel stat"><span className="label">Status weryfikacji</span><span className="value" style={{ fontSize: '1.2rem' }}>{MAT_STATUS[m.status]}</span><span className="sub">pobrano {fmtDate(m.fetched_at)}</span></div>
        <div className="panel stat"><span className="label">Wyniki modułów</span>
          {Object.entries(a?.module_scores ?? {}).map(([k, v]) => <span key={k} className="small">{MODULES[k]}: <b>{Math.round(v)}</b></span>)}
        </div>
      </div>

      <div className="tabs" style={{ marginTop: 18 }}>
        {TABS.map((t) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}
      </div>

      {tab === 'Podsumowanie' && (
        <div className="grid g2">
          <Summary materialId={id} analysis={a} tick={tick} />
          <Panel title="Wykryte podmioty">
            {entities.length ? <table><tbody>{entities.map((e) => (
              <tr key={`${e.id}-${e.role}`}><td><Link to={`/entities/${e.id}`}>{e.name}</Link></td><td className="small muted">{{ advertised_firm: 'reklamowana firma', publisher: 'publikujący', advisor: 'podmiot doradczy' }[e.role]}</td>
                <td><span className={`chip ${REG[e.registry_status]?.[0] ?? 'na'}`}>{REG[e.registry_status]?.[1] ?? 'nieustalone'}</span></td></tr>))}
            </tbody></table> : <Empty>Nie wykryto podmiotów.</Empty>}
            <h3 style={{ marginTop: 16 }}>Profil klasyfikatora zdań ({r.ml?.model})</h3>
            <div className="kv">{Object.entries(r.ml?.max ?? {}).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{pct(v)} (maks.)</dd></Fragment>)}</div>
            <h3 style={{ marginTop: 16 }}>Etykieta testowa (kalibracja)</h3>
            <div className="btn-row">
              <button className={`btn ${m.ground_truth === true ? 'primary' : ''}`} onClick={() => label(true)}>Ryzykowny</button>
              <button className={`btn ${m.ground_truth === false ? 'primary' : ''}`} onClick={() => label(false)}>Poprawny</button>
              <button className="btn" onClick={() => label(null)}>Brak etykiety</button>
            </div>
            <h3 style={{ marginTop: 16 }}>Podobne materiały (simhash)</h3>
            {similar.length ? <table><tbody>{similar.map((x) => (
              <tr key={x.id}><td><Link to={`/materials/${x.id}`}>{x.title || x.url}</Link><div className="small muted">{x.platform}{x.author ? ` · ${x.author}` : ''}</div></td>
                <td><span className={`chip ${x.distance <= 3 ? 'mid' : 'neutral'}`}>{x.distance <= 3 ? 'prawie duplikat' : 'podobny'} · {x.distance} bit</span></td></tr>))}
            </tbody></table> : <p className="small muted">Brak podobnych treści w bazie.</p>}
          </Panel>
        </div>
      )}

      {tab === 'Reguły zgodności (M2)' && (
        <Panel title="18 reguł UKNF – informacja o ryzyku" meta={`render: ${m.layout_engine}`}>
          {m.layout_engine === 'ocr' && <div className="notice" style={{ marginBottom: 8 }}>Obraz reklamy (OCR) – reguły 4–6 ocenione na podstawie wysokości liter, kontrastu i położenia tekstu na obrazie; reguły 7–8 nie dotyczą obrazu statycznego.</div>}
          {!['playwright', 'ocr'].includes(m.layout_engine) && <div className="notice" style={{ marginBottom: 8 }}>Materiał tekstowy – reguły wizualne 4–8 wymagają renderu strony i nie zostały ocenione.</div>}
          <FindingsTable findings={byModule('m2')} />
        </Panel>
      )}

      {tab === 'Finfluencerzy (M1)' && (
        <div className="grid g2">
          <Panel title="Reklamowana firma i reklamujący">
            <dl className="kv">
              <dt>Publikujący</dt><dd>{r.m1?.publisher?.name ?? <i>nieustalone</i>}</dd>
              <dt>Typ publikującego</dt><dd>{{ firma: 'sama firma inwestycyjna', podmiot_trzeci: 'podmiot trzeci / finfluencer', nieustalone: 'nieustalone (do ręcznej weryfikacji)' }[r.m1?.publisher?.type]}</dd>
              <dt>Platforma</dt><dd>{r.m1?.publisher?.platform}</dd>
              <dt>Firmy z rejestru</dt><dd>{(r.m1?.firms ?? []).map((f) => f.name + (f.demo ? ' [DEMO]' : '')).join(', ') || '–'}</dd>
              <dt>Instrumenty</dt><dd>{(r.m1?.instruments ?? []).join(', ') || '–'}</dd>
              <dt>URL</dt><dd className="mono">{m.url}</dd>
            </dl>
          </Panel>
          <Panel title="Przesłanki M1"><FindingsTable findings={byModule('m1')} /></Panel>
        </div>
      )}

      {tab === 'Shadow Advisory (M3)' && (
        <div className="grid g2">
          <Panel title="Klasyfikacja oferty">
            <dl className="kv">
              <dt>Klasyfikacja</dt><dd><b>{{ indywidualne_doradztwo: 'oferta indywidualnego doradztwa', 'usługa_doradcza_ogólna': 'usługa doradcza (ogólna)', edukacja: 'materiał edukacyjny', brak: 'brak cech doradztwa' }[r.m3?.classification] ?? '–'}</b></dd>
              {(r.m3?.entities ?? []).map((e) => <Fragment key={e.name}><dt>{e.name}</dt><dd>{e.registry}</dd></Fragment>)}
            </dl>
            <div className="notice" style={{ marginTop: 10 }}>Brak podmiotu w rejestrze KNF nie oznacza automatycznie nielegalnej działalności – to sygnał do weryfikacji (art. 76 u.o.i.f.).</div>
          </Panel>
          <Panel title="Przesłanki M3"><FindingsTable findings={byModule('m3')} /></Panel>
        </div>
      )}

      {tab === 'Materiał' && (
        <div className="grid g2">
          <Panel title={m.layout_engine === 'ocr' ? 'Obraz reklamy (OCR)' : 'Zrzut ekranu (desktop)'} meta="ramki: czerwona = ostrzeżenie o ryzyku, niebieska = obietnica zysku">
            {m.screenshot ? <AnnotatedShot src={m.screenshot} vp={m.viewports?.desktop} boxes={r.doc?.highlights ?? []} /> : <Empty>Brak zrzutu (materiał tekstowy).</Empty>}
            {Object.keys(m.viewports ?? {}).length > 0 && (
              <p className="small muted">Viewporty: {Object.entries(m.viewports).map(([k, v]) => `${k} ${v.width}×${v.height} (${v.blocks} bloków)`).join(' · ')}</p>
            )}
          </Panel>
          <Panel title="Treść i metadane">
            <dl className="kv" style={{ marginBottom: 10 }}>
              <dt>Autor</dt><dd>{m.author ?? 'nieustalone'}</dd>
              <dt>Data publikacji</dt><dd>{m.published_at ? fmtDate(m.published_at) : 'brak danych'}</dd>
              <dt>Język</dt><dd>{m.lang ?? '–'}</dd>
              <dt>Platforma</dt><dd>{m.platform}</dd>
              <dt>Hash treści</dt><dd className="mono">{m.content_hash.slice(0, 16)}…</dd>
            </dl>
            <div className="content-text">{m.content_text}</div>
          </Panel>
        </div>
      )}

      {tab === 'Historia' && (
        <Panel title="Historia analiz">
          <table><thead><tr><th>Data</th><th>Wynik</th><th>Moduły</th><th>Wersja analizatora</th><th>Podsumowanie</th></tr></thead>
            <tbody>{history.map((h) => (
              <tr key={h.id}><td>{fmtDate(h.created_at)}</td><td><Score score={h.score} threshold={threshold} /></td><td><ModuleChips modules={h.modules} /></td><td className="mono">{h.analyzer_version}</td><td className="small">{h.summary_engine ?? '–'}</td></tr>))}
            </tbody></table>
        </Panel>
      )}
    </>
  );
}

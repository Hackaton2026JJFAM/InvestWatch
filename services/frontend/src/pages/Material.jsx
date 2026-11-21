import { Fragment, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Empty, Evidence, fmtCount, fmtDate, MAT_STATUS, ModuleChips, MODULES, Panel, pct, ProfileChip, RiskBadge, Score, ScoreBar, StatusChip } from '../components/ui.jsx';
import { HelpTip } from '../components/HelpTip.jsx';
import { useData } from '../hooks.js';
import { REG } from './Entities.jsx';
import { useLive } from '../live.jsx';

const TABS = ['Podsumowanie', 'Przesłanki', 'Publikujący', 'Materiał', 'Historia'];
const FINDING_MODULES = [['m2', 'Zgodność'], ['m1', 'Publikujący'], ['m3', 'Doradztwo']];

function moveTab(event, items, active, setActive, idFor) {
  const index = items.findIndex((item) => (Array.isArray(item) ? item[0] : item) === active);
  let next = index;
  if (event.key === 'ArrowRight') next = (index + 1) % items.length;
  else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = items.length - 1;
  else return;
  event.preventDefault();
  const item = items[next];
  setActive(Array.isArray(item) ? item[0] : item);
  requestAnimationFrame(() => document.getElementById(idFor(item, next))?.focus());
}

function FindingsTable({ findings, rejected }) {
  const [onlyIssues, setOnlyIssues] = useState(false);
  const rows = onlyIssues ? findings.filter((f) => f.status === 'fail' || f.status === 'warn') : findings;
  return (
    <>
      <label className="small"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> tylko niespełnione i do weryfikacji</label>
      <div className="table-wrap"><table style={{ marginTop: 8 }}>
        <thead><tr><th>ID</th><th>Reguła</th><th>Wynik</th><th>Uzasadnienie i fragmenty</th><th>Podstawa prawna</th></tr></thead>
        <tbody>{rows.map((f) => (
          <tr key={f.id ?? f.rule_id} style={rejected?.has(f.rule_id) ? { opacity: 0.5 } : undefined}>
            <td className="mono"><b>{f.rule_id}</b></td>
            <td style={{ minWidth: 160 }}>{f.title}</td>
            <td><StatusChip status={f.status} />{rejected?.has(f.rule_id) && <div className="small muted">odrzucone przez analityka</div>}</td>
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

const mmss = (s) => `${Math.floor((s ?? 0) / 60)}:${String(Math.floor((s ?? 0) % 60)).padStart(2, '0')}`;
const RISK_RE = /ryzyk|strat|utrat|risk|loss|lose/i;

// Wideo: transkrypcja z czasami + napisy z ekranu z czasem widoczności (ostrzeżenie < 3 s = za krótko).
function VideoPanel({ video }) {
  const segs = video.transcript?.segments ?? [];
  const caps = [...(video.captions ?? [])].sort((a, b) => a.t - b.t);
  const meta = video.meta ?? {};
  return (
    <div className="grid g2" style={{ marginTop: 12 }}>
      <Panel title="Transkrypcja mowy" meta={video.transcript ? `Whisper ${video.transcript.model} · język ${video.transcript.language ?? '?'}` : ''}>
        <dl className="kv" style={{ marginBottom: 10 }}>
          <dt>Długość</dt><dd>{video.duration ? mmss(video.duration) : '–'}</dd>
          <dt>Klatki</dt><dd>{video.frames_sampled ?? 0} próbek · {video.frames_with_text ?? 0} z nowym tekstem</dd>
          {meta.view_count != null && <><dt>Wyświetlenia</dt><dd>{Number(meta.view_count).toLocaleString('pl-PL')}</dd></>}
          {meta.channel_follower_count != null && <><dt>Obserwujący</dt><dd>{Number(meta.channel_follower_count).toLocaleString('pl-PL')}</dd></>}
        </dl>
        {video.transcript?.no_audio && <Empty>Nagranie bez ścieżki dźwiękowej.</Empty>}
        {segs.length > 0 ? (
          <div className="transcript">{segs.map((s, i) => (
            <div key={i} className={`seg ${RISK_RE.test(s.text) ? 'risk' : ''}`}><span className="mono muted">{mmss(s.start)}</span> {s.text}</div>
          ))}</div>
        ) : !video.transcript?.no_audio && <Empty>Nie rozpoznano mowy.</Empty>}
      </Panel>
      <Panel title="Napisy na ekranie" meta="pierwsze pojawienie · czas widoczności">
        {caps.length ? <table><tbody>{caps.map((c, i) => {
          const risk = RISK_RE.test(c.text);
          return (
            <tr key={i}><td className="mono small">{mmss(c.t)}</td><td>{c.text}</td>
              <td><span className={`chip ${risk && c.seen_s < 3 ? 'high' : risk ? 'low' : 'neutral'}`}>{c.seen_s?.toFixed(1)} s</span></td></tr>
          );
        })}</tbody></table> : <Empty>Brak tekstu na ekranie (lub OCR niedostępny).</Empty>}
      </Panel>
    </div>
  );
}


const RET = (c) => `${c.claim}${c.period ? ` ${c.period}` : ''}${c.annual_pct != null ? ` → ≈ ${Math.round(c.annual_pct)}% rocznie` : ''}`;

// Profil publikującego: płatna promocja / podejrzenie oszustwa / doradca + realizm obietnic zysku.
function ProfilePanel({ r, m }) {
  const p = r.profile;
  if (!p) return <Panel title="Profil publikującego"><Empty>Brak profilu – przeanalizuj materiał ponownie.</Empty></Panel>;
  const lic = r.m3?.license;
  return (
    <Panel title="Profil publikującego i wiarygodność oferty" meta="sygnały do weryfikacji, nie ocena prawna">
      <div className="btn-row" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        <ProfileChip type={p.primary} />
        {p.tags.map((t) => <span key={t} className="chip neutral">{t}</span>)}
        <span className={`chip ${p.scam_score >= 55 ? 'high' : p.scam_score >= 30 ? 'mid' : 'low'}`}>sygnały oszustwa: {p.scam_score}/100</span>
      </div>
      <dl className="kv" style={{ marginBottom: 10 }}>
        <dt>Publikujący</dt><dd>{r.m1?.publisher?.name ?? <i>nieustalone</i>} <span className="small muted">({{ firma: 'sama firma', podmiot_trzeci: 'podmiot trzeci', 'własne_usługi': 'strona własna usługodawcy', nieustalone: 'nieustalone' }[r.m1?.publisher?.type] ?? '–'})</span></dd>
        <dt>Zasięg</dt><dd>{m.views != null ? `${fmtCount(m.views)} wyświetleń` : '–'}{m.followers != null ? ` · ${fmtCount(m.followers)} obserwujących` : ''}</dd>
        <dt>Oznaczenie promocji</dt><dd>{p.paid ? 'w materiale widnieje oznaczenie reklamy lub współpracy' : p.affiliate ? 'wykryto kod lub link afiliacyjny bez oznaczenia' : 'nie wykryto oznaczenia ani linku afiliacyjnego'}</dd>
        <dt>Uprawnienia</dt><dd>{lic?.declared ? `zadeklarowane${lic.number ? ` (nr ${lic.number})` : ''} – do weryfikacji w rejestrze KNF` : 'nie deklaruje'}</dd>
        {m.tags?.length > 0 && <><dt>Tagi</dt><dd>{m.tags.map((t) => <Link key={t} to={`/materials?tag=${encodeURIComponent(t)}`} style={{ marginRight: 6 }}>#{t}</Link>)}</dd></>}
      </dl>
      {p.returns?.length > 0 && (
        <>
          <h3>Obietnice zysku (przeliczone na rok)</h3>
          {p.returns.slice(0, 5).map((c, i) => (
            <div key={i} className={`signal ${(c.annual_pct ?? 0) >= 50 || (c.multiplier && c.annual_pct == null) ? '' : 'warn'}`}>
              <b>{RET(c)}</b>{c.historical && <span className="small muted"> (wynik historyczny)</span>}<div className="small muted">„{c.text.slice(0, 220)}”</div>
            </div>
          ))}
          <p className="small muted">Punkt odniesienia: lokaty i obligacje skarbowe – kilka procent rocznie; powyżej ~50% rocznie obietnica jest nierealistyczna.</p>
        </>
      )}
      {p.signals?.length > 0 && (
        <>
          <h3>Sygnały typowe dla oszustw</h3>
          {p.signals.map((s) => (
            <div key={s.key} className={`signal ${s.weight >= 30 ? '' : 'warn'}`}><b>{s.label}</b><div className="small muted">„{(s.evidence[0] ?? '').slice(0, 220)}”</div></div>
          ))}
        </>
      )}
    </Panel>
  );
}

// Ikona edycji (ołówek) – tryb weryfikacji punktów podsumowania
const PencilIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

function Summary({ materialId, analysis, tick, onReviewed }) {
  const { toast } = useLive();
  const { data, reload } = useData(`/summary/${materialId}`, `${tick}-${analysis?.id}`);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const points = data?.points ?? [];
  const rejected = points.filter((p) => p.rejected);
  const startEdit = () => { setDraft(new Set(rejected.map((p) => p.rule_id))); setEditing(true); };
  const toggle = (rule) => setDraft((s) => { const n = new Set(s); n.has(rule) ? n.delete(rule) : n.add(rule); return n; });
  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put(`/materials/${materialId}/review`, { rejected: [...draft] });
      toast({ kind: 'info', title: 'Weryfikacja zapisana', text: r.reviewed_score != null ? `Wynik po weryfikacji: ${Math.round(r.reviewed_score)}/100 (klasyfikator: ${Math.round(r.score)})` : 'Przywrócono wszystkie punkty.' });
      setEditing(false);
      reload();
      onReviewed?.();
    } catch (e) { toast({ kind: 'error', title: 'Weryfikacja', text: e.message }); } finally { setSaving(false); }
  };
  const refresh = async () => {
    setRefreshing(true);
    try { await api.get(`/summary/${materialId}?refresh=1`); await reload(); }
    catch (e) { toast({ kind: 'error', title: 'Nie udało się odświeżyć podsumowania', text: e.message }); }
    finally { setRefreshing(false); }
  };
  const actions = editing
    ? <span className="btn-row"><button className="btn" onClick={() => setEditing(false)}>Anuluj</button><button className="btn primary" disabled={saving} onClick={save}>{saving ? 'Zapisywanie…' : 'Zapisz'}</button></span>
    : <span className="btn-row">
        <button className="icon-btn" title="Edytuj – odrzuć wybrane punkty" aria-label="Edytuj punkty podsumowania" disabled={!points.length} onClick={startEdit}><PencilIcon /></button>
        <button className="btn" disabled={refreshing} onClick={refresh}>{refreshing ? 'Odświeżanie…' : 'Odśwież'}</button>
      </span>;
  return (
    <Panel title="Podsumowanie AI" meta={data ? `silnik: ${data.engine}${data.reviewed_score != null ? ` · po weryfikacji ${Math.round(data.reviewed_score)}/100` : ''}` : ''} actions={actions}>
      {editing ? (
        <>
          <div className="notice" style={{ marginBottom: 10 }}>Odznacz punkty, które po weryfikacji nie są zasadne. Odrzucone nie liczą się do wyniku po weryfikacji ani do podsumowania; decyzja obowiązuje także po ponownej analizie.</div>
          <div className="review-list">
            {points.map((p) => {
              const on = !draft.has(p.rule_id);
              return (
                <label key={p.rule_id} className={`review-item ${on ? '' : 'off'}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(p.rule_id)} />
                  <span><span className="mono"><b>[{p.rule_id}]</b></span> {p.title} <StatusChip status={p.status} />
                    <div className="small muted">{p.explanation}</div></span>
                </label>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className="notice" style={{ marginBottom: 10 }}>Podsumowanie powstaje wyłącznie z ustrukturyzowanych przesłanek; każde zdanie odwołuje się do reguły [ID]. To sygnał do weryfikacji, nie ocena prawna.</div>
          <div className="summary-text">{data?.summary ?? 'Generowanie…'}</div>
          {rejected.length > 0 && (
            <p className="small muted" style={{ marginBottom: 0 }}>Odrzucone przez analityka ({rejected.length}): {rejected.map((p) => `[${p.rule_id}] ${p.title}`).join('; ')}</p>
          )}
        </>
      )}
    </Panel>
  );
}

export default function Material() {
  const { id } = useParams();
  const { tick, toast } = useLive();
  const [tab, setTab] = useState(TABS[0]);
  const [findingModule, setFindingModule] = useState('m2');
  const [busyAction, setBusyAction] = useState('');
  const nav = useNavigate();
  const { data, error, reload } = useData(`/materials/${id}`, tick);
  if (error) return <Empty>{error.message}</Empty>;
  if (!data) return <Empty>Ładowanie…</Empty>;
  const { material: m, analysis: a, findings, entities, history, threshold, risk, similar = [] } = data;
  const rejectedSet = new Set(data.rejected ?? []);
  const r = a?.result ?? {};
  const byModule = (mod) => findings.filter((f) => f.module === mod);
  const act = async (key, label, action) => {
    setBusyAction(key);
    try {
      await action();
      await reload();
      toast({ kind: 'info', title: label, text: m.title || m.url });
    } catch (err) {
      toast({ kind: 'error', title: `Nie udało się: ${label.toLowerCase()}`, text: err.message });
    } finally { setBusyAction(''); }
  };
  const setStatus = (status) => act(`status-${status}`, `Zmieniono status na „${MAT_STATUS[status]}”`,
    () => api.patch(`/materials/${id}/status`, { status }));
  // usunięcie materiału (operacja administratora – okno logowania pojawi się automatycznie)
  const remove = () => {
    if (!window.confirm(`Usunąć materiał „${m.title || m.url}” wraz z analizami i alertami? Tej operacji nie można cofnąć.`)) return;
    api.del(`/materials/${id}`)
      .then(() => { toast({ kind: 'info', title: 'Usunięto materiał', text: m.title || m.url }); nav('/materials'); })
      .catch((err) => { if (err.auth !== 'cancelled') toast({ kind: 'alert', title: 'Nie usunięto materiału', text: err.message }); });
  };
  const reanalyze = () => act('reanalyze', 'Ponowna analiza zakończona', () => api.post(`/materials/${id}/reanalyze`));
  const label = (gt) => act(`label-${gt}`, 'Zapisano etykietę do kalibracji',
    () => api.patch(`/materials/${id}/label`, { ground_truth: gt }));
  const advertisedFirms = entities.filter((entity) => entity.role === 'advertised_firm');
  const publisher = r.m1?.publisher;

  return (
    <>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1>{m.title || '(bez tytułu)'}</h1>
          <p className="truncate" style={{ maxWidth: 760 }}><a href={m.final_url || m.url} target="_blank" rel="noreferrer noopener">{m.final_url || m.url}</a></p>
        </div>
        <div className="btn-row">
          <span className="small muted">Status: <b>{MAT_STATUS[m.status]}</b> · zmień na:</span>
          {[['REVIEWED', 'Zweryfikowany'], ['ESCALATED', 'Eskaluj'], ['DISMISSED', 'Odrzuć']].map(([s, label]) => (
          <button key={s} className={`btn ${m.status === s ? 'selected' : ''}`} aria-pressed={m.status === s} disabled={m.status === s || Boolean(busyAction)}
            title={m.status === s ? 'Obecny status' : `Zmień status na „${MAT_STATUS[s]}”`} onClick={() => setStatus(s)}>{m.status === s ? `✓ ${MAT_STATUS[s]}` : label}</button>
        ))}
          {m.status !== 'NEW' && <button className="btn" disabled={Boolean(busyAction)} onClick={() => setStatus('NEW')}>Przywróć „Nowy”</button>}
          <button className="btn" disabled={Boolean(busyAction)} onClick={reanalyze}>{busyAction === 'reanalyze' ? 'Analizowanie…' : 'Analizuj ponownie'}</button>
          <button className="btn danger" disabled={Boolean(busyAction)} onClick={remove}>Usuń</button>
        </div>
      </div>

      <div className="grid g4">
        <div className="panel stat"><span className="label">Wynik punktowy <HelpTip term="scoring" label="wynik punktowy" /></span><span className="value"><Score score={a?.score} threshold={threshold} /><span className="muted small"> /100</span></span>{m.reviewed_score != null && <span className="sub">po weryfikacji analityka: <b>{Math.round(m.reviewed_score)}</b>/100 <HelpTip term="scoring_review" label="wynik po weryfikacji" /></span>}<ScoreBar score={a?.score} threshold={threshold} /></div>
        <div className="panel stat"><span className="label">Poziom ryzyka <HelpTip term="risk_threshold" label="próg ryzyka" /></span><span><RiskBadge risk={risk} />{data.above_threshold && <span className="chip high" style={{ marginLeft: 6 }}>powyżej progu {threshold}</span>}</span><span className="sub">Alert powstaje po przekroczeniu progu {threshold}. Wynik analizy pozostaje bez zmian.</span></div>
        <div className="panel stat"><span className="label">Status weryfikacji</span><span className="value" style={{ fontSize: '1.2rem' }}>{MAT_STATUS[m.status]}</span><span className="sub">pobrano {fmtDate(m.fetched_at)}</span></div>
        <div className="panel stat"><span className="label">Wyniki modułów</span>
          {Object.entries(a?.module_scores ?? {}).map(([k, v]) => <span key={k} className="small">{MODULES[k]}: <b>{Math.round(v)}</b></span>)}
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Szczegóły materiału" onKeyDown={(event) => moveTab(event, TABS, tab, setTab, (_item, index) => `material-tab-${index}`)}>
        {TABS.map((t, index) => <button key={t} id={`material-tab-${index}`} type="button" role="tab" aria-selected={tab === t} aria-controls="material-tab-content" tabIndex={tab === t ? 0 : -1} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}
      </div>

      <div role="tabpanel" id="material-tab-content" aria-labelledby={`material-tab-${TABS.indexOf(tab)}`} tabIndex={0}>
      {tab === 'Podsumowanie' && (
        <>
          <Summary materialId={id} analysis={a} tick={tick} onReviewed={reload} />
          <div className="grid g2" style={{ marginTop: 16 }}>
            <Panel title="Podmioty powiązane w analizie">
              <div className="notice" style={{ marginBottom: 10 }}>Powiązanie wykryte automatycznie nie potwierdza współpracy ani relacji biznesowej. Każdy wynik wymaga sprawdzenia.</div>
              {entities.length ? <div className="entity-links">{entities.map((entity) => (
                <div key={`${entity.id}-${entity.role}`} className="entity-link-row">
                  <div><Link to={`/entities/${entity.id}`}><b>{entity.name}</b><span className="entity-link-arrow"> — profil podmiotu →</span></Link>
                    <div className="small muted">{{ advertised_firm: 'firma wskazana w analizie materiału', publisher: 'autor lub publikujący', advisor: 'podmiot wskazany przy ofercie doradczej' }[entity.role] ?? 'podmiot wykryty w analizie'}</div>
                  </div>
                  <span className={`chip ${REG[entity.registry_status]?.[0] ?? 'na'}`}>{REG[entity.registry_status]?.[1] ?? 'status nieustalony'}</span>
                </div>
              ))}</div> : <Empty>Nie znaleziono jednoznacznie powiązanego profilu podmiotu. Sama wzmianka o nazwie firmy nie wystarcza do jej przypisania.</Empty>}
            </Panel>
            <Panel title="Oznacz materiał do kalibracji" meta="etykieta testowa">
              <p className="small muted">Twoje oznaczenie pomaga oceniać jakość modelu. Nie zmienia wyniku analizy tego materiału.</p>
              <div className="btn-row">
                <button className={`btn ${m.ground_truth === true ? 'primary' : ''}`} disabled={Boolean(busyAction)} onClick={() => label(true)}>Ryzykowny</button>
                <button className={`btn ${m.ground_truth === false ? 'primary' : ''}`} disabled={Boolean(busyAction)} onClick={() => label(false)}>Poprawny</button>
                <button className="btn" disabled={Boolean(busyAction)} onClick={() => label(null)}>Usuń etykietę</button>
              </div>
              <details className="secondary-details">
                <summary>Informacje dodatkowe</summary>
                <h3>Profil klasyfikatora zdań {r.ml?.model && <span className="mono">({r.ml.model})</span>}</h3>
                <div className="kv">{Object.entries(r.ml?.max ?? {}).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{pct(v)} (maks.)</dd></Fragment>)}</div>
                <h3>Podobne materiały <HelpTip term="simhash" label="podobne materiały" /></h3>
                {similar.length ? <table><tbody>{similar.map((x) => (
                  <tr key={x.id}><td><Link to={`/materials/${x.id}`}>{x.title || x.url}</Link><div className="small muted">{x.platform}{x.author ? ` · ${x.author}` : ''}</div></td>
                    <td><span className={`chip ${x.distance <= 3 ? 'mid' : 'neutral'}`}>{x.distance <= 3 ? 'bardzo podobny' : 'podobny'} · {x.distance} bit</span></td></tr>))}
                </tbody></table> : <p className="small muted">Nie znaleziono podobnych treści.</p>}
              </details>
            </Panel>
          </div>
        </>
      )}

      {tab === 'Przesłanki' && (
        <>
        <div className="tabs sub-tabs" role="tablist" aria-label="Grupa przesłanek" onKeyDown={(event) => moveTab(event, FINDING_MODULES, findingModule, setFindingModule, (item) => `finding-tab-${item[0]}`)}>
          {FINDING_MODULES.map(([key, label]) => <button key={key} id={`finding-tab-${key}`} type="button" role="tab" aria-selected={findingModule === key} aria-controls="finding-tab-content" tabIndex={findingModule === key ? 0 : -1} className={findingModule === key ? 'active' : ''} onClick={() => setFindingModule(key)}>{label}</button>)}
        </div>
        <p className="small muted finding-help">M1 — promocja przez twórcę <HelpTip term="finfluencer" label="finfluencer" /> · M3 — możliwa oferta indywidualnej porady <HelpTip term="shadow_advisory" label="shadow advisory" /></p>
        <div role="tabpanel" id="finding-tab-content" aria-labelledby={`finding-tab-${findingModule}`} tabIndex={0}>
        {findingModule === 'm2' && <Panel title="Informacja o ryzyku" meta={`źródło pomiaru: ${m.layout_engine}`}>
          {m.video && <div className="notice" style={{ marginBottom: 8 }}>Wideo – mowa przepisana przez Whisper, napisy z klatek odczytane OCR. Reguły 4–6 oceniają wielkość, kontrast, położenie w kadrze i czas wyświetlania ostrzeżenia (min. 3 s); ostrzeżenie tylko w mowie oznaczane jest w regule 6.</div>}
          {m.layout_engine === 'ocr' && <div className="notice" style={{ marginBottom: 8 }}>Obraz reklamy (odczyt tekstu OCR) – reguły 4–6 ocenione na podstawie wysokości liter, kontrastu i położenia tekstu na obrazie; reguły 7–8 nie dotyczą obrazu statycznego.</div>}
          {!['playwright', 'ocr', 'video'].includes(m.layout_engine) && !m.video && <div className="notice" style={{ marginBottom: 8 }}>
            {m.layout_reason && m.layout_reason !== 'text_only'
              ? <>Render strony nie powiódł się ({m.layout_reason.replace('playwright_unavailable', 'Playwright niedostępny').replace('render_error', 'błąd renderu')}) – reguły wizualne 4–8 nie zostały ocenione. Użyj „Analizuj ponownie” lub sprawdź status serwisów.</>
              : 'Materiał tekstowy – reguły wizualne 4–8 wymagają renderu strony i nie zostały ocenione.'}</div>}
          {m.consent_hidden > 0 && <div className="small muted" style={{ marginBottom: 8 }}>Przed pomiarem ukryto nakładkę zgody na cookies ({m.consent_hidden}) – nie zasłania ostrzeżeń w ocenie reguły 5.</div>}
          <FindingsTable findings={byModule('m2')} rejected={rejectedSet} />
        </Panel>}
        {findingModule === 'm1' && <div className="grid g2">
          <ProfilePanel r={r} m={m} />
          <Panel title="Przesłanki dotyczące publikującego">
            <dl className="kv" style={{ marginBottom: 12 }}>
              <dt>Publikujący</dt><dd>{publisher?.name ?? <i>nieustalony</i>}</dd>
              <dt>Rola w analizie</dt><dd>{{ firma: 'profil firmowy', podmiot_trzeci: 'podmiot zewnętrzny', 'własne_usługi': 'własna oferta usługodawcy', nieustalone: 'nieustalona' }[publisher?.type] ?? 'nieustalona'}</dd>
              <dt>Platforma</dt><dd>{publisher?.platform ?? m.platform ?? '–'}</dd>
              <dt>Instrumenty</dt><dd>{(r.m1?.instruments ?? []).join(', ') || 'nie wykryto'}</dd>
            </dl>
            <FindingsTable findings={byModule('m1')} rejected={rejectedSet} />
            <h3 className="section-subhead">Podmioty wskazane w analizie</h3>
            <div className="notice" style={{ marginBottom: 10 }}>Wzmianka o firmie lub link afiliacyjny nie potwierdzają zawarcia współpracy.</div>
            {advertisedFirms.length ? <div className="entity-links">{advertisedFirms.map((firm) => (
              <div key={firm.id} className="entity-link-row">
                <div><Link to={`/entities/${firm.id}`}><b>{firm.name}</b><span className="entity-link-arrow"> — zobacz profil →</span></Link>
                  <div className="small muted">Dopasowanie firmy w analizie; nie jest potwierdzeniem współpracy.</div>
                  {firm.krs ? <div className="small">KRS: <span className="mono">{firm.krs}</span>{firm.krs_status === 'found' && <span className="chip pass">odpis dostępny</span>}{firm.krs_status === 'not_found' && <span className="chip warn">nie znaleziono odpisu</span>}{firm.krs_status === 'error' && <span className="chip warn">nie udało się sprawdzić odpisu</span>}</div>
                    : <div className="small muted">Numer KRS nieustalony{firm.krs_status === 'not_found' ? ' — nie znaleziono wpisu w KRS' : firm.krs_status === 'error' ? ' — nie udało się sprawdzić rejestru' : ''}.</div>}
                </div>
                <span className={`chip ${REG[firm.registry_status]?.[0] ?? 'na'}`}>{REG[firm.registry_status]?.[1] ?? 'status KNF nieustalony'}</span>
              </div>
            ))}</div> : <Empty>{(r.m1?.firms ?? []).length ? 'Analiza wskazała nazwy firm, ale nie udało się jednoznacznie dopasować ich do profili podmiotów.' : 'Nie wykryto jednoznacznego powiązania firmy z tym materiałem.'}</Empty>}
          </Panel>
        </div>}
        {findingModule === 'm3' && <div className="grid g2">
          <Panel title="Oferta doradcza">
            <dl className="kv">
              <dt>Wynik oceny</dt><dd><b>{{ indywidualne_doradztwo: 'możliwa oferta indywidualnego doradztwa', 'usługa_doradcza_ogólna': 'usługa doradcza (ogólna)', edukacja: 'materiał edukacyjny', brak: 'nie wykryto cech doradztwa' }[r.m3?.classification] ?? 'nie ustalono'}</b></dd>
              {(r.m3?.entities ?? []).map((e) => <Fragment key={e.name}><dt>{e.name}</dt><dd>{e.registry}</dd></Fragment>)}
            </dl>
            <div className="notice" style={{ marginTop: 10 }}>Brak podmiotu w rejestrze KNF nie oznacza automatycznie nielegalnej działalności – to sygnał do weryfikacji (art. 76 u.o.i.f.).</div>
          </Panel>
          <Panel title="Przesłanki dotyczące doradztwa"><FindingsTable findings={byModule('m3')} rejected={rejectedSet} /></Panel>
        </div>}
        </div>
        </>
      )}

      {tab === 'Publikujący' && (
        <div className="grid g2">
          <ProfilePanel r={r} m={m} />
          <Panel title="Podmioty powiązane w analizie">
            <div className="notice" style={{ marginBottom: 10 }}>Powiązanie automatyczne nie potwierdza współpracy. Sprawdź źródła i dane rejestrowe przed wyciągnięciem wniosków.</div>
            {entities.length ? <div className="entity-links">{entities.map((entity) => (
              <div key={`${entity.id}-${entity.role}`} className="entity-link-row">
                <div><Link to={`/entities/${entity.id}`}><b>{entity.name}</b><span className="entity-link-arrow"> — profil →</span></Link>
                  <div className="small muted">{{ advertised_firm: 'firma wskazana w analizie', publisher: 'autor lub publikujący', advisor: 'podmiot wskazany przy ofercie doradczej' }[entity.role] ?? 'podmiot wykryty w analizie'}</div>
                  {entity.krs && <div className="small">KRS: <span className="mono">{entity.krs}</span></div>}
                  {!entity.krs && <div className="small muted">Numer KRS nieustalony.</div>}
                </div>
                <span className={`chip ${REG[entity.registry_status]?.[0] ?? 'na'}`}>{REG[entity.registry_status]?.[1] ?? 'status nieustalony'}</span>
              </div>
            ))}</div> : <Empty>Brak jednoznacznie dopasowanych podmiotów. Sama wzmianka o firmie nie oznacza współpracy.</Empty>}
          </Panel>
        </div>
      )}

      {tab === 'Materiał' && (
        <div className="grid g2">
          <Panel title={m.layout_engine === 'video' ? 'Klatki wideo z tekstem (OCR)' : m.layout_engine === 'ocr' ? 'Obraz reklamy (OCR)' : 'Zrzut ekranu (desktop)'} meta="ramki: czerwona = ostrzeżenie o ryzyku, niebieska = obietnica zysku">
            {m.screenshot ? <AnnotatedShot src={m.screenshot} vp={m.viewports?.desktop} boxes={r.doc?.highlights ?? []} /> : <Empty>{m.video ? 'Brak tekstu na ekranie – analiza na podstawie mowy.' : 'Brak zrzutu (materiał tekstowy).'}</Empty>}
            {m.image_ocr?.blocks > 0 && <p className="small muted">OCR grafik na stronie: {m.image_ocr.blocks} napisów z {m.image_ocr.images} grafik (banery z tekstem w obrazie).</p>}
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

      {tab === 'Materiał' && m.video && <VideoPanel video={m.video} />}

      {tab === 'Historia' && (
        <Panel title="Historia analiz">
          <table><thead><tr><th>Data</th><th>Wynik</th><th>Moduły</th><th>Wersja analizatora</th><th>Podsumowanie</th></tr></thead>
            <tbody>{history.map((h) => (
              <tr key={h.id}><td>{fmtDate(h.created_at)}</td><td><Score score={h.score} threshold={threshold} /></td><td><ModuleChips modules={h.modules} /></td><td className="mono">{h.analyzer_version}</td><td className="small">{h.summary_engine ?? '–'}</td></tr>))}
            </tbody></table>
        </Panel>
      )}
      </div>
    </>
  );
}

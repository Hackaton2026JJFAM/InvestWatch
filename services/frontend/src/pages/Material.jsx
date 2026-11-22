import { Fragment, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
<<<<<<< HEAD
import { Empty, Evidence, fmtCount, fmtDate, MAT_STATUS, ModuleChips, MODULES, Panel, pct, PROFILE, ProfileChip, RiskBadge, Score, ScoreBar, StatusChip } from '../components/ui.jsx';
=======
import { Empty, Evidence, fmtCount, fmtDate, MAT_STATUS, ModuleChips, MODULES, Panel, pct, ProfileChip, RiskBadge, Score, ScoreBar, StatusChip } from '../components/ui.jsx';
import { HelpTip } from '../components/HelpTip.jsx';
>>>>>>> origin/frontend
import { useData } from '../hooks.js';
import { REG } from './Entities.jsx';
import { useLive } from '../live.jsx';

<<<<<<< HEAD
const TABS = ['Podsumowanie', 'Informacja o ryzyku', 'Reklama i publikujący', 'Doradztwo inwestycyjne', 'Materiał', 'Historia'];
=======
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
>>>>>>> origin/frontend

function FindingsTable({ findings, rejected }) {
  const [onlyIssues, setOnlyIssues] = useState(false);
  const rows = onlyIssues ? findings.filter((f) => f.status === 'fail' || f.status === 'warn') : findings;
  return (
    <>
      <label className="small"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> pokaż tylko problemy</label>
      <div className="table-wrap"><table style={{ marginTop: 8 }}>
        <thead><tr><th>ID</th><th>Co sprawdzamy</th><th>Ocena</th><th>Dlaczego (fragmenty)</th><th>Przepis</th></tr></thead>
        <tbody>{rows.map((f) => (
          <tr key={f.id ?? f.rule_id} style={rejected?.has(f.rule_id) ? { opacity: 0.5 } : undefined}>
            <td className="mono"><b>{f.rule_id}</b></td>
            <td style={{ minWidth: 160 }}>{f.title}</td>
            <td><StatusChip status={f.status} />{rejected?.has(f.rule_id) && <div className="small muted">odznaczone przez analityka</div>}</td>
            <td style={{ minWidth: 320 }}>{f.explanation}<Evidence items={(f.evidence ?? []).filter((e, i) => !rejected?.has(`${f.rule_id}:${e.signal ?? i}`)).slice(0, 3)} />
              {(f.evidence ?? []).some((e, i) => rejected?.has(`${f.rule_id}:${e.signal ?? i}`)) && (
                <div className="small muted">odrzucone elementy: {(f.evidence ?? []).filter((e, i) => rejected?.has(`${f.rule_id}:${e.signal ?? i}`)).map((e) => e.where || e.text.slice(0, 40)).join('; ')}</div>)}</td>
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
function ProfilePanel({ r, m, onChange }) {
  const { toast } = useLive();
  const p = r.profile;
  if (!p) return <Panel title="Profil publikującego"><Empty>Brak profilu – przeanalizuj materiał ponownie.</Empty></Panel>;
  const lic = r.m3?.license;
  const setProfile = (v) => api.put(`/materials/${m.id}/profile`, { profile: v || null })
    .then((x) => { toast({ kind: 'info', title: 'Oznaczenie treści', text: v ? `Ustawiono: ${PROFILE[v].label}` : `Przywrócono klasyfikację automatyczną (${PROFILE[x.profile_type]?.label ?? '–'})` }); onChange?.(); })
    .catch((e) => toast({ kind: 'error', title: 'Oznaczenie treści', text: e.message }));
  const effective = m.profile_type ?? p.primary;
  const choose = (
    <label className="small">Oznacz jako{' '}
      <select value={m.profile_manual ?? ''} onChange={(e) => setProfile(e.target.value)} aria-label="Ręczne oznaczenie typu treści">
        <option value="">automatycznie ({PROFILE[p.primary]?.label ?? p.primary})</option>
        {Object.entries(PROFILE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
    </label>
  );
  return (
    <Panel title="Profil publikującego i wiarygodność oferty" meta="sygnały do weryfikacji, nie ocena prawna" actions={choose}>
      <div className="btn-row" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        <ProfileChip type={effective} />
        {m.profile_manual && <span className="chip neutral">oznaczone ręcznie</span>}
        {!m.profile_manual && effective !== p.primary && <span className="chip neutral">po weryfikacji analityka</span>}
        {p.tags.map((t) => <span key={t} className="chip neutral">{t}</span>)}
        <span className={`chip ${p.scam_score >= 55 ? 'high' : p.scam_score >= 30 ? 'mid' : 'low'}`}>sygnały oszustwa: {p.scam_score}/100</span>
        {m.scam_score != null && Number(m.scam_score) !== p.scam_score && <span className="chip neutral">po weryfikacji: {Math.round(m.scam_score)}/100</span>}
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

// Ikony: edycja (ołówek), dodawanie (plus), usuwanie (kosz)
const PencilIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);
const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
);
const TrashIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" />
  </svg>
);

const SEVERITY = [[20, 'niska'], [40, 'średnia'], [60, 'wysoka'], [80, 'bardzo wysoka']];
const MODULE_SHORT = { m1: 'Reklama i publikujący', m2: 'Informacja o ryzyku', m3: 'Doradztwo inwestycyjne' };

// Ręczne dodanie problemu (np. fragment filmu, którego automat nie wychwycił)
function AddProblem({ materialId, isVideo, onDone, onCancel }) {
  const { toast } = useLive();
  const [f, setF] = useState({ module: 'm2', title: '', severity: 40, fragment: '', at: '', explanation: '' });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await api.post(`/materials/${materialId}/manual-findings`, { ...f, severity: Number(f.severity) });
      toast({ kind: 'info', title: 'Dodano problem', text: `Wynik po weryfikacji: ${Math.round(r.reviewed_score)}/100` });
      onDone();
    } catch (err) { toast({ kind: 'error', title: 'Nie dodano problemu', text: err.message }); } finally { setSaving(false); }
  };
  return (
    <form className="add-problem" onSubmit={submit}>
      <div className="grid g2" style={{ gap: 8 }}>
        <label className="f">Czego dotyczy<select value={f.module} onChange={set('module')}>
          {Object.entries(MODULE_SHORT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="f">Waga<select value={f.severity} onChange={set('severity')}>
          {SEVERITY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      </div>
      <label className="f">Problem<input required minLength={3} maxLength={200} value={f.title} onChange={set('title')} placeholder="np. Obietnica zysku bez ostrzeżenia o ryzyku" /></label>
      <div className="grid g2" style={{ gap: 8, gridTemplateColumns: isVideo ? '1fr 120px' : '1fr' }}>
        <label className="f">Fragment (cytat){' '}<input maxLength={1000} value={f.fragment} onChange={set('fragment')} placeholder="np. „gwarantuję 20% miesięcznie”" /></label>
        {isVideo && <label className="f">Moment w filmie<input maxLength={20} value={f.at} onChange={set('at')} placeholder="np. 0:42" /></label>}
      </div>
      <label className="f">Komentarz (opcjonalnie)<input maxLength={1000} value={f.explanation} onChange={set('explanation')} /></label>
      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onCancel}>Anuluj</button>
        <button className="btn primary" disabled={saving}>{saving ? 'Dodawanie…' : 'Dodaj problem'}</button>
      </div>
    </form>
  );
}

// Wynik po weryfikacji z rozbiciem na moduły – wynik ogólny to najwyższy wynik modułu
function ScoreBreakdown({ score, reviewed, modules, reviewedModules }) {
  const after = reviewed ?? score;
  const mods = reviewedModules ?? modules ?? {};
  const top = Object.entries(mods).sort((a, b) => b[1] - a[1])[0];
  return (
    <div className="score-breakdown">
      <div><span className="muted small">Wynik</span>{' '}
        {reviewed != null && Math.round(reviewed) !== Math.round(score)
          ? <><s className="muted">{Math.round(score)}</s> → <b>{Math.round(after)}</b>/100</>
          : <b>{Math.round(after)}/100</b>}
      </div>
      <div className="small">
        {Object.entries(mods).map(([k, v]) => (
          <span key={k} className={`chip ${top && k === top[0] && v > 0 ? 'brand' : 'neutral'}`} style={{ marginRight: 6 }}>
            {MODULE_SHORT[k] ?? k}: {modules?.[k] != null && Math.round(modules[k]) !== Math.round(v) ? <><s>{Math.round(modules[k])}</s> → </> : null}<b>{Math.round(v)}</b>
          </span>))}
      </div>
      <div className="small muted">Wynik ogólny = najwyższy wynik spośród obszarów. Żeby go obniżyć, trzeba odznaczyć punkty w obszarze, który ma teraz najwyższy wynik{top ? ` (${MODULE_SHORT[top[0]] ?? top[0]})` : ''}.</div>
    </div>
  );
}

function Summary({ materialId, analysis, tick, onReviewed, isVideo }) {
  const { toast } = useLive();
  const { data, reload } = useData(`/summary/${materialId}`, `${tick}-${analysis?.id}`);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(new Set());
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const points = data?.points ?? [];
  const auto = points.filter((p) => !p.manual);
  const manual = points.filter((p) => p.manual);
  const rejected = auto.filter((p) => p.rejected);
  const rejectedEls = auto.flatMap((p) => (p.rejected ? [] : (p.elements ?? []).filter((e) => e.rejected).map((e) => ({ ...e, point: p }))));
  const draftKey = [...draft].sort().join('|');
  // podgląd wyniku na żywo podczas odznaczania (bez zapisu)
  useEffect(() => {
    if (!editing) return undefined;
    let alive = true;
    const t = setTimeout(() => {
      api.put(`/materials/${materialId}/review?dry=1`, { rejected: draftKey ? draftKey.split('|') : [] })
        .then((r) => { if (alive) setPreview(r); }).catch(() => {});
    }, 150);
    return () => { alive = false; clearTimeout(t); };
  }, [editing, draftKey, materialId]);
  const startEdit = () => {
    setDraft(new Set([...rejected.map((p) => p.rule_id), ...auto.flatMap((p) => (p.elements ?? []).filter((e) => e.rejected).map((e) => e.key))]));
    setPreview(null);
    setEditing(true);
  };
  const toggle = (rule) => setDraft((s) => { const n = new Set(s); n.has(rule) ? n.delete(rule) : n.add(rule); return n; });
  const done = () => { reload(); onReviewed?.(); };
  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put(`/materials/${materialId}/review`, { rejected: [...draft] });
      toast({ kind: 'info', title: 'Weryfikacja zapisana', text: r.reviewed_score != null ? `Nowy wynik: ${Math.round(r.reviewed_score)}/100 (automat: ${Math.round(r.score)})` : 'Przywrócono wynik automatyczny.' });
      setEditing(false);
      done();
    } catch (e) { toast({ kind: 'error', title: 'Weryfikacja', text: e.message }); } finally { setSaving(false); }
  };
<<<<<<< HEAD
  const removeManual = async (p) => {
    if (!window.confirm(`Usunąć problem „${p.title}”?`)) return;
    try { await api.del(`/materials/${materialId}/manual-findings/${p.id}`); done(); } catch (e) { toast({ kind: 'error', title: 'Nie usunięto', text: e.message }); }
  };
  const byModule = (list) => Object.keys(MODULE_SHORT).map((m) => [m, list.filter((p) => p.module === m)]).filter(([, l]) => l.length);
  const addBtn = <button className="icon-btn" title="Dodaj problem ręcznie" aria-label="Dodaj problem ręcznie" onClick={() => setAdding(true)}><PlusIcon /></button>;
=======
  const refresh = async () => {
    setRefreshing(true);
    try { await api.get(`/summary/${materialId}?refresh=1`); await reload(); }
    catch (e) { toast({ kind: 'error', title: 'Nie udało się odświeżyć podsumowania', text: e.message }); }
    finally { setRefreshing(false); }
  };
>>>>>>> origin/frontend
  const actions = editing
    ? <span className="btn-row">{addBtn}<button className="btn" onClick={() => setEditing(false)}>Anuluj</button><button className="btn primary" disabled={saving} onClick={save}>{saving ? 'Zapisywanie…' : 'Zapisz'}</button></span>
    : <span className="btn-row">
<<<<<<< HEAD
        {addBtn}
        <button className="icon-btn" title="Edytuj – odznacz źle rozpoznane punkty" aria-label="Edytuj punkty podsumowania" disabled={!points.length} onClick={startEdit}><PencilIcon /></button>
        <button className="btn" onClick={() => api.get(`/summary/${materialId}?refresh=1`).then(reload)}>Odśwież</button>
=======
        <button className="icon-btn" title="Edytuj – odrzuć wybrane punkty" aria-label="Edytuj punkty podsumowania" disabled={!points.length} onClick={startEdit}><PencilIcon /></button>
        <button className="btn" disabled={refreshing} onClick={refresh}>{refreshing ? 'Odświeżanie…' : 'Odśwież'}</button>
>>>>>>> origin/frontend
      </span>;
  const manualRow = (p) => (
    <div key={p.rule_id} className="review-item manual">
      <span className="chip brand">dodane ręcznie</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div><b>{p.title}</b> <span className="muted small">· {MODULE_SHORT[p.module]} · waga {SEVERITY.find(([v]) => v === p.severity)?.[1] ?? p.severity}</span></div>
        {p.fragment && <div className="small muted">„{p.fragment}”</div>}
      </div>
      <button className="icon-btn" title="Usuń problem" aria-label={`Usuń problem ${p.title}`} onClick={() => removeManual(p)}><TrashIcon /></button>
    </div>
  );
  return (
    <Panel title="Podsumowanie" meta={data ? `silnik: ${data.engine}` : ''} actions={actions}>
      {adding && <AddProblem materialId={materialId} isVideo={isVideo} onCancel={() => setAdding(false)} onDone={() => { setAdding(false); done(); }} />}
      {editing ? (
        <>
          <div className="notice" style={{ marginBottom: 10 }}>Odznacz punkty albo pojedyncze elementy (np. źle rozpoznany fragment transkrypcji), które są błędne. Wynik poniżej zmienia się od razu; po zapisaniu zastępuje wynik automatyczny.</div>
          <ScoreBreakdown score={data?.score} reviewed={preview ? preview.reviewed_score : data?.reviewed_score}
            modules={data?.module_scores} reviewedModules={preview ? preview.reviewed_modules : data?.reviewed_modules} />
          {byModule(auto).map(([mod, list]) => (
            <div key={mod} style={{ marginTop: 12 }}>
              <h3 style={{ margin: '0 0 6px' }}>{MODULE_SHORT[mod]}</h3>
              <div className="review-list">
                {list.map((p) => {
                  const on = !draft.has(p.rule_id);
                  return (
                    <div key={p.rule_id} className={`review-item ${on ? '' : 'off'}`}>
                      <input id={`rv-${p.rule_id}`} type="checkbox" checked={on} onChange={() => toggle(p.rule_id)} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <label htmlFor={`rv-${p.rule_id}`} style={{ cursor: 'pointer' }}><span className="mono"><b>[{p.rule_id}]</b></span> {p.title} <StatusChip status={p.status} /></label>
                        <div className="small muted">{p.explanation}</div>
                        {p.elements?.length > 0 && (
                          <div className="review-sub">
                            {p.elements.map((e) => {
                              const eon = on && !draft.has(e.key);
                              return (
                                <label key={e.key} className={`review-el ${eon ? '' : 'off'}`}>
                                  <input type="checkbox" disabled={!on} checked={eon} onChange={() => toggle(e.key)} />
                                  <span><b>{e.where}</b>{e.weight ? <span className="muted"> · waga {e.weight}</span> : null}
                                    <div className="small muted">„{(e.text ?? '').slice(0, 200)}”</div></span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {manual.length > 0 && <div style={{ marginTop: 12 }}><h3 style={{ margin: '0 0 6px' }}>Dodane ręcznie</h3><div className="review-list">{manual.map(manualRow)}</div></div>}
        </>
      ) : (
        <>
          <div className="notice" style={{ marginBottom: 10 }}>Podsumowanie opisuje wykryte problemy; numer w nawiasie [ID] wskazuje regułę. To wskazówka do sprawdzenia, nie ocena prawna.</div>
          {data?.reviewed_score != null && <ScoreBreakdown score={data.score} reviewed={data.reviewed_score} modules={data.module_scores} reviewedModules={data.reviewed_modules} />}
          <div className="summary-text">{data?.summary ?? 'Generowanie…'}</div>
          {manual.length > 0 && <div style={{ marginTop: 10 }}><h3 style={{ margin: '0 0 6px' }}>Problemy dodane ręcznie</h3><div className="review-list">{manual.map(manualRow)}</div></div>}
          {rejected.length > 0 && (
            <p className="small muted" style={{ marginBottom: 0 }}>Odznaczone przez analityka ({rejected.length}): {rejected.map((p) => `[${p.rule_id}] ${p.title}`).join('; ')}</p>
          )}
          {rejectedEls.length > 0 && (
            <p className="small muted" style={{ marginBottom: 0 }}>Odznaczone elementy ({rejectedEls.length}): {rejectedEls.map((e) => `[${e.point.rule_id}] ${e.where}`).join('; ')}</p>
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
  const score = data.effective_score ?? a?.score;
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
<<<<<<< HEAD
          {[['IN_REVIEW', 'W trakcie weryfikacji'], ['REVIEWED', 'Zweryfikowany'], ['ESCALATED', 'Eskaluj'], ['DISMISSED', 'Odrzuć']].map(([s, label]) => (
            <button key={s} className={`btn ${m.status === s ? 'selected' : ''}`} aria-pressed={m.status === s} disabled={m.status === s}
              title={m.status === s ? 'Obecny status' : `Zmień status na „${MAT_STATUS[s]}”`} onClick={() => setStatus(s)}>{m.status === s ? `✓ ${MAT_STATUS[s]}` : label}</button>
          ))}
          {m.status !== 'NEW' && <button className="btn" onClick={() => setStatus('NEW')}>Przywróć „Nowy”</button>}
          <button className="btn" onClick={reanalyze}>Analizuj ponownie</button>
          <button className="btn danger" onClick={remove}>Usuń</button>
=======
          {[['REVIEWED', 'Zweryfikowany'], ['ESCALATED', 'Eskaluj'], ['DISMISSED', 'Odrzuć']].map(([s, label]) => (
          <button key={s} className={`btn ${m.status === s ? 'selected' : ''}`} aria-pressed={m.status === s} disabled={m.status === s || Boolean(busyAction)}
            title={m.status === s ? 'Obecny status' : `Zmień status na „${MAT_STATUS[s]}”`} onClick={() => setStatus(s)}>{m.status === s ? `✓ ${MAT_STATUS[s]}` : label}</button>
        ))}
          {m.status !== 'NEW' && <button className="btn" disabled={Boolean(busyAction)} onClick={() => setStatus('NEW')}>Przywróć „Nowy”</button>}
          <button className="btn" disabled={Boolean(busyAction)} onClick={reanalyze}>{busyAction === 'reanalyze' ? 'Analizowanie…' : 'Analizuj ponownie'}</button>
          <button className="btn danger" disabled={Boolean(busyAction)} onClick={remove}>Usuń</button>
>>>>>>> origin/frontend
        </div>
      </div>

      <div className="grid g4">
<<<<<<< HEAD
        <div className="panel stat"><span className="label">Ocena ryzyka{m.reviewed_score != null ? ' (po weryfikacji)' : ''}</span><span className="value"><Score score={score} threshold={threshold} /><span className="muted small"> /100</span></span>{m.reviewed_score != null && <span className="sub">automat: <s>{Math.round(a?.score)}</s> · zmieniona przez analityka</span>}<ScoreBar score={score} threshold={threshold} /></div>
        <div className="panel stat"><span className="label">Poziom ryzyka (skala 0–100)</span><span><RiskBadge risk={risk} />{data.above_threshold && <span className="chip high" style={{ marginLeft: 6 }}>powyżej progu {threshold}</span>}</span><span className="sub">Moduły: <ModuleChips modules={a?.modules} /></span></div>
        <div className="panel stat"><span className="label">Status weryfikacji</span><span className="value" style={{ fontSize: '1.2rem' }}>{MAT_STATUS[m.status]}</span><span className="sub">opublikowano: <b>{m.published_at ? fmtDate(m.published_at) : 'brak danych'}</b> · pobrano {fmtDate(m.fetched_at)}</span></div>
        <div className="panel stat"><span className="label">Wyniki obszarów</span>
          {Object.entries(m.reviewed_modules ?? a?.module_scores ?? {}).map(([k, v]) => <span key={k} className="small">{MODULES[k]}: <b>{Math.round(v)}</b></span>)}
=======
        <div className="panel stat"><span className="label">Wynik punktowy <HelpTip term="scoring" label="wynik punktowy" /></span><span className="value"><Score score={a?.score} threshold={threshold} /><span className="muted small"> /100</span></span>{m.reviewed_score != null && <span className="sub">po weryfikacji analityka: <b>{Math.round(m.reviewed_score)}</b>/100 <HelpTip term="scoring_review" label="wynik po weryfikacji" /></span>}<ScoreBar score={a?.score} threshold={threshold} /></div>
        <div className="panel stat"><span className="label">Poziom ryzyka <HelpTip term="risk_threshold" label="próg ryzyka" /></span><span><RiskBadge risk={risk} />{data.above_threshold && <span className="chip high" style={{ marginLeft: 6 }}>powyżej progu {threshold}</span>}</span><span className="sub">Alert powstaje po przekroczeniu progu {threshold}. Wynik analizy pozostaje bez zmian.</span></div>
        <div className="panel stat"><span className="label">Status weryfikacji</span><span className="value" style={{ fontSize: '1.2rem' }}>{MAT_STATUS[m.status]}</span><span className="sub">pobrano {fmtDate(m.fetched_at)}</span></div>
        <div className="panel stat"><span className="label">Wyniki modułów</span>
          {Object.entries(a?.module_scores ?? {}).map(([k, v]) => <span key={k} className="small">{MODULES[k]}: <b>{Math.round(v)}</b></span>)}
>>>>>>> origin/frontend
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Szczegóły materiału" onKeyDown={(event) => moveTab(event, TABS, tab, setTab, (_item, index) => `material-tab-${index}`)}>
        {TABS.map((t, index) => <button key={t} id={`material-tab-${index}`} type="button" role="tab" aria-selected={tab === t} aria-controls="material-tab-content" tabIndex={tab === t ? 0 : -1} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}
      </div>

      <div role="tabpanel" id="material-tab-content" aria-labelledby={`material-tab-${TABS.indexOf(tab)}`} tabIndex={0}>
      {tab === 'Podsumowanie' && (
<<<<<<< HEAD
        <div className="grid g2">
          <Summary materialId={id} analysis={a} tick={tick} onReviewed={reload} isVideo={Boolean(m.video)} />
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

      {tab === 'Informacja o ryzyku' && (
        <Panel title="18 reguł UKNF – informacja o ryzyku" meta={`render: ${m.layout_engine}`}>
=======
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
>>>>>>> origin/frontend
          {m.video && <div className="notice" style={{ marginBottom: 8 }}>Wideo – mowa przepisana przez Whisper, napisy z klatek odczytane OCR. Reguły 4–6 oceniają wielkość, kontrast, położenie w kadrze i czas wyświetlania ostrzeżenia (min. 3 s); ostrzeżenie tylko w mowie oznaczane jest w regule 6.</div>}
          {m.layout_engine === 'ocr' && <div className="notice" style={{ marginBottom: 8 }}>Obraz reklamy (odczyt tekstu OCR) – reguły 4–6 ocenione na podstawie wysokości liter, kontrastu i położenia tekstu na obrazie; reguły 7–8 nie dotyczą obrazu statycznego.</div>}
          {!['playwright', 'ocr', 'video'].includes(m.layout_engine) && !m.video && <div className="notice" style={{ marginBottom: 8 }}>
            {m.layout_reason && m.layout_reason !== 'text_only'
              ? <>Render strony nie powiódł się ({m.layout_reason.replace('playwright_unavailable', 'Playwright niedostępny').replace('render_error', 'błąd renderu')}) – reguły wizualne 4–8 nie zostały ocenione. Użyj „Analizuj ponownie” lub sprawdź status serwisów.</>
              : 'Materiał tekstowy – reguły wizualne 4–8 wymagają renderu strony i nie zostały ocenione.'}</div>}
          {m.consent_hidden > 0 && <div className="small muted" style={{ marginBottom: 8 }}>Przed pomiarem ukryto nakładkę zgody na cookies ({m.consent_hidden}) – nie zasłania ostrzeżeń w ocenie reguły 5.</div>}
          <FindingsTable findings={byModule('m2')} rejected={rejectedSet} />
<<<<<<< HEAD
        </Panel>
      )}

      {tab === 'Reklama i publikujący' && (
        <div className="grid g2">
          <Panel title="Reklamowana firma i reklamujący">
            <dl className="kv">
              <dt>Publikujący</dt><dd>{r.m1?.publisher?.name ?? <i>nieustalone</i>}</dd>
              <dt>Typ publikującego</dt><dd>{{ firma: 'sama firma inwestycyjna', podmiot_trzeci: 'podmiot trzeci / finfluencer', nieustalone: 'nieustalone (do ręcznej weryfikacji)' }[r.m1?.publisher?.type]}</dd>
              <dt>Platforma</dt><dd>{r.m1?.publisher?.platform}</dd>
              <dt>Firmy z rejestru</dt><dd>{(r.m1?.firms ?? []).map((f) => f.name + (f.demo ? ' [DEMO]' : '')).join(', ') || '–'}</dd>
              <dt>Instrumenty</dt><dd>{(r.m1?.instruments ?? []).join(', ') || '–'}</dd>
              <dt>URL</dt><dd className="mono">{m.url}</dd>
=======
        </Panel>}
        {findingModule === 'm1' && <div className="grid g2">
          <ProfilePanel r={r} m={m} />
          <Panel title="Przesłanki dotyczące publikującego">
            <dl className="kv" style={{ marginBottom: 12 }}>
              <dt>Publikujący</dt><dd>{publisher?.name ?? <i>nieustalony</i>}</dd>
              <dt>Rola w analizie</dt><dd>{{ firma: 'profil firmowy', podmiot_trzeci: 'podmiot zewnętrzny', 'własne_usługi': 'własna oferta usługodawcy', nieustalone: 'nieustalona' }[publisher?.type] ?? 'nieustalona'}</dd>
              <dt>Platforma</dt><dd>{publisher?.platform ?? m.platform ?? '–'}</dd>
              <dt>Instrumenty</dt><dd>{(r.m1?.instruments ?? []).join(', ') || 'nie wykryto'}</dd>
>>>>>>> origin/frontend
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
<<<<<<< HEAD
          <Panel title="Wykryte problemy – reklama i publikujący"><FindingsTable findings={byModule('m1')} rejected={rejectedSet} /></Panel>
        </div>
      )}
      {tab === 'Reklama i publikujący' && (
        <div style={{ marginTop: 12 }}><ProfilePanel r={r} m={m} onChange={reload} /></div>
      )}

      {tab === 'Doradztwo inwestycyjne' && (
        <div className="grid g2">
          <Panel title="Klasyfikacja oferty">
=======
        </div>}
        {findingModule === 'm3' && <div className="grid g2">
          <Panel title="Oferta doradcza">
>>>>>>> origin/frontend
            <dl className="kv">
              <dt>Wynik oceny</dt><dd><b>{{ indywidualne_doradztwo: 'możliwa oferta indywidualnego doradztwa', 'usługa_doradcza_ogólna': 'usługa doradcza (ogólna)', edukacja: 'materiał edukacyjny', brak: 'nie wykryto cech doradztwa' }[r.m3?.classification] ?? 'nie ustalono'}</b></dd>
              {(r.m3?.entities ?? []).map((e) => <Fragment key={e.name}><dt>{e.name}</dt><dd>{e.registry}</dd></Fragment>)}
            </dl>
            <div className="notice" style={{ marginTop: 10 }}>Brak podmiotu w rejestrze KNF nie oznacza automatycznie nielegalnej działalności – to sygnał do weryfikacji (art. 76 u.o.i.f.).</div>
          </Panel>
<<<<<<< HEAD
          <Panel title="Wykryte problemy – doradztwo"><FindingsTable findings={byModule('m3')} rejected={rejectedSet} /></Panel>
=======
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
>>>>>>> origin/frontend
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

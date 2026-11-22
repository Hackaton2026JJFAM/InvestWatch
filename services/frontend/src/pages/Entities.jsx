import { Link } from 'react-router-dom';
import { useState } from 'react';
import { api } from '../api.js';
import { Empty, Panel, RecordDetails, Score } from '../components/ui.jsx';
import { useData } from '../hooks.js';
import { useLive } from '../live.jsx';

export const KIND = { company: 'spółka', influencer: 'finfluencer', person: 'osoba', unknown: 'autor / wydawca' };
export const REG = { registered: ['pass', 'w rejestrze KNF'], demo: ['mid', 'DEMO – podmiot fikcyjny'], not_found: ['warn', 'brak w rejestrze KNF'], unknown: ['na', 'nie sprawdzono'] };

export const CATEGORY = { spolka: 'spółka', doradca: 'podmiot doradczy' };

// Oznaczenie podmiotu: spółka / podmiot doradczy, potwierdzony / niepotwierdzony; zatwierdzenie ręczne przez analityka.
// Spółka z numerem KRS polskiej spółki jest potwierdzana automatycznie; podmiot doradczy (finfluencer, autor) – tylko ręcznie.
export function EntityVerification({ entity, onChange, compact = false }) {
  const { toast } = useLive();
  const [busy, setBusy] = useState(false);
  const set = async (body, msg) => {
    setBusy(true);
    try { const r = await api.patch(`/entities/${entity.id}/verification`, body); toast({ kind: 'info', title: entity.name, text: msg }); onChange?.(r); }
    catch (e) { toast({ kind: 'error', title: 'Nie zapisano oznaczenia', text: e.message }); }
    finally { setBusy(false); }
  };
  const cat = CATEGORY[entity.category] ?? 'podmiot';
  const end = entity.category === 'spolka' ? 'a' : 'y';   // spółka – potwierdzona, podmiot doradczy – potwierdzony
  const label = entity.verified
    ? `${cat} – potwierdzon${end}${entity.verified_source === 'krs' && entity.krs ? ` (KRS ${entity.krs})` : entity.verified_source === 'manual' ? ' ręcznie' : ''}`
    : `${cat} – niepotwierdzon${end}`;
  const other = entity.category === 'spolka' ? 'doradca' : 'spolka';
  return (
    <span className="btn-row" style={{ gap: 6, flexWrap: 'wrap' }}>
      <span className={`chip ${entity.verified ? 'pass' : 'warn'}`} title={entity.verified_source === 'krs' ? 'Potwierdzone automatycznie – numer KRS polskiej spółki' : entity.verified_source === 'manual' ? 'Zatwierdzone ręcznie przez analityka' : 'Wymaga ręcznego zatwierdzenia'}>{label}</span>
      {entity.verified
        ? <button className="btn" disabled={busy} onClick={() => set({ verified: false }, 'Oznaczono jako niepotwierdzony')} title="Cofnij potwierdzenie">Cofnij</button>
        : <button className="btn primary" disabled={busy} onClick={() => set({ verified: true }, 'Zatwierdzono ręcznie')} title="Zatwierdź podmiot ręcznie">Zatwierdź</button>}
      {!compact && <button className="btn" disabled={busy} onClick={() => set({ category: other }, `Zmieniono na: ${CATEGORY[other]}`)} title="Zmień kategorię podmiotu">→ {CATEGORY[other]}</button>}
      {!compact && entity.verified_source === 'manual' && <button className="btn" disabled={busy} onClick={() => set({ verified: null, category: null }, 'Przywrócono oznaczenie automatyczne')} title="Usuń ręczną decyzję">↺ automatycznie</button>}
    </span>
  );
}


export default function Entities() {
  const { tick, threshold } = useLive();
  const { data, error, reload } = useData('/entities', tick);
  const [category, setCategory] = useState('');
  const [verified, setVerified] = useState('');
  const [query, setQuery] = useState('');
  const [registry, setRegistry] = useState('');
  const [order, setOrder] = useState('score');
  const rows = (data ?? []).filter((e) => e.name.toLocaleLowerCase('pl').includes(query.toLocaleLowerCase('pl')) && (!registry || e.registry_status === registry) && (!category || e.category === category) && (!verified || String(Boolean(e.verified)) === verified)).sort((a, b) => order === 'name' ? a.name.localeCompare(b.name, 'pl') : order === 'materials' ? Number(b.materials) - Number(a.materials) : (b.max_score ?? -1) - (a.max_score ?? -1));
  return (
    <>
      <div className="page-head"><div><h1>Podmioty</h1><p>Firmy inwestycyjne, reklamujący i podmioty doradcze wykryte w materiałach</p></div></div>
      <Panel>
        <div className="filters">
          <label className="f search-filter">Nazwa podmiotu<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Wyszukaj firmę lub autora…" /></label>
          <label className="f">Status rejestrowy<select value={registry} onChange={(e) => setRegistry(e.target.value)}><option value="">Wszystkie</option>{Object.entries(REG).map(([key, value]) => <option key={key} value={key}>{value[1]}</option>)}</select></label>
          <label className="f">Rodzaj<select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Wszystkie</option>{Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="f">Potwierdzenie<select value={verified} onChange={(e) => setVerified(e.target.value)}><option value="">Wszystkie</option><option value="true">potwierdzone</option><option value="false">niepotwierdzone</option></select></label>
          <label className="f">Sortuj<select value={order} onChange={(e) => setOrder(e.target.value)}><option value="score">Najwyższy wynik</option><option value="materials">Liczba materiałów</option><option value="name">Nazwa A–Z</option></select></label>
          {(query || registry || category || verified) && <button className="btn clear-filters" onClick={() => { setQuery(''); setRegistry(''); setCategory(''); setVerified(''); }}>Wyczyść filtry</button>}
        </div>
        <p className="small muted">Każdy podmiot jest spółką albo podmiotem doradczym (finfluencerzy, autorzy, oferty doradcze). Spółka z numerem KRS polskiej spółki jest potwierdzana automatycznie, pozostałe zatwierdza analityk. Automatyczne dopasowanie nie potwierdza współpracy z publikującym.</p>
        {!data && !error && <Empty>Ładowanie podmiotów…</Empty>}
        {error && <Empty>{error.message}</Empty>}
        {data && (rows.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Nazwa</th><th>Oznaczenie</th><th>Rejestr</th><th>Materiały</th><th>Maks. wynik</th></tr></thead>
            <tbody>{rows.map((e) => (
              <tr key={e.id}>
                <td><Link to={`/entities/${e.id}`}>{e.name}</Link><RecordDetails context={e.name} fields={ [['Rodzaj', KIND[e.kind] ?? e.kind]] }>Maksymalny wynik dotyczy powiązanych materiałów, nie oceny prawnej podmiotu. <Link to={`/entities/${e.id}`}>Pełny profil →</Link></RecordDetails></td>
                <td><EntityVerification entity={e} onChange={reload} compact /></td>
                <td><span className={`chip ${REG[e.registry_status]?.[0]}`}>{REG[e.registry_status]?.[1]}</span></td>
                <td>{e.materials}</td><td><Score score={e.max_score} threshold={threshold} /></td>
              </tr>))}
            </tbody>
          </table></div>
        ) : <Empty>Brak podmiotów dla wybranych kryteriów.</Empty>)}
      </Panel>
    </>
  );
}

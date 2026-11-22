import { Link } from 'react-router-dom';
import { useState } from 'react';
import { Empty, Panel, RecordDetails, Score } from '../components/ui.jsx';
import { useData } from '../hooks.js';
import { useLive } from '../live.jsx';

export const KIND = { company: 'spółka', influencer: 'finfluencer', person: 'osoba', unknown: 'autor / wydawca' };
export const REG = { registered: ['pass', 'w rejestrze KNF'], demo: ['mid', 'DEMO – podmiot fikcyjny'], not_found: ['warn', 'brak w rejestrze KNF'], unknown: ['na', 'nie sprawdzono'] };

export default function Entities() {
  const { tick, threshold } = useLive();
  const { data, error } = useData('/entities', tick);
  const [query, setQuery] = useState('');
  const [registry, setRegistry] = useState('');
  const [order, setOrder] = useState('score');
  const rows = (data ?? []).filter((e) => e.name.toLocaleLowerCase('pl').includes(query.toLocaleLowerCase('pl')) && (!registry || e.registry_status === registry)).sort((a, b) => order === 'name' ? a.name.localeCompare(b.name, 'pl') : order === 'materials' ? Number(b.materials) - Number(a.materials) : (b.max_score ?? -1) - (a.max_score ?? -1));
  return (
    <>
      <div className="page-head"><div><h1>Podmioty</h1><p>Firmy inwestycyjne, reklamujący i podmioty doradcze wykryte w materiałach</p></div></div>
      <Panel>
        <div className="filters">
          <label className="f search-filter">Nazwa podmiotu<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Wyszukaj firmę lub autora…" /></label>
          <label className="f">Status rejestrowy<select value={registry} onChange={(e) => setRegistry(e.target.value)}><option value="">Wszystkie</option>{Object.entries(REG).map(([key, value]) => <option key={key} value={key}>{value[1]}</option>)}</select></label>
          <label className="f">Sortuj<select value={order} onChange={(e) => setOrder(e.target.value)}><option value="score">Najwyższy wynik</option><option value="materials">Liczba materiałów</option><option value="name">Nazwa A–Z</option></select></label>
          {(query || registry) && <button className="btn clear-filters" onClick={() => { setQuery(''); setRegistry(''); }}>Wyczyść filtry</button>}
        </div>
        <p className="small muted">Automatyczne dopasowanie nie potwierdza współpracy z publikującym.</p>
        {!data && !error && <Empty>Ładowanie podmiotów…</Empty>}
        {error && <Empty>{error.message}</Empty>}
        {data && (rows.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Nazwa</th><th>Rejestr</th><th>Materiały</th><th>Maks. wynik</th></tr></thead>
            <tbody>{rows.map((e) => (
              <tr key={e.id}>
                <td><Link to={`/entities/${e.id}`}>{e.name}</Link><RecordDetails context={e.name} fields={ [['Rodzaj', KIND[e.kind] ?? e.kind]] }>Maksymalny wynik dotyczy powiązanych materiałów, nie oceny prawnej podmiotu. <Link to={`/entities/${e.id}`}>Pełny profil →</Link></RecordDetails></td>
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

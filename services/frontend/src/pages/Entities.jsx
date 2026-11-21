import { useNavigate } from 'react-router-dom';
import { Empty, Panel, Score } from '../components/ui.jsx';
import { useData } from '../hooks.js';
import { useLive } from '../live.jsx';

export const KIND = { company: 'spółka', influencer: 'finfluencer', person: 'osoba', unknown: 'autor / wydawca' };
export const REG = { registered: ['pass', 'w rejestrze KNF'], demo: ['mid', 'DEMO – podmiot fikcyjny'], not_found: ['warn', 'brak w rejestrze'], unknown: ['na', 'nie sprawdzono'] };

export default function Entities() {
  const { tick, threshold } = useLive();
  const nav = useNavigate();
  const { data, error } = useData('/entities', tick);
  return (
    <>
      <div className="page-head"><div><h1>Podmioty</h1><p>Firmy inwestycyjne, reklamujący i podmioty doradcze wykryte w materiałach</p></div></div>
      <Panel>
        {error && <Empty>{error.message}</Empty>}
        {data && (data.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Nazwa</th><th>Rodzaj</th><th>Rejestr</th><th>Materiały</th><th>Maks. wynik</th></tr></thead>
            <tbody>{data.map((e) => (
              <tr key={e.id} className="click" onClick={() => nav(`/entities/${e.id}`)}>
                <td>{e.name}</td><td className="small">{KIND[e.kind] ?? e.kind}</td>
                <td><span className={`chip ${REG[e.registry_status]?.[0]}`}>{REG[e.registry_status]?.[1]}</span></td>
                <td>{e.materials}</td><td><Score score={e.max_score} threshold={threshold} /></td>
              </tr>))}
            </tbody>
          </table></div>
        ) : <Empty>Brak podmiotów.</Empty>)}
      </Panel>
    </>
  );
}

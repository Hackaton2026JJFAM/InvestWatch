import { useState } from 'react';
import { Link } from 'react-router-dom';
import { qs } from '../api.js';
import { Empty, Panel, Score } from '../components/ui.jsx';
import { useData, useDebounced } from '../hooks.js';
import { useLive } from '../live.jsx';
import { KIND, REG } from './Entities.jsx';

export default function Search() {
  const { threshold } = useLive();
  const [text, setText] = useState('');
  const [type, setType] = useState('all');
  const q = useDebounced(text.trim(), 350);
  const { data, error } = useData(q.length >= 2 ? `/search${qs({ q, type })}` : null);

  return (
    <>
      <div className="page-head"><div><h1>Wyszukiwarka</h1><p>Firmy, osoby, materiały, adresy URL oraz rejestr firm inwestycyjnych KNF</p></div></div>
      <Panel>
        <input className="search-big" autoFocus placeholder="np. Vistula, family office, tiktok.com, CFD…" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="tabs" style={{ marginTop: 12 }}>
          {[['all', 'Wszystko'], ['entities', 'Podmioty'], ['materials', 'Materiały'], ['registry', 'Rejestr KNF']].map(([k, v]) => (
            <button key={k} className={type === k ? 'active' : ''} onClick={() => setType(k)}>{v}</button>
          ))}
        </div>
        {q.length < 2 && <Empty>Wpisz co najmniej 2 znaki.</Empty>}
        {error && <Empty>{error.message}</Empty>}
      </Panel>
      {data && q.length >= 2 && (
        <div className="grid g3" style={{ marginTop: 16 }}>
          {data.entities && (
            <Panel title={`Podmioty (${data.entities.length})`}>
              {data.entities.length ? <table><tbody>{data.entities.map((e) => (
                <tr key={e.id}><td><Link to={`/entities/${e.id}`}>{e.name}</Link><div className="small muted">{KIND[e.kind]}</div></td><td><span className={`chip ${REG[e.registry_status]?.[0]}`}>{REG[e.registry_status]?.[1]}</span></td></tr>))}
              </tbody></table> : <Empty>Brak</Empty>}
            </Panel>
          )}
          {data.materials && (
            <Panel title={`Materiały (${data.materials.length})`}>
              {data.materials.length ? data.materials.map((m) => (
                <div key={m.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <Link to={`/materials/${m.id}`}>{m.title || m.url}</Link> <Score score={m.score} threshold={threshold} />
                  <div className="small muted truncate">{m.platform} · {m.url}</div>
                  {m.snippet && <div className="small">…{m.snippet}…</div>}
                </div>)) : <Empty>Brak</Empty>}
            </Panel>
          )}
          {data.registry && (
            <Panel title={`Rejestr KNF (${data.registry.length})`} meta="snapshot publicznych list KNF">
              {data.registry.length ? <table><tbody>{data.registry.map((f) => (
                <tr key={f.name}><td>{f.name}{f.demo && <span className="chip mid" style={{ marginLeft: 6 }}>DEMO</span>}<div className="small muted">{f.category} · {f.country ?? '–'}</div></td><td className="small muted">{Math.round(f.score)}%</td></tr>))}
              </tbody></table> : <Empty>Brak</Empty>}
            </Panel>
          )}
        </div>
      )}
    </>
  );
}

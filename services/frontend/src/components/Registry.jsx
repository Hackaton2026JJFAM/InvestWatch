// Podsumowania danych z rejestrów KRS i GLEIF (propsy, bez pobierania danych).
import { Fragment } from 'react';
import { RecordDetails } from './ui.jsx';

export const money = (c) => (c ? `${c.value.toLocaleString('pl-PL', { maximumFractionDigits: 2 })} ${c.currency ?? ''}` : 'brak danych');
const Ext = ({ url, children }) => (url ? <a href={url} target="_blank" rel="noreferrer noopener">{children}</a> : children);

export function KrsSummary({ d, source }) {
  if (!d) return null;
  return (
    <>
      <dl className="kv">
        <dt>Nazwa</dt><dd><b>{d.name}</b></dd>
        <dt>Forma prawna</dt><dd>{d.legal_form ?? '–'}</dd>
        <dt>KRS / NIP / REGON</dt><dd className="mono">{d.krs} / {d.nip ?? '–'} / {d.regon ?? '–'}</dd>
        <dt>Kapitał zakładowy</dt><dd>{money(d.capital)}{d.capital_paid && d.capital_paid.value !== d.capital?.value ? ` (wpłacono ${money(d.capital_paid)})` : ''}</dd>
      </dl>
      <RecordDetails label="Adres, reprezentacja i dane rejestracji" context={d.name}>
      <dl className="kv">
        <dt>Rejestr</dt><dd>{d.register}</dd>
        <dt>Data rejestracji w KRS</dt><dd>{d.registered_at ?? 'brak danych'}</dd>
        <dt>Ostatni wpis</dt><dd>{d.last_entry_at ?? '–'}</dd>
        <dt>Siedziba / adres</dt><dd>{d.address ?? 'brak danych'}</dd>
        <dt>Strona WWW</dt><dd>{d.website ?? '–'}</dd>
        <dt>Sposób reprezentacji</dt><dd>{d.representation ?? '–'}</dd>
        <dt>Stan na</dt><dd>{d.state_as_of ?? '–'} · <Ext url={d.source_url}>odpis w API KRS</Ext>{source ? <span className="muted small"> · numer KRS: {source}</span> : null}</dd>
      </dl>
      </RecordDetails>
      {(d.persons?.length > 0 || d.shareholders?.length > 0) && (
        <RecordDetails label={`Organy, prokurenci, wspólnicy (${(d.persons?.length ?? 0) + (d.shareholders?.length ?? 0)})`} context={d.name}>
          {d.persons_masked && <p className="small muted" style={{ marginTop: 0 }}>Publiczne API KRS anonimizuje imiona, nazwiska i PESEL.</p>}
          <div className="table-wrap"><table><tbody>{[...(d.persons ?? []), ...(d.shareholders ?? [])].map((p, i) => (
            <tr key={i}><td>{p.name ?? '–'}</td><td>{p.role}</td><td>{p.function ?? p.shares ?? ''}{p.suspended ? ' (zawieszony)' : ''}</td></tr>))}
          </tbody></table></div>
        </RecordDetails>
      )}
    </>
  );
}

export function GleifSummary({ g }) {
  if (!g) return null;
  return (
    <><dl className="kv">
      <dt>LEI</dt><dd className="mono"><Ext url={g.source_url}>{g.lei}</Ext></dd>
      <dt>Nazwa prawna</dt><dd><b>{g.name}</b></dd>
      <dt>Status podmiotu / LEI</dt><dd>{g.entity_status ?? '–'} / {g.registration_status ?? '–'}</dd>
    </dl>
    <RecordDetails label="Identyfikatory, adres i rejestracja LEI" context={g.name}>
    <dl className="kv">
      {g.other_names?.length > 0 && <><dt>Inne nazwy</dt><dd>{g.other_names.join(' · ')}</dd></>}
      <dt>Kraj / jurysdykcja</dt><dd>{g.country ?? '–'} / {g.jurisdiction ?? '–'}</dd>
      <dt>Adres prawny</dt><dd>{g.address || '–'}</dd>
      {g.hq_address && g.hq_address !== g.address && <><dt>Siedziba główna</dt><dd>{g.hq_address}</dd></>}
      <dt>Forma prawna (ELF)</dt><dd className="mono">{g.legal_form ?? '–'}</dd>
      <dt>Rejestr źródłowy</dt><dd className="mono">{g.registered_at ?? '–'} / {g.registered_as ?? '–'}{g.krs && <span className="chip pass" style={{ marginLeft: 6 }}>KRS {g.krs}</span>}</dd>
      <dt>Utworzenie podmiotu</dt><dd>{g.created_at?.slice(0, 10) ?? '–'}</dd>
      <dt>Rejestracja LEI</dt><dd>{g.initial_registration?.slice(0, 10) ?? '–'} · odnowienie {g.next_renewal?.slice(0, 10) ?? '–'}</dd>
      {g.bic?.length > 0 && <><dt>BIC</dt><dd className="mono">{g.bic.join(', ')}</dd></>}
    </dl>
    </RecordDetails></>
  );
}

const parentLabel = (p) => (p?.name ? `${p.name} (${p.country}, ${p.lei})` : p?.exception ? `brak – ${p.exception}` : 'brak danych');

export function GleifRelations({ detail }) {
  if (!detail) return null;
  return (
    <RecordDetails label="Struktura grupy i podmioty zależne"><dl className="kv">
      <dt>Dominujący bezpośredni</dt><dd>{parentLabel(detail.direct_parent)}</dd>
      <dt>Dominujący najwyższy</dt><dd>{parentLabel(detail.ultimate_parent)}</dd>
      <dt>Podmioty zależne</dt><dd>{detail.direct_children?.length ? detail.direct_children.map((c) => <Fragment key={c.lei}><span>{c.name} ({c.country})</span><br /></Fragment>) : 'brak'}</dd>
    </dl></RecordDetails>
  );
}

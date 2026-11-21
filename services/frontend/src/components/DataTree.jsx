// Czytelny podgląd wszystkich danych z rejestru (KRS, GLEIF) – zagnieżdżone sekcje, polskie etykiety, filtr.
import { useMemo, useState } from 'react';

const LABELS = {
  odpis: 'Odpis', rodzaj: 'Rodzaj odpisu', naglowekA: 'Nagłówek odpisu (aktualny)', naglowekP: 'Nagłówek odpisu (pełny)', dane: 'Dane',
  dzial1: 'Dział 1 – dane podmiotu, siedziba, kapitał, wspólnicy', dzial2: 'Dział 2 – reprezentacja, organ nadzoru, prokurenci',
  dzial3: 'Dział 3 – przedmiot działalności, sprawozdania', dzial4: 'Dział 4 – zaległości, wierzytelności, zakazy',
  dzial5: 'Dział 5 – kurator', dzial6: 'Dział 6 – likwidacja, upadłość, restrukturyzacja',
  numerKRS: 'Numer KRS', nip: 'NIP', regon: 'REGON', pesel: 'PESEL', krs: 'KRS', lei: 'LEI', bic: 'BIC',
  danePodmiotu: 'Dane podmiotu', siedzibaIAdres: 'Siedziba i adres', umowaStatut: 'Umowa / statut', kapital: 'Kapitał',
  wspolnicySpzoo: 'Wspólnicy (sp. z o.o.)', emisjeAkcji: 'Emisje akcji', reprezentacja: 'Reprezentacja', organNadzoru: 'Organ nadzoru',
  prokurenci: 'Prokurenci', sklad: 'Skład', przedmiotDzialalnosci: 'Przedmiot działalności', wzmiankiOZlozonychDokumentach: 'Złożone dokumenty',
  entity: 'Podmiot', registration: 'Rejestracja LEI', legalName: 'Nazwa prawna', otherNames: 'Inne nazwy', legalAddress: 'Adres prawny',
  headquartersAddress: 'Adres siedziby głównej', registeredAt: 'Urząd rejestrowy', registeredAs: 'Numer w rejestrze', jurisdiction: 'Jurysdykcja',
  legalForm: 'Forma prawna', status: 'Status', creationDate: 'Data utworzenia', initialRegistrationDate: 'Pierwsza rejestracja LEI',
  lastUpdateDate: 'Ostatnia aktualizacja', nextRenewalDate: 'Następne odnowienie', managingLou: 'Zarządzająca jednostka LOU',
  corroborationLevel: 'Poziom weryfikacji', addressLines: 'Adres', postalCode: 'Kod pocztowy', city: 'Miasto', country: 'Kraj', region: 'Region',
  direct_parent: 'Podmiot dominujący (bezpośredni)', ultimate_parent: 'Podmiot dominujący (najwyższy)', direct_children: 'Podmioty zależne',
  record: 'Rekord LEI', exception: 'Wyjątek raportowania', reason: 'Powód',
};

// camelCase -> zdanie („wysokoscKapitaluZakladowego” -> „Wysokosc kapitalu zakladowego”)
export function humanize(key) {
  if (LABELS[key]) return LABELS[key];
  if (/^\d+$/.test(key)) return `#${Number(key) + 1}`;
  const s = key.replace(/_/g, ' ').replace(/([a-ząćęłńóśźż0-9])([A-ZĄĆĘŁŃÓŚŹŻ])/g, '$1 $2').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// porównanie bez polskich znaków i wielkości liter (klucze KRS nie mają diakrytyków: „wysokoscKapitalu…”)
export const fold = (t) => String(t).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
const keyHit = (k, q) => fold(humanize(k)).includes(q) || fold(k).includes(q);

const isPrimitive = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const fmt = (v) => (v === null || v === '' ? '–' : v === true ? 'tak' : v === false ? 'nie' : String(v));

function matches(value, q) {
  if (!q) return true;
  if (isPrimitive(value)) return fold(fmt(value)).includes(q);
  return Object.entries(value).some(([k, v]) => keyHit(k, q) || matches(v, q));
}

function Node({ name, value, q, depth }) {
  if (isPrimitive(value)) {
    return <div className="dt-row"><span className="dt-key">{humanize(name)}</span><span className="dt-val">{fmt(value)}</span></div>;
  }
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value);
  if (!entries.length) return <div className="dt-row"><span className="dt-key">{humanize(name)}</span><span className="dt-val muted">brak</span></div>;
  if (Array.isArray(value) && value.every(isPrimitive)) {
    return <div className="dt-row"><span className="dt-key">{humanize(name)}</span><span className="dt-val">{value.map(fmt).join(' · ')}</span></div>;
  }
  // pasujący klucz sekcji pokazuje całą sekcję; inaczej tylko pasujące elementy
  const visible = !q || keyHit(name, q) ? entries : entries.filter(([k, v]) => keyHit(k, q) || matches(v, q));
  if (!visible.length) return null;
  return (
    <details className="dt-node" open={depth < 1 || Boolean(q)}>
      <summary>{humanize(name)}{Array.isArray(value) && <span className="muted small"> ({value.length})</span>}</summary>
      <div className="dt-children">{visible.map(([k, v]) => <Node key={k} name={k} value={v} q={q} depth={depth + 1} />)}</div>
    </details>
  );
}

export default function DataTree({ data, title }) {
  const [filter, setFilter] = useState('');
  const q = fold(filter.trim());
  const entries = useMemo(() => (data && typeof data === 'object' ? Object.entries(data) : []), [data]);
  if (!data) return <p className="small muted">Brak danych.</p>;
  return (
    <div className="data-tree">
      <div className="filters" style={{ marginBottom: 6 }}>
        <input placeholder={`Szukaj w danych${title ? ` (${title})` : ''}… np. kapitał, prezes, PKD`} value={filter} onChange={(e) => setFilter(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
      </div>
      {entries.filter(([k, v]) => !q || keyHit(k, q) || matches(v, q)).map(([k, v]) => <Node key={k} name={k} value={v} q={q} depth={0} />)}
    </div>
  );
}

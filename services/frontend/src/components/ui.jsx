// Komponenty prezentacyjne – wyłącznie propsy, bez własnego pobierania danych.
import { Link } from 'react-router-dom';

export const RISK_CLASS = { wysokie: 'high', 'średnie': 'mid', niskie: 'low' };
export const STATUS_LABEL = { fail: 'problem', warn: 'do sprawdzenia', pass: 'w porządku', na: 'nie dotyczy', not_checked: 'nie oceniono' };
export const MODULES = { m1: 'M1 · Reklamy i finfluencerzy', m2: 'M2 · Informacja o ryzyku', m3: 'M3 · Doradztwo inwestycyjne' };
export const MAT_STATUS = { NEW: 'Nowy', IN_REVIEW: 'W trakcie weryfikacji', REVIEWED: 'Zweryfikowany', ESCALATED: 'Eskalowany', DISMISSED: 'Odrzucony' };

// Poziom ryzyka w stałej skali 0–100: 0–30 niskie (zielony), 31–70 średnie (żółty), 71–100 wysokie (czerwony).
// Próg alertów (kalibracja) jest osobny – decyduje o alercie i widoku „powyżej progu”.
// eslint-disable-next-line no-unused-vars
export function riskOf(score, _threshold) {
  if (score == null) return null;
  const s = Math.round(Number(score));
  return s > 70 ? 'wysokie' : s > 30 ? 'średnie' : 'niskie';
}

// Profil publikującego / materiału (analyzer: profile.primary)
export const PROFILE = {
  podejrzenie_oszustwa: { label: 'Podejrzenie oszustwa', tone: 'high' },
  płatna_promocja: { label: 'Płatna promocja', tone: 'mid' },
  autoreklama: { label: 'Autoreklama (własna reklama)', tone: 'brand' },
  doradca_finansowy: { label: 'Doradca / oferta doradcza', tone: 'info' },
  edukacja: { label: 'Edukacja', tone: 'low' },
  informacja: { label: 'Informacja', tone: 'neutral' },
};
export function ProfileChip({ type }) {
  const p = PROFILE[type];
  return p ? <span className={`chip ${p.tone}`}>{p.label}</span> : null;
}
export const fmtCount = (n) => (n == null ? '–' : Number(n).toLocaleString('pl-PL', { notation: Number(n) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }));

export function Panel({ title, meta, actions, children, className = '' }) {
  return (
    <section className={`panel ${className}`}>
      {(title || meta || actions) && (
        <div className="panel-head">
          <h2>{title}</h2>
          <div className="btn-row">{meta && <span className="meta">{meta}</span>}{actions}</div>
        </div>
      )}
      {children}
    </section>
  );
}

export function StatCard({ label, value, sub, tone = '' }) {
  return (
    <div className={`panel stat ${tone}`}>
      <span className="label">{label}</span>
      <span className="value">{value ?? '–'}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}

export function RiskBadge({ risk }) {
  if (!risk) return <span className="chip na">brak</span>;
  return <span className={`chip ${RISK_CLASS[risk]}`}>{risk}</span>;
}

export function Score({ score, threshold }) {
  if (score == null) return <span className="muted">–</span>;
  const cls = RISK_CLASS[riskOf(score, threshold)] ?? '';
  return <span className={`score ${cls}`}>{Math.round(score)}</span>;
}

export function ScoreBar({ score, threshold }) {
  const cls = RISK_CLASS[riskOf(score, threshold)];
  const color = { high: 'var(--high)', mid: 'var(--mid)', low: 'var(--low)' }[cls] ?? 'var(--na)';
  return <div className="bar"><span style={{ width: `${Math.min(score ?? 0, 100)}%`, background: color }} /></div>;
}

export function StatusChip({ status }) {
  return <span className={`chip ${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function ModuleChips({ modules = [] }) {
  if (!modules.length) return <span className="muted small">–</span>;
  return <span className="btn-row">{modules.map((m) => <span key={m} className="chip brand">{m.toUpperCase()}</span>)}</span>;
}

export function Evidence({ items = [] }) {
  return items.filter((e) => e.text).map((e, i) => (
    <div key={i} className="evidence">
      <span className="where">{e.where}{e.font_size ? ` · ${e.font_size}px` : ''}{e.contrast ? ` · kontrast ${e.contrast}:1` : ''}</span>
      <div>„{e.text}”</div>
    </div>
  ));
}

export function Empty({ children = 'Brak danych' }) {
  return <div className="empty">{children}</div>;
}

// Native disclosure: keyboard accessible, collapsed by default, no data fetching.
export function RecordDetails({ fields = [], children, label = 'Szczegóły', context }) {
  return (
    <details className="row-details record-details">
      <summary aria-label={context ? `${label}: ${context}` : undefined}>{label}</summary>
      <div className="record-details-body">
        {fields.length > 0 && <dl className="kv">{fields.map(([name, value]) => (
          <div className="detail-field" key={name}><dt>{name}</dt><dd>{value ?? '–'}</dd></div>
        ))}</dl>}
        {children}
      </div>
    </details>
  );
}

export function MaterialLink({ id, title, url }) {
  return <Link to={`/materials/${id}`}>{title || url}</Link>;
}

export const fmtDate = (d) => (d ? new Date(d).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : '–');
export const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);

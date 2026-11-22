import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export const TERMS = {
  finfluencer: 'Twórca internetowy, który publikuje treści o finansach lub inwestowaniu. Sama publikacja nie potwierdza współpracy z firmą.',
  shadow_advisory: 'Możliwa oferta indywidualnej porady inwestycyjnej przedstawiana jako ogólna informacja lub edukacja. To sygnał do sprawdzenia, nie rozstrzygnięcie prawne.',
  scoring: 'Wynik punktowy analizy w skali 0–100. Pokazuje siłę wykrytych sygnałów; nie jest prawdopodobieństwem naruszenia prawa.',
  risk_vs_scam: 'Ryzyko naruszeń – czy reklama łamie zasady reklamy inwestycyjnej: ukryta współpraca (M1), brak lub słaba informacja o ryzyku (M2), doradztwo bez zezwolenia (M3); to najwyższy wynik z tych obszarów. Sygnały oszustwa – czy treść wygląda na oszustwo (gwarancja zysku, bot AI, „pisz na WhatsApp”, lista ostrzeżeń KNF). Legalny broker bez ostrzeżenia o ryzyku ma wysokie ryzyko i zero sygnałów oszustwa; mocne sygnały oszustwa (≥ 45) zawsze podnoszą ryzyko co najmniej do swojego poziomu.',
  scam_signals: 'Wynik z samych wzorców typowych dla oszustw inwestycyjnych (0–100). Od 45 punktów ryzyko naruszeń nie może być niższe niż ten wynik.',
  risk_threshold: 'Ustawiona granica wyniku, od której system tworzy alert. Zmienia alerty i kategorie ryzyka, nie sam wynik analizy.',
  false_positive: 'Wynik oznaczony jako ryzykowny, który po sprawdzeniu okazuje się prawidłowy.',
  false_negative: 'Treść wymagająca uwagi, której analiza nie oznaczyła jako ryzykownej.',
  knf: 'Komisja Nadzoru Finansowego — polski organ nadzorujący m.in. rynek finansowy.',
  esma: 'Europejski Urząd Nadzoru Giełd i Papierów Wartościowych.',
  mica: 'Unijne przepisy dotyczące rynku kryptoaktywów.',
  krs: 'Krajowy Rejestr Sądowy — publiczny rejestr m.in. spółek i organizacji w Polsce.',
  simhash: 'Skrót tekstu używany do znajdowania treści podobnych do siebie. Podobieństwo nie oznacza, że materiały są identyczne.',
  por: 'Proof of Reserves — raport giełdy o deklarowanym pokryciu zobowiązań aktywami. Nie jest audytem finansowym.',
  ocr: 'Automatyczny odczyt tekstu z obrazu lub klatek filmu.',
  lei: 'LEI to 20-znakowy identyfikator podmiotów prawnych używany na rynkach finansowych.',
  gleif: 'Globalna organizacja zarządzająca systemem identyfikatorów LEI.',
  casp: 'Dostawca usług związanych z kryptoaktywami, np. giełda lub operator portfela.',
  scoring_review: 'Wynik po uwzględnieniu ręcznej weryfikacji punktów. Pierwotny wynik automatyczny pozostaje zachowany.',
  reach: 'Liczba wyświetleń lub obserwujących podana przez platformę. Może być niedostępna albo nieporównywalna między serwisami.',
  websocket: 'Połączenie, które pozwala aplikacji otrzymywać nowe alerty i zmiany bez odświeżania strony.',
};

const HelpIcon = () => (
  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none">
    <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8.2 7.4a1.85 1.85 0 1 1 3.2 1.25c-.75.8-1.4 1-1.4 2.1M10 13.8v.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export function HelpTip({ term, label, dark = false }) {
  const id = useId();
  const ref = useRef(null);
  const tipRef = useRef(null);
  const closeTimer = useRef(null);
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const text = TERMS[term];
  const visible = open || hovered;

  useEffect(() => {
    if (!visible) return undefined;
    const onPointerDown = (event) => {
      if (!ref.current?.contains(event.target) && !tipRef.current?.contains(event.target)) {
        setOpen(false);
        setHovered(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setHovered(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [visible]);

  useLayoutEffect(() => {
    if (!visible) return undefined;
    const place = () => {
      const trigger = ref.current?.getBoundingClientRect();
      const tip = tipRef.current;
      if (!trigger || !tip) return;
      const bounds = tip.getBoundingClientRect();
      const gap = 9;
      const margin = 12;
      const left = Math.max(margin, Math.min(
        trigger.left + trigger.width / 2 - bounds.width / 2,
        window.innerWidth - bounds.width - margin,
      ));
      const above = trigger.top - bounds.height - gap;
      const top = above >= margin
        ? above
        : Math.min(window.innerHeight - bounds.height - margin, trigger.bottom + gap);
      setPosition({ top: Math.max(margin, top), left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [visible, text]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const keepOpen = () => {
    window.clearTimeout(closeTimer.current);
    setHovered(true);
  };
  const closeOnLeave = (event) => {
    if (ref.current?.contains(event.relatedTarget) || tipRef.current?.contains(event.relatedTarget)) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setHovered(false), 140);
  };

  if (!text) return null;
  return (
    <>
    <span className={`help-tip-wrap${visible ? ' is-open' : ''}${dark ? ' help-tip-sidebar' : ''}`} ref={ref}
      onPointerEnter={keepOpen} onPointerLeave={closeOnLeave} onFocus={keepOpen} onBlur={closeOnLeave}>
      <button
        className="help-tip-trigger"
        type="button"
        aria-label={`Wyjaśnienie: ${label ?? term}`}
        aria-expanded={open}
        aria-describedby={id}
        onClick={() => {
          const next = !open;
          setOpen(next);
          setHovered(next);
        }}
      >
        <HelpIcon />
      </button>
    </span>
    {visible && createPortal(
      <span className={`help-tip${dark ? ' help-tip-dark' : ''}`} role="tooltip" id={id} ref={tipRef}
        style={{ top: position.top, left: position.left }}
        onPointerEnter={keepOpen} onPointerLeave={closeOnLeave}>
        {text}
      </span>,
      document.body,
    )}
    </>
  );
}

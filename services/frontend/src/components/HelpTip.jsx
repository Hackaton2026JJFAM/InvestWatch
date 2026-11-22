import { useEffect, useId, useRef, useState } from 'react';

export const TERMS = {
  finfluencer: 'Twórca internetowy, który publikuje treści o finansach lub inwestowaniu. Sama publikacja nie potwierdza współpracy z firmą.',
  shadow_advisory: 'Możliwa oferta indywidualnej porady inwestycyjnej przedstawiana jako ogólna informacja lub edukacja. To sygnał do sprawdzenia, nie rozstrzygnięcie prawne.',
  scoring: 'Wynik punktowy analizy w skali 0–100. Pokazuje siłę wykrytych sygnałów; nie jest prawdopodobieństwem naruszenia prawa.',
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

export function HelpTip({ term, label }) {
  const id = useId();
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const text = TERMS[term];

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!ref.current?.contains(event.target)) {
        setOpen(false);
        setDismissed(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setDismissed(true);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!text) return null;
  return (
    <span className={`help-tip-wrap${open ? ' is-open' : ''}${dismissed ? ' is-dismissed' : ''}`} ref={ref} onPointerLeave={() => setDismissed(false)}>
      <button
        className="help-tip-trigger"
        type="button"
        aria-label={`Wyjaśnienie: ${label ?? term}`}
        aria-expanded={open}
        aria-describedby={id}
        onClick={() => {
          const next = !open;
          setOpen(next);
          setDismissed(!next);
        }}
      >
        <HelpIcon />
      </button>
      <span className="help-tip" role="tooltip" id={id}>{text}</span>
    </span>
  );
}

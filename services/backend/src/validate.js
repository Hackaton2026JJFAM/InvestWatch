// Walidacja wejścia (zod). Błąd walidacji -> 400 z czytelnym komunikatem.
export class BadRequest extends Error {
  constructor(message, details) {
    super(message);
    this.status = 400;
    this.details = details;
  }
}

export function parse(schema, input) {
  const res = schema.safeParse(input ?? {});
  if (!res.success) {
    const details = res.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw new BadRequest('Niepoprawne dane wejściowe', details);
  }
  return res.data;
}

// Poziom ryzyka w stałej skali 0–100 (niezależny od progu alertów): 0–29 niskie, 30–69 średnie, 70–100 wysokie.
// Próg alertów (kalibracja) decyduje osobno, czy materiał trafia do alertów / widoku „powyżej progu”.
// 0–30 niskie, 31–70 średnie, 71–100 wysokie (granice należą do niższego przedziału)
export const RISK_BANDS = { high: 70, mid: 30 };
export const riskLevel = (score) => (score == null ? null : Math.round(score) > RISK_BANDS.high ? 'wysokie' : Math.round(score) > RISK_BANDS.mid ? 'średnie' : 'niskie');
// eslint-disable-next-line no-unused-vars
export const riskSql = (alias = 'a', _param = '$1') =>
  `CASE WHEN round(${alias}.score) > ${RISK_BANDS.high} THEN 'wysokie' WHEN round(${alias}.score) > ${RISK_BANDS.mid} THEN 'średnie' ELSE 'niskie' END`;

// Ostatnia analiza materiału; „score” = wynik po weryfikacji analityka, gdy istnieje (odrzucone punkty,
// problemy dodane ręcznie), inaczej wynik klasyfikatora; „classifier_score” = zawsze wynik klasyfikatora.
export const LATEST = `JOIN LATERAL (SELECT id, material_id, modules, result, summary, summary_engine, analyzer_version, created_at,
    score AS classifier_score, COALESCE(m.reviewed_score, score) AS score, COALESCE(m.reviewed_modules, module_scores) AS module_scores
  FROM analyses WHERE material_id = m.id ORDER BY created_at DESC LIMIT 1) a ON TRUE`;
// kalibracja ocenia sam klasyfikator – bez korekt analityka
export const LATEST_RAW = 'JOIN LATERAL (SELECT * FROM analyses WHERE material_id = m.id ORDER BY created_at DESC LIMIT 1) a ON TRUE';
// próbki demo/kalibracyjne ukryte w widokach operacyjnych, chyba że włączono ich pokazywanie
export const demoSql = (show, alias = 'm') => (show ? 'TRUE' : `NOT ${alias}.demo`);

// Czy wynik przekracza próg alertów (parametr zapytania – zwykle $1)
export const aboveSql = (alias = 'a', param = '$1') => `(${alias}.score >= ${param}::numeric)`;

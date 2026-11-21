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
export const RISK_BANDS = { high: 70, mid: 30 };
export const riskLevel = (score) => (score == null ? null : score >= RISK_BANDS.high ? 'wysokie' : score >= RISK_BANDS.mid ? 'średnie' : 'niskie');
// eslint-disable-next-line no-unused-vars
export const riskSql = (alias = 'a', _param = '$1') =>
  `CASE WHEN ${alias}.score >= ${RISK_BANDS.high} THEN 'wysokie' WHEN ${alias}.score >= ${RISK_BANDS.mid} THEN 'średnie' ELSE 'niskie' END`;

// Czy wynik przekracza próg alertów (parametr zapytania – zwykle $1)
export const aboveSql = (alias = 'a', param = '$1') => `(${alias}.score >= ${param}::numeric)`;

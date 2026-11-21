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

export const riskSql = (alias = 'a', param = '$1') =>
  `CASE WHEN ${alias}.score >= ${param} THEN 'wysokie' WHEN ${alias}.score >= ${param} * 0.6 THEN 'średnie' ELSE 'niskie' END`;

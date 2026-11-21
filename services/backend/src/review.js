// Weryfikacja analityka: odrzucenie wybranych punktów podsumowania (przesłanek). Odrzucone przesłanki
// nie liczą się do „wyniku po weryfikacji” ani do podsumowania; decyzje są trwałe między ponownymi
// analizami (klucz: materiał + reguła). Wynik klasyfikatora pozostaje niezmieniony w historii analiz.

// ten sam wzór co analyzer/app/scoring.py: noisy-OR wag (fail = waga, warn = połowa), wynik = maks. z modułów
export function scoreOf(findings) {
  const keep = {};
  for (const f of findings) {
    const w = f.status === 'fail' ? f.severity / 100 : f.status === 'warn' ? f.severity / 200 : 0;
    keep[f.module] = (keep[f.module] ?? 1) * (1 - Math.min(Math.max(w, 0), 0.95));
  }
  const modules = Object.fromEntries(Object.entries(keep).map(([m, k]) => [m, Math.round(1000 * (1 - k)) / 10]));
  return { score: Math.max(0, ...Object.values(modules)), module_scores: modules };
}

/** Wynik analizy bez odrzuconych przesłanek (do podsumowania i wyniku po weryfikacji). */
export function withoutRejected(result, rejected) {
  const set = new Set(rejected);
  const findings = result.findings.filter((f) => !set.has(f.rule_id));
  const s = scoreOf(findings);
  return { ...result, findings, score: s.score, module_scores: { ...result.module_scores, ...s.module_scores },
    modules: Object.entries(s.module_scores).filter(([, v]) => v >= 20).map(([m]) => m) };
}

/** Punkty podsumowania = przesłanki „niespełnione” i „do weryfikacji”, od najpoważniejszych. */
export function summaryPoints(result, rejected) {
  const set = new Set(rejected);
  return result.findings.filter((f) => f.status === 'fail' || f.status === 'warn')
    .sort((a, b) => (a.status !== 'fail') - (b.status !== 'fail') || b.severity - a.severity)
    .map((f) => ({ rule_id: f.rule_id, module: f.module, title: f.title, status: f.status, severity: f.severity,
      explanation: f.explanation, rejected: set.has(f.rule_id) }));
}

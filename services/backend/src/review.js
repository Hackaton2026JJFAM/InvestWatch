// Weryfikacja analityka: odrzucenie wybranych punktów podsumowania (przesłanek) albo pojedynczych elementów
// punktu (źle rozpoznany sygnał/fragment, np. z transkrypcji). Odrzucone nie liczą się do „wyniku po
// weryfikacji” ani do podsumowania; decyzje są trwałe między ponownymi analizami (klucz: materiał + reguła
// lub materiał + „reguła:element”). Wynik klasyfikatora pozostaje niezmieniony w historii analiz.
//
// Klucze: „M1.10” – cała przesłanka; „M1.10:gwarancja” – sygnał (dowód z polem `signal`);
// „M2.3:1” – fragment nr 1 (dowody bez sygnału). Odrzucenie wszystkich fragmentów = odrzucenie przesłanki.

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

export const elementKey = (e, i) => String(e?.signal ?? i);
export const KEY_RX = /^[\w.]{1,12}(?::[\w-]{1,30})?$/;

/** Rozbija listę kluczy na odrzucone całe przesłanki i odrzucone elementy (reguła → zbiór elementów). */
export function splitRejected(rejected) {
  const whole = new Set();
  const parts = new Map();
  for (const k of rejected ?? []) {
    const i = k.indexOf(':');
    if (i < 0) whole.add(k);
    else {
      const rule = k.slice(0, i);
      if (!parts.has(rule)) parts.set(rule, new Set());
      parts.get(rule).add(k.slice(i + 1));
    }
  }
  return { whole, parts };
}

/** Czy klucz odnosi się do istniejącej przesłanki / elementu w wyniku analizy. */
export function isKnownKey(result, key) {
  const [rule, el] = key.split(':');
  const f = result.findings.find((x) => x.rule_id === rule);
  if (!f) return false;
  return el == null || (f.evidence ?? []).some((e, i) => elementKey(e, i) === el);
}

const noisyOr = (weights) => Math.round(100 * (1 - weights.reduce((k, w) => k * (1 - w / 100), 1)));

// profil po weryfikacji – te same progi co analyzer/app/profile.py
function reviewProfile(profile, signals) {
  if (!profile) return profile;
  const scam = noisyOr(signals.map((s) => s.weight));
  let primary = profile.primary;
  const isScam = scam >= 55 || (signals.length >= 3 && scam >= 45);
  if (primary === 'podejrzenie_oszustwa' && !isScam) {
    primary = profile.advisor ? 'doradca_finansowy' : profile.self_ad ? 'autoreklama' : (profile.paid || profile.affiliate) ? 'płatna_promocja'
      : profile.edu ? 'edukacja' : 'informacja';
  }
  return { ...profile, primary, scam_score: scam, signals, reviewed: true };
}

// problem dodany ręcznie przez analityka -> przesłanka w formacie analizatora (identyfikator „A<id>”)
export const manualFinding = (x) => ({
  module: x.module, rule_id: `A${x.id}`, title: x.title, status: 'fail', severity: x.severity, manual: true,
  legal_basis: 'dodane przez analityka', explanation: x.explanation || 'Problem zgłoszony ręcznie przez analityka.',
  evidence: x.fragment ? [{ text: x.fragment, where: x.at ? `fragment · ${x.at}` : 'fragment', ...(x.at ? { at: x.at } : {}) }] : [],
});

// Przesłanki M3 dotyczące braku/niepotwierdzonych uprawnień – nieaktualne, gdy analityk sprawdził doradcę w rejestrze.
// M3.4 (lista ostrzeżeń) i M3.5 (nierealne obietnice) zostają – to problemy niezależne od licencji.
export const LICENSE_RULES = ['M3.1', 'M3.2', 'M3.3'];

/** Przesłanki z doradcą sprawdzonym przez analityka: M3.1–M3.3 zastąpione informacją „zweryfikowany” (bez wagi). */
export function withVerifiedAdvisor(result, advisor) {
  if (!advisor) return result;
  const findings = result.findings.filter((f) => !LICENSE_RULES.includes(f.rule_id));
  const had = findings.length !== result.findings.length;
  findings.push({ module: 'm3', rule_id: 'M3.1', title: 'Doradca sprawdzony przez analityka', status: 'pass', severity: 0, verified: true,
    legal_basis: 'art. 76 u.o.i.f.', evidence: [],
    explanation: `${advisor.name || advisor.handle || advisor.domain || 'Publikujący'}${advisor.license_no ? ` (nr ${advisor.license_no})` : ''} – `
      + `uprawnienia sprawdzone w rejestrze KNF${advisor.verified_at ? ` (${new Date(advisor.verified_at).toLocaleDateString('pl-PL')})` : ''}`
      + `${advisor.note ? `: ${advisor.note}` : ''}. Treść nie jest oznaczana jako możliwe doradztwo bez zezwolenia.` });
  if (!had) return { ...result, findings };
  const s = scoreOf(findings);
  return { ...result, findings, score: s.score, module_scores: { ...result.module_scores, ...s.module_scores },
    modules: Object.entries(s.module_scores).filter(([, v]) => v >= 20).map(([m]) => m) };
}

/** Konto z historią naruszeń: przesłanka „do sprawdzenia” (M1.11) na podstawie wcześniejszych materiałów konta. */
export function historyFinding(h) {
  if (!h?.repeat) return null;
  const parts = [];
  if (h.high) parts.push(`${h.high} z wysokim ryzykiem`);
  if (h.scams) parts.push(`${h.scams} z podejrzeniem oszustwa`);
  const severity = Math.min(50, 20 + 8 * h.high + 12 * h.scams);
  return { module: 'm1', rule_id: 'M1.11', title: 'Konto z historią naruszeń', status: 'warn', severity, history: true,
    legal_basis: 'historia konta (sygnał, nie dowód)',
    explanation: `To konto opublikowało wcześniej ${h.materials} przeanalizowanych materiałów, w tym ${parts.join(' i ')} `
      + `(najwyższy wynik ${h.max_score}/100). Wcześniejsze zachowanie zwiększa priorytet weryfikacji tego materiału.`,
    evidence: h.items.filter((x) => x.score >= 70 || x.profile === 'podejrzenie_oszustwa').slice(0, 3)
      .map((x) => ({ text: x.title || x.url, where: `wcześniejszy materiał · ${Math.round(x.score)}/100`, material_id: x.id })) };
}

export function withHistory(result, history) {
  const f = historyFinding(history);
  if (!f) return result;
  const findings = [...result.findings.filter((x) => x.rule_id !== 'M1.11'), f];
  const s = scoreOf(findings);
  const profile = result.profile ? { ...result.profile, tags: [...new Set([...(result.profile.tags ?? []), 'konto z historią naruszeń'])] } : result.profile;
  return { ...result, findings, profile, score: s.score, module_scores: { ...result.module_scores, ...s.module_scores },
    modules: Object.entries(s.module_scores).filter(([, v]) => v >= 20).map(([m]) => m) };
}

/** Wynik po weryfikacji: historia konta, sprawdzony doradca, bez odrzuconych przesłanek/elementów, z problemami ręcznymi. */
export function reviewResult(result, rejected = [], manual = [], advisor = null, history = null) {
  const verified = withVerifiedAdvisor(withHistory(result, history), advisor);
  const base = rejected.length ? withoutRejected(verified, rejected) : verified;
  if (!manual.length) return base;
  const findings = [...base.findings, ...manual.map(manualFinding)];
  const s = scoreOf(findings);
  return { ...base, findings, score: s.score, module_scores: { ...base.module_scores, ...s.module_scores },
    modules: Object.entries(s.module_scores).filter(([, v]) => v >= 20).map(([m]) => m) };
}

/** Wynik analizy bez odrzuconych przesłanek/elementów (do podsumowania i wyniku po weryfikacji). */
export function withoutRejected(result, rejected) {
  const { whole, parts } = splitRejected(rejected);
  // sygnały oszustwa: odrzucony sygnał (lub cała obietnica zysku M1.9) obniża wynik sygnałów i M1.10
  const dropSignals = new Set(parts.get('M1.10') ?? []);
  if (whole.has('M1.9')) dropSignals.add('nierealne_zyski');
  const allSignals = result.profile?.signals ?? [];
  const signals = whole.has('M1.10') ? allSignals.filter((s) => s.key === 'nierealne_zyski' && !dropSignals.has(s.key))
    : allSignals.filter((s) => !dropSignals.has(s.key));

  const findings = [];
  for (const f of result.findings) {
    if (whole.has(f.rule_id)) continue;
    const drop = parts.get(f.rule_id);
    const ev = f.evidence ?? [];
    if (f.rule_id === 'M1.10' && ev.some((e) => e.signal)) {
      if (!drop && !dropSignals.size) { findings.push(f); continue; }
      const score = noisyOr(signals.map((s) => s.weight));
      const strong = signals.filter((s) => s.key !== 'nierealne_zyski');
      if (!strong.length || !(score >= 45 || strong.length >= 2)) continue;   // jak w analizatorze: za słabe sygnały = brak przesłanki
      findings.push({ ...f, status: score >= 55 ? 'fail' : 'warn', severity: Math.min(85, score),
        evidence: ev.filter((e, i) => !dropSignals.has(elementKey(e, i))),
        explanation: `Wzorce typowe dla oszustw inwestycyjnych: ${strong.map((s) => s.label.toLowerCase()).join(', ')}. `
          + `Wynik sygnałów po weryfikacji analityka ${score}/100 – do weryfikacji.` });
      continue;
    }
    if (!drop) { findings.push(f); continue; }
    const kept = ev.filter((e, i) => !drop.has(elementKey(e, i)));
    if (ev.length && !kept.length) continue;   // wszystkie fragmenty źle rozpoznane = przesłanka odpada
    findings.push({ ...f, evidence: kept });
  }
  const s = scoreOf(findings);
  return { ...result, findings, score: s.score, module_scores: { ...result.module_scores, ...s.module_scores },
    modules: Object.entries(s.module_scores).filter(([, v]) => v >= 20).map(([m]) => m),
    profile: result.profile ? reviewProfile(result.profile, signals) : result.profile };
}

/** Punkty podsumowania = przesłanki „niespełnione” i „do weryfikacji”, od najpoważniejszych, z elementami. */
export function summaryPoints(result, rejected, manual = []) {
  const { whole, parts } = splitRejected(rejected);
  return [...result.findings, ...manual.map(manualFinding)].filter((f) => f.status === 'fail' || f.status === 'warn')
    .sort((a, b) => (a.status !== 'fail') - (b.status !== 'fail') || b.severity - a.severity)
    .map((f) => {
      const ev = f.evidence ?? [];
      const drop = parts.get(f.rule_id) ?? new Set();
      // elementy do odrzucania pokazujemy, gdy jest ich kilka albo są to sygnały z wagą
      const elements = ev.length > 1 || ev.some((e) => e.signal)
        ? ev.map((e, i) => ({ key: `${f.rule_id}:${elementKey(e, i)}`, text: e.text, where: e.where, weight: e.weight ?? null,
          rejected: drop.has(elementKey(e, i)) }))
        : [];
      return { rule_id: f.rule_id, module: f.module, title: f.title, status: f.status, severity: f.severity,
        explanation: f.explanation, rejected: whole.has(f.rule_id), elements: f.manual ? [] : elements, manual: Boolean(f.manual),
        ...(f.manual ? { id: Number(f.rule_id.slice(1)), fragment: f.evidence[0]?.text ?? null } : {}) };
    });
}

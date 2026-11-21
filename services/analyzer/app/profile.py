"""Profil publikującego / materiału: płatna promocja, podejrzenie oszustwa, doradca, edukacja.

Działa tak samo dla stron, postów i wideo (transkrypcja Whisper + napisy z OCR klatek – wszystko trafia
do Doc.text). Wynik to sygnały z cytatami, a nie ocena prawna:

* realizm obietnic – liczby z treści („30% miesięcznie”, „x10 w rok”, „podwoisz kapitał”) przeliczone
  na skalę roczną; powyżej ~50% rocznie = nierealistyczne (lokaty/obligacje skarbowe dają kilka %),
* sygnały oszustwa – gwarancja zysku, presja czasu, kontakt poza platformą (WhatsApp/Telegram), wpłata
  na portfel/BLIK prywatnie, system poleceń (piramida), wizerunek znanych osób, „odzyskamy środki”,
  minimalna wpłata typu „zacznij od 250 zł”, podmiot z listy ostrzeżeń KNF/ESMA,
* płatna promocja – oznaczenie współpracy, kody i linki afiliacyjne,
* doradca – oferta doradcza (M3), sygnały/kopiowanie transakcji, grupa premium.
"""
from __future__ import annotations

import re

from . import text as T
from .model import FAIL, WARN, Doc, Finding, ev

# ---------------------------------------------------------------------------- realizm obietnic zysku
NUM_WORDS = {
    "jeden": 1, "dwa": 2, "trzy": 3, "cztery": 4, "piec": 5, "szesc": 6, "siedem": 7, "osiem": 8, "dziewiec": 9, "dziesiec": 10,
    "pietnascie": 15, "dwadziescia": 20, "trzydziesci": 30, "czterdziesci": 40, "piecdziesiat": 50, "szescdziesiat": 60,
    "siedemdziesiat": 70, "osiemdziesiat": 80, "dziewiecdziesiat": 90, "sto": 100, "dwiescie": 200, "trzysta": 300, "piecset": 500,
    "tysiac": 1000,
}
_NUM = r"(\d+(?:[.,]\d+)?|" + "|".join(sorted(NUM_WORDS, key=len, reverse=True)) + r")"
PCT = re.compile(_NUM + r"\s?(?:%|procent\w*|proc\.?)", re.I)
# okres: dziennie / w tydzień / miesięcznie / w 3 miesiące / rocznie
PERIOD = re.compile(
    r"(?P<n>\d+)?\s*(?P<u>dzien\w*|dni|dniach|dziennie|daily|day|tydz\w*|tygodni\w*|weekly|week|mies\w*|monthly|month|"
    r"kwartal\w*|rok\w*|rocz\w*|lat\b|lata\b|year\w*|annual\w*|annually)", re.I)
UNIT_PER_YEAR = [("dz", 365), ("dni", 365), ("dai", 365), ("day", 365), ("tyg", 52), ("tydz", 52), ("week", 52),
                 ("mies", 12), ("month", 12), ("kwart", 4), ("rok", 1), ("rocz", 1), ("lat", 1), ("year", 1), ("annual", 1)]
MULTIPLIER = re.compile(r"\b(?:x\s?(\d{1,4})|(\d{1,4})\s?x)\b|\b(podwo[ij]\w*|potroj\w*|pomnoz\w*|zwielokrotni\w*)", re.I)
NOT_RETURN = T.rx(r"prowizj", r"oplat", r"rabat", r"znizk", r"podat", r"inflacj", r"stop\w* procentow", r"\brrso\b", r"oprocentowani\w* kredyt",
                  r"rachunk\w* (?:inwestor|klient)", r"\btraci\b", r"\bstrat\w*", r"\bspad\w*", r"\bkurs\w* walut", r"\bmarz\w*", r"\bvat\b",
                  r"\bltv\b", r"\bdzwigni\w*", r"\blewar\w*", r"\bdepozyt\w* zabezpieczaj")
RETURN_CONTEXT = T.rx(r"zysk", r"zarob", r"zwrot", r"stop\w* zwrotu", r"dochod", r"profit", r"return", r"earn", r"\broi\b", r"zarabia", r"wzrost",
                      r"\bpomnoz", r"\bpodwo", r"\bwyplat", r"oprocentowan", r"odsetk", r"\bpasywn")
INVEST_CTX = T.rx(r"monet", r"token", r"krypto", r"bitcoin", r"btc", r"kapital", r"pieniad", r"inwest", r"akcj", r"portfel", r"kurs", r"wartos")
REALISTIC_ANNUAL = 20.0   # powyżej ~20% rocznie = obietnica wysoka (lokaty/obligacje: kilka %)
UNREALISTIC_ANNUAL = 50.0  # powyżej ~50% rocznie = nierealistyczna


def _num(tok: str) -> float | None:
    t = T.fold(tok)
    if t in NUM_WORDS:
        return float(NUM_WORDS[t])
    try:
        return float(t.replace(",", "."))
    except ValueError:
        return None


def _per_year(unit: str, n: int | None) -> float | None:
    u = T.fold(unit)
    for prefix, per in UNIT_PER_YEAR:
        if u.startswith(prefix):
            return per / (n or 1)
    return None


def return_claims(sentences) -> list[dict]:
    """Obietnice zysku z liczbą i okresem -> skala roczna (prosta, bez kapitalizacji – ostrożnie)."""
    from .rules_m2 import is_risk_warning
    out = []
    for s in sentences:
        f = T.fold(s.text)
        if is_risk_warning(s.text) and not T.has(T.GUARANTEE, s.text):
            continue  # „74% rachunków traci pieniądze” to ostrzeżenie, nie obietnica
        has_return = T.has(RETURN_CONTEXT, s.text)
        for m in (PCT.finditer(f) if has_return else ()):
            near = f[max(0, m.start() - 40): m.end() + 45]
            if T.has(NOT_RETURN, near):
                continue
            pct = _num(m.group(1))
            if pct is None or pct <= 0:
                continue
            pm = PERIOD.search(f, m.end(), min(len(f), m.end() + 45)) or PERIOD.search(f[max(0, m.start() - 30): m.start()])
            per = _per_year(pm.group("u"), int(pm.group("n")) if pm and pm.group("n") else None) if pm else None
            annual = round(pct * per, 1) if per else None
            out.append({"text": s.text, "claim": m.group(0), "pct": pct, "period": pm.group(0).strip() if pm else None,
                        "annual_pct": annual, "historical": T.has(T.HIST, s.text) and not T.has(T.FORECAST, s.text)})
        for m in (MULTIPLIER.finditer(f) if has_return or T.has(INVEST_CTX, s.text) else ()):
            mult = m.group(1) or m.group(2)
            word = m.group(3)
            factor = float(mult) if mult else (2.0 if word.startswith("podwo") else 3.0 if word.startswith("potroj") else None)
            if factor is None or factor < 1.5 or factor > 10000:
                if word and not factor:  # „pomnożysz kapitał” bez liczby
                    out.append({"text": s.text, "claim": m.group(0), "pct": None, "period": None, "annual_pct": None,
                                "multiplier": True, "historical": False})
                continue
            pm = PERIOD.search(f, m.end(), min(len(f), m.end() + 45))
            per = _per_year(pm.group("u"), int(pm.group("n")) if pm.group("n") else None) if pm else None
            pct = (factor - 1) * 100
            out.append({"text": s.text, "claim": m.group(0), "pct": round(pct, 1), "period": pm.group(0).strip() if pm else None,
                        "annual_pct": round(pct * per, 1) if per else None, "multiplier": True, "historical": False})
    return out


# ---------------------------------------------------------------------------- sygnały oszustwa
SCAM_SIGNALS: list[tuple[str, str, re.Pattern, int]] = [
    ("presja_czasu", "Presja czasu", T.rx(r"tylko (?:dzis|dzisiaj|teraz|do (?:konca|polnocy))", r"ostatni\w* (?:miejsc|szans|dzien)", r"zostal\w* (?:tylko )?\d+ miejsc",
                                           r"nie przegap", r"\bspiesz\w* sie\b", r"oferta (?:wygasa|konczy)", r"limited (?:time|spots)", r"act now", r"\bonly \d+ spots\b", r"zanim bedzie za pozno"), 20),
    ("kontakt_prywatny", "Przeniesienie rozmowy poza platformę", T.rx(r"\bwhats ?app\b", r"\btelegram\w*", r"\bnapisz (?:do mnie )?(?:na )?(?:priv|prywatn|dm)\w*",
                                                                      r"\bdm me\b", r"\bpisz na priv\b", r"\bmessage me\b", r"\btext me\b", r"\bsignal\b (?:app|komunikator)", r"\bwiadomosc prywatn\w*"), 20),
    ("wplata_prywatna", "Wpłata na prywatny portfel/rachunek", T.rx(r"\bwplac\w* (?:na|przez) (?:moj|portfel|blik|konto prywatn)", r"\bprzelej\w*", r"\bblik\w*",
                                                                   r"\b(?:bc1|[13])[a-hj-np-z0-9]{25,39}\b", r"\b0x[0-9a-f]{40}\b", r"\bt[1-9a-hj-np-z]{33}\b",
                                                                   r"\badres\w* portfela\b"), 30),
    ("piramida", "System poleceń / piramida", T.rx(r"system\w* polecen", r"zarabiaj na polec\w*", r"\bpolec\w* znajom\w*", r"\bpiramid\w*", r"\bmatrix\w*",
                                                   r"\bkazdy polecony\b", r"\bdowntown\b", r"\bdownline\b", r"\bmlm\b"), 30),
    ("znane_osoby", "Wizerunek znanych osób", T.rx(r"\blewandowsk\w*", r"\bkubic\w*", r"\bmusk\w*", r"\bkulczyk\w*", r"\bsolorz\w*", r"\bglapinsk\w*",
                                                    r"\bowsiak\w*", r"\bznan\w* (?:milioner|miliarder|biznesmen|celebryt)\w*",
                                                    r"\b(?:prezydent|premier|prezes nbp)\w* (?:zainwestowal|poleca|ujawnil)\w*"), 35),
    ("odzyskiwanie", "„Odzyskamy Twoje środki”", T.rx(r"odzysk\w* (?:twoje |utracon\w* )?(?:pieniadz|srodk|kapital)\w*", r"recover\w* (?:your )?(?:funds|money)"), 40),
    ("minimalna_wplata", "Niska wpłata na start z obietnicą zysku", T.rx(r"(?:od|tylko|juz od|zacznij od|wplac) ?\$? ?(?:50|99|100|200|250|500) ?(?:zl|pln|eur|euro|usd|\$|dolar)\w*"), 20),
    ("bot_ai", "Automatyczny bot/AI „zarabia za Ciebie”", T.rx(r"\bbot\w* (?:tradingow|inwestycyjn|ai|zarabia)\w*", r"\bai (?:zarabia|inwestuje|trader)\w*",
                                                                 r"\bzarabia (?:za ciebie|sam|automatycznie)\b", r"\bautomatyczn\w* (?:zysk|dochod|zarabian)\w*",
                                                                 r"\bquantum ai\b", r"\bimmediate (?:edge|connect|momentum)\b",
                                                                 r"\b(?:ai|crypto|trading|forex) (?:trading )?bots?\b", r"\beasy (?:gains|money|profits?)\b",
                                                                 r"\bmakes? money (?:for you|while you sleep)\b"), 30),
    ("bez_wiedzy", "„Bez wiedzy i doświadczenia”", T.rx(r"bez (?:zadnej )?(?:wiedzy|doswiadczenia)", r"nie musisz (?:sie znac|nic robic|miec doswiadczenia)",
                                                      r"\bkazdy moze zarobic\b", r"no experience (?:needed|required)", r"\banyone can (?:earn|make)\b"), 15),
]
PAID = T.rx(r"#ad\b", r"#reklama", r"#wspolprac\w*", r"#sponsor\w*", r"#partner\w*", r"wspolprac\w* (?:reklamow|platn|komercyjn)\w*", r"material\w* sponsorowan\w*",
            r"\bpaid partnership\b", r"\bpartnerem (?:materialu|odcinka|filmu)\b", r"\bsponsorem\b")
AFFILIATE = T.rx(r"\bkod\w* (?:polecaj|rabat|promocyj|partnersk)\w*", r"\blink\w* (?:afiliac|partnersk|polecaj)\w*", r"link w bio", r"z moim (?:kodem|linkiem)",
                 r"\bbonus\w* na start", r"\bodbierz\w* (?:bonus|darmow)\w*")
ADVISOR = T.rx(r"\bsygnal\w* (?:transakcyjn|kupna|sprzedazy|tradingow)\w*", r"\bkopiuj\w* (?:moje )?transakcj\w*", r"\bcopy ?trading\b", r"\bgrup\w* (?:premium|vip)\b",
               r"\bkanal\w* (?:premium|vip)\b", r"\bmentoring\w*", r"\bkonsultacj\w*", r"\bdoradz\w*", r"\bportfel\w* (?:modelow|dla ciebie)\w*")


def run(doc: Doc, m3_classification: str, watch_hits: list[dict]) -> dict:
    from .rules_m2 import promises
    s = doc.sentences
    claims = return_claims(s)
    unrealistic = [c for c in claims if (c["annual_pct"] or 0) >= UNREALISTIC_ANNUAL or (c.get("multiplier") and c["annual_pct"] is None)]
    high = [c for c in claims if REALISTIC_ANNUAL <= (c["annual_pct"] or 0) < UNREALISTIC_ANNUAL]
    guarantee = [x for x in s if promises(x.text)]

    signals = []
    for key, label, pat, weight in SCAM_SIGNALS:
        hits = [x for x in s if T.has(pat, x.text)]
        if hits:
            signals.append({"key": key, "label": label, "weight": weight, "evidence": [h.text[:300] for h in hits[:2]]})
    if guarantee:
        signals.append({"key": "gwarancja", "label": "Gwarancja zysku / brak ryzyka", "weight": 35, "evidence": [g.text[:300] for g in guarantee[:2]]})
    if unrealistic:
        signals.append({"key": "nierealne_zyski", "label": "Nierealistyczna stopa zwrotu", "weight": 35, "evidence": [c["text"][:300] for c in unrealistic[:2]]})
    warned = [h for h in watch_hits if h["list"] in ("knf_warnings", "esma_ncasp")]
    if warned:
        signals.append({"key": "lista_ostrzezen", "label": "Podmiot z listy ostrzeżeń KNF/ESMA", "weight": 45,
                        "evidence": [f"{h['name']} ({h['matched_by']})" for h in warned[:2]]})
    keep = 1.0
    for sig in signals:
        keep *= 1 - sig["weight"] / 100
    scam_score = round(100 * (1 - keep))

    paid = [x for x in s if T.has(PAID, x.text)]
    affiliate = [x for x in s if T.has(AFFILIATE, x.text)]
    advisor = m3_classification in ("indywidualne_doradztwo", "usługa_doradcza_ogólna") or any(T.has(ADVISOR, x.text) for x in s)

    tags = []
    if scam_score >= 55 or (len(signals) >= 3 and scam_score >= 45):
        primary = "podejrzenie_oszustwa"
    elif advisor:
        primary = "doradca_finansowy"
    elif paid or affiliate:
        primary = "płatna_promocja"
    elif m3_classification == "edukacja":
        primary = "edukacja"
    else:
        primary = "informacja"
    if paid:
        tags.append("współpraca oznaczona")
    elif affiliate:
        tags.append("afiliacja bez oznaczenia")
    if advisor and primary != "doradca_finansowy":
        tags.append("oferta doradcza")
    if unrealistic:
        tags.append("nierealistyczne obietnice")
    elif high:
        tags.append("wysokie obietnice zysku")
    if signals and primary != "podejrzenie_oszustwa":
        tags.append("sygnały oszustwa")

    findings: list[Finding] = []
    if unrealistic or high:
        worst = max(unrealistic or high, key=lambda c: c["annual_pct"] or 0)
        rate = f" (≈ {worst['annual_pct']:.0f}% w skali roku)" if worst["annual_pct"] else ""
        historical = all(c["historical"] for c in (unrealistic or high))
        status = FAIL if unrealistic and not historical else WARN
        findings.append(Finding(
            "m1", "M1.9", "Nierealistyczne obietnice zysku" if unrealistic else "Wysokie obietnice zysku", status,
            55 if status == FAIL else 25, "art. 5 ustawy o przeciwdziałaniu nieuczciwym praktykom rynkowym",
            f"Obiecywana stopa zwrotu: „{worst['claim']}”{(' ' + worst['period']) if worst['period'] else ''}{rate}. "
            + ("Bezpieczne instrumenty dają kilka procent rocznie – tak wysoka obietnica wskazuje na wprowadzanie w błąd."
               if unrealistic else "Obietnica znacznie powyżej rynkowych stóp zwrotu – wymaga uzasadnienia i ostrzeżenia o ryzyku.")
            + (" Dotyczy wyników historycznych." if historical else ""),
            [ev(c["text"], "obietnica zysku", annual_pct=c["annual_pct"]) for c in (unrealistic or high)[:3]]))
    strong = [x for x in signals if x["key"] != "nierealne_zyski"]
    if strong and (scam_score >= 45 or len(strong) >= 2):
        findings.append(Finding(
            "m1", "M1.10", "Sygnały oszustwa inwestycyjnego", FAIL if scam_score >= 55 else WARN, min(85, scam_score), "art. 286 k.k. (sygnał, nie dowód)",
            f"Wzorce typowe dla oszustw inwestycyjnych: {', '.join(x['label'].lower() for x in strong)}. Wynik sygnałów {scam_score}/100 – do weryfikacji.",
            [ev(e, x["label"]) for x in strong[:4] for e in x["evidence"][:1]]))
    if advisor and unrealistic:
        findings.append(Finding(
            "m3", "M3.5", "Doradca z nierealistycznymi obietnicami", FAIL, 50, "art. 76 u.o.i.f.; art. 5 u.p.n.p.r.",
            "Oferta doradcza połączona z obietnicą nierealistycznej stopy zwrotu.", [ev(c["text"], "obietnica") for c in unrealistic[:2]]))
    return {
        "findings": findings,
        "profile": {"primary": primary, "tags": tags, "scam_score": scam_score, "signals": signals,
                    "returns": claims[:10], "paid": bool(paid), "affiliate": bool(affiliate), "advisor": advisor},
    }

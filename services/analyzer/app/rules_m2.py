"""Moduł 2 – weryfikacja zgodności i informacji o ryzyku.

18 reguł z załącznika UKNF (+ G1: zakazane obietnice). Reguły tekstowe działają na zdaniach,
reguły wizualne (4-8) na pomiarach z renderu Playwright (desktop/tablet/telefon).
Wynik każdej reguły: status, waga, uzasadnienie i fragmenty tekstu (evidence).
"""
from __future__ import annotations

import re
from collections import Counter
from statistics import mean

from . import text as T
from .model import FAIL, NA, NOT_CHECKED, PASS, WARN, Doc, Finding, ev
from .registry import extract_entity_names, get_registry

R = "rozp. del. 2017/565"
CATALOG = {
    "1": ("Identyfikacja firmy", f"art. 44 ust. 2 lit. a {R}", 35),
    "2": ("Oznaczenie reklamy", "art. 24 ust. 3 MiFID II", 30),
    "3": ("Informacja o ryzyku przy zyskach", f"art. 44 ust. 2 lit. b {R}", 60),
    "4": ("Rozmiar czcionki ryzyka", f"art. 44 ust. 2 lit. c {R}", 40),
    "5": ("Ekspozycja i kontrast ryzyka", f"art. 44 ust. 2 lit. c i e {R}", 40),
    "6": ("Ukrywanie ryzyka", f"art. 44 ust. 2 lit. e {R}", 40),
    "7": ("Dostępność za 1 kliknięciem", f"art. 44 ust. 2 lit. b i e {R}", 50),
    "8": ("Responsywność", f"art. 44 ust. 2 lit. g {R}", 45),
    "9": ("Zrozumiałość ostrzeżenia", f"art. 44 ust. 2 lit. d {R}", 15),
    "10": ("Spójność językowa", f"art. 44 ust. 2 lit. f {R}", 50),
    "11": ("Porównania produktów/usług", f"art. 44 ust. 3 {R}", 45),
    "12a": ("Wyniki historyczne – okres i zakres", f"art. 44 ust. 4 {R}", 30),
    "12b": ("Wyniki historyczne – waluta i koszty", f"art. 44 ust. 4 {R}", 25),
    "13": ("Dominacja wyników historycznych", f"art. 44 ust. 4 lit. a {R}", 30),
    "14": ("Ostrzeżenie przy wynikach historycznych", f"art. 44 ust. 4 lit. d {R}", 40),
    "15": ("Prognozy przyszłych wyników", f"art. 44 ust. 6 {R}", 40),
    "16": ("Informacja podatkowa", f"art. 44 ust. 7 {R}", 40),
    "17": ("Sugerowanie aprobaty organu nadzoru", f"art. 44 ust. 8 {R}", 60),
    "18": ("Nadzór jako argument bezpieczeństwa", f"art. 44 ust. 8 {R}", 60),
    "G1": ("Obietnice zysku bez ryzyka", f"art. 44 ust. 2 lit. b {R} (rzetelny, niewprowadzający w błąd przekaz)", 70),
}
VISUAL_RULES = {"4", "5", "6", "7", "8"}
MIN_WARNING_SECONDS = 3   # wideo: minimalny czas wyświetlania ostrzeżenia (czytelność planszy)


def F(rule_id: str, status: str, explanation: str, evidence: list[dict] | None = None, severity: int | None = None) -> Finding:
    title, basis, weight = CATALOG[rule_id]
    return Finding("m2", rule_id, title, status, weight if severity is None else severity, basis, explanation, evidence or [])


class Ctx:
    """Wyniki wstępnej klasyfikacji zdań wspólne dla wszystkich reguł."""

    def __init__(self, doc: Doc):
        self.doc = doc
        s = doc.sentences
        self.profit = [x for x in s if T.has(T.PROFIT, x.text) or x.labels.get("profit", 0) > 0.6]
        # „bez ryzyka” / „zero ryzyka” to obietnica, a nie ostrzeżenie – usuwamy takie frazy przed detekcją
        self.risk = [x for x in s if is_risk_warning(x.text) or (x.labels.get("risk", 0) > 0.6 and not promises(x.text))]
        # wynik historyczny = odniesienie do przeszłości + liczba (%), z wyłączeniem prognoz
        self.hist = [x for x in s if T.has(T.HIST, x.text) and PCT.search(x.text) and not T.has(T.FORECAST, x.text)]
        self.promotional = bool(self.profit) or any(T.has(T.CTA, x.text) for x in s)
        if doc.has_layout:
            self.dom_font = dominant_font([b for b in doc.blocks("desktop")
                                           if not T.has(T.RISK, b["text"]) and not b.get("in_footer")] or doc.blocks("desktop"))
            self.risk_blocks = {vp: [b for b in doc.blocks(vp) if is_risk_warning(b["text"])] for vp in ("desktop", "tablet", "mobile")}
        else:
            self.dom_font, self.risk_blocks = None, {}


def is_risk_warning(text: str) -> bool:
    return bool(T.RISK.search(T.GUARANTEE.sub(" ", T.fold(text))))


def promises(text: str) -> bool:
    """Obietnica zysku/bezpieczeństwa niezaprzeczona w zdaniu."""
    return T.has_affirmed(T.GUARANTEE, text)


def dominant_font(blocks: list[dict]) -> float | None:
    c: Counter = Counter()
    for b in blocks:
        if b.get("visible"):
            c[round(b["font_size"])] += len(b["text"])
    return float(c.most_common(1)[0][0]) if c else None


PCT = re.compile(r"\d+(?:[.,]\d+)?\s?%")


def near(a, others, window: int = 1) -> bool:
    return any(abs(o.idx - a.idx) <= window for o in others)


# ---------------------------------------------------------------------------- reguły tekstowe
def r1(c: Ctx) -> Finding:
    if not c.promotional:
        return F("1", NA, "Materiał nie ma cech przekazu promocyjnego.")
    reg = get_registry()
    firms = reg.find_in_text(c.doc.text, c.doc.domain)
    if firms and all(f.get("demo") for f in firms):
        return F("1", PASS, "W materiale wskazano nazwę firmy z danych DEMO (podmiot fikcyjny, nie wpis w rejestrze KNF).",
                 [ev(f["name"], "rejestr DEMO", category=f["category"]) for f in firms[:5]])
    if firms:
        return F("1", PASS, "W materiale wskazano nazwę firmy inwestycyjnej z rejestru KNF.",
                 [ev(f["name"], "rejestr", category=f["category"]) for f in firms[:5] if not f.get("demo")])
    names = extract_entity_names(c.doc.text)
    if names:
        return F("1", WARN, "Wskazano podmiot z formą prawną, ale nie odnaleziono go w lokalnym rejestrze firm inwestycyjnych KNF – do weryfikacji.",
                 [ev(n) for n in names[:5]], severity=20)
    return F("1", FAIL, "Nie znaleziono oficjalnej nazwy firmy inwestycyjnej (ani podmiotu z formą prawną).")


def r2(c: Ctx) -> Finding:
    denials = [x for x in c.doc.sentences if T.has(T.DENIAL_AD, x.text)]
    labels = [x for x in c.doc.sentences if T.has_affirmed(T.AD_LABEL, x.text) and not T.has(T.DENIAL_AD, x.text)]
    if denials and c.promotional:
        return F("2", FAIL, "Materiał o cechach promocyjnych zaprzecza swojemu reklamowemu charakterowi.",
                 [ev(x.text, "zaprzeczenie") for x in denials[:3]])
    if labels:
        return F("2", PASS, "Materiał jest oznaczony jako reklamowy/marketingowy.", [ev(x.text) for x in labels[:3]])
    if not c.promotional:
        return F("2", NA, "Materiał nie ma cech przekazu promocyjnego (brak twierdzeń o zyskach i wezwań do działania).")
    return F("2", FAIL, "Materiał promocyjny nie zawiera oznaczenia „reklama” / „materiał marketingowy”.")


def r3(c: Ctx) -> Finding:
    if not c.profit:
        return F("3", NA, "Nie wykryto twierdzeń o potencjalnych zyskach.")
    if not c.risk:
        return F("3", FAIL, "Twierdzeniom o zyskach nie towarzyszy żadna informacja o ryzyku.",
                 [ev(x.text, "zysk") for x in c.profit[:4]], severity=80)
    lonely = [x for x in c.profit if not near(x, c.risk, 2)]
    profit_chars = sum(len(x.text) for x in c.profit)
    risk_chars = sum(len(x.text) for x in c.risk)
    ratio = risk_chars / max(profit_chars, 1)
    evid = [ev(x.text, "zysk bez ryzyka w sąsiedztwie") for x in lonely[:3]] + [ev(c.risk[0].text, "ryzyko")]
    if lonely and len(lonely) / len(c.profit) > 0.5:
        return F("3", FAIL, f"{len(lonely)} z {len(c.profit)} twierdzeń o zyskach nie ma informacji o ryzyku w bezpośrednim sąsiedztwie "
                 f"(proporcja treści ryzyko/zysk = {ratio:.2f}).", evid)
    if ratio < 0.3:
        return F("3", WARN, f"Informacja o ryzyku jest nieproporcjonalnie krótka względem treści o zyskach (ryzyko/zysk = {ratio:.2f}).", evid)
    return F("3", PASS, f"Twierdzeniom o zyskach towarzyszy informacja o ryzyku (ryzyko/zysk = {ratio:.2f}).", [ev(c.risk[0].text, "ryzyko")])


def g1(c: Ctx) -> Finding:
    hits = [x for x in c.doc.sentences if promises(x.text)]
    if hits:
        phrases = sorted({p for x in hits for p in T.affirmed(T.GUARANTEE, x.text)})
        return F("G1", FAIL, f"Wykryto sformułowania sugerujące zysk bez ryzyka: {', '.join(phrases)}.", [ev(x.text) for x in hits[:4]])
    return F("G1", PASS, "Nie wykryto obietnic gwarantowanego zysku ani braku ryzyka.")


def _syllables(word: str) -> int:
    return max(1, len(re.findall(r"[aeiouyąęó]+", word.lower())))


def r9(c: Ctx) -> Finding:
    if not c.risk or not c.promotional:
        return F("9", NA, "Brak ostrzeżenia o ryzyku w materiale promocyjnym do oceny.")
    txt = " ".join(x.text for x in c.risk)
    words = re.findall(r"[\wąćęłńóśźż]+", txt.lower())
    sents = max(len(c.risk), 1)
    hard = sum(_syllables(w) >= 4 for w in words) / max(len(words), 1)
    fog = 0.4 * (len(words) / sents + 100 * hard)  # indeks FOG-PL (uproszczony, jak w Jasnopisie)
    jargon = T.find_all(T.JARGON, txt)
    evid = [ev(c.risk[0].text, "ostrzeżenie", fog=round(fog, 1))]
    if fog > 22 or len(jargon) >= 2:
        return F("9", FAIL, f"Ostrzeżenie trudne w odbiorze (FOG≈{fog:.0f}; żargon: {', '.join(jargon) or 'brak'}).", evid)
    if fog > 17 or jargon:
        return F("9", WARN, f"Ostrzeżenie średnio zrozumiałe (FOG≈{fog:.0f}; żargon: {', '.join(jargon) or 'brak'}).", evid)
    return F("9", PASS, f"Ostrzeżenie sformułowane przystępnie (FOG≈{fog:.0f}).", evid)


def r10(c: Ctx) -> Finding:
    if not c.risk:
        return F("10", NA, "Brak ostrzeżenia o ryzyku do oceny.")
    risk_ids = {x.idx for x in c.risk}
    votes: dict[str, int] = {}
    for x in c.doc.sentences:
        l = T.detect_lang(x.text) if x.idx not in risk_ids else None
        if l:
            votes[l] = votes.get(l, 0) + len(x.text)
    main = max(votes, key=votes.get) if votes else c.doc.lang
    langs = [(x, T.detect_lang(x.text)) for x in c.risk]
    other = [x for x, l in langs if l and main and l != main]
    same = [x for x, l in langs if l == main]
    if other and not same:
        return F("10", FAIL, f"Ostrzeżenie o ryzyku podano w innym języku ({T.detect_lang(other[0].text)}) niż główny przekaz ({main}).",
                 [ev(x.text) for x in other[:3]])
    if other:
        return F("10", WARN, "Część ostrzeżeń jest w innym języku niż główny przekaz.", [ev(x.text) for x in other[:3]], severity=15)
    return F("10", PASS, f"Ostrzeżenie w języku głównego przekazu ({main}).")


def r11(c: Ctx) -> Finding:
    comp = [x for x in c.doc.sentences if T.has(T.COMPARISON, x.text)]
    if not comp:
        return F("11", NA, "Nie wykryto porównań produktów lub usług.")
    has_src = any(T.has(T.SOURCE, x.text) for x in c.doc.sentences)
    has_ass = any(T.has(T.ASSUMPTION, x.text) for x in c.doc.sentences)
    missing = [n for n, ok in (("źródła danych", has_src), ("założeń porównania", has_ass)) if not ok]
    if len(missing) == 2:
        return F("11", FAIL, "Porównanie bez wskazania źródła i założeń.", [ev(x.text) for x in comp[:3]])
    if missing:
        return F("11", WARN, f"Porównanie bez wskazania {missing[0]}.", [ev(x.text) for x in comp[:3]])
    return F("11", PASS, "Porównanie wskazuje źródło i założenia.", [ev(comp[0].text)])


YEAR_PCT = re.compile(r"((?:19|20)\d\d)[^.\n]{0,40}?[-+]?\d+(?:[.,]\d+)?\s?%")


def r12a(c: Ctx) -> Finding:
    if not c.hist:
        return F("12a", NA, "Nie wykryto prezentacji wyników historycznych.")
    years = sorted({int(y) for x in c.hist for y in YEAR_PCT.findall(x.text)})
    full = T.has(T.HIST, " ".join(x.text for x in c.hist)) and any(
        re.search(r"od poczatku (?:dzialalnosci|istnienia)|5 lat|pieciu lat", T.fold(x.text)) for x in c.hist)
    ref = any(T.has(T.REF_PERIOD, x.text) for x in c.doc.sentences)
    src = any(T.has(T.SOURCE, x.text) for x in c.doc.sentences)
    problems = []
    if len(years) < 5 and not full:
        problems.append(f"wyniki obejmują {len(years) or 'nieokreśloną liczbę'} lat zamiast ostatnich 5 pełnych okresów 12-miesięcznych")
    if not ref:
        problems.append("brak wskazania okresu referencyjnego")
    if not src:
        problems.append("brak źródła danych")
    evid = [ev(x.text, "wynik historyczny") for x in c.hist[:3]]
    if len(problems) >= 2:
        return F("12a", FAIL, "; ".join(problems).capitalize() + ".", evid)
    if problems:
        return F("12a", WARN, problems[0].capitalize() + ".", evid)
    return F("12a", PASS, "Wyniki historyczne obejmują wymagany okres, z okresem referencyjnym i źródłem.", evid)


def r12b(c: Ctx) -> Finding:
    if not c.hist:
        return F("12b", NA, "Nie wykryto prezentacji wyników historycznych.")
    t = c.doc.text
    problems = []
    if T.has(T.FX, t) and not T.has(T.FX_WARN, t):
        problems.append("brak ostrzeżenia o wpływie zmian kursów walut")
    if not T.has(T.FEES_WARN, t):
        problems.append("brak informacji o wpływie prowizji, opłat i innych obciążeń")
    if problems:
        return F("12b", FAIL if len(problems) == 2 else WARN, "; ".join(problems).capitalize() + ".", [ev(c.hist[0].text, "wynik historyczny")])
    return F("12b", PASS, "Wskazano wpływ kosztów (i walut, jeśli dotyczy) na wyniki.")


def r13(c: Ctx) -> Finding:
    if not c.hist:
        return F("13", NA, "Nie wykryto prezentacji wyników historycznych.")
    if c.doc.has_layout and c.dom_font:
        blocks = [b for b in c.doc.blocks("desktop") if b.get("visible")]
        if blocks:
            biggest = max(blocks, key=lambda b: (b["font_size"], -b["y"]))
            if T.has(T.HIST, biggest["text"]) or YEAR_PCT.search(biggest["text"]):
                return F("13", FAIL, f"Wynik historyczny jest najbardziej wyeksponowanym elementem (czcionka {biggest['font_size']:.0f}px).",
                         [ev(biggest["text"], "nagłówek", font_size=biggest["font_size"])])
            return F("13", PASS, "Wyniki historyczne nie są najbardziej wyeksponowanym elementem.")
    if c.doc.title and (T.has(T.HIST, c.doc.title) or YEAR_PCT.search(c.doc.title)):
        return F("13", WARN, "Wynik historyczny występuje w tytule materiału.", [ev(c.doc.title, "tytuł")])
    return F("13", PASS, "Wyniki historyczne nie dominują w przekazie (ocena tekstowa).")


def r14(c: Ctx) -> Finding:
    if not c.hist:
        return F("14", NA, "Nie wykryto prezentacji wyników historycznych.")
    disc = [x for x in c.doc.sentences if T.has(T.HIST_DISCLAIMER, x.text)]
    if disc:
        return F("14", PASS, "Zawarto zastrzeżenie, że wyniki historyczne nie są wiarygodnym wskaźnikiem przyszłych wyników.", [ev(disc[0].text)])
    return F("14", FAIL, "Brak zastrzeżenia, że wyniki historyczne nie stanowią wiarygodnego wskaźnika przyszłych wyników.",
             [ev(x.text, "wynik historyczny") for x in c.hist[:3]])


def r15(c: Ctx) -> Finding:
    fc = [x for x in c.doc.sentences if T.has(T.FORECAST, x.text) and not T.has(T.FORECAST_WARN, x.text)]
    if not fc:
        return F("15", NA, "Nie wykryto prognoz przyszłych wyników.")
    warn = [x for x in c.doc.sentences if T.has(T.FORECAST_WARN, x.text)]
    if warn:
        return F("15", WARN, "Wykryto prognozę przyszłych wyników (flaga raportowa); ostrzeżenie jest obecne.",
                 [ev(x.text, "prognoza") for x in fc[:3]] + [ev(warn[0].text, "ostrzeżenie")], severity=10)
    return F("15", FAIL, "Wykryto prognozę przyszłych wyników bez ostrzeżenia, że nie jest ona wiarygodnym wskaźnikiem.",
             [ev(x.text, "prognoza") for x in fc[:3]])


def r16(c: Ctx) -> Finding:
    tax = [x for x in c.doc.sentences if T.has(T.TAX, x.text)]
    if not tax:
        return F("16", NA, "Materiał nie odwołuje się do traktowania podatkowego.")
    ok = [x for x in c.doc.sentences if T.has(T.TAX, x.text) and T.has(T.TAX_WARN, x.text)] or \
         [x for x in c.doc.sentences if T.has(T.TAX_WARN, x.text) and near(x, tax, 2)]
    if ok:
        return F("16", PASS, "Wskazano zależność od indywidualnej sytuacji klienta / możliwość zmian.", [ev(ok[0].text)])
    return F("16", FAIL, "Odwołanie do podatków bez informacji, że zależą od indywidualnej sytuacji klienta i mogą ulec zmianie.",
             [ev(x.text) for x in tax[:3]])


def r17_18(c: Ctx) -> list[Finding]:
    sup = [x for x in c.doc.sentences if T.has(T.SUPERVISOR, x.text)]
    if not sup:
        return [F("17", NA, "Brak odwołań do KNF lub innego organu nadzoru."), F("18", NA, "Brak odwołań do organu nadzoru.")]
    appr = [x for x in sup if T.has(T.APPROVAL, x.text)]
    safe = [x for x in sup if T.has(T.SAFETY, x.text)] + \
           [x for x in c.doc.sentences if T.has(T.SAFETY, x.text) and near(x, sup, 1) and not T.has(T.RISK, x.text)]
    safe = [x for x in safe if not T.has(T.RISK, x.text) or promises(x.text)]
    f17 = F("17", FAIL, "Odwołanie do organu nadzoru sugeruje zatwierdzenie lub aprobatę produktu/usługi.", [ev(x.text) for x in appr[:3]]) if appr \
        else F("17", PASS, "Odwołanie do organu nadzoru ma charakter informacyjny (bez sugerowania aprobaty).", [ev(sup[0].text)])
    f18 = F("18", FAIL, "Nadzór organu przedstawiono jako argument bezpieczeństwa inwestycji.", [ev(x.text) for x in safe[:3]]) if safe \
        else F("18", PASS, "Nie wykorzystano nadzoru jako argumentu bezpieczeństwa.")
    return [f17, f18]


# ---------------------------------------------------------------------------- reguły wizualne
def _vis(blocks):
    return [b for b in blocks if b.get("visible") and not b.get("in_collapsed") and b.get("w", 0) > 0 and b.get("h", 0) > 0]


def r4(c: Ctx) -> Finding:
    rb = _vis(c.risk_blocks.get("desktop", []))
    if not rb or not c.dom_font:
        return F("4", NA if c.risk_blocks.get("desktop") is not None and not rb else NOT_CHECKED, "Brak widocznego ostrzeżenia do pomiaru czcionki.")
    best = max(rb, key=lambda b: b["font_size"])
    ratio = best["font_size"] / c.dom_font
    evid = [ev(best["text"], "ostrzeżenie", font_size=best["font_size"], dominant=c.dom_font, ratio=round(ratio, 2))]
    if ratio < 0.75 or best["font_size"] < 10:
        return F("4", FAIL, f"Czcionka ostrzeżenia {best['font_size']:.0f}px wobec przeważającej {c.dom_font:.0f}px (stosunek {ratio:.2f}).", evid)
    if ratio < 0.9:
        return F("4", WARN, f"Czcionka ostrzeżenia mniejsza niż przeważająca ({best['font_size']:.0f}px vs {c.dom_font:.0f}px).", evid)
    return F("4", PASS, f"Czcionka ostrzeżenia porównywalna z przeważającą ({best['font_size']:.0f}px vs {c.dom_font:.0f}px).", evid)


def r5(c: Ctx) -> Finding:
    rb = _vis(c.risk_blocks.get("desktop", []))
    if not rb:
        return F("5", NOT_CHECKED if not c.doc.has_layout else NA, "Brak widocznego ostrzeżenia do oceny ekspozycji.")
    best = max(rb, key=lambda b: (b["contrast"], -b["y"]))
    problems = []
    if best["contrast"] < 3:
        problems.append(f"bardzo niski kontrast {best['contrast']}:1 (WCAG wymaga ≥4,5:1)")
    elif best["contrast"] < 4.5:
        problems.append(f"niski kontrast {best['contrast']}:1 (WCAG ≥4,5:1)")
    if all(b.get("occluded") for b in rb):
        problems.append("ostrzeżenie jest przesłonięte przez inny element")
    if best.get("opacity", 1) < 0.6:
        problems.append(f"obniżona przezroczystość ({best['opacity']})")
    profit_blocks = [b for b in _vis(c.doc.blocks("desktop")) if T.has(T.PROFIT, b["text"])]
    vh = (c.doc.layout["viewports"]["desktop"] or {}).get("height", 768)
    if c.doc.is_video:
        # w wideo „dwa ekrany niżej” nie ma sensu (klatki ułożone jedna pod drugą) – liczy się czas na ekranie
        longest = max((b.get("seen_s") or 0) for b in rb)
        if longest and longest < MIN_WARNING_SECONDS:
            problems.append(f"ostrzeżenie na ekranie zbyt krótko – ok. {longest:.1f} s (min. {MIN_WARNING_SECONDS} s do przeczytania)")
    elif profit_blocks and min(b["y"] for b in rb) - min(b["y"] for b in profit_blocks) > 2 * vh:
        problems.append("ostrzeżenie umieszczone ponad dwa ekrany niżej niż twierdzenia o zyskach")
    evid = [ev(best["text"], "ostrzeżenie", contrast=best["contrast"], color=best["color"], bg=best["bg"], y=best["y"])]
    if any("bardzo niski" in p or "przesłonięte" in p or "zbyt krótko" in p for p in problems) or len(problems) >= 2:
        return F("5", FAIL, "; ".join(problems).capitalize() + ".", evid)
    if problems:
        return F("5", WARN, problems[0].capitalize() + ".", evid)
    return F("5", PASS, f"Ostrzeżenie czytelne (kontrast {best['contrast']}:1, nieprzesłonięte).", evid)


def r6(c: Ctx) -> Finding:
    all_rb = c.risk_blocks.get("desktop", [])
    rb = _vis(all_rb)
    if c.doc.is_video and not all_rb and is_risk_warning(c.doc.spoken):
        said = next((x.text for x in c.doc.sentences if is_risk_warning(x.text) and x.text in c.doc.spoken), c.doc.spoken[:200])
        return F("6", WARN, "Ostrzeżenie o ryzyku pada wyłącznie w ścieżce dźwiękowej – brak napisu na ekranie "
                 "(widz oglądający bez dźwięku go nie zobaczy).", [ev(said, "mowa (transkrypcja)")])
    if not all_rb:
        return F("6", NOT_CHECKED if not c.doc.has_layout else NA, "Brak ostrzeżenia w treści strony.")
    if not rb:
        return F("6", NA, "Ostrzeżenie nie jest widoczne bez interakcji – ocenione w regule 7.")
    prominent = [b for b in rb if not b.get("in_footer") and not b.get("in_fine_print")]
    if prominent:
        return F("6", PASS, "Ostrzeżenie występuje poza stopką i przypisami.", [ev(prominent[0]["text"], "treść główna")])
    where = "przypisie/drobnym druku" if any(b.get("in_fine_print") for b in all_rb) else         ("dolnej krawędzi kadru" if c.doc.is_video else "stopce/sekcji „Legal”")
    return F("6", FAIL, f"Ostrzeżenie o ryzyku znajduje się wyłącznie w {where}.", [ev(b["text"], where) for b in all_rb[:3]])


def r7(c: Ctx) -> Finding:
    if not c.doc.has_layout:
        return F("7", NOT_CHECKED, "Brak renderu strony.")
    if c.doc.is_video:
        return F("7", NA, "Wideo – brak elementów do rozwinięcia; widoczność i czas ekspozycji oceniają reguły 4–6.")
    if c.doc.is_image:
        return F("7", NA, "Obraz statyczny – brak elementów do rozwinięcia; widoczność oceniają reguły 4–6.")
    all_rb = c.risk_blocks.get("desktop", [])
    visible = _vis(all_rb)
    risk_links = [l for l in c.doc.links if T.has(T.RISK, l.get("text", ""))]
    if visible and any(not b.get("is_link") for b in visible):
        return F("7", PASS, "Ostrzeżenie jest widoczne bez dodatkowych akcji.", [ev(visible[0]["text"])])
    if all_rb:
        return F("7", FAIL, "Ostrzeżenie wymaga rozwinięcia sekcji / otwarcia okna – nie jest widoczne bezpośrednio.",
                 [ev(b["text"], "ukryte (zwinięte/modal)") for b in all_rb[:3]])
    if risk_links:
        return F("7", FAIL, "Informacja o ryzyku dostępna wyłącznie po przejściu pod link.",
                 [ev(f"{l['text']} → {l['href']}", "link") for l in risk_links[:3]])
    return F("7", NA, "Brak ostrzeżenia na stronie (ocenione w regule 3).")


def r8(c: Ctx) -> Finding:
    if not c.doc.has_layout:
        return F("8", NOT_CHECKED, "Brak renderu strony.")
    if c.doc.is_image or c.doc.is_video:
        return F("8", NOT_CHECKED, f"{'Wideo' if c.doc.is_video else 'Obraz'} w jednym formacie – responsywności nie da się ocenić.")
    desk = _vis(c.risk_blocks.get("desktop", []))
    if not desk:
        return F("8", NA, "Brak widocznego ostrzeżenia na desktopie.")
    problems, evid = [], []
    for vp in ("tablet", "mobile"):
        blocks = c.risk_blocks.get(vp, [])
        vis = _vis(blocks)
        if not vis:
            problems.append(f"{vp}: ostrzeżenie niewidoczne")
            continue
        b = max(vis, key=lambda b: b["font_size"])
        if b.get("clipped") or b.get("clipped_y") or b.get("offscreen_x"):
            problems.append(f"{vp}: tekst ostrzeżenia ucięty / poza ekranem")
            evid.append(ev(b["text"], vp))
        if b["font_size"] < 10:
            problems.append(f"{vp}: czcionka {b['font_size']:.0f}px poniżej czytelności")
            evid.append(ev(b["text"], vp, font_size=b["font_size"]))
    if problems:
        return F("8", FAIL, "; ".join(problems) + ".", evid)
    return F("8", PASS, "Ostrzeżenie czytelne na desktopie, tablecie i telefonie.")


def highlights(doc: Doc, limit: int = 40) -> list[dict]:
    """Prostokąty (desktop) do podświetlenia na zrzucie: ostrzeżenia o ryzyku i obietnice zysku."""
    if not doc.has_layout:
        return []
    blocks = doc.blocks("desktop")
    vis = [b for b in blocks if b.get("visible") and b.get("w", 0) > 0]
    dom = dominant_font([b for b in vis if not is_risk_warning(b["text"])]) or 16
    out = []
    for b in blocks:
        if b.get("w", 0) <= 0 or b.get("h", 0) <= 0:
            continue
        if is_risk_warning(b["text"]):
            kind = "risk"
        elif promises(b["text"]) or T.has(T.PROFIT, b["text"]):
            kind = "profit"
        else:
            continue
        issues = []
        if kind == "risk":
            if b["font_size"] / dom < 0.75 or b["font_size"] < 10:
                issues.append(f"czcionka {b['font_size']:.0f}px [4]")
            if b.get("contrast", 21) < 4.5:
                issues.append(f"kontrast {b['contrast']}:1 [5]")
            if b.get("occluded"):
                issues.append("przesłonięte [5]")
            if b.get("in_footer") or b.get("in_fine_print"):
                issues.append("stopka/przypis [6]")
        out.append({"kind": kind, "x": b["x"], "y": b["y"], "w": b["w"], "h": b["h"], "text": b["text"][:160], "issues": issues})
        if len(out) >= limit:
            break
    return out


def run(doc: Doc) -> list[Finding]:
    c = Ctx(doc)
    out = [r1(c), r2(c), r3(c), g1(c)]
    if doc.has_layout:
        out += [r4(c), r5(c), r6(c), r7(c), r8(c)]
    elif doc.is_video:
        # wideo bez napisów na ekranie (albo bez OCR) – ocenić można tylko ostrzeżenie wypowiedziane
        out += [F(r, NOT_CHECKED, "Wideo bez rozpoznanego tekstu na ekranie – reguła wymaga napisów w kadrze.") for r in ("4", "5", "7", "8")]
        out.append(r6(c))
    else:
        out += [F(r, NOT_CHECKED, "Brak renderu wizualnego (materiał tekstowy) – reguła wymaga Playwright.") for r in ("4", "5", "6", "7", "8")]
    out += [r9(c), r10(c), r11(c), r12a(c), r12b(c), r13(c), r14(c), r15(c), r16(c), *r17_18(c)]
    order = list(CATALOG)
    return sorted(out, key=lambda f: order.index(f.rule_id))


def avg(xs):
    return mean(xs) if xs else 0

"""Czy materiał dotyczy inwestycji / instrumentów finansowych?

Reguły informacji o ryzyku (Moduł 2) i ocena obietnic zysku (M1.9) mają sens tylko dla treści inwestycyjnych.
Bez tej bramki dowolna „darmowa kasa” (gry, karty podarunkowe Steam, konkursy) dostawała wysokie ryzyko,
bo twierdzenia o „zysku” nie miały obok ostrzeżenia o ryzyku. Kontekst inwestycyjny = co najmniej jeden
z sygnałów: instrument finansowy, firma inwestycyjna z rejestru, oferta doradcza, słownictwo inwestycyjne,
wzorce oszustw inwestycyjnych albo obietnica stopy zwrotu w czasie powiązana z zarabianiem.
"""
from __future__ import annotations

from . import text as T
from .model import Doc

# instrumenty bez „Surowce” (\bzlot\w* łapałby każde „złotych”); złoto tylko jako inwestycja
INSTRUMENT_KEYS = ("CFD", "Forex", "ETF", "Obligacje", "Kryptowaluty", "Opcje/kontrakty", "Zarządzanie portfelem")
# „akcja” (wydarzenie, promocja) i „fundusze” (np. „fundusze na Steama”, „fundusze unijne”) są wieloznaczne – tylko w kontekście rynku
STRICT = {
    "Akcje": T.rx(r"\bakcj\w* (?:spol\w*|firm\w*|na gield\w*|na gpw|dywidendow\w*|wzrostow\w*|amerykansk\w*|polsk\w* spol\w*)",
                  r"\b(?:kup\w*|sprzeda\w*|inwestowa\w*|inwestycj\w* w|kurs\w*|notowani\w*|portfel\w*) (?:w |na )?akcj\w*",
                  r"\bakcjonariusz\w*", r"\bstocks?\b", r"\bspol\w* gieldow\w*"),
    "Fundusze": T.rx(r"\bfundusz\w* (?:inwestycyjn|obligacji|akcji|akcyjn|emerytaln|indeksow|rynku pieniezn|zrownowazon|dluzn|nieruchomos|kryptowalut|etf)\w*",
                     r"\btfi\b", r"\bfio\b", r"\bfiz\b", r"\bjednost\w* uczestnictwa\b", r"\bmutual funds?\b", r"\binvestment funds?\b"),
}
GOLD = T.rx(r"\bzloto\b inwestycyjn\w*", r"\b(?:inwestowa\w*|inwestycj\w*) w zloto\b", r"\bsztabk\w* zlota\b", r"\buncj\w* zlota\b", r"\bgold\b")
INVEST_WORDS = T.rx(
    r"\binwest\w*", r"\binvest\w*", r"\bgield\w*", r"\bgpw\b", r"\btrading\w*", r"\btrader\w*", r"\bbroker\w*", r"\bmaklersk\w*",
    r"\bportfel\w* inwestycyjn\w*", r"\bstop\w* zwrotu\b", r"\bdywidend\w*", r"\blokat\w*", r"\bike\b", r"\bikze\b", r"\bppk\b",
    r"\bkapital\w*", r"\bpomnoz\w*", r"\bpasywn\w* dochod\w*", r"\bdochod\w* pasywn\w*", r"\bwolnosc\w* finansow\w*",
    r"\bnieruchomos\w* na wynajem\b", r"\bstock market\b", r"\bportfolio\b", r"\breturns?\b on investment", r"\broi\b",
)
INVEST_SCAM_KEYS = {"wplata_prywatna", "piramida", "znane_osoby", "odzyskiwanie", "minimalna_wplata", "bot_ai", "bez_wiedzy", "lista_ostrzezen"}
EARN = T.rx(r"\bzarabi\w*", r"\bzarobi\w*", r"\bzarobek\w*", r"\bzysk\w*", r"\bprofit\w*", r"\bearn\w*", r"\bpomnoz\w*", r"\bdochod\w*")


def investment_context(doc: Doc, firms: list, m3_classification: str, signals: list[dict], return_claims: list[dict]) -> dict:
    reasons: list[str] = []
    text = doc.text
    instruments = [k for k in INSTRUMENT_KEYS if T.has(T.INSTRUMENTS[k], text)] + [k for k, pat in STRICT.items() if T.has(pat, text)]
    if instruments:
        reasons.append("instrumenty: " + ", ".join(instruments))
    if T.has(GOLD, text):
        reasons.append("złoto inwestycyjne")
    if firms:
        reasons.append("firma z rejestru: " + ", ".join(f["name"] for f in firms[:2]))
    if m3_classification in ("indywidualne_doradztwo", "usługa_doradcza_ogólna", "planowanie_finansowe"):
        reasons.append("oferta doradcza")
    if any(T.has(INVEST_WORDS, x.text) for x in doc.sentences):
        reasons.append("słownictwo inwestycyjne")
    # tylko wzorce typowe dla oszustw inwestycyjnych – „zero ryzyka”, presja czasu czy „pisz na priv” bywają też w grach i konkursach
    strong = [s for s in signals if s["key"] in INVEST_SCAM_KEYS]
    if strong:
        reasons.append("wzorce oszustw inwestycyjnych: " + ", ".join(s["label"].lower() for s in strong[:2]))
    # „zarabiam 2% dziennie” – stopa zwrotu w czasie + zarabianie (sam „100%” bez okresu się nie liczy)
    if any(c.get("annual_pct") is not None and T.has(EARN, c.get("text", "")) for c in return_claims):
        reasons.append("obietnica stopy zwrotu")
    return {"investment": bool(reasons), "reasons": reasons}

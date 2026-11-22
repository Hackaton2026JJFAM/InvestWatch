"""Preprocessing: normalizacja, podział na zdania, wykrywanie języka, leksykony."""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text or "").replace(" ", " ")
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    return re.sub(r"\n\s*\n+", "\n", text).strip()


def fold(text: str) -> str:
    """Małe litery bez polskich znaków – do dopasowań odpornych na pisownię."""
    text = unicodedata.normalize("NFKD", text.lower()).replace("ł", "l")
    return "".join(c for c in text if not unicodedata.combining(c))


_SENT_RE = re.compile(r"(?<=[.!?…])\s+(?=[A-ZĄĆĘŁŃÓŚŹŻ0-9„\"*#(\[])|\n+")


@dataclass
class Sentence:
    idx: int
    text: str
    start: int
    labels: dict[str, float] = field(default_factory=dict)


def split_sentences(text: str) -> list[Sentence]:
    out, pos = [], 0
    for part in _SENT_RE.split(text):
        part_s = part.strip()
        if not part_s:
            pos += len(part)
            continue
        start = text.find(part_s, pos)
        out.append(Sentence(len(out), part_s[:1500], max(start, 0)))
        pos = max(start, 0) + len(part_s)
    return out


PL_STOP = {"i", "w", "na", "z", "że", "się", "nie", "do", "jest", "to", "o", "jak", "od", "dla", "lub", "może", "są",
           "oraz", "przez", "twoje", "twój", "inwestycji", "ryzyko", "kapitału", "środków", "być", "który", "które"}
EN_STOP = {"the", "and", "of", "to", "is", "in", "for", "your", "you", "are", "with", "may", "be", "on", "or", "that",
           "this", "lose", "money", "risk", "capital", "investment", "can", "not", "will"}


def detect_lang(text: str) -> str | None:
    words = re.findall(r"[a-ząćęłńóśźż]+", text.lower())
    if len(words) < 3:
        return None
    pl = sum(w in PL_STOP for w in words) + 2 * len(re.findall(r"[ąćęłńóśźż]", text.lower()))
    en = sum(w in EN_STOP for w in words)
    if pl == en == 0:
        return None
    return "pl" if pl >= en else "en"


def rx(*patterns: str) -> re.Pattern:
    return re.compile("|".join(f"(?:{p})" for p in patterns), re.I)


# --- Leksykony (dopasowanie na tekście po fold(), czyli bez polskich znaków) -------------
PROFIT = rx(
    r"\bzysk\w*", r"\bzarob\w*", r"\bzarabia\w*", r"stop[aey] zwrotu", r"\bzwrot\w* (?:z inwestycji|na poziomie|rzedu)",
    r"\d+(?:[.,]\d+)?\s?%\s?(?:rocznie|w skali roku|miesiecznie|tygodniowo|dziennie|zwrotu|zysku|p\.a\.)",
    r"\bnawet \d+(?:[.,]\d+)?\s?%", r"\bdochod\w*", r"\bpomnoz\w*", r"\bprofit\w*", r"\breturns?\b", r"\bearn\w*",
    r"\bgains?\b", r"\brentown\w*", r"\bwysok\w* oprocentowan\w*", r"\bpasywn\w* dochod\w*", r"\bwzrost\w* o \d+",
)
GUARANTEE = rx(
    r"gwarant\w* (?:zysk|zwrot|dochod|wynik)\w*", r"gwarancj\w* (?:zysk|zwrot|dochod)\w*", r"bez (?:zadnego )?ryzyka",
    r"zero ryzyka", r"pewn\w* (?:inwestycj|zysk|zarob|dochod)\w*", r"100\s?% bezpieczn\w*", r"w pelni bezpieczn\w*",
    r"calkowicie bezpieczn\w*", r"nie (?:mozesz|da sie) (?:nic )?straci\w*", r"risk[- ]free", r"guaranteed (?:returns?|profits?)",
    r"bezpieczn\w* inwestycj\w* bez", r"zysk bez ryzyka",
)
RISK = rx(
    r"\bryzyk(?!owa|uj)\w*",  # bez czasownika „ryzykować” (np. „lubi ryzykować”)
    r"mozesz (?:\w+ )?straci\w*", r"utrat\w* (?:czesci |calosci |calego |zainwestowan\w* )?(?:kapital|srodk|zainwestowan)\w*",
    r"\bstrat\w*", r"zlozonymi instrumentami", r"\d+(?:[.,]\d+)?\s?% (?:rachunkow|kont) (?:inwestorow )?detalicznych",
    r"wartosc \w+ moze (?:spadac|spasc|male|ulec)", r"nie gwarantuj\w*", r"\brisk\w*", r"\blose\b", r"\bloss\w*",
    r"dzwigni\w* finansow\w*", r"wahani\w* (?:kurs|wartosc|cen)\w*",
)
AD_LABEL = rx(
    r"\breklam\w*", r"material\w* (?:reklamow|marketingow|promocyjn)\w*", r"komunikat\w* marketingow\w*",
    r"informacj\w* (?:promocyjn|handlow|reklamow)\w*", r"#ad\b", r"#sponsor\w*", r"#wspolprac\w*", r"#reklama",
    r"wspolprac\w* (?:reklamow|platn|komercyjn)\w*", r"\bsponsorowan\w*", r"platn\w* (?:wspolprac|partnerstw)\w*",
    r"marketing communication", r"\badvertisement\b", r"\bpaid partnership\b",
)
CTA = rx(r"\bzaloz\w* (?:konto|rachunek)", r"\botworz\w* (?:konto|rachunek)", r"\bdolacz\w*", r"\bzarejestruj\w*", r"\bzainwestuj\w*",
         r"\binwestuj\w*", r"\bkup\w* teraz", r"\bsign up\b", r"\bjoin\b", r"\bstart\w* (?:juz|teraz|inwest)", r"\bzapisz sie",
         r"\bodbierz\w* bonus", r"\bkod\w* (?:polecaj|rabat|promocyj)\w*")

HIST = rx(r"w (?:ostatnim|ubieglym|minionym|zeszlym) roku", r"w (?:latach|roku) (?:19|20)\d\d", r"od (?:19|20)\d\d\s?r",
          r"(?:wynik|stop[aey] zwrotu|zwrot|zysk|wzrost)\w*[^.]{0,60}(?:19|20)\d\d", r"historyczn\w*", r"\bytd\b",
          r"(?:przez|w ciagu) ostatni\w* \d+ (?:lat|miesiecy)", r"od poczatku (?:dzialalnosci|roku|istnienia)",
          r"(?:19|20)\d\d[^.]{0,40}\d+(?:[.,]\d+)?\s?%", r"past performance", r"\bzarobil\w*", r"\bwypracowal\w*")
HIST_DISCLAIMER = rx(r"(?:wyniki|stopy zwrotu|rezultaty)[^.]{0,60}(?:historyczn|osiagniet\w* w przeszlosci|z przeszlosci|archiwaln)[^.]{0,80}nie (?:sa|stanowia|gwarantuj)",
                     r"(?:historyczn|przeszl)\w* (?:wyniki|stopy zwrotu)[^.]{0,80}nie (?:sa|stanowia|gwarantuj)",
                     r"past performance is not", r"nie (?:stanowia|sa) (?:gwarancja|wiarygodnym wskaznikiem|gwarancji)[^.]{0,40}przyszl")
REF_PERIOD = rx(r"okres\w* (?:referencyjn|odniesienia)", r"\bza okres\b", r"od \d{1,2}[./]\d{1,2}[./](?:19|20)\d\d", r"(?:19|20)\d\d\s?[-–]\s?(?:19|20)\d\d",
                r"(?:12|dwunasto)\s?-?miesiecz\w*")
SOURCE = rx(r"\bzrodl\w*:?", r"\bwedlug\b", r"\bna podstawie\b", r"\bdane (?:z|ze|wg)\b", r"\bsource\b", r"\bwg\b")
FX = rx(r"\busd\b", r"\beur\b", r"\bchf\b", r"\bgbp\b", r"\bdolar\w*", r"\beuro\b", r"walu\w* obc\w*", r"\bw walucie\b")
FX_WARN = rx(r"kurs\w* walu\w*", r"zmian\w* kurs\w*", r"ryzyk\w* walutow\w*", r"currency (?:fluctuations|risk)")
FEES_WARN = rx(r"prowizj\w*", r"\boplat\w*", r"\bkoszt\w*", r"\bobciazen\w*", r"\bfees?\b", r"\bcharges\b")
FORECAST = rx(r"\bprognoz\w*", r"\bprzewiduj\w*", r"\bprognozowan\w*", r"\boczekiwan\w* (?:stop|zwrot|zysk|wynik)\w*",
              r"\bw (?:przyszlym|kolejnym|nastepnym) roku\b[^.]{0,60}(?:\d+\s?%|zysk|wzros)", r"\bosiagnie\b", r"\bpotencjal\w* (?:wzrost|zysk)\w*",
              r"\bcel\w* cenow\w*", r"\btarget\w*", r"\bdo (?:konca )?20[2-4]\d\b[^.]{0,60}(?:wzrosnie|osiagnie|\d+\s?%)", r"\bforecast\w*",
              r"\bzarobisz\b", r"\bbedzie (?:rosl|wart)\w*")
FORECAST_WARN = rx(r"prognoz\w*[^.]{0,80}nie (?:sa|stanowia|jest|stanowi|gwarantuj)", r"(?:przyszl\w* )?wynik\w*[^.]{0,40}moga (?:sie )?(?:roznic|odbiegac)",
                   r"nie (?:jest|stanowi|sa|stanowia) wiarygodnym wskaznikiem przyszl", r"forecasts? (?:are|is) not")
# odwołanie do traktowania podatkowego (korzyść/zwolnienie), a nie każda wzmianka o podatku
TAX = rx(r"\bike\b", r"\bikze\b", r"\bpodatk\w* belki\b", r"\bbez podatk\w*", r"\bnie (?:placisz|plac|zaplacisz)\w* (?:\d+\s?% )?podatk\w*",
         r"\bulg\w* podatk\w*", r"zwolni\w* z (?:podatk|opodatkow)\w*", r"\bkorzys\w* podatkow\w*", r"\bodlicz\w* od (?:podatk|dochod)\w*",
         r"\boptymalizacj\w* podatkow\w*", r"\btax[- ](?:free|benefit|advantage|relief)\w*", r"\bnieopodatkowan\w*")
TAX_WARN = rx(r"(?:zalez|uzalezn)\w*[^.]{0,40}(?:indywidualn|sytuacj)\w*", r"(?:moga|moze) (?:ulec )?zmian\w*", r"przepis\w*[^.]{0,30}(?:moga|moze)[^.]{0,20}zmien",
              r"individual circumstances", r"subject to change")
SUPERVISOR = rx(r"\bknf\b", r"komisj\w* nadzoru finansowego", r"\buknf\b", r"\besma\b", r"\bfca\b", r"\bcysec\b", r"\bbafin\b", r"\bamf\b",
                r"organ\w* nadzoru", r"\bnadzorowan\w*", r"\bregulowan\w* przez", r"\blicencj\w* (?:knf|cysec|fca)")
APPROVAL = rx(r"zatwierdz\w*", r"\baprob\w*", r"\bzaakcept\w*", r"\bakceptacj\w*", r"rekomend\w* (?:przez )?(?:knf|komisj)", r"(?:knf|komisj\w*) (?:poleca|rekomend|zatwierdz|popiera|gwarant)\w*",
                r"certyfik\w* (?:knf|nadzor)", r"\bendorse\w*", r"\bapproved by\b", r"\bpod (?:okiem|ochrona) knf\b", r"atest\w*")
SAFETY = rx(r"bezpieczn\w*", r"\bgwarant\w*", r"\bochron\w*", r"\bpewn\w*", r"spokojn\w*", r"nie musisz sie (?:martwic|obawiac)", r"\bsafe\w*", r"\bsecure\w*",
            r"\bzabezpiecz\w*", r"\bchronion\w*")
COMPARISON = rx(r"\blepsz\w* niz\b", r"\bw porownaniu\b", r"\bporown\w*", r"\bvs\.?\b", r"\bnajnizsz\w* (?:oplat|prowizj|spread|koszt)\w*", r"\btaniej niz\b",
                r"\bbije\w* (?:rynek|lokat|inflacj)\w*", r"\bprzewyzsz\w*", r"\bniz (?:lokat|konto oszczednosciowe|obligacj)\w*", r"\bnajlepsz\w* na rynku\b",
                r"\bw przeciwienstwie do\b", r"\b\d+\s?x wiecej\b", r"\bnr ?1\b", r"\blider\w* rynku\b")
ASSUMPTION = rx(r"\bzaloz\w*", r"\bprzy zalozeniu\b", r"\bmetodolog\w*", r"\bprzyjet\w*", r"\bassum\w*")
JARGON = rx(r"\bdrawdown\b", r"\bmargin call\b", r"\bleverage\b", r"\bslippage\b", r"\bkontrahent\w*", r"\bderywat\w*", r"\bdelta\b", r"\bvolatility\b",
            r"\bspread\w*", r"\bswap\w*", r"\blewarowan\w*")

INSTRUMENTS = {
    "CFD": rx(r"\bcfd\w*", r"kontrakt\w* na roznice"), "Forex": rx(r"\bforex\b", r"\bfx\b", r"par\w* walutow\w*"),
    "Akcje": rx(r"\bakcj\w*", r"\bstocks?\b", r"\bshares\b"), "ETF": rx(r"\betf\w*"), "Obligacje": rx(r"\bobligacj\w*", r"\bbonds?\b"),
    "Kryptowaluty": rx(r"\bkrypto\w*", r"\bbitcoin\w*", r"\bbtc\b", r"\bethereum\b", r"\bcrypto\w*", r"\btoken\w*", r"\bstablecoin\w*"),
    "Fundusze": rx(r"\bfundusz\w*", r"\btfi\b", r"\bfio\b", r"\bfiz\b"), "Opcje/kontrakty": rx(r"\bopcj\w* (?:binarn|walutow|na)\w*", r"\bkontrakt\w* terminow\w*", r"\bfutures\b"),
    "Surowce": rx(r"\bzlot\w*", r"\bsurowc\w*", r"\bropa\b", r"\bgold\b"),
    "Zarządzanie portfelem": rx(r"zarzadzani\w* portfel\w*", r"asset management", r"\bwealth management\b"),
}


NEGATION = re.compile(r"\b(?:nie|ani|zadn\w*|nigdy|no|not|never)\b")
DENIAL_AD = rx(r"\bnie (?:jest|stanowi) (?:to )?(?:reklam|material\w* (?:reklamow|marketingow|sponsorowan)|wspolprac)\w*",
               r"\bnie (?:jest|jestem) (?:sponsorowan|oplacon)\w*", r"\bthis is not an? (?:ad|advert)")


def affirmed(pattern: re.Pattern, text: str) -> list[str]:
    """Dopasowania niepoprzedzone negacją w tej samej części zdania („Nie obiecujemy gwarantowanego zysku”)."""
    f = fold(text)
    out = []
    for m in pattern.finditer(f):
        clause = re.split(r"[.,;:!?–-]", f[max(0, m.start() - 60):m.start()])[-1]
        if not NEGATION.search(clause):
            out.append(m.group(0))
    return out


def has_affirmed(pattern: re.Pattern, text: str) -> bool:
    return bool(affirmed(pattern, text))


def find_all(pattern: re.Pattern, text: str) -> list[str]:
    return sorted({m.group(0) for m in pattern.finditer(fold(text))})


def has(pattern: re.Pattern, text: str) -> bool:
    return bool(pattern.search(fold(text)))

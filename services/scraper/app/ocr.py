"""OCR obrazów reklam (Tesseract, pol+eng) -> materiał z blokami tekstu jak z renderu strony.

Współrzędne i wysokości liter są przeliczane na szerokość ekranu desktop (1366 px), więc reguły
wizualne (rozmiar czcionki ostrzeżenia, kontrast, położenie w stopce) działają z tymi samymi progami.
"""
from __future__ import annotations

import base64
import io
import re
import shutil
from collections import Counter, defaultdict
from statistics import median

from PIL import Image, ImageOps

TARGET_W = 1366
MAX_BYTES = 10 * 1024 * 1024
MIN_CONF = 40
GLYPH_TO_FONT = 0.72  # wysokość wielkich liter ≈ 0,72 rozmiaru czcionki
Image.MAX_IMAGE_PIXELS = 60_000_000  # ochrona przed „bombą dekompresyjną”


class OcrUnavailable(RuntimeError):
    pass


def available() -> bool:
    if not shutil.which("tesseract"):
        return False
    try:
        import pytesseract
        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


def decode_image(data: str) -> bytes:
    """Base64 lub data URL -> bajty (z limitem rozmiaru)."""
    if data.startswith("data:"):
        data = data.split(",", 1)[1]
    raw = base64.b64decode(data, validate=False)
    if len(raw) > MAX_BYTES:
        raise ValueError("Obraz przekracza 10 MB")
    return raw


def _luminance(v: float) -> float:
    c = v / 255
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def _contrast(gray: Image.Image, box: tuple[int, int, int, int]) -> float:
    """Kontrast tekst/tło w obszarze: percentyle jasności 10 i 90 (WCAG)."""
    region = gray.crop(box)
    hist = region.histogram()
    total = sum(hist)
    if not total:
        return 21.0

    def pct(p: float) -> int:
        acc = 0
        for i, n in enumerate(hist):
            acc += n
            if acc >= p * total:
                return i
        return 255

    lo, hi = _luminance(pct(0.10)), _luminance(pct(0.90))
    return round((max(lo, hi) + 0.05) / (min(lo, hi) + 0.05), 2)


def group_lines(data: dict) -> list[dict]:
    """Wynik image_to_data -> akapity (block, par) z liniami, ramką i medianą wysokości linii."""
    lines: dict[tuple, list[int]] = defaultdict(list)
    for i, word in enumerate(data["text"]):
        try:
            conf = float(data["conf"][i])
        except (TypeError, ValueError):
            conf = -1
        if word and word.strip() and conf >= MIN_CONF:
            lines[(data["block_num"][i], data["par_num"][i], data["line_num"][i])].append(i)
    paragraphs: dict[tuple, list[dict]] = defaultdict(list)
    for (b, p, l), idx in sorted(lines.items()):
        left = min(data["left"][i] for i in idx)
        top = min(data["top"][i] for i in idx)
        right = max(data["left"][i] + data["width"][i] for i in idx)
        bottom = max(data["top"][i] + data["height"][i] for i in idx)
        paragraphs[(b, p)].append({
            "text": " ".join(data["text"][i].strip() for i in sorted(idx, key=lambda i: data["left"][i])),
            "box": (left, top, right, bottom),
            "height": median(data["height"][i] for i in idx),
            "conf": sum(float(data["conf"][i]) for i in idx) / len(idx),
        })
    out = []
    for key, ls in paragraphs.items():
        out.append({
            "text": " ".join(x["text"] for x in ls),
            "box": (min(x["box"][0] for x in ls), min(x["box"][1] for x in ls), max(x["box"][2] for x in ls), max(x["box"][3] for x in ls)),
            "height": median(x["height"] for x in ls),
            "conf": sum(x["conf"] for x in ls) / len(ls),
        })
    return sorted(out, key=lambda b: (b["box"][1], b["box"][0]))


FAINT_THRESHOLD = 235  # piksele jaśniejsze niż ~92% bieli traktowane jako tło w 2. przebiegu


def to_original(p: dict, factor: int, pass_name: str) -> dict:
    """Akapit z obrazu powiększonego `factor` razy -> współrzędne oryginału."""
    return {**p, "box": tuple(v / factor for v in p["box"]), "height": p["height"] / factor, "pass": pass_name}


def _overlap(a: tuple, b: tuple) -> float:
    """Część mniejszej ramki pokryta przez drugą (0–1)."""
    w = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    h = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    smaller = min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1])) or 1
    return w * h / smaller


def ocr_image(raw: bytes) -> dict:
    if not available():
        raise OcrUnavailable("OCR niedostępny – brak programu tesseract (działa w obrazie Docker scrapera)")
    import pytesseract

    with Image.open(io.BytesIO(raw)) as probe:
        probe.verify()  # odrzuca uszkodzone/podejrzane pliki przed dekodowaniem
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
    w, h = img.size
    # małe obrazy powiększamy dla lepszego OCR; współrzędne wracają do skali oryginału
    up = 2 if w < 1000 else 1
    ocr_src = img.resize((w * up, h * up), Image.LANCZOS) if up > 1 else img
    data = pytesseract.image_to_data(ocr_src, lang="pol+eng", config="--psm 3", output_type=pytesseract.Output.DICT)
    paragraphs = [to_original(p, up, "standard") for p in group_lines(data)]
    gray = img.convert("L")

    # 2. przebieg: blady i drobny tekst (typowo ukryte ostrzeżenie) – progowanie jasności i powiększenie.
    # Kontrast mierzymy potem na ORYGINALE, więc reguły 4–5 wskażą rzeczywistą nieczytelność.
    up2 = 3 if max(w, h) <= 2500 else 2
    faint = gray.resize((w * up2, h * up2), Image.LANCZOS).point(lambda v: 0 if v < FAINT_THRESHOLD else 255)
    data2 = pytesseract.image_to_data(faint, lang="pol+eng", config="--psm 3", output_type=pytesseract.Output.DICT)
    for p in (to_original(x, up2, "faint") for x in group_lines(data2)):
        if len(p["text"]) >= 8 and not any(_overlap(p["box"], q["box"]) > 0.3 for q in paragraphs):
            paragraphs.append(p)
    paragraphs.sort(key=lambda b: (b["box"][1], b["box"][0]))

    scale = TARGET_W / w  # przeliczenie na ekran desktop 1366 px
    page_h = round(h * scale)

    blocks = []
    for p in paragraphs:
        l, t, r, b = p["box"]
        font = p["height"] * scale / GLYPH_TO_FONT
        blocks.append({
            "text": p["text"][:2000], "tag": "ocr", "font_size": round(font, 1), "font_size_min": round(font, 1), "font_weight": 400,
            "color": [0, 0, 0], "bg": [255, 255, 255], "contrast": _contrast(gray, (int(l), int(t), int(r) + 1, int(b) + 1)), "opacity": 1,
            "x": round(l * scale), "y": round(t * scale), "w": round((r - l) * scale), "h": round((b - t) * scale),
            "visible": True, "occluded": False, "clipped": False, "clipped_y": False, "offscreen_x": False,
            "in_footer": (t + b) / 2 > 0.88 * h, "in_fine_print": False, "in_collapsed": False, "in_modal": False,
            "is_link": False, "href": None, "ocr_conf": round(p["conf"], 1), "ocr_pass": p["pass"],
        })
    # drobny druk: czcionka wyraźnie mniejsza od przeważającej (ważonej liczbą znaków)
    weights: Counter = Counter()
    for bl in blocks:
        weights[round(bl["font_size"])] += len(bl["text"])
    dominant = weights.most_common(1)[0][0] if weights else None
    for bl in blocks:
        bl["in_fine_print"] = bool(dominant and bl["font_size"] < 0.65 * dominant)

    shot = img.resize((TARGET_W, page_h), Image.LANCZOS) if w != TARGET_W else img
    buf = io.BytesIO()
    shot.save(buf, format="JPEG", quality=70)
    text = "\n".join(bl["text"] for bl in blocks)
    words = [c for c in data["conf"] if str(c) not in ("-1", "")]
    return {
        "content_text": text,
        "full_text": text,
        "links": [{"text": u, "href": u if u.startswith("http") else f"https://{u}"} for u in sorted(set(re.findall(r"(?:https?://)?(?:www\.)?[a-z0-9-]+\.[a-z]{2,}(?:/\S*)?", text.lower())))][:50],
        "layout": {
            "engine": "ocr",
            "viewports": {"desktop": {"width": TARGET_W, "height": page_h, "page_height": page_h, "screenshot_height": page_h, "blocks": blocks}},
            "screenshot": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(),
            "ocr": {"image_size": [w, h], "paragraphs": len(blocks), "words": len(words),
                    "mean_conf": round(sum(float(c) for c in words) / len(words), 1) if words else None},
        },
    }

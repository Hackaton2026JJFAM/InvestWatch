"""Logika OCR bez Tesseracta: grupowanie wyników image_to_data i pomiar kontrastu."""
from PIL import Image, ImageDraw

from app import ocr


def test_group_lines_builds_paragraphs_with_boxes():
    data = {
        "text": ["Zarabiaj", "20%", "", "Ryzyko", "straty", "x"],
        "conf": [95, 90, -1, 88, 91, 10],
        "block_num": [1, 1, 1, 2, 2, 2], "par_num": [1, 1, 1, 1, 1, 1], "line_num": [1, 1, 1, 1, 1, 1],
        "left": [10, 120, 0, 10, 80, 200], "top": [10, 12, 0, 300, 300, 300],
        "width": [100, 40, 0, 60, 50, 5], "height": [30, 28, 0, 10, 10, 10],
    }
    paras = ocr.group_lines(data)
    assert [p["text"] for p in paras] == ["Zarabiaj 20%", "Ryzyko straty"]  # słowo o niskiej pewności pominięte
    assert paras[0]["box"] == (10, 10, 160, 40)
    assert paras[1]["height"] == 10


def test_contrast_detects_low_contrast_text():
    img = Image.new("L", (200, 40), 255)
    ImageDraw.Draw(img).rectangle((20, 10, 180, 30), fill=220)   # jasnoszary „tekst” na białym tle
    low = ocr._contrast(img, (0, 0, 200, 40))
    ImageDraw.Draw(img).rectangle((20, 10, 180, 30), fill=0)     # czarny na białym
    high = ocr._contrast(img, (0, 0, 200, 40))
    assert low < 2 and high > 15


def test_decode_image_rejects_oversized_payload():
    import base64
    import pytest
    big = base64.b64encode(b"0" * (ocr.MAX_BYTES + 1)).decode()
    with pytest.raises(ValueError):
        ocr.decode_image(big)


def test_to_original_and_overlap():
    p = ocr.to_original({"text": "x", "box": (30, 60, 90, 90), "height": 30, "conf": 90}, 3, "faint")
    assert p["box"] == (10, 20, 30, 30) and p["height"] == 10 and p["pass"] == "faint"
    assert ocr._overlap((0, 0, 10, 10), (5, 5, 15, 15)) == 0.25
    assert ocr._overlap((0, 0, 10, 10), (20, 20, 30, 30)) == 0

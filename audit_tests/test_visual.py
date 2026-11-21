"""Realny render syntetycznych HTML i ocena M2; bez danych osobowych."""
import httpx
import pytest

from test_http import ANA, SCR, rule


def render_and_analyze(html):
    response = httpx.post(SCR + "/scrape/html", json={
        "html": html, "url": "https://audit.example/visual", "render": True,
    }, timeout=120)
    assert response.status_code == 200, response.text
    material = response.json()
    assert material["layout"]["engine"] == "playwright"
    response = httpx.post(ANA + "/analyze", json=material, timeout=120)
    assert response.status_code == 200, response.text
    return material, response.json()


def html(style="", risk_style="", extra="", wrapper=""):
    risk = f'<p class="risk" style="{risk_style}">Inwestowanie wiąże się z ryzykiem utraty całego kapitału.</p>'
    if wrapper:
        risk = wrapper.format(risk=risk)
    return f"""<html lang="pl"><head><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>body {{font:16px Arial;color:black;background:white;}} {style}</style></head>
    <body><main><p>Materiał marketingowy. Dom Maklerski Vistula Capital S.A.</p>
    <p>Akcje mogą przynieść zysk. Inwestuj.</p>{extra}{risk}</main></body></html>"""


def test_three_viewports_and_screenshot():
    material, result = render_and_analyze(html())
    assert set(material["layout"]["viewports"]) == {"desktop", "tablet", "mobile"}
    assert material["layout"]["screenshot"].startswith("data:image/jpeg;base64,")
    assert all(rule(result, r)["status"] == "pass" for r in ("4", "5", "6", "7", "8"))


@pytest.mark.parametrize("markup,key", [
    (html(risk_style="font-size:6px"), "4"),
    (html(risk_style="color:#eeeeee"), "5"),
    (html(wrapper="<footer>{risk}</footer>"), "6"),
    (html(wrapper="<details><summary>Ryzyko</summary>{risk}</details>"), "7"),
    (html(style="@media(max-width:500px){.risk{display:none}}"), "8"),
])
def test_visual_violation(markup, key):
    _, result = render_and_analyze(markup)
    assert rule(result, key)["status"] == "fail", rule(result, key)


def test_risk_absent_from_content_text_still_in_full_text():
    material, result = render_and_analyze(html(wrapper="</main><footer>{risk}</footer><main>"))
    assert "ryzykiem" in material["full_text"]
    assert rule(result, "6")["status"] == "fail"


def test_mobile_vertical_clipping_is_detected():
    _, result = render_and_analyze(html(style="""
        @media(max-width:500px){.risk{max-height:1px;overflow:hidden;width:300px}}
    """))
    assert rule(result, "8")["status"] == "fail", rule(result, "8")


def test_delayed_javascript_risk_is_extracted():
    material, _ = render_and_analyze(html(
        extra="""<script>document.addEventListener('DOMContentLoaded',()=>{
        let el=document.createElement('p');el.textContent='Syntetyczna treść dynamiczna';
        document.querySelector('main').appendChild(el);});</script>"""))
    assert "Syntetyczna treść dynamiczna" in material["content_text"]


def test_block_positions_match_document():
    material, _ = render_and_analyze(html(extra=
        '<p style="margin-top:2000px">Blok kontrolny po przewinięciu.</p>'
        '<p style="margin-top:1000px">Kolejny blok kontrolny.</p>'))
    blocks = material["layout"]["viewports"]["desktop"]["blocks"]
    positions = [b["y"] for b in blocks if "blok kontrolny" in b["text"].lower()]
    assert len(positions) == 2
    assert positions[1] > positions[0] + 900, positions

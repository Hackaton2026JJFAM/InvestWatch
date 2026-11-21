"""Render w Playwright: pomiar warstwy wizualnej dla reguł 4-8 (czcionka, kontrast,
przesłonięcie, ukrycie, responsywność) na trzech viewportach."""
from __future__ import annotations

import base64
import logging

from playwright.async_api import Browser, async_playwright

from .net import next_proxy, random_ua, validate_url

log = logging.getLogger("scraper.render")

VIEWPORTS = {
    "desktop": {"width": 1366, "height": 768},
    "tablet": {"width": 768, "height": 1024},
    "mobile": {"width": 375, "height": 812},
}

# Zbiera bloki tekstu z obliczonymi stylami. Blok = najbliższy przodek blokowy
# węzłów tekstowych; rozmiar czcionki ważony liczbą znaków.
LAYOUT_JS = r"""
() => {
  const MAX = 600;
  const INLINE = new Set(['inline', 'inline-block', 'contents']);
  const vw = window.innerWidth, vh = window.innerHeight;
  const parseRGBA = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return [0,0,0,0];
    const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [p[0],p[1],p[2],p.length>3?p[3]:1]; };
  const lum = ([r,g,b]) => { const f = c => { c/=255; return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4); };
    return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
  const bgOf = (el) => { let bg = [255,255,255];
    for (let e = el; e; e = e.parentElement) { const c = parseRGBA(getComputedStyle(e).backgroundColor);
      if (c[3] > 0.5) { bg = c.slice(0,3); break; } } return bg; };
  const blockOf = (el) => { let e = el; while (e && e !== document.body && INLINE.has(getComputedStyle(e).display)) e = e.parentElement; return e || document.body; };
  const opacityOf = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity || '1'); return o; };
  const groups = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.nodeValue.trim() && n.parentElement && !['SCRIPT','STYLE','NOSCRIPT','TEMPLATE'].includes(n.parentElement.tagName)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
  let node;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement; const block = blockOf(parent);
    if (!groups.has(block)) groups.set(block, []);
    groups.get(block).push({ node, parent });
    if (groups.size > MAX) break;
  }
  const scrollX = window.scrollX, scrollY = window.scrollY;
  const out = [];
  for (const [block, parts] of groups) {
    const text = parts.map(p => p.node.nodeValue).join(' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const sizes = {}; let weight = 400, color = null, fsMin = 1e9;
    for (const { node, parent } of parts) {
      const cs = getComputedStyle(parent); const fs = parseFloat(cs.fontSize);
      sizes[fs] = (sizes[fs] || 0) + node.nodeValue.trim().length; fsMin = Math.min(fsMin, fs);
      if (!color) { color = parseRGBA(cs.color); weight = parseInt(cs.fontWeight) || 400; }
    }
    const fontSize = Number(Object.entries(sizes).sort((a,b) => b[1]-a[1])[0][0]);
    const r = block.getBoundingClientRect();
    const visible = block.checkVisibility ? block.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : r.width > 0;
    const bg = bgOf(block); const L1 = lum(color.slice(0,3)), L2 = lum(bg);
    const contrast = (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
    const opacity = opacityOf(block);
    let occluded = false;
    if (visible && r.width > 0 && r.height > 0) {
      const docY = r.top + window.scrollY; window.scrollTo(0, Math.max(0, docY - vh/2));
      const rr = block.getBoundingClientRect();
      const cx = Math.min(Math.max(rr.left + rr.width/2, 1), vw-1), cy = Math.min(Math.max(rr.top + rr.height/2, 1), vh-1);
      const hit = document.elementFromPoint(cx, cy);
      occluded = !!hit && hit !== block && !block.contains(hit) && !hit.contains(block);
    }
    const cs = getComputedStyle(block);
    const clipped = (block.scrollWidth > block.clientWidth + 2 && ['hidden','clip'].includes(cs.overflowX)) || cs.textOverflow === 'ellipsis' && block.scrollWidth > block.clientWidth;
    const link = block.closest('a');
    out.push({
      text: text.slice(0, 2000), tag: block.tagName.toLowerCase(),
      font_size: fontSize, font_size_min: fsMin, font_weight: weight,
      color: color.slice(0,3), bg, contrast: Math.round(contrast*100)/100, opacity: Math.round(opacity*100)/100,
      x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height),
      visible, occluded, clipped: !!clipped,
      offscreen_x: r.right > vw + 2 || r.left < -2,
      in_footer: !!block.closest('footer,[class*="footer" i],[id*="footer" i],[class*="legal" i],[id*="legal" i],[class*="disclaimer" i]'),
      in_fine_print: !!block.closest('small,sup,sub,[class*="fine" i],[class*="footnote" i],[class*="przypis" i]'),
      in_collapsed: !!block.closest('details:not([open]),[aria-hidden="true"],[hidden],[class*="collapse" i]:not(.show),[class*="accordion" i] [class*="content" i]'),
      in_modal: !!block.closest('[role="dialog"],dialog,[class*="modal" i]'),
      is_link: !!link, href: link ? link.href : null,
    });
  }
  window.scrollTo(scrollX, scrollY);
  return { width: vw, height: vh, page_height: document.documentElement.scrollHeight, blocks: out };
}
"""


class Renderer:
    def __init__(self) -> None:
        self._pw = None
        self._browser: Browser | None = None
        self.available = False

    async def start(self) -> None:
        try:
            self._pw = await async_playwright().start()
            self._browser = await self._pw.chromium.launch(args=["--no-sandbox"])
            self.available = True
        except Exception as exc:  # brak przeglądarki = tryb tylko-tekst
            log.warning("Playwright niedostępny, reguły wizualne wyłączone: %s", exc)

    async def stop(self) -> None:
        if self._browser:
            await self._browser.close()
        if self._pw:
            await self._pw.stop()

    async def render(self, url: str | None = None, html: str | None = None) -> dict:
        if not self.available:
            return {"engine": "none", "reason": "playwright_unavailable"}
        proxy = next_proxy()
        context = await self._browser.new_context(
            user_agent=random_ua(), viewport=VIEWPORTS["desktop"], locale="pl-PL",
            proxy={"server": proxy} if proxy else None, java_script_enabled=True,
        )
        # Każde żądanie (także przekierowania i zasoby) przechodzi walidację SSRF.
        async def guard(route):
            req_url = route.request.url
            if req_url.startswith(("data:", "blob:", "about:")):
                return await route.continue_()
            try:
                validate_url(req_url)
            except ValueError:
                return await route.abort()
            await route.continue_()

        await context.route("**/*", guard)
        page = await context.new_page()
        try:
            if html is not None:
                await page.set_content(html, wait_until="load", timeout=20000)
            else:
                await page.goto(url, wait_until="domcontentloaded", timeout=25000)
                try:
                    await page.wait_for_load_state("networkidle", timeout=5000)
                except Exception:
                    pass
            final_url = page.url
            page_html = await page.content()
            viewports = {}
            screenshot = None
            for name, size in VIEWPORTS.items():
                await page.set_viewport_size(size)
                await page.wait_for_timeout(150)
                viewports[name] = await page.evaluate(LAYOUT_JS)
                if name == "desktop":
                    shot = await page.screenshot(type="jpeg", quality=55, full_page=False)
                    screenshot = "data:image/jpeg;base64," + base64.b64encode(shot).decode()
            return {"engine": "playwright", "final_url": final_url, "html": page_html,
                    "viewports": viewports, "screenshot": screenshot}
        finally:
            await context.close()

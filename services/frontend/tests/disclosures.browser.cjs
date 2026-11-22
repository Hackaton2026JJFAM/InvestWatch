// Run against `npm run preview -- --port 4173`.
// Playwright is optional test tooling, not an application dependency.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');

const material = {
  id: 1, title: 'Test analizy inwestycyjnej', url: 'https://example.com/oferta',
  author: 'Autor testowy', platform: 'web', views: 12000, followers: 4500,
  score: 78, risk: 'wysokie', status: 'NEW', modules: ['m1', 'm2'],
  fetched_at: '2026-11-22', tags: ['inwestycje'], content_hash: 'abcdef0123456789',
  content_text: 'Pełna treść źródłowa',
};
const entity = { id: 1, name: 'Firma Testowa', kind: 'company', registry_status: 'unknown', materials: 1, max_score: 78, created_at: '2026-11-22' };
const stats = { totals: { materials: 2, high: 2, new: 1, unread: 1, to_verify: 2 }, threshold: 45, byModule: [], byRule: [], trend: [], recent: [material] };
const fixtures = {
  '/health': { scraper: { playwright: true, ocr: true }, analyzer: true },
  '/dashboard/stats': stats,
  '/materials': { items: [material, { ...material, id: 2, title: 'Drugi materiał' }], total: 2, page: 1, size: 25, threshold: 45 },
  '/materials/1': {
    material, analysis: { id: 1, score: 78, result: {
      m1: { publisher: { name: 'Autor testowy', type: 'podmiot_trzeci' } },
      profile: { primary: 'informacja', tags: ['test'], scam_score: 45,
        returns: [{ claim: '2%', period: 'dziennie', annual_pct: 730, text: 'Obietnica w materiale źródłowym' }],
        signals: [{ key: 'test', label: 'Sygnał testowy', weight: 30, evidence: ['Pierwszy cytat', 'Drugi cytat'] }],
      },
    }, module_scores: {} },
    findings: [{ id: 1, rule_id: 'R1', module: 'm2', title: 'Brak ostrzeżenia', status: 'fail', explanation: 'Uzasadnienie testowe', legal_basis: 'Podstawa testowa', evidence: [{ text: 'Cytat źródłowy', where: 'tekst' }] }],
    entities: [entity], history: [{ id: 1, created_at: '2026-11-22', score: 78, modules: ['m2'], analyzer_version: 'test' }], threshold: 45, risk: 'wysokie',
  },
  '/summary/1': { engine: 'template', summary: 'Sygnał wymaga weryfikacji.', points: [] },
  '/entities': [entity, { ...entity, id: 2, name: 'Drugi podmiot' }],
  '/entities/1': { entity, registries: {
    krs: { status: 'found', checked_at: '2026-11-22', data: { name: entity.name, krs: '0000000001', legal_form: 'spółka', capital: { value: 100000, currency: 'PLN' }, address: 'Adres testowy', representation: 'Reprezentacja testowa', persons: [{ name: 'Osoba testowa', role: 'zarząd', function: 'prezes' }] } },
    knf_warnings: { checked_at: '2026-11-22', data: { hits: [{ name: 'Test ostrzeżenia', matched_by: 'nazwa', legal_basis: 'Test podstawy', prosecutor: 'Prokuratura testowa' }] } },
    gleif: { data: { exact: '12345678901234567890', records: [{ lei: '12345678901234567890', name: 'Test LEI', country: 'PL', entity_status: 'ACTIVE', source_url: 'https://example.com/lei' }] } },
    esma_mica: { checked_at: '2026-11-22', data: { casp: [{ name: 'Test CASP', country: 'PL', authority: 'Organ testowy', services: ['Usługa testowa'] }] } },
  }, materials: [{ ...material, role: 'advertised_firm' }], persons: [], timeline: [], krsCandidates: [] },
  '/alerts': [{ id: 1, material_id: 1, ...material, read: false, threshold: 45, created_at: '2026-11-22' }],
  '/scans': [{ id: 1, material_id: 1, url: material.url, status: 'failed', error: 'Błąd testowy zadania', attempts: 2, trigger: 'manual', created_at: '2026-11-22' }],
  '/sources': [{ id: 1, url: material.url, enabled: false }],
  '/watch': [{ id: 1, query: 'Test monitoringu', kind: 'hashtag', platform: 'youtube', enabled: false, materials: 1, min_views: 1000, max_per_run: 10 }],
  '/tags/popular': { trending: [], phrases: ['testowa fraza'] },
  '/discover/video': { items: [{ ...material, passes: false, platform: 'youtube', lang: 'pl' }], platforms: ['youtube'] },
  '/search': { entities: [entity], materials: [{ ...material, snippet: 'Fragment wyniku wyszukiwania' }], registry: [{ name: 'Test KNF', category: 'firma inwestycyjna', country: 'PL', score: 90 }] },
  '/registries/gleif': [{ lei: '12345678901234567890', name: 'Test GLEIF', country: 'PL', entity_status: 'ACTIVE' }],
  '/reserves': {
    latest: { entity_id: 1, report_date: '2026-11-22', data: { min_coverage: 1.1, below_one: [], audit_id: 'test-report', source_url: 'https://example.com/raport', merkle_root: 'test-merkle', fetched_at: '2026-11-22', assets: [{ coin: 'BTC', name: 'Bitcoin', liabilities: 100, reserves: 110, coverage: 1.1 }] } },
    history: [{ id: 1, audit_id: 'test-report', report_date: '2026-11-22', coverage: 1.1, below_one: [] }],
    alerts: [], ageDays: 1, staleDays: 45,
  },
};

async function assertNoOverflow(page, context) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Document overflow: ${context}`);
}
async function assertTextContrast(page) {
  const failures = await page.evaluate(() => {
    const rgb = s => s.match(/[\d.]+/g).map(Number);
    const lum = c => c.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0);
    const bad = [];
    for (const el of document.querySelectorAll('main *')) {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || el.closest('svg, option, script')) continue;
      if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
      let parent = el, bg;
      while (parent) {
        const c = rgb(getComputedStyle(parent).backgroundColor);
        if (c.length === 3 || c[3] === 1) { bg = c; break; }
        parent = parent.parentElement;
      }
      if (!bg) continue;
      const fg = rgb(getComputedStyle(el).color);
      const ratio = (Math.max(lum(fg), lum(bg)) + .05) / (Math.min(lum(fg), lum(bg)) + .05);
      if (ratio < 4.5) bad.push([el.tagName, el.textContent.slice(0, 60), ratio.toFixed(2)]);
    }
    return bad;
  });
  assert.deepEqual(failures, []);
}

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname.replace('/api', '');
      return route.fulfill({ json: fixtures[path] ?? {} });
    });
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const path of ['/', '/materials', '/alerts', '/entities', '/scan', '/monitor', '/materials/1', '/materials/1?test=publisher', '/entities/1', '/entities/1?test=registry', '/entities/1?test=warnings', '/search?q=Test', '/reserves']) {
        await page.goto((process.env.TEST_URL || 'http://127.0.0.1:4173') + path);
        await page.locator('h1').waitFor();
        if (path === '/materials/1') await page.getByRole('tab', { name: 'Przesłanki', exact: true }).click();
        if (path === '/materials/1?test=publisher') await page.getByRole('tab', { name: 'Publikujący', exact: true }).click();
        if (path === '/entities/1') await page.getByRole('button', { name: 'Materiały (1)', exact: true }).click();
        if (path === '/entities/1?test=registry') await page.getByRole('button', { name: 'Rejestry i osoby', exact: true }).click();
        if (path === '/monitor') {
          await page.getByRole('button', { name: '„testowa fraza”', exact: true }).click();
          await page.getByText(material.title, { exact: true }).waitFor();
        }
        const disclosures = page.locator('.record-details:visible');
        await disclosures.first().waitFor();
        assert(await disclosures.evaluateAll(items => items.every(el => !el.open)));
        const record = disclosures.first();
        const body = record.locator('> .record-details-body');
        assert.equal(await body.isVisible(), false, `Collapsed body visible: ${path}`);
        await assertNoOverflow(page, `${path} collapsed at ${width}`);
        const summary = record.locator('> summary');
        await page.keyboard.press('Tab');
        await summary.focus();
        await page.keyboard.press('Enter');
        await body.waitFor({ state: 'visible' });
        assert.equal(await summary.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
        assert.equal(await record.evaluate(el => el.open), true);
        if (await disclosures.count() > 1) assert.equal(await disclosures.nth(1).evaluate(el => el.open), false);
        // Opening all visible records checks long metadata and nested disclosures, too.
        for (let i = 0; i < await disclosures.count(); i++) {
          const item = disclosures.nth(i);
          if (!(await item.evaluate(el => el.open))) await item.locator('> summary').click();
        }
        await assertNoOverflow(page, `${path} expanded at ${width}`);
        await assertTextContrast(page);
        if (path === '/materials/1') {
          assert(await page.getByText('Uzasadnienie testowe', { exact: true }).isVisible());
          assert(await page.getByText('„Cytat źródłowy”', { exact: true }).isVisible());
          assert(await page.getByText('Podstawa testowa', { exact: true }).isVisible());
        }
        if (path === '/scan') assert(await page.getByText('Błąd testowy zadania', { exact: true }).isVisible());
        await summary.click();
        assert.equal(await body.isVisible(), false);
        console.log(`PASS ${width}px ${path}: collapsed / expanded / keyboard / contrast`);
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

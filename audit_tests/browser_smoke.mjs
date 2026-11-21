// Smoke w prawdziwym Edge/Chromium; bez mocków API.
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
const req = createRequire(path.join(process.env.AUDIT_NODE_ROOT, 'package.json'));
const { chromium } = req('playwright');
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const out = { browser: browser.version(), routes: [], errors: [], responses: [] };
page.on('pageerror', e => out.errors.push({ type: 'pageerror', text: e.message }));
page.on('console', m => {
  if (['warning', 'error'].includes(m.type())) out.errors.push({ type: m.type(), text: m.text() });
});
page.on('response', r => {
  if (r.status() >= 400) out.responses.push({ status: r.status(), url: r.url() });
});
try {
  for (const route of ['/', '/materials', '/alerts', '/entities', '/search', '/calibration', '/scan']) {
    await page.goto('http://127.0.0.1:5173' + route);
    await page.locator('h1').waitFor();
    await page.getByText('Na żywo (WebSocket)', { exact: true }).waitFor();
    await page.waitForTimeout(150);
    out.routes.push({
      route, heading: await page.locator('h1').innerText(),
      body: (await page.locator('main').innerText()).slice(0, 5000),
    });
    await page.screenshot({ path: `audit_tests/results/smoke-${route.slice(1) || 'dashboard'}.png` });
  }
  const old = (await (await fetch('http://127.0.0.1:4000/api/settings')).json()).threshold;
  try {
    await page.goto('http://127.0.0.1:5173/calibration');
    const slider = page.getByRole('slider', { name: 'Próg ryzyka' });
    await slider.fill('100');
    await page.getByRole('button', { name: 'Zapisz próg 100', exact: true }).click();
    await page.getByText('Nowy próg ryzyka: 100', { exact: true }).waitFor();
    out.thresholdSave = await (await fetch('http://127.0.0.1:4000/api/settings')).json();
  } finally {
    await fetch('http://127.0.0.1:4000/api/settings', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ threshold: old }),
    });
  }
} catch (e) { out.fatal = e.stack; process.exitCode = 1; }
finally {
  await fs.writeFile('audit_tests/results/browser-smoke.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
}

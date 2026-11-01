// In-browser flight stacks: inject faults in each scene and confirm reflex → strategy → new program. Also captures
// the scene cards and the summon panel. Usage: node scripts/stacks-preview.mjs [baseUrl] [sceneIds...]
import { chromium } from '@playwright/test';
const [base = 'http://127.0.0.1:8000', ...only] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => console.log('PAGE ERROR', e.message));
await page.goto(base);
await page.evaluate(() => localStorage.removeItem('aether-run')); await page.reload();
await page.getByRole('heading', { name: 'What should we work on?' }).waitFor();
await page.locator('.shelf').scrollIntoViewIfNeeded(); await page.waitForTimeout(600);
await page.locator('.shelf').screenshot({ path: 'output/stacks-cards.png' });

const plan = {
  rover: { faults: ['Wheel motor fault', 'Unmapped boulder'], speed: '10×' },
  launch: { faults: ['Gimbal fault', 'Engine out'], speed: '8×', waitFirst: 9000 },
  flyby: { faults: ['RCS fault', 'Engine out', 'Pyro failure'], speed: '0.5×' },
};
const feed = async n => (await page.locator('.stack-feed li strong').allInnerTexts()).slice(0, n).join(' | ');
for (const [id, p] of Object.entries(plan)) {
  if (only.length && !only.includes(id)) continue;
  const card = page.locator(`.scene-card.card-${id}`);
  if (!(await card.getByRole('button', { name: 'Open' }).isVisible())) { await card.getByRole('button', { name: /^Download/ }).click(); await card.getByRole('button', { name: 'Open' }).waitFor({ timeout: 90000 }); }
  await card.getByRole('button', { name: 'Open' }).click();
  await page.locator('.scene-stack').waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: p.speed, exact: true }).click();
  await page.waitForTimeout(p.waitFirst ?? 2500);
  for (const f of p.faults) { await page.getByRole('button', { name: f, exact: true }).click(); await page.waitForTimeout(1500); }
  try { await page.locator('.stack-feed li', { hasText: 'New plan adopted' }).first().waitFor({ timeout: 30000 }); console.log(id, 'new program applied: OK'); }
  catch { console.log(id, 'no new program within 30 s'); }
  await page.waitForTimeout(2500);
  console.log(id, '| phase:', await page.locator('.scene-phase').innerText(), '| readouts:', (await page.locator('.scene-readouts').innerText()).replace(/\n/g, ' '));
  console.log(id, '| feed:', await feed(8));
  await page.screenshot({ path: `output/stacks-${id}.png` });
  if (id === 'rover') {
    await page.locator('.buddy').click(); await page.locator('.summon').waitFor(); await page.waitForFunction(() => { const r = document.querySelector('.buddy').getBoundingClientRect(); return Math.abs(r.left + r.width / 2 - innerWidth / 2) < 4; }, null, { timeout: 15000 }); await page.waitForTimeout(400);
    await page.screenshot({ path: 'output/stacks-summon.png' });
    console.log('summon actions:', (await page.locator('.summon-action b').allInnerTexts()).join(' | '));
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: 'Close scene' }).click();
  await page.getByRole('heading', { name: 'What should we work on?' }).waitFor();
}
await browser.close();

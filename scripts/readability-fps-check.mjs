// Docking: rapid repeat fault clicks, plain-language feed, and an FPS A/B for HUD backdrop blur.
// Usage: node scripts/readability-fps-check.mjs [baseUrl]
import { chromium } from '@playwright/test';
const base = process.argv[2] || 'http://127.0.0.1:8000';
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => console.log('PAGE ERROR', e.message));
await page.goto(base);
console.log('model:', await page.evaluate(() => fetch('api/health').then(r => r.json()).then(h => h.reasoning_model)));
const card = page.locator('.scene-card.card-docking');
if (!(await card.getByRole('button', { name: 'Open' }).isVisible())) { await card.getByRole('button', { name: /^Download/ }).click(); await card.getByRole('button', { name: 'Open' }).waitFor({ timeout: 60000 }); }
await card.getByRole('button', { name: 'Open' }).click();
await page.locator('.stack-now').waitFor({ timeout: 60000 });
await page.waitForTimeout(4000);

const fps = () => page.evaluate(() => new Promise(done => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 5000) requestAnimationFrame(f); else done(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); }));
const now = await fps();
await page.addStyleTag({ content: '.scene-phase,.scene-close,.scene-readouts div,.scene-transport,.scene-stack{backdrop-filter:blur(12px)!important}' });
const blurred = await fps();
console.log(`fps (software WebGL): new HUD ${now.toFixed(1)} · with old blurs ${blurred.toFixed(1)}`);
await page.evaluate(() => document.querySelectorAll('style').forEach(s => s.textContent.includes('backdrop-filter:blur(12px)!important') && s.remove()));

console.log('headline:', await page.locator('.stack-now p').innerText());
// The user's scenario: Spin up clicked four times in quick succession.
for (let i = 0; i < 4; i++) { await page.getByRole('button', { name: 'Spin up' }).click({ force: true }).catch(() => {}); await page.waitForTimeout(250); }
await page.waitForTimeout(6000);
console.log('headline after spin-up:', await page.locator('.stack-now p').innerText());
const items = await page.locator('.stack-feed li').evaluateAll(lis => lis.map(li => li.querySelector('strong')?.textContent + ' — ' + (li.querySelector('p')?.textContent ?? '')));
console.log('feed:\n  ' + items.join('\n  '));
console.log('faults applied:', items.filter(t => t.startsWith('Fault:')).length);
await page.screenshot({ path: 'output/readable-docking.png' });
await page.getByText(/^(Ended|Live)$/).first().waitFor();
await page.locator('.live-pill', { hasText: 'Ended' }).waitFor({ timeout: 150000 });
console.log('final headline:', await page.locator('.stack-now p').innerText(), '|', await page.locator('.stack-routine').innerText().catch(() => ''));
await page.screenshot({ path: 'output/readable-docking-end.png' });
await browser.close();

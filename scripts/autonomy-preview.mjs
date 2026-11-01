// Live docking autonomy in the browser: start, inject faults, follow the flight stack to the end, close.
// Uses offline rules (no billed model calls). Usage: node scripts/autonomy-preview.mjs [baseUrl]
import { chromium } from '@playwright/test';
const base = process.argv[2] || 'http://127.0.0.1:8000';
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => console.log('PAGE ERROR', e.message));
await page.goto(base);
const card = page.locator('.scene-card.card-docking');
if (!(await card.getByRole('button', { name: 'Open' }).isVisible())) {
  await card.getByRole('button', { name: /^Download/ }).click();
  await card.getByRole('button', { name: 'Open' }).waitFor({ timeout: 60000 });
}
await card.getByRole('button', { name: 'Open' }).click();
await page.locator('.scene-stack').waitFor({ timeout: 60000 });
await page.waitForTimeout(5000);
await page.screenshot({ path: 'output/autonomy-live.png' });
const feed = async () => (await page.locator('.stack-feed li strong').allInnerTexts()).slice(0, 6).join(' | ');
console.log('t+5s phase:', await page.locator('.scene-phase').innerText(), '| feed:', await feed());
await page.getByRole('button', { name: 'Debris' }).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: 'output/autonomy-debris.png' });
console.log('after debris:', await page.locator('.scene-phase').innerText(), '| feed:', await feed());
await page.getByRole('button', { name: 'Thrust −50%' }).click();
await page.waitForTimeout(3000);
console.log('after thrust loss:', await page.locator('.scene-phase').innerText(), '| feed:', await feed());
await page.getByText('Ended', { exact: true }).waitFor({ timeout: 90000 });
await page.waitForTimeout(800);
await page.screenshot({ path: 'output/autonomy-end.png' });
console.log('end:', await page.locator('.scene-phase').innerText(), '| feed:', await feed());
await page.getByRole('button', { name: 'Run again' }).click();
await page.waitForTimeout(2500);
const running = await page.evaluate(() => fetch('/api/autonomy/sessions').then(r => r.json()).then(s => s.filter(x => ['running', 'starting', 'created'].includes(x.status)).length));
console.log('active sessions after restart:', running);
await page.getByRole('button', { name: 'Close scene' }).click();
await page.waitForTimeout(1500);
const after = await page.evaluate(() => fetch('/api/autonomy/sessions').then(r => r.json()).then(s => s.filter(x => ['running', 'starting', 'created'].includes(x.status)).length));
console.log('active sessions after close:', after);
await browser.close();

// Captures the Aether console: empty state, a finished demo run, the files drawer and mobile. Usage: node scripts/harness-preview.mjs [baseUrl]
import { chromium } from '@playwright/test';
const base = process.argv[2] || 'http://127.0.0.1:8000';
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => console.log('PAGE ERROR', e.message));
await page.goto(base);
await page.evaluate(() => localStorage.removeItem('aether-run'));
await page.reload();
await page.getByRole('heading', { name: 'What should we work on?' }).waitFor();
await page.waitForTimeout(1200);
await page.screenshot({ path: 'output/harness-welcome.png' });
await page.getByRole('button', { name: 'Build a docking controller' }).click();
await page.getByLabel('Agent provider').selectOption('demo');
await page.getByRole('button', { name: 'Start agent' }).click();
try { await page.locator('.outcome').waitFor({ timeout: 60000 }); }
catch (e) { await page.screenshot({ path: 'output/harness-stuck.png' }); throw e; }
await page.locator('.work-head').first().click();
await page.waitForTimeout(800);
await page.screenshot({ path: 'output/harness-done.png' });
await page.getByRole('button', { name: 'Report', exact: true }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: 'output/harness-files.png' });
await page.keyboard.press('Escape');
await page.setViewportSize({ width: 400, height: 820 });
await page.waitForTimeout(400);
await page.screenshot({ path: 'output/harness-mobile.png' });
console.log('Captured harness screenshots; title:', await page.title());
await browser.close();

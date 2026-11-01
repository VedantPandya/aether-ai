// Downloads and opens every scene, capturing screenshots. Usage: node scripts/scenes-preview.mjs [baseUrl] [sceneIds...]
import { chromium } from '@playwright/test';
const [base = 'http://127.0.0.1:8000', ...only] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => console.log('PAGE ERROR', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
await page.goto(base);
await page.evaluate(async () => { localStorage.removeItem('aether-run'); for (const k of await caches.keys()) await caches.delete(k); });
await page.reload();
await page.getByRole('heading', { name: 'What should we work on?' }).waitFor();
await page.waitForTimeout(1200);
await page.screenshot({ path: 'output/scenes-home.png' });
const scenes = { docking: 'Rotating dock', flyby: 'Black hole flyby', launch: 'Saturn V launch', rover: 'Rover autonomy' };
for (const [id, title] of Object.entries(scenes)) {
  if (only.length && !only.includes(id)) continue;
  const card = page.locator(`.scene-card.card-${id}`);
  await card.getByRole('button', { name: new RegExp(`^Download ${title}`) }).click();
  await card.getByRole('button', { name: 'Open' }).waitFor({ timeout: 60000 });
  await card.getByRole('button', { name: 'Open' }).click();
  await page.locator('.scene-head h2').waitFor({ timeout: 60000 });
  await page.waitForTimeout(id === 'launch' ? 9000 : 5000);
  await page.screenshot({ path: `output/scene-${id}.png` });
  console.log(id, 'phase:', await page.locator('.scene-phase').innerText());
  if (id === 'docking') {
    await page.getByRole('button', { name: 'Ask Aether' }).click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: 'output/scene-docking-chat.png' });
    await page.getByRole('button', { name: 'Hide chat' }).click();
  }
  await page.getByRole('button', { name: 'Close scene' }).click();
  await page.getByRole('heading', { name: 'What should we work on?' }).waitFor();
}
await page.waitForTimeout(600);
await page.screenshot({ path: 'output/scenes-home-after.png' });
await browser.close();

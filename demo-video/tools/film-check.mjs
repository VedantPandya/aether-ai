// Plays the demo film in real time, capturing frames and the live rover's captions. Usage: node demo-video/tools/film-check.mjs [baseUrl]
import { chromium } from '@playwright/test';
const base = process.argv[2] || 'http://127.0.0.1:8000/';
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => console.log('PAGE ERROR', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
await page.goto(new URL('demo', base).href);
await page.getByText('Play the Aether film').waitFor();
await page.screenshot({ path: 'demo-video/source/film-start.png' });
await page.getByText('Play the Aether film').click();
// Wait on the film's own clock, then pause (which also pauses the live rover and narration) while capturing:
// software-rendered screenshots take seconds and would otherwise let the film run on.
const filmTime = async () => { const [m, s] = (await page.locator('.film-controls .clock').innerText()).split(' / ')[0].split(':').map(Number); return m * 60 + s; };
const shots = [[5, 'hook'], [17, 'meet'], [24, 'rover-start'], [29, 'rover-boulder'], [35, 'rover-replan'], [43, 'rover-goal'], [62, 'arch-server'], [66, 'credits-image'], [69.5, 'credits-astra'], [75.5, 'credits-voice'], [85, 'outro']];
for (const [s, name] of shots) {
  while (await filmTime() < s) await page.waitForTimeout(100);
  await page.keyboard.press('Space');
  const cap = await page.locator('.caption').innerText().catch(() => '');
  const label = await page.locator('.film-controls .label').innerText();
  console.log(`${s}s ${name.padEnd(14)} | ${label}${cap ? ' | ' + cap.replace(/\n/g, ' ') : ''}`);
  await page.screenshot({ path: `demo-video/source/film-${name}.png` });
  await page.keyboard.press('Space');
}
await browser.close();

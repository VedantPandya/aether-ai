// Sprite sanity checks: onion-skin of every frame (raw vs registered) and facing behaviour of the live avatar.
// Usage: node scripts/sprite-check.mjs [baseUrl]
import { chromium } from '@playwright/test';
const base = process.argv[2] || 'http://127.0.0.1:8000';
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 560 } });
await page.goto(base);
await page.getByRole('heading', { name: 'What should we work on?' }).waitFor();

// Facing: pointer movement must never turn the orb; clicks turn it only sometimes.
const facing = () => page.locator('.buddy .aether-frame').evaluate(e => parseFloat(getComputedStyle(e).backgroundPositionX) / (100 / 3) % 2 < .5 ? 'left' : 'right');
const before = await facing(); const seen = new Set();
for (let i = 0; i < 40; i++) { await page.mouse.move(i % 2 ? 980 : 20, 100 + i * 10); await page.waitForTimeout(150); seen.add(await facing()); }
console.log('pointer sweep: start', before, 'seen', [...seen].join(','), seen.size === 1 ? 'OK (never turned)' : 'FAIL');
let flips = 0, last = await facing();
for (let i = 0; i < 20; i++) { await page.locator('.buddy').click(); await page.waitForTimeout(80); const now = await facing(); if (now !== last) flips++; last = now; }
console.log(`clicks: ${flips}/20 turned`, flips > 0 && flips < 20 ? 'OK (random)' : 'CHECK');

// Onion skin: 32 expressions per facing drawn at 1/10 opacity in one spot. Aligned frames read as one crisp orb.
await page.evaluate(() => {
  const css = document.createElement('style');
  css.textContent = '.skin{position:fixed;top:40px;width:220px;height:220px;z-index:99;background:#121211}.skin span{position:absolute;inset:0;background-repeat:no-repeat;background-size:400% 800%;opacity:.12}.skin b{position:absolute;bottom:-26px;left:0;right:0;text-align:center;color:#ddd;font:500 13px Inter}';
  document.head.append(css);
  const sample = document.querySelector('.buddy .aether-frame');
  const make = (left, label, registered, column) => {
    const box = document.createElement('div'); box.className = 'skin'; box.style.left = left + 'px';
    for (const sheet of ['a', 'b']) for (let row = 0; row < 8; row++) for (const col of [column, column + 2]) {
      const s = document.createElement('span'); s.style.backgroundImage = `url(/aether-avatar-sprites-v2-${sheet}.png)`;
      s.style.backgroundPosition = `${col / 3 * 100}% ${row / 7 * 100}%`;
      if (registered) s.style.transform = window.__reg(sheet, row * 4 + col);
      box.append(s);
    }
    const b = document.createElement('b'); b.textContent = label; box.append(b); document.body.append(box);
  };
  window.__make = make; void sample;
});
// The registration table, read from the component source the app is built from.
const source = (await import('fs')).readFileSync(new URL('../src/AetherSprite.tsx', import.meta.url), 'utf8');
const table = source.match(/const REGISTRATION[^=]*=\s*\{([\s\S]*?)\n\};/)?.[1];
if (!table) { console.log('registration table not found in src/AetherSprite.tsx'); process.exit(1); }
await page.evaluate(t => {
  const reg = Function(`return {${t}}`)();
  window.__reg = (sheet, i) => { const [dx, dy, s] = reg[sheet][i]; return `translate(${dx * 100}%, ${dy * 100}%) scale(${s})`; };
  window.__make(30, 'raw · left', false, 0); window.__make(270, 'registered · left', true, 0);
  window.__make(510, 'raw · right', false, 1); window.__make(750, 'registered · right', true, 1);
}, table);
await page.waitForTimeout(600);
await page.screenshot({ path: 'output/sprite-onion.png', clip: { x: 0, y: 20, width: 1000, height: 290 } });
await browser.close();

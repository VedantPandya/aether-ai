// Builds the favicon from Aether's own sprite: the neutral, left-facing cell of sheet A, re-centred with the
// registration table and cropped to the orb. Usage: node scripts/make-favicon.mjs [baseUrl]
import { chromium } from '@playwright/test';
import { writeFileSync } from 'fs';
const base = process.argv[2] || 'http://127.0.0.1:8000/';
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage();
await page.goto(base);
const images = await page.evaluate(async () => {
  const img = new Image(); img.src = 'aether-avatar-sprites-v2-a.png'; await img.decode();
  const cw = img.width / 4, ch = img.height / 8;
  // Orb centre from the neutral-left registration entry [dx, dy, scale] = [-0.0221, -0.091, 1.0542]: c = 0.5 - d / s.
  const cx = (0.5 + 0.0221 / 1.0542) * cw, cy = (0.5 + 0.091 / 1.0542) * ch, side = 0.66 * cw;
  return [64, 180].map(size => {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
    g.drawImage(img, cx - side / 2, cy - side / 2, side, side, 0, 0, size, size);
    return c.toDataURL('image/png').split(',')[1];
  });
});
writeFileSync(new URL('../public/favicon.png', import.meta.url), Buffer.from(images[0], 'base64'));
writeFileSync(new URL('../public/apple-touch-icon.png', import.meta.url), Buffer.from(images[1], 'base64'));
console.log('wrote public/favicon.png (64px) and public/apple-touch-icon.png (180px)');
await browser.close();

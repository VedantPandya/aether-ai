// Measures where the orb actually sits in each cell of the v2 sprite sheets, so frames can be re-registered.
// Prints a TypeScript table of [dx, dy, scale] corrections (cell fractions). Usage: node scripts/measure-sprites.mjs [baseUrl]
import { chromium } from '@playwright/test';
const base = process.argv[2] || 'http://127.0.0.1:8000';
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage();
await page.goto(base);
const result = await page.evaluate(async () => {
  const out = {};
  for (const sheet of ['a', 'b']) {
    const img = new Image(); img.src = `/aether-avatar-sprites-v2-${sheet}.png`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const { data } = g.getImageData(0, 0, c.width, c.height), cw = c.width / 4, ch = c.height / 8;
    out[sheet] = [];
    for (let row = 0; row < 8; row++) for (let col = 0; col < 4; col++) {
      // Solid pixels only (alpha > 200): ignores faint glow and stray specks at the cell edges.
      let n = 0, sx = 0, sy = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
      const x0 = Math.ceil(col * cw), x1 = Math.floor((col + 1) * cw), y0 = Math.ceil(row * ch), y1 = Math.floor((row + 1) * ch);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        if (data[(y * c.width + x) * 4 + 3] > 200) { n++; sx += x; sy += y; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      }
      out[sheet].push({ cx: (sx / n - col * cw) / cw, cy: (sy / n - row * ch) / ch, size: Math.sqrt(n) / cw, h: (maxY - minY) / ch });
    }
  }
  return out;
});
await browser.close();
const all = [...result.a, ...result.b], median = k => { const v = all.map(f => f[k]).sort((a, b) => a - b); return v[v.length >> 1]; };
const size = median('size');
// Visual target: the orb centred in the cell at the median size. translate(t) scale(s) maps centre c -> s*(c-.5)+.5+t.
const fix = f => { const s = size / f.size; return [+(.5 - (s * (f.cx - .5) + .5)).toFixed(4), +(.5 - (s * (f.cy - .5) + .5)).toFixed(4), +s.toFixed(4)]; };
for (const sheet of ['a', 'b']) console.log(`  ${sheet}: [${result[sheet].map(f => `[${fix(f).join(',')}]`).join(',')}],`);
console.error('spread cx', Math.min(...all.map(f => f.cx)).toFixed(3), Math.max(...all.map(f => f.cx)).toFixed(3), 'cy', Math.min(...all.map(f => f.cy)).toFixed(3), Math.max(...all.map(f => f.cy)).toFixed(3), 'size', Math.min(...all.map(f => f.size)).toFixed(3), Math.max(...all.map(f => f.size)).toFixed(3));

// Verifies an isolated /aether/ production build without paid provider calls.
// First: APP_BASE_PATH=/aether/ npm run build -- --outDir output/deploy-preview
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
const port = 8297, origin = `http://127.0.0.1:${port}`, root = process.cwd();
const python = process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python';
const code = `import uvicorn; from backend.main import app; from starlette.applications import Starlette; from starlette.routing import Mount; uvicorn.run(Starlette(routes=[Mount('/aether',app)]),host='127.0.0.1',port=${port},log_level='warning')`;
const server = spawn(resolve(root, python), ['-c', code], { cwd: root, env: { ...process.env, AGENT_PROVIDER: 'demo', APP_ROOT_PATH: '/aether', AETHER_STATIC_DIR: resolve(root, 'output/deploy-preview') }, stdio: ['ignore', 'ignore', 'pipe'] });
let serverErrors = '', browser;
server.stderr.on('data', chunk => { serverErrors += chunk; });
const assert = (ok, text) => { if (!ok) throw new Error(text); };
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { ready = (await fetch(origin + '/aether/api/health')).ok; } catch {}
    if (ready) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert(ready, 'Preview backend failed: ' + serverErrors);
  browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const requests = [], errors = [], failed = [];
  page.on('request', r => { if (r.url().startsWith(origin)) requests.push(new URL(r.url()).pathname); });
  page.on('response', r => { if (r.url().startsWith(origin) && r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/aether/');
  await page.getByRole('heading', { name: 'What should we work on?' }).waitFor();
  await page.getByRole('button', { name: /Download Rotating dock,/ }).first().click();
  const docking = page.locator('.card-docking');
  await docking.getByRole('button', { name: 'Open', exact: true }).click({ timeout: 20000 });
  await page.locator('.scene-view canvas').waitFor();
  await page.locator('.scene-loading').waitFor({ state: 'detached', timeout: 30000 });
  await page.screenshot({ path: 'output/deploy-subpath.png' });
  assert(requests.some(p => /\/aether\/api\/autonomy\/sessions\/[^/]+\/events/.test(p)), 'Flight SSE did not use the prefix');
  await new Promise((done, reject) => {
    const voice = spawn(process.execPath, ['scripts/voice-preview.mjs', origin + '/aether/'], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    voice.stdout.on('data', chunk => { output += chunk; });
    voice.stderr.on('data', chunk => { output += chunk; });
    voice.on('error', reject);
    voice.on('exit', code => code === 0 && output.includes('session.close sent: true') && !output.includes('PAGE ERROR') ? done() : reject(new Error('Mocked voice handshake failed: ' + output)));
  });

  assert(requests.some(p => p === '/aether/api/voice/status'), 'Voice status did not use the prefix');
  assert(requests.some(p => p.includes('/aether/assets-3d/')), 'Scene assets did not use the prefix');
  assert(requests.every(p => p.startsWith('/aether/')), 'Requests escaped /aether/: ' + requests.filter(p => !p.startsWith('/aether/')).join(', '));
  assert(!errors.length && !failed.length, JSON.stringify({ errors, failed }));
  console.log(JSON.stringify({ ok: true, prefixedRequests: requests.length, scene: 'Rotating dock', flightSSE: true, voiceWebRTC: 'mocked handshake, captions, mute and close passed', screenshot: 'output/deploy-subpath.png' }));
} finally {
  if (browser) await browser.close();
  server.kill();
}

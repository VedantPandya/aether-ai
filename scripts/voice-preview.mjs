// Exercises voice mode end to end without billing: an in-page peer stands in for GPT-Live
// (answers the real SDP offer, streams a tone as "speech", sends session/caption events).
// Usage: node scripts/voice-preview.mjs [baseUrl]
import { chromium } from '@playwright/test';
const base = process.argv[2] || 'http://127.0.0.1:8000';
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => console.log('PAGE ERROR', e.message));
await page.addInitScript(() => {
  const realFetch = window.fetch;
  window.__closed = false;
  window.fetch = async (input, init) => {
    if (String(input).includes('/api/voice/sessions')) {
      const { sdp } = JSON.parse(init.body);
      const server = new RTCPeerConnection(), ctx = new AudioContext(), osc = ctx.createOscillator(), gain = ctx.createGain(), dest = ctx.createMediaStreamDestination();
      osc.frequency.value = 220; gain.gain.value = 0; osc.connect(gain).connect(dest); osc.start();
      dest.stream.getTracks().forEach(t => server.addTrack(t, dest.stream));
      server.ondatachannel = ({ channel }) => {
        const send = e => channel.send(JSON.stringify(e));
        channel.onopen = () => {
          send({ type: 'session.started' });
          const words = 'Hello. I am Aether, your mission companion. Honesty setting at one hundred percent. Humor, slightly lower. What are we flying today?'.split(' ');
          let t = 0;
          setTimeout(() => { gain.gain.setTargetAtTime(.6, ctx.currentTime, .05); words.forEach((w, i) => setTimeout(() => { send({ type: 'session.output_transcript.delta', delta: (i ? ' ' : '') + w, start_ms: t, end_ms: t += 280 }); }, i * 140)); }, 600);
          setTimeout(() => gain.gain.setTargetAtTime(0, ctx.currentTime, .1), 600 + words.length * 140);
          setTimeout(() => ['Show me', ' the docking', ' scene please'].forEach((d, i) => setTimeout(() => send({ type: 'session.input_transcript.delta', delta: d, start_ms: 9000 + i * 300, end_ms: 9300 + i * 300 }), i * 200)), 3200);
        };
        channel.onmessage = e => { const m = JSON.parse(e.data); if (m.type === 'session.close') { window.__closed = true; send({ type: 'session.closed' }); } };
      };
      await server.setRemoteDescription({ type: 'offer', sdp });
      await server.setLocalDescription(await server.createAnswer());
      await new Promise(r => { if (server.iceGatheringState === 'complete') r(); server.onicegatheringstatechange = () => server.iceGatheringState === 'complete' && r(); setTimeout(r, 2000); });
      window.__server = server;
      return new Response(JSON.stringify({ session: { id: 'live_test' }, transport: { type: 'webrtc', sdp: server.localDescription.sdp } }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(input, init);
  };
});
await page.goto(base);
await page.evaluate(() => localStorage.removeItem('aether-run'));
await page.reload();
await page.getByRole('heading', { name: 'What should we work on?' }).waitFor();
await page.getByRole('button', { name: 'Talk to Aether' }).first().click();
await page.waitForTimeout(400);
await page.screenshot({ path: 'output/voice-connecting.png' });
await page.getByText('Listening').waitFor({ timeout: 15000 });
await page.waitForTimeout(1600);
await page.screenshot({ path: 'output/voice-speaking.png' });
await page.waitForTimeout(2600);
await page.screenshot({ path: 'output/voice-captions.png' });
console.log('captions:', await page.locator('.voice-captions').innerText());
await page.getByRole('button', { name: 'Mute microphone' }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: 'output/voice-muted.png' });
await page.getByRole('button', { name: 'End voice conversation' }).click();
await page.locator('.voice-overlay').waitFor({ state: 'detached', timeout: 8000 });
console.log('session.close sent:', await page.evaluate(() => window.__closed));
await page.setViewportSize({ width: 400, height: 820 });
// The desktop sidebar stays open after a resize; a real phone starts with it closed.
if (await page.getByRole('button', { name: 'Close sidebar' }).isVisible()) await page.getByRole('button', { name: 'Close sidebar' }).click();
await page.getByRole('button', { name: 'Talk to Aether' }).first().click();
await page.getByText('Listening').waitFor({ timeout: 15000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'output/voice-mobile.png' });
await browser.close();

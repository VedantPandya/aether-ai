import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Loader2, Pause, Play, RotateCcw, Sparkles, X } from 'lucide-react';
import { cachedUrl, SCENES, type SceneId } from './catalog';
import { appUrl } from '../urls';
import type { LiveEntry, LiveStatus, Readout, SceneContext, SceneHandle } from './kit';

const LAYERS = [{ n: 1, name: 'Control', role: 'flies the vehicle' }, { n: 2, name: 'Quick checks', role: 'every second' }, { n: 3, name: 'Planning', role: 'when things change' }] as const;
const BADGE: Record<number, string> = { 0: '·', 1: 'Control', 2: 'Check', 3: 'Plan' };

const BUILDERS: Record<SceneId, () => Promise<{ default: (ctx: SceneContext) => Promise<SceneHandle> }>> = {
  docking: () => import('./docking'), flyby: () => import('./flyby'), launch: () => import('./launch'), rover: () => import('./rover'),
};
export interface SceneStatus { phase: string; readouts: Readout[]; mood?: string | null }
interface Hud { phase: string; clock: string; readouts: Readout[]; progress: number; finite: boolean; note: string; live: { entries: LiveEntry[]; status: LiveStatus; headline: string; routine: number } | null }

/** `remote` loads assets from the server when they are not in the download cache (the demo film uses it);
 *  `speed` and `paused` let a host drive playback. */
export default function SceneView({ id, onClose, onStatus, onHandle, remote = false, speed: speedOverride, paused, suspended = false }: { id: SceneId; onClose: () => void; onStatus?: (s: SceneStatus) => void; onHandle?: (h: SceneHandle | null) => void; remote?: boolean; speed?: number; paused?: boolean; suspended?: boolean }) {
  // `suspended` keeps a preloaded scene alive but skips simulation and rendering until it is shown.
  const suspendedRef = useRef(suspended); suspendedRef.current = suspended;
  const host = useRef<HTMLDivElement>(null), control = useRef({ playing: true, speed: 1, time: 0, seek: null as number | null }), handleRef = useRef<SceneHandle | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [playing, setPlaying] = useState(true), [speed, setSpeed] = useState(1), [busy, setBusy] = useState('');
  const [hud, setHud] = useState<Hud>({ phase: '', clock: '', readouts: [], progress: 0, finite: true, note: '', live: null });
  const info = SCENES.find(s => s.id === id)!, statusRef = useRef(onStatus), handleCallback = useRef(onHandle); statusRef.current = onStatus; handleCallback.current = onHandle;

  useEffect(() => {
    const element = host.current!, urls: string[] = [];
    let disposed = false, handle: SceneHandle | null = null;
    const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    // Adaptive resolution: start at ≤1.5× and step down when frames run long, back up when there is headroom.
    const maxRatio = Math.min(devicePixelRatio, 1.5); let ratio = maxRatio;
    renderer.setPixelRatio(ratio); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1; renderer.setClearColor(0x050607);
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, .5, 400000), controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const resize = () => {
      const w = element.clientWidth, h = element.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); handle?.resize?.(camera.aspect);
    };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    const ctx: SceneContext = {
      scene, camera, controls, renderer,
      url: async path => {
        let u: string;
        try { u = await cachedUrl(path); }
        catch (e) { if (!remote) throw e; u = URL.createObjectURL(await (await fetch(appUrl(path))).blob()); }
        urls.push(u); return u;
      },
      json: async path => { const u = await ctx.url(path); return (await fetch(u)).json(); },
    };
    let last = performance.now(), hold = 0, lastHud = 0, lastPhase = '', lastMood: string | null = null, frameSum = 0, frames = 0, sampleStart = performance.now();
    BUILDERS[id]().then(m => m.default(ctx)).then(h => {
      if (disposed) return;
      handle = h; handleRef.current = h; handleCallback.current?.(h); const c = control.current; c.time = h.start; c.speed = h.speed; setSpeed(h.speed); resize(); setLoading(false);
      renderer.setAnimationLoop(now => {
        if (suspendedRef.current) { last = now; return; }
        const dt = Math.min(.1, (now - last) / 1000); frameSum += now - last; frames++; last = now;
        if (now - sampleStart > 2000) {
          const avg = frameSum / frames, next = avg > 24 ? Math.max(.75, ratio - .25) : avg < 14 ? Math.min(maxRatio, ratio + .25) : ratio;
          if (next !== ratio) { ratio = next; renderer.setPixelRatio(ratio); resize(); }
          frameSum = 0; frames = 0; sampleStart = now;
        }
        // Seeks arrive as a 0–1 fraction of the timeline.
        if (c.seek !== null) { c.time = h.start + c.seek * (h.duration - h.start); c.seek = null; hold = 0; }
        let step = 0;
        if (c.playing) {
          if (c.time >= h.duration) { hold += dt; if (hold > 3) { c.time = h.start; hold = 0; } }
          else { step = dt * c.speed; c.time = Math.min(h.duration, c.time + step); }
        }
        h.update(c.time, step); controls.update();
        if (h.render) h.render(renderer, scene, camera); else renderer.render(scene, camera);
        // The HUD is text: 4 updates a second is plenty, and keeps React work off most frames.
        if (now - lastHud > 250) {
          lastHud = now;
          const readouts = h.readouts(c.time), phase = h.phase(c.time), live = h.live ? { entries: h.live.entries(), status: h.live.status(), headline: h.live.headline(), routine: h.live.routine() } : null;
          setHud({ phase, clock: h.clock(c.time), readouts, progress: Number.isFinite(h.duration) ? (c.time - h.start) / (h.duration - h.start) : 0, finite: Number.isFinite(h.duration), note: h.note, live });
          // The parent app re-renders on every status, so only tell it when something it shows has changed.
          const mood = h.live?.mood() ?? null;
          if (phase !== lastPhase || mood !== lastMood) { lastPhase = phase; lastMood = mood; statusRef.current?.({ phase, readouts, mood }); }
        }
      });
    }).catch(e => { if (!disposed) { setError((e as Error).message); setLoading(false); } });
    return () => {
      disposed = true; handle?.dispose?.(); handleRef.current = null; handleCallback.current?.(null); observer.disconnect(); renderer.setAnimationLoop(null); controls.dispose();
      scene.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose(); (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []).forEach(x => x.dispose()); });
      renderer.dispose(); renderer.domElement.remove(); urls.forEach(u => URL.revokeObjectURL(u));
    };
  }, [id]);

  useEffect(() => { if (speedOverride) { control.current.speed = speedOverride; setSpeed(speedOverride); } }, [speedOverride, loading]);
  useEffect(() => { if (paused !== undefined) { control.current.playing = !paused; setPlaying(!paused); } }, [paused]);
  const togglePlay = () => { control.current.playing = !control.current.playing; setPlaying(control.current.playing); };
  const speeds = id === 'flyby' ? [.5, 1, 2] : id === 'launch' ? [1, 3, 8] : [1, 4, 10];
  const live = hud.live && hud.live.status.state !== 'offline' ? hud.live : null;
  const run = async (key: string, task: () => Promise<void>, cooldown = 0) => { setBusy(key); try { await task(); } finally { setTimeout(() => setBusy(''), cooldown); } };
  return <div className="scene-view">
    <div ref={host} className="scene-canvas" />
    {loading && <div className="scene-loading"><Loader2 size={20} className="spin" /><span>Assembling {info.title.toLowerCase()}…</span></div>}
    {error && <div className="scene-loading"><span>{error}</span><button onClick={onClose}>Back to workspace</button></div>}
    {!loading && !error && <>
      <header className="scene-head">
        <div><span className="scene-kicker">{info.subtitle}</span><h2>{info.title}</h2><span className="scene-phase"><i />{hud.phase}</span></div>
        <button className="scene-close" aria-label="Close scene" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="scene-readouts">{hud.readouts.map(r => <div key={r.label}><span>{r.label}</span><strong>{r.value}{r.unit && <small>{r.unit}</small>}</strong></div>)}</div>
      {live ? <div className="scene-transport live">
        {live.status.provider === 'browser' && <button className="live-play" aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlay}>{playing ? <Pause size={15} /> : <Play size={15} />}</button>}
        <span className={`live-pill ${playing || live.status.provider !== 'browser' ? live.status.state : 'paused'}`}><i />{live.status.state === 'connecting' ? 'Starting' : live.status.state !== 'live' ? 'Ended' : playing || live.status.provider !== 'browser' ? 'Live' : 'Paused'}</span>
        <span className="scene-clock">{hud.clock}</span>
        {live.status.provider === 'browser' && <div className="scene-speeds">{speeds.map(s => <button key={s} className={speed === s ? 'active' : ''} onClick={() => { control.current.speed = s; setSpeed(s); }}>{s}×</button>)}</div>}
        {live.status.aiAvailable ? <button className={`ai-toggle ${live.status.ai ? 'on' : ''}`} aria-pressed={live.status.ai} disabled={!!busy}
          title={live.status.ai ? 'Reflex via Decisions API and strategic reasoning (billed model calls)' : 'Deterministic reflex rules and candidate search, no model calls'}
          onClick={() => void run('ai', () => handleRef.current!.live!.restart(!live.status.ai))}><Sparkles size={13} />{live.status.ai ? 'AI reflex + strategy' : 'Offline rules'}</button>
          : <span className="stack-where" title="Control, reflex and strategy run in this page on forward rollouts">In-browser stack</span>}
        <button aria-label="Run again" title="Run again" disabled={!!busy} onClick={() => void run('restart', () => handleRef.current!.live!.restart())}><RotateCcw size={14} /></button>
      </div> : <div className="scene-transport">
        <button aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlay}>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
        {hud.finite && <input aria-label="Scene time" type="range" min={0} max={1000} value={Math.round(hud.progress * 1000)}
          onChange={e => { control.current.seek = Number(e.target.value) / 1000; setHud(h => ({ ...h, progress: Number(e.target.value) / 1000 })); }} />}
        <span className="scene-clock">{hud.clock}</span>
        <div className="scene-speeds">{speeds.map(s => <button key={s} className={speed === s ? 'active' : ''} onClick={() => { control.current.speed = s; setSpeed(s); }}>{s}×</button>)}</div>
        {hud.finite && <button aria-label="Restart" onClick={() => { control.current.seek = 0; }}><RotateCcw size={14} /></button>}
      </div>}
      {live && <aside className="scene-stack" aria-label="Flight stack">
        <div className="stack-now" aria-live="polite"><span>Right now</span><p>{live.headline}</p></div>
        <div className="stack-layers">{LAYERS.map(l => <div key={l.n} className={`stack-layer l${l.n} ${live.status.activeLayer === l.n ? 'active' : ''}`}><span>{l.name}</span><em>{l.role}</em></div>)}</div>
        <ol className="stack-feed">
          {live.entries.slice(0, 8).map(e => <li key={e.id} className={`tone-${e.tone}`}>
            <span className={`feed-layer l${e.layer ?? 0}`}>{BADGE[e.layer ?? 0]}</span>
            <div><strong>{e.title}{e.count && e.count > 1 ? <small> ×{e.count}</small> : null}</strong>{e.detail && <p>{e.detail}</p>}{e.tech && <code>{e.tech}</code>}</div>
            <time>{Math.round(e.t)}s</time>
          </li>)}
          {!live.entries.length && <li className="tone-info"><span className="feed-layer l0">·</span><div><strong>Nothing to report yet.</strong><p>Inject a fault below to see the stack respond.</p></div></li>}
        </ol>
        {live.routine > 0 && <div className="stack-routine">✓ {live.routine} routine check{live.routine === 1 ? '' : 's'} passed</div>}
        <div className="stack-faults"><span>Inject a fault</span><div>{handleRef.current?.live?.actions.map(a => <button key={a.id} title={a.hint} disabled={live.status.state !== 'live' || !!busy}
          onClick={() => void run(a.id, () => handleRef.current!.live!.act(a.id), 2500)}>{a.label}</button>)}</div></div>
      </aside>}
      <p className="scene-note">{hud.live?.status.state === 'offline' ? `Recorded replay: ${hud.live.status.summary}.` : hud.note} Drag to orbit · scroll to zoom.</p>
    </>}
  </div>;
}

/// <reference types="vite/client" />
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Maximize2, Minimize2, Pause, Play } from 'lucide-react';
import AetherSprite, { type Mood } from '../../src/AetherSprite';
import SceneView, { type SceneStatus } from '../../src/scenes/SceneView';
import type { SceneHandle } from '../../src/scenes/kit';
import VoiceOverlay from '../../src/voice/VoiceOverlay';
import SceneShelf, { type DownloadState } from '../../src/scenes/SceneShelf';
import type { SceneId } from '../../src/scenes/catalog';
import { appUrl } from '../../src/urls';
import hookWav from '../source/audio-natural/hook.wav?url';
import meetWav from '../source/audio-natural/meet.wav?url';
import roverWav from '../source/audio-natural/rover.wav?url';
import arrivalWav from '../source/audio-natural/arrival.wav?url';
import architectureWav from '../source/audio-natural/architecture.wav?url';
import creditsWav from '../source/audio-natural/credits.wav?url';
import outroWav from '../source/audio-natural/outro.wav?url';
import './film.css';

/*
 * The Aether film. Nothing is a screen recording: every shot renders Aether's real components on a scripted
 * clock. The rover shot is a genuine live run of the in-browser flight stack inside a product window; the film
 * only drops the boulder on cue and reads its story beats back from the stack's own decision feed.
 */

// --- Timeline (seconds) -------------------------------------------------------
const AUDIO = { hook: hookWav, meet: meetWav, rover: roverWav, arrival: arrivalWav, architecture: architectureWav, credits: creditsWav, outro: outroWav };
type Clip = keyof typeof AUDIO;
const PLAN: { id: string; label: string; dur: number; audio: [Clip, number][]; letterbox?: boolean }[] = [
  { id: 'hook', label: 'The distance problem', dur: 11.5, audio: [['hook', .6]], letterbox: true },
  { id: 'meet', label: 'Meet Aether', dur: 8.5, audio: [['meet', .6]], letterbox: true },
  { id: 'rover', label: 'Live · Mars rover', dur: 30, audio: [['rover', 5], ['arrival', 24.6]] },
  { id: 'arch', label: 'How it works', dur: 15, audio: [['architecture', .8]], letterbox: true },
  { id: 'credits', label: 'Built with OpenAI', dur: 15, audio: [['credits', .8]] },
  { id: 'outro', label: 'Find their way', dur: 9, audio: [['outro', 1]], letterbox: true },
];
const SCENES = PLAN.reduce<(typeof PLAN[number] & { start: number; end: number })[]>((list, s) => {
  const start = list.at(-1)?.end ?? 0; return [...list, { ...s, start, end: start + s.dur }];
}, []);
const TOTAL = SCENES.at(-1)!.end;
// Rover shot: the scene shelf is clicked at CLICK_AT and the live run takes over at OPEN_AT.
const CLICK_AT = 3.2, OPEN_AT = 4.2, BOULDER_AT = 8.6, FAST_AT = 13.5;
const sceneAt = (t: number) => SCENES.find(s => t < s.end) ?? SCENES.at(-1)!;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const prog = (t: number, at: number, dur: number) => clamp((t - at) / dur, 0, 1);
const easeOut = (p: number) => 1 - (1 - p) ** 3;
const easeInOut = (p: number) => p < .5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// --- Clock and narration ------------------------------------------------------
function useFilmClock() {
  const anchor = useRef({ pos: 0, at: performance.now(), playing: false });
  const [time, setTime] = useState(0), [playing, setPlaying] = useState(false);
  const position = useCallback(() => { const a = anchor.current; return a.playing ? a.pos + (performance.now() - a.at) / 1000 : a.pos; }, []);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      let p = position();
      if (p >= TOTAL) { anchor.current = { pos: TOTAL, at: performance.now(), playing: false }; setPlaying(false); p = TOTAL; }
      setTime(p); raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [position]);
  const seek = useCallback((s: number) => { anchor.current = { ...anchor.current, pos: clamp(s, 0, TOTAL - .01), at: performance.now() }; }, []);
  const toggle = useCallback(() => {
    const a = anchor.current, restart = !a.playing && a.pos >= TOTAL - .05;
    anchor.current = { pos: restart ? 0 : position(), at: performance.now(), playing: !a.playing }; setPlaying(!a.playing);
  }, [position]);
  return { time, playing, seek, toggle };
}
/** Each narration clip plays inside its window of the timeline and re-syncs after drift, pause or seek. */
function useNarration(time: number, playing: boolean) {
  const clips = useRef<Record<string, HTMLAudioElement>>({});
  useEffect(() => {
    for (const [name, src] of Object.entries(AUDIO)) { const a = new Audio(src); a.preload = 'auto'; clips.current[name] = a; }
    return () => Object.values(clips.current).forEach(a => { a.pause(); a.src = ''; });
  }, []);
  // Seeking a playing <audio> is audible, so only re-sync on a real jump (a seek) or gross drift, never routinely.
  const last = useRef({ time: 0, at: performance.now() });
  useEffect(() => {
    const now = performance.now(), expected = last.current.time + (playing ? (now - last.current.at) / 1000 : 0);
    const jumped = Math.abs(time - expected) > .5; last.current = { time, at: now };
    for (const scene of SCENES) for (const [name, offset] of scene.audio) {
      const a = clips.current[name]; if (!a) continue;
      const local = time - scene.start - offset, inside = local >= 0 && local < (Number.isFinite(a.duration) ? a.duration : 30);
      if (playing && inside) {
        if (a.paused) { if (Math.abs(a.currentTime - local) > .15) a.currentTime = local; void a.play().catch(() => {}); }
        else if (jumped || Math.abs(a.currentTime - local) > 1) a.currentTime = local;
      } else if (!a.paused) a.pause();
    }
  }, [time, playing]);
}

// --- Motion primitives --------------------------------------------------------
/** Shot-level motion: arrive from a soft zoom and blur, leave the same way. */
function shotStyle(t: number, dur: number): CSSProperties {
  const i = easeOut(prog(t, 0, .9)), o = easeInOut(prog(t, dur - .7, .7));
  const blur = (1 - i) * 14 + o * 10;
  return { opacity: i * (1 - o), transform: `scale(${1.06 - .06 * i - .03 * o})`, filter: blur > .2 ? `blur(${blur}px)` : undefined };
}
function Rise({ t, at, out = Infinity, text, className = '' }: { t: number; at: number; out?: number; text: string; className?: string }) {
  return <div className={`rise ${className}`}>{text.split(' ').map((w, i) => {
    const p = easeOut(prog(t, at + i * .055, .75)), q = Number.isFinite(out) ? easeInOut(prog(t, out + i * .025, .45)) : 0;
    return <span key={i} className="rise-mask"><span style={{ transform: `translateY(${(1 - p) * 110 - q * 110}%) rotate(${(1 - p) * 4}deg)` }}>{w}</span></span>;
  })}</div>;
}
function Fade({ t, at, out = Infinity, children, className = '', style }: { t: number; at: number; out?: number; children: ReactNode; className?: string; style?: CSSProperties }) {
  const p = easeOut(prog(t, at, .8)), q = Number.isFinite(out) ? easeInOut(prog(t, out, .5)) : 0;
  if (p * (1 - q) <= .001) return null;
  return <div className={className} style={{ ...style, opacity: p * (1 - q), transform: `${style?.transform ?? ''} translateY(${(1 - p) * 16}px)`, filter: p < 1 ? `blur(${(1 - p) * 8}px)` : undefined }}>{children}</div>;
}

function Starfield({ t, warp = .3, tint = '#0f130d' }: { t: number; warp?: number; tint?: string }) {
  const ref = useRef<HTMLCanvasElement>(null), stars = useRef<{ x: number; y: number; z: number }[]>([]);
  useEffect(() => { stars.current = Array.from({ length: 900 }, () => ({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random() })); }, []);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const dpr = Math.min(devicePixelRatio, 1.5), w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = g.createRadialGradient(w * .5, h * .5, 0, w * .5, h * .5, w * .75);
    bg.addColorStop(0, tint); bg.addColorStop(1, '#020302'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
    for (const s of stars.current) {
      const z = ((s.z - t * .02 * warp) % 1 + 1) % 1, k = 1 / (z * 1.6 + .15);
      const x = w / 2 + s.x * w * .5 * k * .35, y = h / 2 + s.y * h * .5 * k * .35;
      if (x < 0 || y < 0 || x > w || y > h) continue;
      g.fillStyle = `rgba(236,232,222,${Math.min(1, (1 - z) * 1.2)})`; g.beginPath(); g.arc(x, y, 1.5 * (1 - z) + .35, 0, Math.PI * 2); g.fill();
    }
  });
  return <canvas ref={ref} className="film-canvas" />;
}

// --- 1 · Hook: the light-delay problem ----------------------------------------
function HookShot({ t }: { t: number }) {
  const travel = easeInOut(prog(t, 3.2, 4.2)), minutes = Math.round(22 * travel), show = easeOut(prog(t, 2.6, 1));
  return <>
    <Starfield t={t} warp={.5} />
    <div className="hook-title"><Rise t={t} at={.7} out={2.6} text="Space is vast." className="display" /></div>
    <div className="hook-orbit" style={{ opacity: show * (1 - easeInOut(prog(t, 7.6, .6))) }}>
      <div className="planet earth" /><div className="planet mars" />
      <svg className="hook-path" viewBox="0 0 1000 120" preserveAspectRatio="none">
        <path d="M0,60 C300,-10 700,130 1000,60" fill="none" stroke="rgba(236,232,222,.18)" strokeWidth="1.5" strokeDasharray="3 7" />
        <path d="M0,60 C300,-10 700,130 1000,60" fill="none" stroke="url(#sig)" strokeWidth="2.5" pathLength="1" strokeDasharray={`${travel} 1`} />
        <defs><linearGradient id="sig" x1="0" x2="1"><stop offset="0" stopColor="#9cc4ff" stopOpacity="0" /><stop offset="1" stopColor="#d7f27e" /></linearGradient></defs>
      </svg>
      <div className="planet-label l">Earth<em>Mission control</em></div>
      <div className="planet-label r">Mars<em>The rover</em></div>
      <div className="delay"><b>{String(minutes).padStart(2, '0')}:00</b><span>minutes for one command to arrive</span></div>
    </div>
    <div className="hook-title low"><Rise t={t} at={3} out={7.6} text="The farther we go, the longer every command takes." className="headline" /></div>
    <div className="hook-title"><Rise t={t} at={8} text="Can AI help us find our way?" className="display lime" /></div>
  </>;
}

// --- 2 · Meet Aether ----------------------------------------------------------
function MeetShot({ t }: { t: number }) {
  const p = easeOut(prog(t, .2, 1.6)), sheen = prog(t, 1.4, 2.2);
  return <>
    <Starfield t={t + 12} warp={.12} />
    <div className="meet-glow" style={{ opacity: p, transform: `scale(${.7 + .3 * p})` }} />
    <svg className="meet-rings" viewBox="-300 -300 600 600" style={{ opacity: p }}>
      {[150, 200, 260].map((r, i) => <circle key={r} r={r} fill="none" stroke={`rgba(215,242,126,${.22 - i * .06})`} strokeWidth="1.2" pathLength="1"
        strokeDasharray={i === 1 ? '0.02 0.03' : '1'} strokeDashoffset={1 - easeInOut(prog(t, .3 + i * .25, 1.4))} transform={`rotate(${t * (i % 2 ? -8 : 10)})`} />)}
    </svg>
    <div className="meet">
      <div style={{ transform: `translateY(${(1 - p) * 30}px) scale(${.7 + .3 * p})`, opacity: p }}><AetherSprite mood={t > 6.2 ? 'success' : t > 3.4 ? 'explaining' : 'idle'} size={250} /></div>
      <div className="wordmark" style={{ opacity: easeOut(prog(t, 1.1, 1.2)), letterSpacing: `${.22 + .4 * (1 - easeOut(prog(t, 1.1, 2)))}em`, backgroundPosition: `${100 - sheen * 100}% 0` }}>AETHER</div>
      <Fade t={t} at={3.1} className="tagline">An autonomous mission-control companion.</Fade>
      <Fade t={t} at={4.6} className="tagline lime">Built to turn a goal into action.</Fade>
    </div>
  </>;
}

// --- 3 · The live rover, in a product window ----------------------------------
/** Mounted from page load (suspended) so the 5 MB model, terrain and planner are ready before the shot. */
const LiveRover = memo(function LiveRover({ speed, paused, suspended, onHandle, onStatus }: { speed: number; paused: boolean; suspended: boolean; onHandle: (h: SceneHandle | null) => void; onStatus: (s: SceneStatus) => void }) {
  return <SceneView id="rover" remote speed={speed} paused={paused} suspended={suspended} onClose={() => {}} onHandle={onHandle} onStatus={onStatus} />;
});
const READY = Object.fromEntries((['docking', 'flyby', 'launch', 'rover'] as SceneId[]).map(id => [id, { status: 'ready', progress: 1 }])) as Record<SceneId, DownloadState>;
const BEATS = [
  { when: '', step: 'Pick a scene', title: 'One workspace, many missions.', sub: 'Docking, a black-hole flyby, a Saturn V launch and a Mars rover. Today, the rover.' },
  { when: '', step: 'The goal', title: 'Reach the next waypoint.', sub: 'A 33 m drive across a Martian boulder field.' },
  { when: 'Fault: unmapped boulder', step: 'A surprise', title: 'A boulder lands on the route.', sub: 'It is not on any map. Nobody warns the rover.' },
  { when: 'Looking for a better plan', step: 'Quick checks', title: 'The route no longer fits.', sub: 'Reflex checks flag it within a second and hand over to planning.' },
  { when: 'New plan adopted', step: 'Planning', title: 'Twelve plans, rolled forward.', sub: '' },
  { when: 'Goal reached', step: 'Arrived', title: 'Around the boulder. On target.', sub: 'Every decision in this run happened live, in the browser.' },
];
const WIN_W = 1280, WIN_H = 800;
function RoverShot({ t, playing, active, handle, status, speed, onHandle, onStatus, size }: { t: number; playing: boolean; active: boolean; handle: SceneHandle | null; status: SceneStatus | null; speed: number; onHandle: (h: SceneHandle | null) => void; onStatus: (s: SceneStatus) => void; size: { w: number; h: number } }) {
  const entries = handle?.live?.entries() ?? [];
  // Beat 0 is the scene shelf; from the click on, beats follow the live run's own decision feed.
  let beat = t < OPEN_AT ? 0 : 1; BEATS.forEach((b, i) => { if (i > 1 && t >= OPEN_AT && entries.some(e => e.title === b.when)) beat = i; });
  const plan = entries.find(e => e.title === 'New plan adopted');
  const planSub = plan?.detail?.split('.')[0] ?? 'Each one simulated 30 seconds ahead';
  // Camera: the window swings in, then pushes in on the decision panel while planning lands.
  const enter = easeOut(prog(t, .1, 1.6));
  const planAt = useRef<number | null>(null);
  if (beat >= 4 && planAt.current === null) planAt.current = t;
  if (beat < 4) planAt.current = null;
  const push = planAt.current === null ? 0 : easeInOut(prog(t, planAt.current, 1.1)) * (1 - easeInOut(prog(t, planAt.current + 4.4, 1.1)));
  const scale = Math.min((size.w * .62) / WIN_W, (size.h * .74) / WIN_H);
  const b = BEATS[beat];

  // The real scene shelf, a cursor that clicks Rover autonomy → Open, then a cross-fade into the live run.
  const shelfRef = useRef<HTMLDivElement>(null), target = useRef({ x: 1020, y: 560 });
  useLayoutEffect(() => {
    const btn = shelfRef.current?.querySelector('.card-rover .scene-open'), box = shelfRef.current?.getBoundingClientRect();
    if (btn && box && box.width) { const r = btn.getBoundingClientRect(), k = WIN_W / box.width; target.current = { x: (r.left + r.width / 2 - box.left) * k, y: (r.top + r.height / 2 - box.top) * k }; }
  });
  const swap = easeInOut(prog(t, CLICK_AT + .3, OPEN_AT - CLICK_AT)), move = easeInOut(prog(t, 1.2, CLICK_AT - 1.3));
  const cx = 760 + (target.current.x - 760) * move, cy = 640 + (target.current.y - 640) * move, press = prog(t, CLICK_AT, .5);
  return <>
    <div className="studio" />
    <div className="story" style={{ opacity: enter }}>
      <div className="story-avatar"><AetherSprite mood={beat === 0 ? 'listening' : (status?.mood as Mood) ?? (playing ? 'reading' : 'sleepy')} size={96} /></div>
      <div className="eyebrow"><i />{beat === 0 ? 'Mission scenes' : 'Live demo · Mars'}</div>
      <div className="story-copy" key={beat}>
        <h2>{b.title}</h2>
        <p>{beat === 4 ? `${planSub}.` : b.sub}</p>
      </div>
      <ol className="steps">{BEATS.map((s, i) => <li key={s.step} className={i < beat ? 'done' : i === beat ? 'on' : ''}><span>{i < beat ? '✓' : ''}</span>{s.step}</li>)}</ol>
    </div>
    <div className="product" style={{ width: WIN_W * scale, height: (WIN_H + 34) * scale, opacity: Math.min(1, enter * 1.4),
      transform: `perspective(2200px) translateX(${(1 - enter) * 120}px) rotateY(${(1 - enter) * -18}deg) rotateX(${(1 - enter) * 6}deg)` }}>
      <div className="product-inner" style={{ width: WIN_W, height: WIN_H + 34, transform: `scale(${scale})` }}>
        <div className="chrome"><i /><i /><i /><span>{swap < .5 ? 'Aether · Workspace' : 'Aether · Rover autonomy'}</span>{speed > 4 && <b>10× time</b>}</div>
        <div className="viewport" style={{ transform: `scale(${1 + .55 * push})`, transformOrigin: '96% 18%' }}>
          <LiveRover speed={speed} paused={!playing || !active || t < OPEN_AT} suspended={!active || t < CLICK_AT} onHandle={onHandle} onStatus={onStatus} />
          {swap < 1 && <div className="film-home" ref={shelfRef} style={{ opacity: 1 - swap, transform: `scale(${1 + .04 * swap})` }}>
            <span className="brand-mark" /><h1>What should we work on?</h1>
            <div className={`film-shelf ${press > 0 ? 'pressed' : ''}`}><SceneShelf states={READY} onDownload={() => {}} onOpen={() => {}} onRemove={() => {}} /></div>
            {press > 0 && press < 1 && <i className="click-ring" style={{ left: target.current.x, top: target.current.y, transform: `translate(-50%,-50%) scale(${.4 + press * 1.4})`, opacity: 1 - press }} />}
            <svg className="film-cursor" width="26" height="32" viewBox="0 0 22 28" style={{ left: cx - 4, top: cy - 3, transform: `scale(${press > 0 && press < .35 ? .88 : 1})` }}>
              <path d="M2 2 L2 22 L7.5 17 L11 25.5 L14.5 24 L11 15.8 L18.5 15.5 Z" fill="#fff" stroke="#111" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
          </div>}
        </div>
      </div>
    </div>
    <div className="product-shadow" style={{ width: WIN_W * scale * .9, opacity: enter }} />
  </>;
}

// --- 4 · How it works: the whole stack is one loop ----------------------------
// The flight stack in eight lines of code. Each layer's lines light up as the narration names it.
const CODE: { text: string; layer: 0 | 1 | 2 | 3; note?: string }[] = [
  { text: 'while (mission.active) {', layer: 0 },
  { text: '  control.step(state)', layer: 1, note: '// every 50 ms: PID keeps it on course' },
  { text: '', layer: 0 },
  { text: '  if (everySecond()) {', layer: 2 },
  { text: '    const verdict = reflex.check(state)', layer: 2, note: '// continue · slow · hold · replan' },
  { text: "    if (verdict === 'replan')", layer: 2 },
  { text: '      program = strategy.plan(state)', layer: 3, note: '// try many plans, keep the safe one' },
  { text: '  }', layer: 0 },
  { text: '}', layer: 0 },
];
const LAYERS = [
  { n: 1, name: 'Control loop', line: 'Runs every step. Steers with physics and a PID controller.', at: 2.9, color: '#9cc4ff', by: 'Plain code' },
  { n: 2, name: 'Reflex check', line: 'Every second: is the plan still OK?', at: 4.7, color: '#d7f27e', by: 'Decisions API', byAt: 8.4 },
  { n: 3, name: 'Strategy', line: "If it isn't: find a better plan, then hand it back.", at: 6.3, color: '#c8b6ff', by: 'Reasoning model', byAt: 10.8 },
];
/** Lightweight JS syntax colouring for the editor card. */
function Code({ text }: { text: string }) {
  return <>{text.split(/('[^']*'|\b(?:while|if|const)\b|\b\w+(?=\())/g).map((part, i) =>
    /^'/.test(part) ? <span key={i} className="tok-str">{part}</span>
    : /^(while|if|const)$/.test(part) ? <span key={i} className="tok-kw">{part}</span>
    : i % 2 ? <span key={i} className="tok-fn">{part}</span> : part)}</>;
}
function ArchShot({ t }: { t: number }) {
  const active = LAYERS.reduce((a, l) => t >= l.at ? l.n : a, 0);
  return <>
    <div className="arch-bg" />
    <div className="arch-title"><Fade t={t} at={.3} className="eyebrow center"><i />How it works</Fade><Rise t={t} at={.6} text="The whole stack is one loop." className="headline" /></div>
    <Fade t={t} at={.9} className="editor">
      <div className="editor-bar"><i /><i /><i /><span>flight_stack.ts</span></div>
      <pre>{CODE.map((line, i) => {
        const shown = t >= 1 + i * .12, lit = line.layer !== 0 && line.layer === active;
        const color = LAYERS[line.layer - 1]?.color;
        return <div key={i} className={`code-line ${lit ? 'lit' : ''}`} style={{ opacity: shown ? (active && line.layer && !lit ? .45 : 1) : 0, '--c': color } as CSSProperties}>
          <span className="ln">{i + 1}</span><span className="src"><Code text={line.text} /></span>
          {line.note && <span className="note" style={{ opacity: t >= (LAYERS[line.layer - 1]?.at ?? 99) ? 1 : 0 }}>{line.note}</span>}
        </div>;
      })}</pre>
    </Fade>
    <div className="layer-cards">
      {LAYERS.map(l => {
        const p = easeOut(prog(t, l.at - .2, .6)), by = l.byAt ? easeOut(prog(t, l.byAt, .6)) : p;
        return <div key={l.n} className={`layer-card ${active === l.n ? 'on' : ''}`} style={{ '--c': l.color, opacity: .2 + .8 * p, transform: `translateX(${(1 - p) * 20}px)` } as CSSProperties}>
          <span className="layer-n">{l.n}</span>
          <div><b>{l.name}</b><p>{l.line}</p>
            <em className={l.byAt ? 'ai' : ''} style={{ opacity: by }}>{l.byAt ? 'Powered by ' : ''}<strong>{l.by}</strong></em></div>
        </div>;
      })}
    </div>
    <Fade t={t} at={11.6} className="arch-foot">The Mars demo runs all three layers in your browser. In the docking scene, layers 2 and 3 run on the server with the Decisions API and a reasoning model.</Fade>
  </>;
}

// --- 5 · Credits: GPT Image, GPT-6 Astra, voice, Decisions API -----------------
function Turntable() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!, renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;
    renderer.setSize(el.clientWidth, el.clientHeight); el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, el.clientWidth / el.clientHeight, .1, 500);
    camera.position.set(28, 9, 30); camera.lookAt(-3, 0, 0);
    scene.add(new THREE.HemisphereLight(0xd8e4f0, 0x12140f, 1.6));
    const key = new THREE.DirectionalLight(0xffe2c0, 4); key.position.set(-14, 16, 10); scene.add(key);
    const rim = new THREE.DirectionalLight(0xd7f27e, 2.2); rim.position.set(12, 4, -18); scene.add(rim);
    const rig = new THREE.Group(); scene.add(rig); let disposed = false;
    new GLTFLoader().loadAsync(appUrl('/assets-3d/flyby/aether-odyssey-carrier.glb')).then(g => { if (!disposed) rig.add(g.scene); }).catch(() => {});
    renderer.setAnimationLoop(now => { rig.rotation.y = now / 3600; rig.position.y = Math.sin(now / 1400) * .4; renderer.render(scene, camera); });
    return () => { disposed = true; renderer.setAnimationLoop(null); renderer.dispose(); renderer.domElement.remove(); };
  }, []);
  return <div ref={ref} className="turntable" />;
}
const SPRITE_MOODS: Mood[] = ['success', 'thinking', 'panic', 'explaining', 'oops', 'done'];
function CreditsShot({ t }: { t: number }) {
  const STARTS = [0, 3.9, 7.4, 11.7], beat = STARTS.filter(s => t >= s).length - 1, local = t - STARTS[beat];
  const choice = ['continue', 'slow_down', 'hold', 'replan'], pick = local > 1.6 ? 3 : -1;
  const enter = easeOut(prog(local, 0, .8));
  const cell = Math.floor(t * 4) % 32, mood = SPRITE_MOODS[Math.floor(t / .8) % SPRITE_MOODS.length];
  const speaking = t > 9.4, listening = t > 7.8 && t < 9.2;
  // A scripted voice session: the real overlay, fed synthetic levels and captions.
  const voice: any = {
    state: 'live', error: '', muted: false, status: null, start() {}, stop() {}, toggleMute() {}, dismissError() {},
    captions: [
      ...(t > 7.8 ? [{ id: 1, role: 'user', text: "Aether, how's the rover doing?".slice(0, Math.round(prog(t, 7.8, 1.2) * 29)), endMs: 0 }] : []),
      ...(t > 9.4 ? [{ id: 2, role: 'assistant', text: 'Waypoint reached. Two plans rejected, one adopted. Clean drive.'.slice(0, Math.round(prog(t, 9.4, 2.4) * 64)), endMs: 0 }] : []),
    ],
    levels: () => ({ input: listening ? .25 + .2 * Math.abs(Math.sin(performance.now() / 120)) : 0, output: speaking ? .3 + .25 * Math.abs(Math.sin(performance.now() / 95)) : 0 }),
  };
  return <>
    <div className="credits-bg" />
    {beat === 0 && <div className="credit" key="image" style={{ opacity: enter }}>
      <div className="credit-copy"><span className="eyebrow"><i />Built with OpenAI</span><h3>Expressions by<br /><b>GPT Image</b></h3><p>64 sprites: 32 expressions, each facing left and right.</p></div>
      <div className="sheet-wrap" style={{ transform: `perspective(1600px) rotateY(${-22 + 8 * enter}deg) rotateX(8deg)` }}>
        <div className="sheet"><img src={appUrl('/aether-avatar-sprites-v2-a.png')} alt="" /><span className="cell" style={{ left: `${(cell % 4) * 25}%`, top: `${Math.floor(cell / 4) * 12.5}%` }} /></div>
      </div>
      <div className="credit-hero"><AetherSprite mood={mood} size={230} facing={Math.floor(t / 1.6) % 2 ? 'right' : 'left'} /></div>
    </div>}
    {beat === 1 && <div className="credit" key="astra" style={{ opacity: enter }}>
      <div className="credit-copy"><span className="eyebrow"><i />Built with OpenAI</span><h3>Spacecraft by<br /><b>GPT-6 Astra</b></h3><p>The Odyssey carrier, its drop stage and the Kestrel.</p></div>
      <div className="stage-light" /><Turntable /><div className="floor" />
    </div>}
    {beat === 2 && <div className="voice-stage" style={{ opacity: enter }}>
      <VoiceOverlay voice={voice} speaker={speaking ? 'assistant' : listening ? 'user' : 'none'} onSpeaker={() => {}} />
      <div className="voice-buddy"><AetherSprite mood={speaking ? 'explaining' : 'listening'} size={220} /></div>
      <div className="voice-tag"><b>Voice mode</b>Talk it through with Aether</div>
    </div>}
    {beat === 3 && <div className="credit" key="decisions" style={{ opacity: enter }}>
      <div className="credit-copy"><span className="eyebrow"><i />Built with OpenAI</span><h3>Fast calls by the<br /><b>Decisions API</b></h3><p>The reflex layer asks one typed question and gets one typed answer, quickly enough to keep flying.</p></div>
      <div className="decision-card" style={{ transform: `perspective(1600px) rotateY(${-14 + 6 * enter}deg)` }}>
        <div className="editor-bar"><i /><i /><i /><span>reflex.check(state)</span></div>
        <pre>
          <span className="tok-fn">decisions</span>.<span className="tok-fn">create</span>{'({\n'}
          {'  input: telemetry,\n  questions: [{\n    type: '}<span className="tok-str">"choice"</span>{', name: '}<span className="tok-str">"action"</span>{',\n    choices: [\n'}
          {choice.map((c, i) => <span key={c} className={`choice ${pick === i ? 'picked' : pick >= 0 ? 'dim' : ''}`}>{'      '}<span className="tok-str">"{c}"</span>{i < 3 ? ',' : ''}{'\n'}</span>)}
          {'    ]\n  }]\n})'}
        </pre>
        <div className="answer" style={{ opacity: easeOut(prog(local, 1.6, .5)) }}>→ action: <b>"replan"</b><span>hand over to strategy</span></div>
      </div>
    </div>}
  </>;
}

// --- 6 · Outro ----------------------------------------------------------------
function OutroShot({ t }: { t: number }) {
  const sheen = prog(t, 6.6, 2);
  return <>
    <Starfield t={t + 40} warp={.1} tint="#11140d" />
    <div className="outro">
      <Fade t={t} at={.3}><AetherSprite mood={t > 4 ? 'done' : 'idle'} size={150} /></Fade>
      <Rise t={t} at={1.1} out={6.3} text="We can't guide every step from Earth." className="headline" />
      <Rise t={t} at={3.9} out={6.3} text="But we can teach our explorers to find their way." className="headline lime" />
      <Fade t={t} at={6.6} className="wordmark small" style={{ backgroundPosition: `${100 - sheen * 100}% 0` }}>AETHER</Fade>
      <Fade t={t} at={7.1} className="built">Decisions API · GPT Image · GPT-6 Astra · GPT-Live voice</Fade>
      <Fade t={t} at={7.5} className="fine">The rover shot is a live run of Aether's in-browser stack. Narration is an AI-generated voice (gpt-4o-mini-tts).</Fade>
    </div>
  </>;
}

// --- Player -------------------------------------------------------------------
export default function DemoFilm() {
  const { time, playing, seek, toggle } = useFilmClock();
  useNarration(time, playing);
  const [started, setStarted] = useState(false), [fullscreen, setFullscreen] = useState(false), [size, setSize] = useState({ w: innerWidth, h: innerHeight });
  const [handle, setHandle] = useState<SceneHandle | null>(null), [status, setStatus] = useState<SceneStatus | null>(null);
  const [run, setRun] = useState(0), injected = useRef(-1), ran = useRef(false), root = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null);
  const scene = sceneAt(time), t = time - scene.start;

  useEffect(() => {
    const el = stage.current!, o = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    o.observe(el); return () => o.disconnect();
  }, []);
  // The rover is built once; re-entering its shot restarts the run (fresh vehicle, default program) instead of
  // reloading assets. The boulder drops on cue in every run.
  const lastScene = useRef('');
  useEffect(() => {
    if (scene.id === 'rover' && lastScene.current !== 'rover') { if (ran.current) void handle?.live?.restart(); ran.current = true; setRun(r => r + 1); }
    lastScene.current = scene.id;
  }, [scene.id, handle]);
  useEffect(() => {
    if (scene.id === 'rover' && t >= BOULDER_AT && injected.current !== run && handle?.live) { injected.current = run; void handle.live.act('boulder'); }
  }, [scene.id, t, run, handle]);
  const onHandle = useCallback((h: SceneHandle | null) => setHandle(h), []);
  const onStatus = useCallback((s: SceneStatus) => setStatus(s), []);
  const seekTo = (s: number) => { if (sceneAt(s).id === 'rover') lastScene.current = ''; seek(s); };
  const play = () => { setStarted(true); toggle(); };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); play(); }
      if (e.key === 'f') { if (document.fullscreenElement) void document.exitFullscreen(); else void root.current?.requestFullscreen(); }
    };
    const fs = () => setFullscreen(!!document.fullscreenElement);
    addEventListener('keydown', key); document.addEventListener('fullscreenchange', fs);
    return () => { removeEventListener('keydown', key); document.removeEventListener('fullscreenchange', fs); };
  });

  return <div ref={root} className="demo-film">
    <div ref={stage} className="film-stage" onClick={play}>
      {/* Always mounted: the rover preloads behind the opening shots and only becomes visible in its own. */}
      <div className="shot" style={scene.id === 'rover' ? shotStyle(t, scene.dur) : { opacity: 0, visibility: 'hidden', pointerEvents: 'none' }}>
        <RoverShot t={scene.id === 'rover' ? t : 0} playing={playing} active={scene.id === 'rover'} handle={handle} status={status} speed={scene.id === 'rover' && t >= FAST_AT ? 10 : 4} onHandle={onHandle} onStatus={onStatus} size={size} />
      </div>
      <div className="shot" key={scene.id} style={shotStyle(t, scene.dur)}>
        {scene.id === 'hook' && <HookShot t={t} />}
        {scene.id === 'meet' && <MeetShot t={t} />}
        {scene.id === 'arch' && <ArchShot t={t} />}
        {scene.id === 'credits' && <CreditsShot t={t} />}
        {scene.id === 'outro' && <OutroShot t={t} />}
      </div>
      <div className={`letterbox ${scene.letterbox ? 'on' : ''}`} />
      <div className="vignette" />
      <div className="grain" style={{ backgroundPosition: `${(time * 997) % 128}px ${(time * 631) % 128}px` }} />
      {!started && <button className="film-start" onClick={e => { e.stopPropagation(); play(); }}>
        <AetherSprite mood="idle" size={170} /><span>Aether</span><em>Play the film · {fmt(TOTAL)} · sound on</em>
      </button>}
    </div>
    <div className="film-bar">
      <div className="film-track" onPointerDown={e => { const r = e.currentTarget.getBoundingClientRect(); seekTo((e.clientX - r.left) / r.width * TOTAL); }}>
        {SCENES.map(s => <div key={s.id} className="seg" style={{ flex: s.dur }} title={s.label}><i style={{ width: `${clamp((time - s.start) / s.dur, 0, 1) * 100}%` }} /></div>)}
      </div>
      <div className="film-controls">
        <button aria-label={playing ? 'Pause' : 'Play'} onClick={play}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
        <span className="clock">{fmt(time)} / {fmt(TOTAL)}</span>
        <span className="label">{scene.label}</span>
        <button aria-label="Full screen" onClick={() => document.fullscreenElement ? void document.exitFullscreen() : void root.current?.requestFullscreen()}>{fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
      </div>
    </div>
  </div>;
}

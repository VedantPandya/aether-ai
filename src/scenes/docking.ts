import { appUrl } from '../urls';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { follow, mmss, sampleAt, stars, type LiveAction, type LiveEntry, type LivePanel, type LiveStatus, type SceneContext, type SceneHandle } from './kit';

interface Sample { t: number; x: number; y: number; speed_m_s: number; fuel_kg: number; phase: string; distance_m: number; station_angle: number }
/** Plant snapshot streamed by /api/autonomy telemetry (backend/physics_models/docking_plant.py). */
interface PlantState {
  t: number; position_m: number[]; velocity_m_s: number[]; heading_rad: number; angular_velocity_rad_s: number; fuel_kg: number;
  distance_m: number; relative_speed_m_s: number; station_angle: number; station_angular_velocity_rad_s: number;
  thrust_effectiveness: number; program: { mode: string }; done: boolean;
}
interface AutonomyEvent { id: number; type: string; layer: 1 | 2 | 3 | null; t: number; data: Record<string, any> }

const REALTIME = 4, PORT_RADIUS_M = 8;
const ACTIONS: LiveAction[] = [
  { id: 'thrust', label: 'Thrust −50%', hint: 'Lose half of translation thrust' },
  { id: 'leak', label: 'Fuel leak', hint: 'Vent 60% of remaining propellant' },
  { id: 'debris', label: 'Debris', hint: 'Place a 2 m object across the approach path' },
  { id: 'spin', label: 'Spin up', hint: 'Station spin changes to 0.6 rpm' },
];

const FAULT_TEXT: Record<string, (v: number) => [string, string]> = {
  thrust_loss: v => ['Lost thrust', `The thrusters now deliver ${Math.round((1 - v) * 100)}% of normal force.`],
  fuel_leak: v => ['Fuel leak', `${Math.round(v * 100)}% of the remaining propellant vented.`],
  torque_loss: v => ['Attitude thrusters weak', `Turning authority down ${Math.round(v * 100)}%.`],
  station_spin_change: v => ['Station spin changed', `The docking port now rotates at ${v} rpm.`],
  obstacle: v => ['Debris in the path', `A ${v} m object is between the craft and the port.`],
};
/** Approach program in words: how fast it closes in, whether it swings around, how hard it pushes. */
function programWords(p: any) {
  const parts = [`${Number(p.approach_time_constant_s) > 30 ? 'slower' : 'standard'} approach (τ ${p.approach_time_constant_s} s)`];
  if (p.phase_offset_deg) parts.push(`swing ${Math.abs(p.phase_offset_deg)}° ${p.phase_offset_deg > 0 ? 'ahead of' : 'behind'} the port`);
  if (p.thrust_fraction < 1) parts.push(`${Math.round(p.thrust_fraction * 100)}% thrust`);
  return p.mode === 'approach' ? parts.join(', ') : `${p.mode} at ${p.hold_distance_m} m`;
}
/** Plain-language feed line for each autonomy event; null hides routine traffic (counted separately). */
function describe(e: AutonomyEvent): Omit<LiveEntry, 'id' | 't'> | null {
  const d = e.data, how = (s: any) => `${String(s.source ?? '').replace(/_/g, ' ')} · ${Math.round(s.latency_ms ?? 0)} ms`;
  switch (e.type) {
    case 'fault': { const [title, detail] = FAULT_TEXT[d.type]?.(d.value) ?? [String(d.type).replace(/_/g, ' '), '']; return { layer: 1, tone: 'bad', title: `Fault: ${title}`, detail }; }
    case 'local_guard': return { layer: 1, tone: d.action === 'abort' ? 'bad' : 'warn', title: d.action === 'abort' ? 'Aborting' : 'Holding position', detail: d.action === 'abort' ? d.reason : 'Pausing the approach until the higher layers decide what to do.', tech: d.reason };
    case 'reflex_decision':
      if (d.action === 'continue' && !d.vetoed && !d.escalate) return null;
      return { layer: 2, tone: d.action === 'abort' ? 'bad' : 'warn', title: d.vetoed ? 'Quick check overruled by safety rules' : d.escalate || d.action === 'replan' ? 'Quick check: the plan no longer fits' : `Quick check: ${d.action.replace('_', ' ')}`,
        detail: /explicit offline reflex policy/i.test(d.reason) ? 'Conditions changed beyond what the current approach can handle.' : d.reason, tech: how(d) };
    case 'reflex_discarded': return { layer: 2, tone: 'info', title: 'Quick check ignored', detail: 'Things changed while it was being decided.', tech: d.reason };
    case 'reflex_program_applied': return { layer: 1, tone: 'good', title: `Backing off (${d.program.mode})`, detail: 'The retreat passed the physics check.' };
    case 'strategic_requested': return { layer: 3, tone: 'info', title: 'Looking for a better plan', detail: 'Testing alternative approaches against the physics model before changing anything.' };
    case 'strategic_preview': return d.evidence?.admissible
      ? { layer: 3, tone: 'good', title: 'Option works', detail: `${programWords(d.program ?? {})}: captures in about ${Math.round(d.evidence.duration_s ?? 0)} s.` }
      : { layer: 3, tone: 'warn', title: 'Option rejected', detail: `${programWords(d.program ?? {})}: ${String(d.evidence?.reason ?? 'failed the check').toLowerCase()}.` };
    case 'strategic_message': return { layer: 3, tone: 'info', title: 'Strategy note', detail: String(d.text ?? d.message ?? '').slice(0, 180) };
    case 'proposal_vetoed': return { layer: 1, tone: 'warn', title: 'Plan rejected by the safety check', detail: d.reason };
    case 'strategic_error': return { layer: 3, tone: 'bad', title: 'Planning failed', detail: d.message };
    case 'program_applied': return { layer: 1, tone: 'good', title: 'New plan adopted', detail: `${programWords(d.program)}. Resuming the approach.`, tech: String(d.source).replace(/_/g, ' ') };
    case 'notice': return { layer: null, tone: 'info', title: 'Running on offline rules', detail: 'No AI model calls. Physics, faults and safety checks are real.' };
    case 'budget': return { layer: 3, tone: 'bad', title: 'Out of replans', detail: `All ${MAX_REPLANS} strategy calls for this run are used. Holding until time runs out; press Run again for a fresh vehicle.` };
    case 'status': return d.status === 'running' ? null : { layer: 1, tone: d.status === 'docked' ? 'good' : 'bad', title: d.status === 'docked' ? 'Docked' : d.status === 'timeout' ? 'Ran out of time' : `Run ended (${d.status})`, detail: d.status === 'docked' ? 'Captured within every position, speed and attitude tolerance.' : d.summary };
    default: return null;
  }
}
const MAX_REPLANS = 6;
const MOODS: Record<string, string> = { fault: 'panic', local_guard: 'worried', strategic_requested: 'thinking', strategic_preview: 'thinking', program_applied: 'editing', reflex_program_applied: 'editing', proposal_vetoed: 'oops', strategic_error: 'worried' };

// Coordinate contract from assets-3d/README-docking.md: metres, station spin +Y, plant (x, y) -> (x, 0, y).
export default async function build({ scene, camera, controls, url, json }: SceneContext): Promise<SceneHandle> {
  const loader = new GLTFLoader();
  const [station, ship, replay, earthUrl] = await Promise.all([
    url('/assets-3d/docking/aether-relay-station.glb').then(u => loader.loadAsync(u)).then(g => g.scene),
    url('/assets-3d/docking/aether-kestrel-spacecraft.glb').then(u => loader.loadAsync(u)).then(g => g.scene),
    json<{ samples: Sample[] }>('/assets-3d/docking/docking-replay.json'),
    url('/earth-blue-marble.png'),
  ]);
  scene.add(station, ship);
  scene.add(new THREE.HemisphereLight(0xa9bfd8, 0x0a0c10, 1.1));
  const sun = new THREE.DirectionalLight(0xfff1dc, 3.6); sun.position.set(-80, 50, 40); scene.add(sun);
  const rim = new THREE.DirectionalLight(0x86a8ff, .9); rim.position.set(60, -20, -50); scene.add(rim);
  scene.add(stars(5000, 9000));

  // Far enough back that a good fraction of the globe is visible, so the colour map is not magnified into blocks.
  const earthTexture = await new THREE.TextureLoader().loadAsync(earthUrl); earthTexture.colorSpace = THREE.SRGBColorSpace; earthTexture.anisotropy = 8;
  const earth = new THREE.Mesh(new THREE.SphereGeometry(4000, 128, 96), new THREE.MeshStandardMaterial({ map: earthTexture, roughness: .9 }));
  earth.position.set(-1500, -6200, -4200); earth.rotation.set(.4, 2.2, 0); scene.add(earth);
  const limb = new THREE.Mesh(new THREE.SphereGeometry(4090, 128, 96), new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal); vec4 p = modelViewMatrix * vec4(position,1.); vV = normalize(-p.xyz); gl_Position = projectionMatrix * p; }',
    fragmentShader: 'varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1. - abs(dot(vN, vV)), 5.); gl_FragColor = vec4(vec3(.35,.6,1.) * f * 1.6, f); }',
  }));
  limb.position.copy(earth.position); scene.add(limb);

  camera.position.set(34, 20, 52); controls.target.set(10, 0, 0); controls.minDistance = 8; controls.maxDistance = 400;
  const focus = new THREE.Vector3();
  const pose = (x: number, y: number, heading: number, stationAngle: number) => {
    station.rotation.y = -stationAngle;
    ship.position.set(x, 0, y); ship.rotation.y = -heading;
    focus.set(x * .45, 0, y * .45); follow(controls, focus, .04);
  };

  // ---- Live: stream a real autonomy session; fall back to the recorded replay if the backend is unreachable. ----
  const trailPoints = new Float32Array(3 * 4000), trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPoints, 3)); trailGeometry.setDrawRange(0, 0);
  scene.add(new THREE.Line(trailGeometry, new THREE.LineBasicMaterial({ color: 0xd7f27e, transparent: true, opacity: .55 })));
  const hazards = new THREE.Group(); scene.add(hazards);
  const alarm = new THREE.PointLight(0xff5a4a, 0, 40, 1.5); ship.add(alarm);

  let session: string | null = null, stream: EventSource | null = null, latest: PlantState | null = null, received = 0, trail = 0;
  let entries: LiveEntry[] = [], status: LiveStatus = { state: 'connecting', ai: false, aiAvailable: true, provider: '', summary: '', activeLayer: null };
  let lastMood: { mood: string; at: number } | null = null, alarmUntil = 0, entryId = 0, lastEventId = 0;
  let routine = 0, replans = 0, budgetSaid = false, story: { text: string; at: number } | null = null;
  const active = new Set<string>(); // faults already applied this run, so repeated clicks do not stack up
  const say = (text: string) => { story = { text, at: performance.now() }; };
  const shown = new THREE.Vector3(), shownState = { heading: 0, station: 0, init: false };

  function push(e: AutonomyEvent) {
    const line = describe(e); if (!line) return;
    const last = entries[0];
    if (last && last.title === line.title && last.detail === line.detail) { entries = [{ ...last, count: (last.count ?? 1) + 1, t: e.t }, ...entries.slice(1)]; return; }
    entries = [{ ...line, id: ++entryId, t: e.t }, ...entries].slice(0, 40);
  }
  function onEvent(e: AutonomyEvent) {
    if (e.id <= lastEventId) return; lastEventId = e.id;
    if (e.type === 'telemetry') {
      latest = e.data as PlantState; received = performance.now();
      if (trail < 4000) { trailPoints.set([latest.position_m[0], 0, latest.position_m[1]], trail * 3); trailGeometry.setDrawRange(0, ++trail); trailGeometry.attributes.position.needsUpdate = true; }
      return;
    }
    if (e.layer) status = { ...status, activeLayer: e.layer };
    if (MOODS[e.type]) lastMood = { mood: MOODS[e.type], at: performance.now() };
    // Headline narration and replan accounting.
    if (e.type === 'reflex_decision' && e.data.action === 'continue' && !e.data.escalate && !e.data.vetoed) routine++;
    if (e.type === 'fault') { const [title, detail] = FAULT_TEXT[e.data.type]?.(e.data.value) ?? ['Fault', '']; say(`${title}: ${detail} Holding while the stack works out what to do.`); }
    if (e.type === 'strategic_requested') { replans++; say('Testing alternative approaches before changing anything.'); }
    if (e.type === 'program_applied') say(`New plan adopted: ${programWords(e.data.program)}. Closing in again.`);
    if (e.type === 'proposal_vetoed') say('The proposed plan failed the safety check. Holding position.');
    if (e.type === 'strategic_error') say('Planning failed. Holding position.');
    if (e.type === 'reflex_decision' && (e.data.escalate || e.data.action === 'replan') && replans >= MAX_REPLANS && !budgetSaid) {
      // The backend stops starting strategy once the budget is spent, without an event; say so instead of looping silently.
      budgetSaid = true; say('Out of replans for this run. Holding until time runs out.');
      push({ id: 0, type: 'budget', layer: 3, t: e.t, data: {} });
    }
    if (e.type === 'fault') {
      alarmUntil = performance.now() + 1600;
      if (e.data.type === 'obstacle') {
        const [x, y] = e.data.position_m, r = e.data.value;
        const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), new THREE.MeshStandardMaterial({ color: 0x5b5048, roughness: .9, flatShading: true }));
        const ring = new THREE.Mesh(new THREE.RingGeometry(r + .5, r + .62, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff7b6b, transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false }));
        rock.position.set(x, 0, y); ring.position.set(x, 0, y); hazards.add(rock, ring);
      }
    }
    if (e.type === 'status' && e.data.status !== 'running') {
      status = { ...status, state: 'ended', summary: e.data.summary ?? '' };
      lastMood = { mood: e.data.status === 'docked' ? 'success' : 'worried', at: performance.now() + 1e9 };
      stream?.close();
    }
    push(e);
  }
  async function start(ai: boolean) {
    stop(); entries = []; latest = null; lastEventId = 0; routine = 0; replans = 0; budgetSaid = false; story = null; active.clear(); trail = 0; trailGeometry.setDrawRange(0, 0); hazards.clear(); shownState.init = false; lastMood = null;
    status = { state: 'connecting', ai, aiAvailable: true, provider: '', summary: '', activeLayer: null };
    try {
      const response = await fetch(appUrl('/api/autonomy/sessions'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: ai ? 'auto' : 'demo', paced: true, realtime_factor: REALTIME, max_strategic_calls: MAX_REPLANS }) });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail ?? `Autonomy unavailable (${response.status})`);
      const snapshot = await response.json();
      session = snapshot.id; status = { ...status, state: 'live', provider: snapshot.provider };
      stream = new EventSource(appUrl(`/api/autonomy/sessions/${session}/events`));
      stream.onmessage = m => onEvent(JSON.parse(m.data));
      stream.onerror = () => { stream?.close(); if (status.state === 'live') void catchUp(snapshot.id); };
    } catch (e) {
      status = { state: 'offline', ai, aiAvailable: true, provider: '', summary: (e as Error).message, activeLayer: null };
    }
  }
  /** The event stream can close just before the final status event is emitted; read what was missed from the snapshot. */
  async function catchUp(id: string) {
    for (let attempt = 0; attempt < 6 && session === id && status.state === 'live'; attempt++) {
      try {
        const snapshot = await (await fetch(appUrl(`/api/autonomy/sessions/${id}?after=${lastEventId}`))).json();
        if (session !== id) return;
        for (const e of snapshot.events ?? []) onEvent(e);
        if (!['running', 'starting', 'created'].includes(snapshot.status)) {
          if (status.state === 'live') onEvent({ id: lastEventId + 1, type: 'status', layer: 1, t: latest?.t ?? 0, data: { status: snapshot.status, summary: snapshot.summary } });
          return;
        }
        // Still running: the stream dropped; reattach to it.
        stream = new EventSource(appUrl(`/api/autonomy/sessions/${id}/events?after=${lastEventId}`));
        stream.onmessage = m => onEvent(JSON.parse(m.data));
        stream.onerror = () => { stream?.close(); if (status.state === 'live') void catchUp(id); };
        return;
      } catch { await new Promise(r => setTimeout(r, 500)); }
    }
    if (session === id && status.state === 'live') status = { ...status, state: 'ended', summary: 'Lost contact with the flight stack' };
  }
  function stop() {
    stream?.close(); stream = null;
    if (session && status.state === 'live') void fetch(appUrl(`/api/autonomy/sessions/${session}/stop`), { method: 'POST' }).catch(() => {});
    session = null;
  }
  async function inject(id: string) {
    if (!session || !latest || status.state !== 'live') return;
    // Re-applying an identical fault changes nothing physically but spends a replan; ignore it.
    if (active.has(id)) { say('That fault is already active. Try a different one, or Run again for a fresh vehicle.'); return; }
    active.add(id);
    const at_s = Math.min(600, latest.t + .2);
    let fault: Record<string, unknown>;
    if (id === 'thrust') fault = { type: 'thrust_loss', value: .5, at_s };
    else if (id === 'leak') fault = { type: 'fuel_leak', value: .6, at_s };
    else if (id === 'spin') fault = { type: 'station_spin_change', value: .6, at_s };
    else {
      // Debris 45% of the way from the craft to the port, which is where the approach is heading.
      const a = latest.station_angle, [x, y] = latest.position_m, px = PORT_RADIUS_M * Math.cos(a), py = PORT_RADIUS_M * Math.sin(a);
      fault = { type: 'obstacle', value: 2, at_s, position_m: [x + (px - x) * .45, y + (py - y) * .45] };
    }
    const response = await fetch(appUrl(`/api/autonomy/sessions/${session}/inject`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fault) });
    if (!response.ok) push({ id: 0, type: 'strategic_error', layer: null, t: latest.t, data: { message: (await response.json().catch(() => ({}))).detail ?? 'Fault rejected' } });
  }
  await start(false);

  const live: LivePanel = {
    entries: () => entries, status: () => status, actions: ACTIONS, act: inject,
    restart: ai => start(ai ?? status.ai),
    mood: () => lastMood && performance.now() - lastMood.at < 4500 ? lastMood.mood : null,
    routine: () => routine,
    headline: () => {
      if (status.state === 'connecting') return 'Starting the flight stack…';
      if (status.state === 'offline') return 'Autonomy backend unreachable: showing a recorded run.';
      if (status.state === 'ended') return entries.find(e => e.title === 'Docked') ? 'Docked. Captured within every tolerance.' : status.summary || 'Run ended.';
      if (story && performance.now() - story.at < 9000) return story.text;
      if (!latest) return 'Waiting for telemetry…';
      const mode = latest.program.mode;
      return mode === 'approach' ? `Closing in: ${latest.distance_m.toFixed(1)} m to the port at ${latest.relative_speed_m_s.toFixed(2)} m/s. All checks passing.`
        : mode === 'hold' ? `Holding ${latest.distance_m.toFixed(0)} m from the port while the stack decides.` : `${mode[0].toUpperCase()}${mode.slice(1)} in progress.`;
    },
  };
  const replaying = () => status.state === 'offline';
  const samples = replay.samples, replayEnd = samples.at(-1)!.t;
  const at = (t: number) => {
    const [a, b, f] = sampleAt(samples, t), lerp = (k: keyof Sample) => THREE.MathUtils.lerp(a[k] as number, b[k] as number, f);
    return { x: lerp('x'), y: lerp('y'), angle: lerp('station_angle'), distance: lerp('distance_m'), speed: lerp('speed_m_s'), fuel: lerp('fuel_kg'), phase: b.phase };
  };
  /** Dead-reckon between 0.5 s telemetry frames so motion stays smooth, never more than 1 s ahead of the plant. */
  const now = () => {
    if (!latest) return null;
    const ahead = status.state === 'live' && !latest.done ? Math.min(1, (performance.now() - received) / 1000 * REALTIME) : 0;
    return { s: latest, dt: ahead };
  };

  return {
    duration: Infinity, start: 0, speed: 1, live,
    note: 'Live autonomy session: RK4 plant with PD control, reflex checks and strategic replans. Planar model, no contact dynamics.',
    update(t, dt) {
      earth.rotation.y += dt * .004;
      alarm.intensity = performance.now() < alarmUntil ? 40 * (.5 + .5 * Math.sin(performance.now() / 70)) : 0;
      if (replaying()) { const s = at(t % (replayEnd + 3)); pose(s.x, s.y, Math.atan2(s.y, s.x) + Math.PI, s.angle); return; }
      const n = now(); if (!n) return;
      const { s, dt: ahead } = n;
      const x = s.position_m[0] + s.velocity_m_s[0] * ahead, y = s.position_m[1] + s.velocity_m_s[1] * ahead;
      const heading = s.heading_rad + s.angular_velocity_rad_s * ahead, stationAngle = s.station_angle + s.station_angular_velocity_rad_s * ahead;
      if (!shownState.init) { shown.set(x, 0, y); shownState.heading = heading; shownState.station = stationAngle; shownState.init = true; }
      shown.lerp(new THREE.Vector3(x, 0, y), .25); shownState.heading += (heading - shownState.heading) * .25; shownState.station += (stationAngle - shownState.station) * .3;
      pose(shown.x, shown.z, shownState.heading, shownState.station);
    },
    phase(t) {
      if (replaying()) return t >= replayEnd ? 'Soft capture (replay)' : `${at(t).phase} (replay)`;
      if (status.state === 'connecting') return 'Starting flight stack';
      if (status.state === 'ended') return status.summary.startsWith('Capture') ? 'Soft capture' : status.summary || 'Session ended';
      const mode = latest?.program.mode ?? 'approach';
      return { approach: 'PD approach', hold: 'Holding position', retreat: 'Retreating', abort: 'Abort' }[mode] ?? mode;
    },
    readouts(t) {
      if (replaying()) { const s = at(t % (replayEnd + 3)); return [{ label: 'Range', value: s.distance.toFixed(1), unit: 'm' }, { label: 'Closing speed', value: s.speed.toFixed(2), unit: 'm/s' }, { label: 'Fuel', value: s.fuel.toFixed(1), unit: 'kg' }]; }
      const s = latest; if (!s) return [];
      return [
        { label: 'Range', value: s.distance_m.toFixed(1), unit: 'm' },
        { label: 'Closing speed', value: s.relative_speed_m_s.toFixed(2), unit: 'm/s' },
        { label: 'Fuel', value: s.fuel_kg.toFixed(1), unit: 'kg' },
        { label: 'Thrust', value: String(Math.round(s.thrust_effectiveness * 100)), unit: '%' },
      ];
    },
    clock: t => replaying() ? mmss(t % (replayEnd + 3)) : mmss(latest?.t ?? 0),
    dispose: stop,
  };
}

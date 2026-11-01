import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { follow, mmss, puffTexture, skyDome, stars, type LiveAction, type SceneContext, type SceneHandle } from './kit';
import { FlightStack, Pid, type Candidate } from './stack';

// Printable Saturn V parts (millimetres, +Y up), stacked bottom to top. The full stack is scaled to the real 110.6 m.
const STACK: [string, string, number, number][] = [
  ['s-ic-bottom', '#f1efe8', .15, .55], ['s-ic-top', '#f3f1ea', .1, .55], ['coupler', '#e6e3db', .15, .5], ['s-ii', '#f4f2ec', .1, .5],
  ['s-ivb', '#efede6', .1, .5], ['lem-shroud', '#dedbd2', .1, .5], ['service-module', '#c7c9cb', .65, .32], ['command-module', '#b9bcc0', .75, .28], ['escape-tower', '#a8432f', .3, .45],
];
const HEIGHT_M = 110.6, PAD_TOP = 9, G0 = 9.80665, R_EARTH = 6.371e6, DEG = Math.PI / 180;
const S1_PROP = 2.16e6, S1_DRY = 131000, LIFTOFF_MASS = 2.97e6, F1_FLOW = 2578, ARM = 45, GYRATION2 = 900, AREA = Math.PI * 5.05 ** 2;

// ---- Plant: planar ascent with thrust vectoring. The controller steers pitch through the engine gimbal. ----
interface Program { pitchRate: number; kp: number; ki: number; kd: number; qLimit: number; gLimit: number }
interface State { t: number; x: number; h: number; vx: number; vh: number; m: number; pitch: number; rate: number; prop: number; stage: 1 | 2; engines: number; throttle: number; gimbal: number; acc: number; q: number; sepAt: number }
/** True hardware condition. Faults change it; the controller works from estimates. */
interface Hardware { perf: number; gimbalBias: number; gimbalLimit: number; disturbance: number; disturbanceUntil: number; enginesOut: number }
const DEFAULT: Program = { pitchRate: .5, kp: 1.2, ki: 0, kd: 2.2, qLimit: 33, gLimit: 4 };
const describeProgram = (p: Program) => `pitch ${p.pitchRate.toFixed(2)}°/s · gimbal PID ${p.kp}/${p.ki}/${p.kd} · q ≤ ${p.qLimit} kPa · ≤ ${p.gLimit} g`;
const pitchTarget = (t: number, p: Program) => t < 12 ? 0 : Math.min(75 * DEG, (t - 12) * p.pitchRate * DEG);
const start = (): State => ({ t: -7, x: 0, h: 0, vx: 0, vh: 0, m: LIFTOFF_MASS, pitch: 0, rate: 0, prop: S1_PROP, stage: 1, engines: 5, throttle: 1, gimbal: 0, acc: 0, q: 0, sepAt: -1 });
const healthy = (): Hardware => ({ perf: 1, gimbalBias: 0, gimbalLimit: 5 * DEG, disturbance: 0, disturbanceUntil: -1, enginesOut: 0 });

function thrustOf(s: State, hw: Hardware) {
  const p = Math.exp(-s.h / 7200), spool = THREE.MathUtils.smoothstep(s.t, -6.5, -1.6);
  if (s.stage === 1) return s.prop > 0 ? (s.engines - hw.enginesOut) * (6.77e6 * p + 7.77e6 * (1 - p)) * spool * hw.perf * s.throttle : 0;
  return s.t >= s.sepAt + 1.9 ? 5 * 1.033e6 * hw.perf : 0;
}
/** L1 controller: gimbal PID on pitch error; throttle trimmed to respect the dynamic-pressure and g limits. */
function control(s: State, p: Program, pid: Pid, hw: Hardware, dt: number) {
  const err = pitchTarget(s.t, p) - s.pitch;
  const cmd = pid.step(err, dt, -s.rate);
  s.gimbal = THREE.MathUtils.clamp(cmd, -hw.gimbalLimit, hw.gimbalLimit) + hw.gimbalBias;
  const qOver = (s.q / 1000 - p.qLimit) / p.qLimit, gOver = (s.acc / G0 - p.gLimit) / p.gLimit;
  const want = THREE.MathUtils.clamp(1 - Math.max(0, qOver) * 3 - Math.max(0, gOver) * 4, .7, 1);
  s.throttle += THREE.MathUtils.clamp(want - s.throttle, -.2 * dt, .2 * dt);
  return err;
}
function step(s: State, hw: Hardware, dt: number) {
  s.t += dt;
  if (s.t < 0) { s.prop -= (s.engines - hw.enginesOut) * F1_FLOW * THREE.MathUtils.smoothstep(s.t, -6.5, -1.6) * dt; s.m = LIFTOFF_MASS - (S1_PROP - s.prop); return; }
  if (s.stage === 1 && s.engines === 5 && s.t >= 135.2) s.engines = 4; // centre engine cutoff, as flown
  const T = thrustOf(s, hw), v = Math.hypot(s.vx, s.vh), rho = 1.225 * Math.exp(-s.h / 8500);
  s.q = .5 * rho * v * v; const drag = s.q * .5 * AREA, g = G0 * (R_EARTH / (R_EARTH + s.h)) ** 2;
  const dir = s.pitch + s.gimbal, ax = (T * Math.sin(dir) - (v ? drag * s.vx / v : 0)) / s.m, ah = (T * Math.cos(dir) - (v ? drag * s.vh / v : 0)) / s.m - g;
  s.acc = Math.hypot(ax, ah + g);
  const disturbance = s.t < hw.disturbanceUntil ? hw.disturbance : 0;
  s.rate += (T * Math.sin(s.gimbal) * ARM / (s.m * GYRATION2) + disturbance) * dt; s.pitch += s.rate * dt;
  s.vx += ax * dt; s.vh += ah * dt; s.x += s.vx * dt; s.h = Math.max(0, s.h + s.vh * dt);
  if (s.stage === 1) {
    const flow = T > 0 ? (s.engines - hw.enginesOut) * F1_FLOW * s.throttle : 0;
    s.prop -= flow * dt; s.m -= flow * dt;
    if (s.prop <= 0) { s.stage = 2; s.sepAt = s.t; s.m -= S1_DRY; }
  } else if (T > 0) s.m -= 5 * 247 * dt;
}
/** Forecast a program on a copy of the vehicle until first-stage cut-off (or the horizon). */
function rollout(from: State, p: Program, hw: Hardware, horizon: number) {
  const s = { ...from }, pid = new Pid(p.kp, p.ki, p.kd, .2);
  let worst = 0, maxQ = 0;
  for (let k = 0; k < horizon / .1 && s.stage === 1; k++) { worst = Math.max(worst, Math.abs(control(s, p, pid, hw, .1))); step(s, hw, .1); maxQ = Math.max(maxQ, s.q); }
  return { s, worst, maxQ, energy: (s.vx * s.vx + s.vh * s.vh) / 2 + G0 * s.h };
}

const ACTIONS: LiveAction[] = [
  { id: 'engine', label: 'Engine out', hint: 'One F-1 shuts down' },
  { id: 'gimbal', label: 'Gimbal fault', hint: 'Actuator offset +0.35° and authority cut to ±1.5°' },
  { id: 'shear', label: 'Wind shear', hint: 'Pitch disturbance for 12 s' },
  { id: 'thrust', label: 'Low thrust', hint: 'Engine performance −12%' },
];

export default async function build({ scene, camera, controls, url }: SceneContext): Promise<SceneHandle> {
  const loader = new STLLoader();
  const geometries = await Promise.all([...STACK.map(s => s[0]), 'fin'].map(name =>
    url(`/assets-3d/launch/${name}.stl`).then(u => fetch(u)).then(r => r.arrayBuffer()).then(b => loader.parse(b))));
  const total = geometries.slice(0, STACK.length).reduce((n, g) => { g.computeBoundingBox(); return n + g.boundingBox!.max.y - g.boundingBox!.min.y; }, 0);
  const scale = HEIGHT_M / total;

  const rocket = new THREE.Group(), firstStage = new THREE.Group(), upper = new THREE.Group();
  rocket.add(firstStage, upper); scene.add(rocket);
  let y = 0, separationHeight = 0;
  STACK.forEach(([, color, metalness, roughness], i) => {
    const g = mergeVertices(geometries[i].deleteAttribute('normal'), 1e-3); g.computeBoundingBox();
    // Copy the box: translate() and scale() recompute boundingBox in place.
    const box = g.boundingBox!.clone(), cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    g.translate(-cx, y - box.min.y, -cz); g.scale(scale, scale, scale); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, metalness, roughness }));
    mesh.castShadow = true; (i < 2 ? firstStage : upper).add(mesh);
    y += box.max.y - box.min.y;
    if (i === 1) separationHeight = y * scale;
  });
  const fin = geometries[STACK.length]; fin.computeBoundingBox(); fin.translate(0, -fin.boundingBox!.min.y, 0); fin.deleteAttribute('normal'); fin.scale(scale, scale, scale); fin.computeVertexNormals();
  for (let k = 0; k < 4; k++) { const f = new THREE.Mesh(fin, new THREE.MeshStandardMaterial({ color: '#2a2a28', roughness: .6 })); f.rotation.y = Math.PI / 4 + k * Math.PI / 2; firstStage.add(f); }

  const altitude = { value: 0 };
  scene.add(skyDome(150000, { altitude }, `
    varying vec3 vDir; uniform float altitude;
    void main(){ float k = clamp(altitude / 60000., 0., 1.); float up = clamp(vDir.y, -.2, 1.);
      vec3 low = mix(vec3(.72,.82,.92), vec3(.24,.47,.78), pow(max(up,0.), .6));
      vec3 high = mix(vec3(.12,.22,.42), vec3(.0,.0,.01), pow(max(up,0.), .4));
      gl_FragColor = vec4(mix(low, high, smoothstep(0., 1., k)), 1.); }`));
  const starfield = stars(3000, 140000); (starfield.material as THREE.PointsMaterial).opacity = 0; scene.add(starfield);
  scene.fog = new THREE.FogExp2(0xb7cadc, .00012);
  // Land and sea meet at the coastline instead of overlapping: coplanar overlap z-fights from altitude.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(240000, 124000), new THREE.MeshStandardMaterial({ color: 0x55613f, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.z = 58000; ground.receiveShadow = true; scene.add(ground);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(240000, 120000), new THREE.MeshStandardMaterial({ color: 0x1f4f6e, roughness: .3, metalness: .2 }));
  sea.rotation.x = -Math.PI / 2; sea.position.z = -64000; scene.add(sea);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(70, PAD_TOP, 70), new THREE.MeshStandardMaterial({ color: 0x9a978f, roughness: .95 }));
  pad.position.y = PAD_TOP / 2; pad.receiveShadow = true; scene.add(pad);
  const trench = new THREE.Mesh(new THREE.BoxGeometry(14, 1, 70.5), new THREE.MeshStandardMaterial({ color: 0x1d1c1a })); trench.position.y = PAD_TOP; scene.add(trench);
  const towerMaterial = new THREE.MeshStandardMaterial({ color: 0xb23b2b, roughness: .7, metalness: .3 }), tower = new THREE.Group();
  for (const [x, z] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1, 125, 1), towerMaterial); p.position.set(x, 62.5, z); tower.add(p); }
  for (let h = 6; h < 125; h += 6) for (const [w, d, x, z] of [[13, 1, 0, -6], [13, 1, 0, 6], [1, 13, -6, 0], [1, 13, 6, 0]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, .6, d), towerMaterial); b.position.set(x, h, z); tower.add(b); }
  const arms = [24, 46, 70, 88, 100].map(h => { const pivot = new THREE.Group(); pivot.position.set(6, h, 0); const arm = new THREE.Mesh(new THREE.BoxGeometry(14, 1.4, 2), towerMaterial); arm.position.x = 7; pivot.add(arm); tower.add(pivot); return pivot; });
  tower.position.set(-24, PAD_TOP, 0); scene.add(tower);
  scene.add(new THREE.HemisphereLight(0xcfe2ff, 0x4a4436, 1.3));
  const sun = new THREE.DirectionalLight(0xfff3e0, 3); sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 160, bottom: -40, far: 1500 }); sun.shadow.mapSize.set(1024, 1024); scene.add(sun, sun.target);

  const flame = (color: number, top: number, bottom: number, length: number, opacity: number) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, length, 32, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.geometry.translate(0, -length / 2, 0); return m;
  };
  const s1Plume = new THREE.Group(); s1Plume.add(flame(0xfff1b8, 4.2, 2.4, 22, .9), flame(0xff9a3c, 5.4, 9, 60, .45), flame(0xff6a1a, 6, 16, 120, .18)); firstStage.add(s1Plume);
  const s2Plume = new THREE.Group(); s2Plume.add(flame(0xcfe6ff, 3.6, 5, 14, .5), flame(0x8fb7ff, 4.4, 14, 50, .18)); s2Plume.position.y = separationHeight; upper.add(s2Plume);
  const glow = new THREE.PointLight(0xffa04a, 0, 400, 1.6); glow.position.y = -10; firstStage.add(glow);

  const COUNT = 1400, positions = new Float32Array(COUNT * 3), velocity = new Float32Array(COUNT * 3), life = new Float32Array(COUNT).fill(-1), sizes = new Float32Array(COUNT);
  const smokeGeometry = new THREE.BufferGeometry();
  smokeGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); smokeGeometry.setAttribute('life', new THREE.BufferAttribute(life, 1)); smokeGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  const smoke = new THREE.Points(smokeGeometry, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { map: { value: puffTexture() } },
    vertexShader: 'attribute float life; attribute float size; varying float vLife; void main(){ vLife = life; vec4 p = modelViewMatrix * vec4(position,1.); gl_PointSize = life < 0. ? 0. : size * (300. / -p.z); gl_Position = projectionMatrix * p; }',
    fragmentShader: 'uniform sampler2D map; varying float vLife; void main(){ if (vLife < 0.) discard; vec4 c = texture2D(map, gl_PointCoord); float fade = (1. - vLife) * min(1., vLife * 8.); gl_FragColor = vec4(mix(vec3(1.,.82,.6), vec3(.86,.84,.8), min(1., vLife*3.)), c.a * fade * .55); }',
  }));
  smoke.frustumCulled = false; scene.add(smoke);
  let cursor = 0;
  const emit = (p: THREE.Vector3, vx: number, vy: number, vz: number, size: number) => { const i = cursor++ % COUNT; positions.set([p.x, p.y, p.z], i * 3); velocity.set([vx, vy, vz], i * 3); life[i] = 0; sizes[i] = size; };

  // ---- Live stack ----
  let s = start(), hw = healthy(), program = { ...DEFAULT }, pid = new Pid(program.kp, program.ki, program.kd, .2);
  let nextReflex = 0, disturbanceEstimate = 0, perfEstimate = 1, lastRate = 0, errNow = 0, maxQ = 0, maxQAt = 0;
  const separated = { done: false, vx: 0, vh: 0, spin: 0 };
  const stack = new FlightStack<Program>(ACTIONS, { act: inject, restart: reset }, () =>
    s.t < 0 ? 'Engines igniting. Held down until they reach full thrust.'
    : s.stage === 2 ? `First stage gone. Second stage burning at ${(s.h / 1000).toFixed(0)} km. All checks passing.`
    : `Climbing through ${(s.h / 1000).toFixed(1)} km at ${Math.round(Math.hypot(s.vx, s.vh))} m/s on ${s.engines - hw.enginesOut} engines, tilting into the gravity turn. All checks passing.`);
  function reset() {
    s = start(); hw = healthy(); program = { ...DEFAULT }; pid = new Pid(program.kp, program.ki, program.kd, .2);
    nextReflex = 0; disturbanceEstimate = 0; perfEstimate = 1; lastRate = 0; maxQ = 0;
    if (separated.done) { rocket.add(firstStage); firstStage.position.set(0, 0, 0); firstStage.rotation.set(0, 0, 0); separated.done = false; }
    life.fill(-1); arms.forEach(a => a.rotation.y = 0);
  }
  function inject(id: string) {
    if (s.t < 0) return;
    if (id === 'engine') { if (s.stage !== 1 || s.engines - hw.enginesOut <= 2) return; hw.enginesOut++; stack.fault(id, 'engine out', `F-1 shutdown; ${s.engines - hw.enginesOut} of ${s.engines} running`, s.t); }
    else if (id === 'gimbal') { hw.gimbalBias = .35 * DEG; hw.gimbalLimit = 1.5 * DEG; stack.fault(id, 'gimbal actuator', 'Offset +0.35° (unknown to control), authority ±1.5°', s.t); }
    else if (id === 'shear') { hw.disturbance = (Math.random() < .5 ? -1 : 1) * .006; hw.disturbanceUntil = s.t + 12; stack.fault(id, 'wind shear', 'Pitch disturbance for 12 s', s.t); }
    else if (id === 'thrust') { hw.perf *= .88; stack.fault(id, 'low thrust', 'Engine performance −12%', s.t); }
  }
  /** L3: forecast pitch-rate × gain combinations to first-stage cut-off on the estimated vehicle; keep the highest energy that stays inside limits. */
  function strategize() {
    const estimated: Hardware = { perf: perfEstimate, gimbalBias: 0, gimbalLimit: hw.gimbalLimit, disturbance: disturbanceEstimate, disturbanceUntil: s.t + 12, enginesOut: hw.enginesOut };
    const candidates: Candidate<Program>[] = [];
    for (const rate of [program.pitchRate * .85, program.pitchRate, program.pitchRate * 1.12]) for (const [kp, ki, kd] of [[program.kp, program.ki, program.kd], [1.8, .5, 2.6], [2.8, 1.2, 3.2]]) {
      const p = { ...program, pitchRate: +rate.toFixed(2), kp, ki, kd }, f = rollout(s, p, estimated, 200);
      const admissible = f.worst < 4 * DEG && f.maxQ / 1000 < p.qLimit * 1.15 && f.s.vh > 0;
      candidates.push({ program: p, admissible, score: f.energy / 1e6 - f.worst / DEG * .3,
        label: `pitch ${p.pitchRate.toFixed(2)}°/s, PID ${kp}/${ki}/${kd}`,
        reason: `${(f.energy / 1e6).toFixed(1)} MJ/kg at cut-off · worst error ${(f.worst / DEG).toFixed(1)}° · max-Q ${(f.maxQ / 1000).toFixed(0)} kPa` });
    }
    const best = stack.decide(candidates, s.t, p => { program = p; pid.tune(p.kp, p.ki, p.kd); }, describeProgram);
    if (!best) stack.end('Abort: no program keeps the vehicle inside its limits (launch escape)', false, s.t);
  }
  function tick(dt: number) {
    if (stack.status.state !== 'live') return;
    errNow = control(s, program, pid, hw, dt);
    const before = { vx: s.vx, vh: s.vh }, expectedThrust = thrustOf(s, { ...hw, perf: 1 });
    step(s, hw, dt);
    if (s.t <= 0) return;
    // Estimators: residual pitch acceleration (unmodelled torque) and measured vs expected thrust.
    const modelled = expectedThrust * Math.sin(s.gimbal - hw.gimbalBias) * ARM / (s.m * GYRATION2), measured = (s.rate - lastRate) / dt; lastRate = s.rate;
    disturbanceEstimate += (measured - modelled - disturbanceEstimate) * Math.min(1, dt * .5);
    // Accelerometers measure specific force: the velocity change with gravity removed. Only trusted while drag is small.
    const specificForce = Math.hypot((s.vx - before.vx) / dt, (s.vh - before.vh) / dt + G0 * (R_EARTH / (R_EARTH + s.h)) ** 2);
    if (expectedThrust > 0 && s.q < 5000) perfEstimate += (THREE.MathUtils.clamp(specificForce * s.m / expectedThrust, .5, 1.1) - perfEstimate) * Math.min(1, dt * .4);
    if (s.q > maxQ) { maxQ = s.q; maxQAt = s.t; }
    if (Math.abs(errNow) > 12 * DEG) { stack.end('Abort: attitude lost (launch escape system)', false, s.t); return; }
    if (s.t >= 240) { stack.end(`S-II burning, ${(s.h / 1000).toFixed(0)} km at ${Math.round(Math.hypot(s.vx, s.vh))} m/s`, true, s.t); return; }
    if (s.t >= nextReflex) {
      nextReflex = s.t + 1;
      const engineFault = s.stage === 1 && hw.enginesOut > 0 && stack.faults.includes('engine');
      if (Math.abs(errNow) > 3 * DEG) { stack.escalate(`Pitch error ${(errNow / DEG).toFixed(1)}°`, s.t, 1); }
      else if (engineFault) { stack.escalate('Thrust loss: trajectory no longer matches the program', s.t, 1); }
      else if (stack.faults.length && Math.abs(disturbanceEstimate) > .0006) { stack.escalate(`Unmodelled pitch torque ${(disturbanceEstimate / DEG).toFixed(2)}°/s²`, s.t, 1); }
      else if (stack.faults.includes('thrust') && perfEstimate < .95) { stack.escalate(`Thrust ${Math.round(perfEstimate * 100)}% of expected`, s.t, 1); }
      else if (s.q / 1000 > program.qLimit) stack.log(2, 'info', 'Easing the throttle', `Air pressure on the vehicle (${(s.q / 1000).toFixed(0)} kPa) is above its ${program.qLimit} kPa limit.`, s.t);
      else stack.ok();
    }
    if (stack.pendingStrategy && s.t >= stack.pendingStrategy.at) strategize();
  }

  camera.position.set(170, 60, 230); controls.target.set(0, 60, 0); controls.minDistance = 40; controls.maxDistance = 3000;
  const focus = new THREE.Vector3(), base = new THREE.Vector3();
  return {
    duration: Infinity, start: 0, speed: 3, live: stack.panel(),
    note: 'Live in-browser stack: planar ascent with a gimbal PID, reflex rules and strategic re-tuning on forward rollouts. Throttle is a model control knob.',
    update(_t, dt) {
      for (let left = dt; left > 1e-6; left -= .05) tick(Math.min(.05, left));
      rocket.position.set(s.x, PAD_TOP + s.h, 0); rocket.rotation.z = -s.pitch;
      altitude.value = s.h;
      (starfield.material as THREE.PointsMaterial).opacity = THREE.MathUtils.smoothstep(s.h, 25000, 60000);
      (scene.fog as THREE.FogExp2).density = .00012 * Math.exp(-s.h / 6000);
      arms.forEach((a, i) => { a.rotation.y = THREE.MathUtils.lerp(a.rotation.y, s.t > -2 + i * .3 ? 1.35 : 0, .05); });
      if (s.stage === 2 && !separated.done) { scene.attach(firstStage); separated.done = true; separated.vx = s.vx; separated.vh = s.vh - 6; separated.spin = .05; }
      if (separated.done && dt > 0) {
        separated.vh -= G0 * dt; firstStage.position.x += separated.vx * dt; firstStage.position.y += separated.vh * dt; firstStage.rotation.z -= separated.spin * dt;
      }
      const burning1 = s.stage === 1 && s.t > -6.5, burning2 = s.stage === 2 && s.t >= s.sepAt + 1.9, spool = THREE.MathUtils.smoothstep(s.t, -6.5, -1.6);
      s1Plume.visible = burning1; s2Plume.visible = burning2;
      const expand = 1 + s.h / 9000, flicker = .92 + Math.random() * .16, out = (s.engines - hw.enginesOut) / 5;
      s1Plume.scale.set(expand * flicker * (.6 + .4 * out), (.4 + .6 * spool) * (1 + s.h / 30000) * flicker * s.throttle, expand * flicker * (.6 + .4 * out));
      s2Plume.scale.setScalar(.9 + Math.random() * .2);
      glow.intensity = burning1 ? 9000 * spool * flicker * Math.exp(-s.h / 3000) : 0;
      if (burning1 && dt > 0) {
        rocket.localToWorld(base.set(0, -20, 0));
        for (let k = 0; k < Math.min(40, Math.ceil(dt * 260)); k++) {
          if (s.h < 120) { const side = Math.random() < .5 ? -1 : 1; emit(new THREE.Vector3((Math.random() - .5) * 10, PAD_TOP + 2, side * 30), (Math.random() - .5) * 14, 6 + Math.random() * 12, side * (30 + Math.random() * 40), 40 + Math.random() * 30); }
          if (s.t > 0 && s.h < 14000) emit(base.clone().add(new THREE.Vector3((Math.random() - .5) * 6, -Math.random() * 40, (Math.random() - .5) * 6)), (Math.random() - .5) * 4, -s.vh * .1, (Math.random() - .5) * 4, 30 + Math.random() * 25);
        }
      }
      for (let i = 0; i < COUNT; i++) {
        if (life[i] < 0) continue;
        life[i] += dt / 14; if (life[i] >= 1) { life[i] = -1; continue; }
        positions[i * 3] += velocity[i * 3] * dt; positions[i * 3 + 1] += velocity[i * 3 + 1] * dt; positions[i * 3 + 2] += velocity[i * 3 + 2] * dt;
        velocity[i * 3] *= .985; velocity[i * 3 + 1] = velocity[i * 3 + 1] * .985 + .6 * dt; velocity[i * 3 + 2] *= .985; sizes[i] += dt * 14;
      }
      smokeGeometry.attributes.position.needsUpdate = smokeGeometry.attributes.life.needsUpdate = smokeGeometry.attributes.size.needsUpdate = true;
      sun.target.position.copy(rocket.position); sun.position.set(rocket.position.x + 300, rocket.position.y + 500, 200);
      focus.set(rocket.position.x + Math.sin(s.pitch) * 55, rocket.position.y + Math.cos(s.pitch) * 55, 0); follow(controls, focus, s.t > 0 ? .2 : .05);
    },
    phase() {
      if (stack.status.state === 'ended') return stack.status.summary;
      if (s.t < -6.5) return 'Terminal count';
      if (s.t < 0) return 'Ignition sequence';
      if (s.t < 12) return 'Liftoff · tower clear';
      if (s.stage === 2) return s.t < s.sepAt + 1.9 ? 'S-IC separation' : 'S-II powered flight';
      if (Math.abs(s.t - maxQAt) < 5 && s.q > 25000) return 'Max-Q';
      if (s.engines === 4 && s.t < 141) return 'Centre engine cutoff';
      return hw.enginesOut ? `Powered ascent · ${s.engines - hw.enginesOut} engines` : 'Gravity turn';
    },
    readouts() {
      return [
        { label: 'Altitude', value: (s.h / 1000).toFixed(s.h < 10000 ? 2 : 1), unit: 'km' },
        { label: 'Velocity', value: Math.round(Math.hypot(s.vx, s.vh)).toLocaleString(), unit: 'm/s' },
        { label: 'Pitch error', value: (errNow / DEG).toFixed(2), unit: '°' },
        { label: 'Dyn. pressure', value: (s.q / 1000).toFixed(1), unit: 'kPa' },
      ];
    },
    clock: () => mmss(s.t),
  };
}

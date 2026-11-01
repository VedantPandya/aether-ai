import { appUrl } from '../urls';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { follow, skyDome, type LiveAction, type SceneContext, type SceneHandle } from './kit';
import { FlightStack, Pid, type Candidate } from './stack';

const SIZE = 140, HALF = SIZE / 2, CELL = 1, N = SIZE / CELL, STEP = .05;

function hash(x: number, y: number) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function noise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), u), THREE.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), u), v);
}
const CRATERS = [[-30, 22, 13], [34, -26, 10], [18, 36, 7]];
function height(x: number, z: number) {
  let h = 0, amp = 3.2, f = .025;
  for (let o = 0; o < 5; o++) { h += (noise(x * f + 11, z * f + 7) - .5) * amp; amp *= .45; f *= 2.1; }
  for (const [cx, cz, r] of CRATERS) { const d = Math.hypot(x - cx, z - cz) / r; if (d < 1.4) h += d < 1 ? -2.2 * (1 - d * d) : 1.1 * Math.sin((d - 1) / .4 * Math.PI); }
  return h;
}

interface Rock { x: number; z: number; r: number }
type Route = THREE.Vector2[];
/** A* over a 1 m grid: rocks inflated by `margin` are blocked, slope adds cost. */
let slopeCost: Float32Array | null = null;
/** Terrain never changes, so the slope cost of every cell is computed once (≈400k noise samples), not per plan. */
function terrainCost() {
  if (slopeCost) return slopeCost;
  slopeCost = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i * CELL - HALF, z = j * CELL - HALF;
    slopeCost[j * N + i] = 1 + 6 * Math.hypot(height(x + .5, z) - height(x - .5, z), height(x, z + .5) - height(x, z - .5));
  }
  return slopeCost;
}
function plan(from: THREE.Vector2, to: THREE.Vector2, rocks: Rock[], margin: number): Route | null {
  const idx = (i: number, j: number) => j * N + i, cellOf = (p: THREE.Vector2) => [Math.round((p.x + HALF) / CELL), Math.round((p.y + HALF) / CELL)];
  const cost = terrainCost(), blocked = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (i < 2 || j < 2 || i > N - 3 || j > N - 3) blocked[idx(i, j)] = 1;
  // Stamp each inflated rock onto the grid instead of testing every rock from every cell.
  for (const r of rocks) {
    const reach = r.r + margin, i0 = Math.max(0, Math.floor((r.x - reach + HALF) / CELL)), i1 = Math.min(N - 1, Math.ceil((r.x + reach + HALF) / CELL));
    const j0 = Math.max(0, Math.floor((r.z - reach + HALF) / CELL)), j1 = Math.min(N - 1, Math.ceil((r.z + reach + HALF) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (Math.hypot(r.x - (i * CELL - HALF), r.z - (j * CELL - HALF)) < reach) blocked[idx(i, j)] = 1;
  }
  const [si, sj] = cellOf(from), [gi, gj] = cellOf(to), goal = idx(gi, gj);
  const g = new Float32Array(N * N).fill(Infinity), came = new Int32Array(N * N).fill(-1), open: number[] = [idx(si, sj)], done = new Uint8Array(N * N), inOpen = new Uint8Array(N * N);
  const hDist = (k: number) => Math.hypot(k % N - gi, Math.floor(k / N) - gj);
  g[open[0]] = 0; blocked[open[0]] = 0; blocked[goal] = 0; inOpen[open[0]] = 1;
  while (open.length) {
    let best = 0; for (let k = 1; k < open.length; k++) if (g[open[k]] + hDist(open[k]) < g[open[best]] + hDist(open[best])) best = k;
    const cur = open[best]; open[best] = open[open.length - 1]; open.pop(); inOpen[cur] = 0;
    if (cur === goal) break; done[cur] = 1;
    const ci = cur % N, cj = Math.floor(cur / N);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ni = ci + di, nj = cj + dj; if ((!di && !dj) || ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const nk = idx(ni, nj); if (blocked[nk] || done[nk]) continue;
      const step = g[cur] + Math.hypot(di, dj) * cost[nk];
      if (step < g[nk]) { g[nk] = step; came[nk] = cur; if (!inOpen[nk]) { inOpen[nk] = 1; open.push(nk); } }
    }
  }
  if (came[goal] < 0) return null;
  const cells: Route = [];
  for (let k = goal; k >= 0; k = came[k]) cells.unshift(new THREE.Vector2(k % N * CELL - HALF, Math.floor(k / N) * CELL - HALF));
  cells[0] = from.clone();
  return cells.map((p, i) => i === 0 || i === cells.length - 1 ? p : p.clone().add(cells[i - 1]).add(cells[i + 1]).divideScalar(3));
}
const routeLength = (r: Route) => r.reduce((n, p, i) => i ? n + p.distanceTo(r[i - 1]) : 0, 0);
function crossTrack(r: Route, p: THREE.Vector2) {
  let best = Infinity;
  for (let i = 1; i < r.length; i++) { const a = r[i - 1], ab = r[i].clone().sub(a), t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / (ab.lengthSq() || 1))); best = Math.min(best, a.clone().addScaledVector(ab, t).distanceTo(p)); }
  return best;
}

// ---- Plant, controller and rollouts: the same code drives the live rover and the strategy's forecasts. ----
interface Program { cruise: number; lookahead: number; kp: number; ki: number; kd: number; margin: number }
interface State { x: number; z: number; heading: number; speed: number; yawRate: number; steer: number }
/** True plant conditions. Faults change these; the controller only ever sees its estimates. */
interface World { bias: number; traction: number; speedCap: number }
const DEFAULT: Program = { cruise: 1.1, lookahead: 3.5, kp: 1.4, ki: 0, kd: .25, margin: 1.9 };
const describeProgram = (p: Program) => `${p.cruise.toFixed(1)} m/s · look-ahead ${p.lookahead} m · PID ${p.kp}/${p.ki}/${p.kd} · margin ${p.margin.toFixed(1)} m`;

function control(s: State, route: Route, target: number, p: Program, pid: Pid, dt: number) {
  const pos = new THREE.Vector2(s.x, s.z);
  while (target < route.length - 1 && route[target].distanceTo(pos) < p.lookahead) target++;
  const aim = route[target], desired = Math.atan2(aim.x - s.x, aim.y - s.z);
  const err = Math.atan2(Math.sin(desired - s.heading), Math.cos(desired - s.heading));
  const steer = THREE.MathUtils.clamp(pid.step(err, dt), -.9, .9);
  const remaining = pos.distanceTo(route.at(-1)!);
  return { steer, speed: Math.min(p.cruise, remaining * .4) * Math.max(.2, Math.cos(err)), target, remaining };
}
function step(s: State, steer: number, speedCmd: number, w: World, dt: number) {
  s.speed += THREE.MathUtils.clamp(speedCmd - s.speed, -.6 * dt, .6 * dt);
  s.yawRate = steer + w.bias; s.steer = steer;
  s.heading += s.yawRate * dt;
  const v = Math.min(s.speed, w.speedCap) * w.traction;
  s.x += Math.sin(s.heading) * v * dt; s.z += Math.cos(s.heading) * v * dt;
}
function rollout(start: State, route: Route, p: Program, w: World, rocks: Rock[], horizon: number) {
  const s = { ...start }, pid = new Pid(p.kp, p.ki, p.kd, .6), from = route.at(-1)!.distanceTo(new THREE.Vector2(s.x, s.z));
  let target = 0, minClear = Infinity, sq = 0, n = 0, remaining = from;
  for (let t = 0; t < horizon; t += .1) {
    const c = control(s, route, target, p, pid, .1); target = c.target; remaining = c.remaining;
    if (remaining < .8) break;
    step(s, c.steer, c.speed, w, .1);
    for (const r of rocks) minClear = Math.min(minClear, Math.hypot(r.x - s.x, r.z - s.z) - r.r - 1.2);
    const xt = crossTrack(route, new THREE.Vector2(s.x, s.z)); sq += xt * xt; n++;
  }
  return { progress: from - remaining, minClear, xtrack: Math.sqrt(sq / Math.max(1, n)) };
}

const ACTIONS: LiveAction[] = [
  { id: 'wheel', label: 'Wheel motor fault', hint: 'Left drive motor degrades: an unmodelled yaw pull' },
  { id: 'boulder', label: 'Unmapped boulder', hint: 'A rock not on the map appears on the route ahead' },
  { id: 'sand', label: 'Soft sand', hint: 'Traction drops to 45% for 30 s' },
  { id: 'dust', label: 'Dust storm', hint: 'Solar power drops: speed capped at 0.45 m/s' },
];

export default async function build({ scene, camera, controls, renderer, url }: SceneContext): Promise<SceneHandle> {
  // The Perseverance GLB is Draco-compressed; the decoder is three.js's own, served from /draco/.
  const draco = new DRACOLoader().setDecoderPath(appUrl('/draco/'));
  const [gltf, texture] = await Promise.all([
    url('/assets-3d/rover/perseverance.glb').then(u => new GLTFLoader().setDRACOLoader(draco).loadAsync(u)).finally(() => draco.dispose()),
    url('/assets-3d/rover/mars.jpg').then(u => new THREE.TextureLoader().loadAsync(u)),
  ]);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const fog = new THREE.Fog(0xc99a6e, 45, 150); scene.fog = fog;
  scene.add(skyDome(400, {}, 'varying vec3 vDir; void main(){ float up = clamp(vDir.y, 0., 1.); gl_FragColor = vec4(mix(vec3(.84,.62,.42), vec3(.42,.3,.25), pow(up, .7)), 1.); }'));
  scene.add(new THREE.HemisphereLight(0xf2c9a0, 0x3d2418, 1.4));
  const sun = new THREE.DirectionalLight(0xffe2c0, 3.2); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, far: 200 }); scene.add(sun, sun.target);

  texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.MirroredRepeatWrapping; texture.repeat.set(5, 5);
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const ground = new THREE.PlaneGeometry(SIZE, SIZE, 220, 220); ground.rotateX(-Math.PI / 2);
  const pos = ground.attributes.position, colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { const h = height(pos.getX(i), pos.getZ(i)); pos.setY(i, h); const c = .78 + h * .05 + noise(pos.getX(i) * .8, pos.getZ(i) * .8) * .12; colors.set([c * 1.05, c * .9, c * .8], i * 3); }
  ground.setAttribute('color', new THREE.BufferAttribute(colors, 3)); ground.computeVertexNormals();
  const terrain = new THREE.Mesh(ground, new THREE.MeshStandardMaterial({ map: texture, vertexColors: true, roughness: .97 }));
  terrain.receiveShadow = true; scene.add(terrain);

  const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x6e4632, roughness: .95, flatShading: true });
  const rockMesh = (r: number, seed: number) => {
    const g = new THREE.IcosahedronGeometry(r, 1), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const s = .75 + hash(i + seed, p.getY(i) * 9) * .5; p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * .7, p.getZ(i) * s); }
    g.computeVertexNormals(); const m = new THREE.Mesh(g, rockMaterial); m.castShadow = m.receiveShadow = true; return m;
  };
  const mapped: Rock[] = [], rockParts: THREE.BufferGeometry[] = [];
  for (let k = 0; mapped.length < 85 && k < 2000; k++) {
    const x = (hash(k, 3) - .5) * (SIZE - 16), z = (hash(k, 9) - .5) * (SIZE - 16), r = .35 + hash(k, 5) ** 2.2 * 1.9;
    if (Math.hypot(x, z) < 7 || mapped.some(o => Math.hypot(o.x - x, o.z - z) < o.r + r + 1)) continue;
    const rock = rockMesh(r, k); rock.position.set(x, height(x, z) + r * .2, z); rock.rotation.y = hash(k, 1) * 6; rock.updateMatrix();
    rockParts.push(rock.geometry.applyMatrix4(rock.matrix)); mapped.push({ x, z, r });
  }
  // One mesh for the whole boulder field: 85 separate meshes cost ~170 draw calls a frame with shadows on.
  const field = new THREE.Mesh(mergeGeometries(rockParts), rockMaterial); field.castShadow = field.receiveShadow = true; scene.add(field);
  rockParts.forEach(g => g.dispose());
  const hazards = new THREE.Group(), spawned = new THREE.Group(); scene.add(hazards, spawned);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xff8a6a, transparent: true, opacity: .32, depthWrite: false });
  const drawHazards = (rocks: Rock[], margin: number) => {
    hazards.children.forEach(c => (c as THREE.Mesh).geometry.dispose()); hazards.clear();
    const rings = rocks.map(r => new THREE.RingGeometry(r.r + margin - .15, r.r + margin, 40).rotateX(-Math.PI / 2).translate(r.x, height(r.x, r.z) + .08, r.z));
    hazards.add(new THREE.Mesh(mergeGeometries(rings), ringMaterial)); rings.forEach(g => g.dispose());
  };

  // Normalise the rover to its real ~3 m length, wheels on the ground. The model's long axis is +Z.
  const model = gltf.scene, rover = new THREE.Group();
  const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3()), longest = Math.max(size.x, size.z);
  const k = 3 / longest; model.scale.setScalar(k); model.position.set(-(box.min.x + box.max.x) / 2 * k, -box.min.y * k, -(box.min.z + box.max.z) / 2 * k);
  if (size.x > size.z) { model.rotation.y = Math.PI / 2; model.position.set(-(box.min.z + box.max.z) / 2 * k, -box.min.y * k, (box.min.x + box.max.x) / 2 * k); }
  model.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  rover.add(model); scene.add(rover);

  const routeMaterial = new THREE.LineBasicMaterial({ color: 0xd7f27e, transparent: true, opacity: .9 });
  let routeLine: THREE.Line | null = null;
  const goalMarker = new THREE.Group();
  goalMarker.add(new THREE.Mesh(new THREE.RingGeometry(1.1, 1.4, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xd7f27e, transparent: true, opacity: .9, side: THREE.DoubleSide, depthWrite: false })));
  goalMarker.add(new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, 14, 8).translate(0, 7, 0), new THREE.MeshBasicMaterial({ color: 0xd7f27e, transparent: true, opacity: .45 })));
  scene.add(goalMarker);
  const drawRoute = (r: Route) => {
    if (routeLine) { scene.remove(routeLine); routeLine.geometry.dispose(); }
    routeLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(r.map(p => new THREE.Vector3(p.x, height(p.x, p.y) + .2, p.y))), routeMaterial); scene.add(routeLine);
  };

  // ---- Live state ----
  let s: State, w: World, program: Program, pid: Pid, rocks: Rock[], route: Route = [], goal = new THREE.Vector2(), target = 0;
  let goalIndex = 0, goalsReached = 0, odometer = 0, simT = 0, nextReflex = 1, holding = false, pause = 0, mode = 'Planning route';
  let biasEstimate = 0, slowFor = 0, sandUntil = -1, xtrackNow = 0;
  const stack = new FlightStack<Program & { route?: Route }>(ACTIONS, { act: inject, restart: reset }, () =>
    mode === 'Goal reached' ? 'Arrived. Choosing the next destination.'
    : holding ? 'Stopped while the stack decides how to get around the problem.'
    : `Driving to the goal: ${(route.length ? new THREE.Vector2(s.x, s.z).distanceTo(route.at(-1)!) : 0).toFixed(0)} m to go at ${(s.speed * w.traction).toFixed(1)} m/s. All checks passing.`);
  const nextGoal = () => { const a = goalIndex * 2.39996 + 1, r = 32 + (goalIndex % 3) * 9; goalIndex++; return new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r); };

  function newRoute() {
    for (let tries = 0; tries < 6; tries++) {
      goal = nextGoal();
      const r = plan(new THREE.Vector2(s.x, s.z), goal, rocks, program.margin); if (!r) continue;
      route = r; target = 0; drawRoute(r); goalMarker.position.set(goal.x, height(goal.x, goal.y) + .1, goal.y);
      mode = 'Driving'; stack.log(3, 'info', 'New route planned', `${routeLength(r).toFixed(0)} m long, keeping ${program.margin.toFixed(1)} m clear of known rocks.`, simT, undefined, 'A* on a 1 m grid, slope-weighted'); return;
    }
  }
  function reset() {
    s = { x: 0, z: 0, heading: 0, speed: 0, yawRate: 0, steer: 0 }; w = { bias: 0, traction: 1, speedCap: 9 };
    program = { ...DEFAULT }; pid = new Pid(program.kp, program.ki, program.kd, .6); rocks = [...mapped]; spawned.clear();
    goalIndex = 0; goalsReached = 0; odometer = 0; simT = 0; nextReflex = 1; holding = false; biasEstimate = 0; slowFor = 0; sandUntil = -1;
    fog.near = 45; fog.far = 150; drawHazards(rocks, program.margin); newRoute();
  }
  function inject(id: string) {
    if (id === 'wheel') { w.bias = .22; stack.fault(id, 'left wheel motor degraded', 'Unmodelled yaw pull. The controller is not told; it must notice.', simT); }
    else if (id === 'sand') { w.traction = .45; sandUntil = simT + 30; stack.fault(id, 'soft sand', 'Traction 45% for 30 s', simT); }
    else if (id === 'dust') { w.speedCap = .45; fog.near = 12; fog.far = 60; stack.fault(id, 'dust storm', 'Solar input down: drive speed capped at 0.45 m/s', simT); }
    else if (id === 'boulder') {
      const here = new THREE.Vector2(s.x, s.z), at = route.find((p, i) => i >= target && p.distanceTo(here) > 8) ?? route.at(-1)!;
      const r = { x: at.x, z: at.y, r: 1.3 }; rocks.push(r);
      const m = rockMesh(1.3, 999 + rocks.length); m.position.set(r.x, height(r.x, r.z) + .3, r.z); spawned.add(m); drawHazards(rocks, program.margin);
      stack.fault(id, 'unmapped boulder', `1.3 m rock detected ${at.distanceTo(here).toFixed(0)} m ahead, on the route`, simT);
    }
  }
  /** L3: replan the route at two hazard margins and roll every gain/speed combination forward 30 s on the estimated plant. */
  function strategize() {
    const estimated: World = { bias: biasEstimate, traction: simT < sandUntil ? .45 : 1, speedCap: w.speedCap };
    const candidates: Candidate<Program & { route?: Route }>[] = [];
    const here = new THREE.Vector2(s.x, s.z);
    for (const margin of [...new Set([program.margin, Math.min(3.4, program.margin + .8)])]) {
      const r = plan(here, goal, rocks, margin); if (!r) continue;
      for (const [kp, ki, kd] of [[program.kp, program.ki, program.kd], [1.8, .6, .3], [2.4, 1.1, .35]]) for (const cruise of [.6, 1.1]) {
        const p = { ...program, margin, kp, ki, kd, cruise: Math.min(cruise, estimated.speedCap + .05), lookahead: cruise < .8 ? 2.8 : 3.5 };
        const f = rollout(s, r, p, estimated, rocks, 30);
        const admissible = f.minClear > .3 && f.xtrack < 1.2;
        candidates.push({ program: { ...p, route: r }, admissible, score: f.progress - 6 * f.xtrack - (f.minClear < .8 ? 8 : 0),
          label: `margin ${margin.toFixed(1)} m, PID ${kp}/${ki}, ${p.cruise.toFixed(1)} m/s`,
          reason: `${f.progress.toFixed(0)} m progress · ${f.xtrack.toFixed(2)} m cross-track · ${Number.isFinite(f.minClear) ? f.minClear.toFixed(1) : '—'} m clearance` });
      }
    }
    const best = stack.decide(candidates, simT, p => {
      const { route: r, ...rest } = p; program = rest; pid.tune(rest.kp, rest.ki, rest.kd); pid.reset();
      if (r) { route = r; target = 0; drawRoute(r); } drawHazards(rocks, program.margin); holding = false; mode = 'Driving';
    }, ({ route: _, ...p }) => describeProgram(p));
    if (!best) { holding = true; mode = 'Holding — no safe program'; }
  }

  reset();
  camera.position.set(9, 6, 11); controls.target.set(0, 1, 0); controls.minDistance = 4; controls.maxDistance = 80; controls.maxPolarAngle = Math.PI * .48;
  const focus = new THREE.Vector3(), up = new THREE.Vector3(), forward = new THREE.Vector3(), basis = new THREE.Matrix4();

  function tick(dt: number) {
    simT += dt;
    if (sandUntil > 0 && simT >= sandUntil) { w.traction = 1; sandUntil = -1; stack.log(1, 'good', 'Traction recovered', 'Out of the soft sand.', simT); }
    if (mode === 'Goal reached') { pause -= dt; if (pause <= 0) newRoute(); return; }
    if (!route.length) return;
    const c = control(s, route, target, program, pid, dt); target = c.target;
    // L1 local guard: never drive into an inflated hazard, whatever the program says.
    // Look along the route, not the current heading, so a fresh detour is not vetoed while the rover is still turning.
    const here = new THREE.Vector2(s.x, s.z), toward = route[target].clone().sub(here);
    const ahead = toward.lengthSq() > 1e-6 ? here.clone().addScaledVector(toward.normalize(), 2.5) : here;
    const danger = rocks.find(r => Math.hypot(r.x - ahead.x, r.z - ahead.y) < r.r + 1.4);
    if (danger && !holding) { holding = true; mode = 'Holding — hazard ahead'; stack.log(1, 'warn', 'Stopping: hazard ahead', 'A rock is inside the stopping distance.', simT, 'worried'); stack.escalate('Hazard ahead of the rover', simT); }
    step(s, c.steer, holding ? 0 : c.speed, w, dt);
    odometer += Math.abs(s.speed) * w.traction * dt;
    // Estimator: yaw-rate residual between what was commanded and what the IMU measures.
    biasEstimate += (s.yawRate - s.steer - biasEstimate) * Math.min(1, dt * .8);
    xtrackNow = crossTrack(route, new THREE.Vector2(s.x, s.z));
    if (c.speed > .3 && s.speed * w.traction < c.speed * .6) slowFor += dt; else slowFor = 0;
    if (c.remaining < .8) { mode = 'Goal reached'; goalsReached++; pause = 2.5; s.speed = 0; stack.log(1, 'good', 'Goal reached', `${goalsReached} so far · ${odometer.toFixed(0)} m driven`, simT, 'success'); return; }
    if (simT >= nextReflex) {
      nextReflex = simT + 1;
      const blocked = route.slice(target).some(p => rocks.some(r => Math.hypot(r.x - p.x, r.z - p.y) < r.r + 1.2));
      if (blocked) { stack.escalate('Route passes through a known hazard', simT); }
      else if (Math.abs(biasEstimate) > .08 && program.ki === 0) { stack.escalate(`Estimator sees ${(biasEstimate * 57.3).toFixed(0)}°/s unexplained yaw`, simT); }
      else if (xtrackNow > 1) { stack.escalate(`Cross-track error ${xtrackNow.toFixed(1)} m`, simT); }
      else if (slowFor > 3) { stack.escalate('Wheels turning faster than the rover moves', simT); slowFor = 0; }
      else if (program.cruise > w.speedCap + .1) { stack.escalate('Commanded speed exceeds available power', simT); }
      else stack.ok();
    }
    if (stack.pendingStrategy && simT >= stack.pendingStrategy.at) strategize();
  }

  return {
    duration: Infinity, start: 0, speed: 4, live: stack.panel(),
    note: 'Live in-browser stack: PID + pure pursuit, reflex rules and strategic replans on forward rollouts. Time-compressed.',
    update(_t, dt) {
      for (let left = dt; left > 1e-6; left -= STEP) tick(Math.min(STEP, left));
      const x = s.x, z = s.z, fx = Math.sin(s.heading), fz = Math.cos(s.heading);
      up.set(height(x - .8, z) - height(x + .8, z), 1.6, height(x, z - .8) - height(x, z + .8)).normalize();
      forward.set(fx, (height(x + fx, z + fz) - height(x - fx, z - fz)) / 2, fz).normalize();
      const side = new THREE.Vector3().crossVectors(up, forward).normalize(); forward.crossVectors(side, up);
      basis.makeBasis(side, up, forward); rover.quaternion.slerp(new THREE.Quaternion().setFromRotationMatrix(basis), .2);
      rover.position.set(x, height(x, z), z);
      goalMarker.rotation.y += dt * .25;
      sun.position.set(x + 30, 40, z + 18); sun.target.position.set(x, 0, z);
      focus.set(x, rover.position.y + 1, z); follow(controls, focus, .1);
    },
    phase: () => mode,
    readouts() {
      return [
        { label: 'To goal', value: (route.length ? new THREE.Vector2(s.x, s.z).distanceTo(route.at(-1)!) : 0).toFixed(1), unit: 'm' },
        { label: 'Speed', value: (s.speed * w.traction).toFixed(2), unit: 'm/s' },
        { label: 'Cross-track', value: xtrackNow.toFixed(2), unit: 'm' },
        { label: 'Yaw bias est.', value: (biasEstimate * 57.3).toFixed(1), unit: '°/s' },
      ];
    },
    clock: () => `Sol 1 · ${String(Math.floor(9 + simT / 3600)).padStart(2, '0')}:${String(Math.floor(simT / 60) % 60).padStart(2, '0')}`,
  };
}

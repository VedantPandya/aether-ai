import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { sampleAt, type SceneContext, type SceneHandle } from './kit';
import { FlightStack, type Candidate } from './stack';

interface Sample { t: number; ship: number[]; stage: number[] | null; mass_kg: number; phase: string }
interface Replay { releaseTime: number; burnTime: number; burnDeltaV_m_s: number; timeUnit_s: number; isp_s?: number; samples: Sample[] }

// Cinematic mode of assets-3d/swingby-preview.mjs. The lensing is an artistic screen-space shader, not a relativistic renderer.
const SKY = `
precision highp float;
varying vec2 vUv; uniform float aspect, clock;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
void main(){
  vec2 uv=(vUv*2.-1.)*vec2(aspect,1.);
  vec3 color=vec3(.012,.017,.024);
  vec2 cell=uv*180.;float star=step(.996,hash(floor(cell)))*pow(max(0.,1.-length(fract(cell)-.5)*2.),5.);
  color+=vec3(.58,.66,.77)*star;
  vec2 q=(uv-vec2(.26,.13))/.88;
  float r=length(q), a=atan(q.y,q.x);
  float diskR=length(vec2(q.x,q.y*6.8));
  float bands=.6+.18*sin(diskR*104.+noise(vec2(a*3.,diskR*5.))*5.-clock*.18)+.1*sin(diskR*211.-a*5.);
  float disk=smoothstep(.35,.41,diskR)*(1.-smoothstep(.65,1.65,diskR));
  float streak=pow(max(0.,1.-abs(q.y)/.065),3.)*(1.-smoothstep(.6,1.85,abs(q.x)));
  float glow=exp(-abs(q.y)*25.)*exp(-abs(q.x)*1.8)*.13;
  vec3 gold=mix(vec3(1.,.83,.5),vec3(.7,.21,.045),smoothstep(.35,1.5,diskR));
  color+=gold*disk*bands*1.8+vec3(.86,.36,.11)*(streak*.55+glow);
  float arc=exp(-abs(r-.385)*110.)*.9 + exp(-abs(r-.385)*24.)*.12;
  float upper=exp(-abs(r-.48)*46.)*smoothstep(-.03,.24,q.y)*(.45+.25*sin(a*7.+clock*.04));
  float asym=.7+.3*clamp(-q.x/.4,0.,1.);
  color+=vec3(1.,.69,.32)*(arc+upper)*asym;
  color*=smoothstep(.345,.35,r);
  color+=vec3(1.,.8,.5)*exp(-abs(r-.354)*280.)*.65;
  color*=1.-.26*length(vUv-.5);
  gl_FragColor=vec4(color,1.);
}`;

export default async function build({ scene, camera, controls, renderer, url, json }: SceneContext): Promise<SceneHandle> {
  const loader = new GLTFLoader();
  const [carrier, stage, replay] = await Promise.all([
    url('/assets-3d/flyby/aether-odyssey-carrier.glb').then(u => loader.loadAsync(u)).then(g => g.scene),
    url('/assets-3d/flyby/aether-atlas-drop-stage.glb').then(u => loader.loadAsync(u)).then(g => g.scene),
    json<Replay>('/assets-3d/flyby/swingby-replay.json'),
  ]);
  renderer.toneMappingExposure = 1.3;
  scene.add(carrier, stage);
  scene.add(new THREE.HemisphereLight(0xb5c9de, 0x0f1116, 2));
  const key = new THREE.DirectionalLight(0xffd2a0, 4); key.position.set(-10, 10, -12); scene.add(key);
  const fill = new THREE.DirectionalLight(0xd6e7ff, 2.7); fill.position.set(12, 18, 15); scene.add(fill);
  const rotor = carrier.getObjectByName('habitat_rotor');

  const backdrop = new THREE.Scene(), backdropCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const sky = new THREE.ShaderMaterial({ uniforms: { aspect: { value: 1 }, clock: { value: 0 } }, vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}', fragmentShader: SKY, depthTest: false, depthWrite: false });
  backdrop.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sky));

  const plumeMaterial = new THREE.MeshBasicMaterial({ color: 0xa5dcf6, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const plumes = [-1.7, 1.7].map(y => { const p = new THREE.Mesh(new THREE.CylinderGeometry(.04, .4, 4.8, 24, 1, true), plumeMaterial); p.rotation.z = Math.PI / 2; p.position.set(-11, y, 0); carrier.add(p); return p; });

  // ---- Live plant: Newtonian point mass in Schwarzschild units (lengths Rₛ, speeds c, so GM = 1/2), RK4. ----
  const C = 299792458, ISP = replay.isp_s ?? 450, ENGINE_N = 60000, PROPELLANT = 4000, STAGE = 8000, CARRIER = 24000;
  const samples = replay.samples, D = samples.at(-1)!.t;
  const from = replay.releaseTime - D * .12, to = replay.burnTime + D * .25, unitsPerSecond = (to - from) / 80;
  interface Program { releaseAt: number; burnAt: number; engines: number; kp: number; kd: number }
  interface State { t: number; x: number; y: number; vx: number; vy: number; m: number; prop: number; released: boolean; burning: boolean; burned: boolean; dv: number; point: number; rate: number }
  interface Hardware { pyroFailed: boolean; enginesOut: number; rcs: number; navKick: number }
  const DEFAULT: Program = { releaseAt: replay.releaseTime, burnAt: replay.burnTime, engines: 2, kp: .02, kd: .3 };
  const describeProgram = (p: Program) => `release ${p.releaseAt.toFixed(0)} · burn ${p.burnAt.toFixed(0)} (Rₛ/c) · ${p.engines} engines · attitude PD ${p.kp}/${p.kd}`;
  const accel = (x: number, y: number) => { const r3 = Math.hypot(x, y) ** 3; return [-.5 * x / r3, -.5 * y / r3]; };
  const initial = (): State => {
    const [a, b, f] = sampleAt(samples, from), v = a.ship.map((q, i) => THREE.MathUtils.lerp(q, b.ship[i], f));
    return { t: from, x: v[0], y: v[1], vx: v[2], vy: v[3], m: CARRIER + STAGE, prop: PROPELLANT, released: false, burning: false, burned: false, dv: 0, point: 0, rate: 0 };
  };
  const vInf = (s: State) => Math.sqrt(Math.max(0, (s.vx * s.vx + s.vy * s.vy) - 1 / Math.hypot(s.x, s.y))) * C; // from specific energy
  /** One step of plant + L1 control: attitude PD toward prograde, scheduled release, prograde burn until propellant is gone. */
  function step(s: State, p: Program, hw: Hardware, dt: number) {
    if (!s.released && s.t >= p.releaseAt && !hw.pyroFailed) { s.released = true; s.m -= STAGE; }
    const err = s.point; s.rate += (-p.kp * err - p.kd * s.rate) * hw.rcs * dt + (hw.rcs < 1 ? .0004 * dt : 0); s.point += s.rate * dt;
    s.burning = !s.burned && s.t >= p.burnAt && s.prop > 0;
    let ax = 0, ay = 0;
    if (s.burning) {
      const thrust = ENGINE_N * Math.max(0, p.engines - hw.enginesOut), flow = thrust / (ISP * 9.80665), dtS = dt * replay.timeUnit_s;
      const used = Math.min(s.prop, flow * dtS), dvMs = ISP * 9.80665 * Math.log(s.m / (s.m - used)) * Math.cos(err);
      s.m -= used; s.prop -= used; s.dv += dvMs;
      const v = Math.hypot(s.vx, s.vy), dvC = dvMs / C; ax = s.vx / v * dvC / dt; ay = s.vy / v * dvC / dt;
      if (s.prop <= 1e-6 || thrust === 0) s.burned = s.prop <= 1e-6;
    }
    // RK4 on gravity; thrust applied as a constant acceleration over the step.
    const f = (x: number, y: number, vx: number, vy: number) => { const [gx, gy] = accel(x, y); return [vx, vy, gx + ax, gy + ay]; };
    const k1 = f(s.x, s.y, s.vx, s.vy), k2 = f(s.x + k1[0] * dt / 2, s.y + k1[1] * dt / 2, s.vx + k1[2] * dt / 2, s.vy + k1[3] * dt / 2);
    const k3 = f(s.x + k2[0] * dt / 2, s.y + k2[1] * dt / 2, s.vx + k2[2] * dt / 2, s.vy + k2[3] * dt / 2), k4 = f(s.x + k3[0] * dt, s.y + k3[1] * dt, s.vx + k3[2] * dt, s.vy + k3[3] * dt);
    s.x += dt / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]); s.y += dt / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    s.vx += dt / 6 * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]); s.vy += dt / 6 * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]);
    s.t += dt;
  }
  function rollout(start: State, p: Program, hw: Hardware) {
    const s = { ...start }; let worst = 0, minR = Infinity;
    while (s.t < to) { step(s, p, hw, 1); minR = Math.min(minR, Math.hypot(s.x, s.y)); if (s.burning) worst = Math.max(worst, Math.abs(s.point)); }
    return { vInf: vInf(s), dv: s.dv, worst, minR, prop: s.prop };
  }
  /** Periapsis time on the current coast arc, for re-timing the burn. */
  function periapsisTime(start: State) { const s = { ...start, burned: true }; let best = Infinity, at = s.t; while (s.t < to) { step(s, { ...DEFAULT, burnAt: Infinity }, { pyroFailed: true, enginesOut: 0, rcs: 1, navKick: 0 }, 1); const r = Math.hypot(s.x, s.y); if (r < best) { best = r; at = s.t; } } return at; }

  const ACTIONS = [
    { id: 'pyro', label: 'Pyro failure', hint: 'Stage separation bolts do not fire' },
    { id: 'engine', label: 'Engine out', hint: 'One of two retained engines fails' },
    { id: 'rcs', label: 'RCS fault', hint: 'Attitude thrusters at 30%, with a drift torque' },
    { id: 'nav', label: 'Nav update', hint: 'Tracking finds the trajectory off-nominal: periapsis moves' },
  ];
  let s = initial(), hw: Hardware = { pyroFailed: false, enginesOut: 0, rcs: 1, navKick: 0 }, program = { ...DEFAULT }, baseline = 0, nextReflex = from, burnShown = 0;
  const stack = new FlightStack<Program>(ACTIONS, { act: inject, restart: reset }, () =>
    s.burning ? 'Burning engines at closest approach, where each m/s of burn gains the most speed.'
    : s.burned ? `Burn complete. Coasting outbound ${Math.round(vInf(s) - baseline).toLocaleString()} m/s faster than without it.`
    : s.released ? 'Empty stage released. Pointing prograde for the burn at closest approach.'
    : `Falling toward the black hole, ${Math.hypot(s.x, s.y).toFixed(0)} Schwarzschild radii out. All checks passing.`);
  function reset() { s = initial(); hw = { pyroFailed: false, enginesOut: 0, rcs: 1, navKick: 0 }; program = { ...DEFAULT }; nextReflex = from; baseline = rollout(s, { ...DEFAULT, burnAt: Infinity }, hw).vInf; }
  function inject(id: string) {
    if (id === 'pyro') { if (s.released) return; hw.pyroFailed = true; stack.fault(id, 'separation pyros', 'Primary pyro channel did not fire; Atlas stage still attached', s.t); }
    else if (id === 'engine') { if (s.burned) return; hw.enginesOut = 1; stack.fault(id, 'engine out', 'One retained engine failed: half thrust, burn takes twice as long', s.t); }
    else if (id === 'rcs') { hw.rcs = .3; stack.fault(id, 'RCS degraded', 'Attitude authority 30%, slow drift torque', s.t); }
    else if (id === 'nav') {
      // An unmodelled velocity error of 0.4%: small, but it moves periapsis and so the best burn time.
      s.vx *= 1.004; s.vy *= 1.004; stack.fault(id, 'navigation update', 'Tracking shows a 0.4% velocity error; periapsis has moved', s.t);
    }
  }
  /** L3: candidate releases, burn times and gains, each integrated to the outbound asymptote. */
  function strategize() {
    const peri = periapsisTime(s), candidates: Candidate<Program>[] = [];
    const releases = hw.pyroFailed ? [Infinity, s.t + 40] : [program.releaseAt];
    const burnTimes = [...new Set([program.burnAt, peri - 10, peri, peri + 15].map(t => Math.max(s.t + 2, Math.round(t))))];
    const gains: [number, number][] = hw.rcs < 1 ? [[program.kp, program.kd], [.06, .9], [.12, 1.6]] : [[program.kp, program.kd]];
    for (const releaseAt of releases) for (const burnAt of burnTimes) for (const [kp, kd] of gains) {
      const p = { ...program, releaseAt, burnAt, kp, kd, engines: 2 };
      // Retrying release models the backup pyro channel: it fires if commanded at least 40 Rₛ/c later.
      const f = rollout(s, p, { ...hw, pyroFailed: hw.pyroFailed && releaseAt === Infinity });
      const admissible = f.minR > 20 && f.worst < 10 * Math.PI / 180;
      candidates.push({ program: p, admissible, score: f.vInf - baseline,
        label: `${releaseAt === Infinity ? 'keep stage, ' : hw.pyroFailed ? 'backup pyro, ' : ''}burn ${burnAt.toFixed(0)}${burnAt === Math.round(peri) ? ' (periapsis)' : ''}${hw.rcs < 1 ? `, PD ${kp}/${kd}` : ''}`,
        reason: `+${Math.round(f.vInf - baseline).toLocaleString()} m/s outbound · Δv ${f.dv.toFixed(0)} m/s · pointing ≤ ${(f.worst * 57.3).toFixed(1)}°` });
    }
    stack.decide(candidates, s.t, p => {
      if (hw.pyroFailed && p.releaseAt !== Infinity) hw.pyroFailed = false; // backup channel commanded
      program = p;
    }, describeProgram);
  }
  reset();

  camera.position.set(26, 21, 42); controls.target.set(-3, -1.5, 0); controls.minDistance = 6; controls.maxDistance = 220;
  controls.autoRotate = true; controls.autoRotateSpeed = .25;
  let split = 0;
  return {
    duration: Infinity, start: 0, speed: 1, live: stack.panel(),
    note: 'Live in-browser stack on a Newtonian RK4 flyby of a 10⁶ M☉ black hole. Separation distances and lensing are schematic.',
    update(_t, dt) {
      let budget = dt * unitsPerSecond;
      while (budget > 1e-6 && stack.status.state === 'live') {
        const h = Math.min(1, budget); budget -= h; step(s, program, hw, h);
        if (s.burning) burnShown = 1.5;
        if (s.t >= nextReflex) {
          nextReflex = s.t + 20;
          if (hw.pyroFailed && s.t >= program.releaseAt && program.releaseAt !== Infinity) { stack.escalate('Release commanded but the stage is still attached', s.t, 8); }
          else if (hw.enginesOut && !s.burned && stack.faults.includes('engine')) { stack.escalate('Burn plan assumes two engines', s.t, 8); }
          else if (Math.abs(s.point) > 2 * Math.PI / 180 && !s.burned) { stack.escalate(`Pointing error ${(s.point * 57.3).toFixed(1)}° before the burn`, s.t, 8); }
          else if (stack.faults.includes('nav') && !s.burned) { stack.escalate('Trajectory differs from the planned arc', s.t, 8); }
          else stack.ok();
        }
        if (stack.pendingStrategy && s.t >= stack.pendingStrategy.at) strategize();
        if (s.t >= to) stack.end(`Outbound coast, +${Math.round(vInf(s) - baseline).toLocaleString()} m/s v∞ from the burn`, s.burned, s.t);
      }
      burnShown = Math.max(0, burnShown - dt);
      split = THREE.MathUtils.lerp(split, s.released ? 1 : 0, Math.min(1, dt * .35));
      carrier.position.set(2 + split * 2, 0, 0); carrier.rotation.set(0, -.12, .04 + s.point * 3);
      stage.rotation.copy(carrier.rotation);
      stage.position.copy(new THREE.Vector3(-9 - split * 16, -split * 4, split * 3).applyEuler(carrier.rotation)).add(carrier.position);
      stage.rotation.z += split * .55;
      if (rotor) rotor.rotation.x += dt * .35;
      for (const [i, p] of plumes.entries()) { p.visible = burnShown > 0 && i >= hw.enginesOut; p.scale.set(1, .85 + Math.random() * .3, 1); }
      sky.uniforms.clock.value = (s.t - from) / (to - from) * 70;
    },
    phase() {
      if (stack.status.state === 'ended') return stack.status.summary;
      return s.burning ? 'Prograde burn' : s.burned ? 'Escape coast' : s.released ? 'Stage released' : hw.pyroFailed && s.t > program.releaseAt ? 'Stage hung up' : 'Inbound coast';
    },
    readouts() {
      return [
        { label: 'Distance', value: Math.hypot(s.x, s.y).toFixed(1), unit: 'Rₛ' },
        { label: 'Vehicle mass', value: (s.m / 1000).toFixed(1), unit: 't' },
        { label: 'Burn Δv', value: s.dv.toFixed(0), unit: 'm/s' },
        { label: 'Outbound gain', value: `${Math.round(vInf(s) - baseline) >= 0 ? '+' : ''}${Math.round(vInf(s) - baseline).toLocaleString()}`, unit: 'm/s' },
      ];
    },
    clock: () => `${(s.t * replay.timeUnit_s / 3600).toFixed(2)} h`,
    render(r, sceneToDraw, cam) { r.autoClear = false; r.clear(); r.render(backdrop, backdropCamera); r.clearDepth(); r.render(sceneToDraw, cam); },
    resize(aspect) { sky.uniforms.aspect.value = aspect; },
  };
}

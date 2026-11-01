import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface Readout { label: string; value: string; unit?: string }
export interface SceneContext {
  scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; renderer: THREE.WebGLRenderer;
  /** Object URL of a downloaded file. */
  url: (path: string) => Promise<string>;
  json: <T>(path: string) => Promise<T>;
}
/** One line of a live autonomy feed. Layer 1 = physics/control, 2 = reflex, 3 = strategy. */
/** title and detail are plain language; tech carries the engineering specifics in small print. */
export interface LiveEntry { id: number; layer: 1 | 2 | 3 | null; title: string; detail?: string; tech?: string; tone: 'info' | 'good' | 'warn' | 'bad'; t: number; count?: number }
export interface LiveAction { id: string; label: string; hint: string }
/** provider 'browser' = the stack runs in this page (pausable, speed-adjustable); otherwise a backend session. */
export interface LiveStatus { state: 'connecting' | 'live' | 'ended' | 'offline'; ai: boolean; aiAvailable?: boolean; provider: string; summary: string; activeLayer: 1 | 2 | 3 | null }
/** Scenes driven by a backend session rather than a recording expose this. */
export interface LivePanel {
  entries(): LiveEntry[];
  status(): LiveStatus;
  actions: LiveAction[];
  act(id: string): Promise<void>;
  restart(ai?: boolean): Promise<void>;
  /** Avatar expression for the most recent notable event, if any. */
  mood(): string | null;
  /** One sentence, in plain language, describing what is happening right now. */
  headline(): string;
  /** Routine all-clear checks, counted instead of listed so the feed shows only what changed. */
  routine(): number;
}
export interface SceneHandle {
  live?: LivePanel;
  dispose?(): void;
  /** Seconds of scene time; Infinity for open-ended scenes. */
  duration: number;
  start: number;
  speed: number;
  note: string;
  update(t: number, dt: number): void;
  phase(t: number): string;
  readouts(t: number): Readout[];
  clock(t: number): string;
  render?(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void;
  resize?(aspect: number): void;
}

export function stars(count: number, radius: number, size = 1.6) {
  const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(radius);
    positions.set([v.x, v.y, v.z], i * 3);
    const warm = Math.random(), b = .55 + Math.random() * .45;
    colors.set([b * (warm > .8 ? 1 : .82), b * .88, b * (warm < .2 ? 1 : .8)], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false }));
}

/** Move the orbit target to `point`, carrying the camera along so the user's chosen angle is kept. */
export function follow(controls: OrbitControls, point: THREE.Vector3, smoothing = 1) {
  const delta = point.clone().sub(controls.target).multiplyScalar(smoothing);
  controls.target.add(delta); controls.object.position.add(delta);
}

/** Linear interpolation over a time-sorted sample array. */
export function sampleAt<T extends { t: number }>(samples: T[], t: number): [T, T, number] {
  let lo = 0, hi = samples.length - 1;
  if (t <= samples[0].t) return [samples[0], samples[0], 0];
  if (t >= samples[hi].t) return [samples[hi], samples[hi], 0];
  while (lo < hi) { const mid = (lo + hi) >> 1; if (samples[mid].t < t) lo = mid + 1; else hi = mid; }
  const b = samples[lo], a = samples[lo - 1];
  return [a, b, (t - a.t) / (b.t - a.t || 1)];
}

export const mmss = (t: number) => `${t < 0 ? 'T−' : 'T+'}${String(Math.floor(Math.abs(t) / 60)).padStart(2, '0')}:${String(Math.floor(Math.abs(t) % 60)).padStart(2, '0')}`;

/** Soft round sprite drawn on a canvas, used for exhaust smoke and dust. */
export function puffTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d')!, grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(.45, 'rgba(255,255,255,.45)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

export function skyDome(radius: number, uniforms: Record<string, THREE.IUniform>, fragment: string) {
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: fragment,
  }));
}

import { appUrl } from '../urls';
export type SceneId = 'docking' | 'flyby' | 'launch' | 'rover';
export interface SceneFile { url: string; bytes: number }
export interface SceneInfo { id: SceneId; title: string; subtitle: string; blurb: string; files: SceneFile[] }

// Assets come from the workspace's assets-3d package (see public/assets-3d/CREDITS.md). Sizes drive the download progress.
export const SCENES: SceneInfo[] = [
  { id: 'docking', title: 'Rotating dock', subtitle: 'Match a spinning station', blurb: 'Kestrel closes on a spinning station. Inject faults and watch the stack replan.', files: [
    { url: '/assets-3d/docking/aether-relay-station.glb', bytes: 215144 },
    { url: '/assets-3d/docking/aether-kestrel-spacecraft.glb', bytes: 105548 },
    { url: '/assets-3d/docking/docking-replay.json', bytes: 51363 },
    { url: '/earth-blue-marble.png', bytes: 1912469 },
  ] },
  { id: 'flyby', title: 'Black hole flyby', subtitle: 'Stage drop at periapsis', blurb: 'Drop a stage at periapsis and burn. Faults force the burn to be re-timed.', files: [
    { url: '/assets-3d/flyby/aether-odyssey-carrier.glb', bytes: 525016 },
    { url: '/assets-3d/flyby/aether-atlas-drop-stage.glb', bytes: 502008 },
    { url: '/assets-3d/flyby/swingby-replay.json', bytes: 311169 },
  ] },
  { id: 'launch', title: 'Saturn V launch', subtitle: 'Ignition to staging', blurb: 'Gimbal PID flies the gravity turn. Engine-outs and shear trigger re-tuning.', files: [
    's-ic-bottom', 's-ic-top', 'coupler', 's-ii', 's-ivb', 'lem-shroud', 'service-module', 'command-module', 'escape-tower', 'fin',
  ].map(name => ({ url: `/assets-3d/launch/${name}.stl`, bytes: ({ 's-ic-bottom': 1891434, 's-ic-top': 820384, coupler: 331184, 's-ii': 816184, 's-ivb': 836634, 'lem-shroud': 58184, 'service-module': 2329184, 'command-module': 182684, 'escape-tower': 801584, fin: 3384 } as Record<string, number>)[name] })) },
  { id: 'rover', title: 'Rover autonomy', subtitle: 'Plan around hazards', blurb: 'A* routes through boulders; faults make it re-plan and re-tune itself.', files: [
    { url: '/assets-3d/rover/perseverance.glb', bytes: 4987176 },
    { url: '/assets-3d/rover/mars.jpg', bytes: 972896 },
  ] },
];

export const sceneBytes = (s: SceneInfo) => s.files.reduce((n, f) => n + f.bytes, 0);
export const formatBytes = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`;

const CACHE = 'aether-scenes-v1';
const hasCache = () => typeof caches !== 'undefined';

export async function isDownloaded(scene: SceneInfo) {
  if (!hasCache()) return false;
  const cache = await caches.open(CACHE);
  return (await Promise.all(scene.files.map(f => cache.match(appUrl(f.url))))).every(Boolean);
}

/** Fetch every file into Cache Storage, reporting byte-level progress from 0 to 1. */
export async function downloadScene(scene: SceneInfo, onProgress: (fraction: number) => void, signal?: AbortSignal) {
  if (!hasCache()) throw new Error('This browser cannot store scenes offline');
  const cache = await caches.open(CACHE), total = sceneBytes(scene);
  let loaded = 0;
  for (const file of scene.files) {
    if (await cache.match(appUrl(file.url))) { loaded += file.bytes; onProgress(loaded / total); continue; }
    const response = await fetch(appUrl(file.url), { signal });
    if (!response.ok || !response.body) throw new Error(`Could not download ${file.url.split('/').pop()}`);
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); loaded += value.length; onProgress(Math.min(1, loaded / total));
    }
    const type = response.headers.get('Content-Type') ?? 'application/octet-stream';
    await cache.put(appUrl(file.url), new Response(new Blob(chunks as BlobPart[], { type }), { headers: { 'Content-Type': type } }));
  }
  onProgress(1);
}

export async function removeScene(scene: SceneInfo) {
  if (!hasCache()) return;
  const cache = await caches.open(CACHE);
  await Promise.all(scene.files.map(f => cache.delete(appUrl(f.url))));
}

/** Object URL for a cached file, so loaders read the downloaded copy rather than the network. */
export async function cachedUrl(url: string) {
  const response = hasCache() ? await (await caches.open(CACHE)).match(appUrl(url)) : undefined;
  if (!response) throw new Error('Scene is not downloaded');
  return URL.createObjectURL(await response.blob());
}

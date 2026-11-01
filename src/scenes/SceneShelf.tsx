import { useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, Mountain, Orbit, Play, Rocket, Satellite, Trash2, X } from 'lucide-react';
import { downloadScene, formatBytes, isDownloaded, removeScene, SCENES, sceneBytes, type SceneId, type SceneInfo } from './catalog';

export type DownloadState = { status: 'checking' | 'idle' | 'downloading' | 'ready' | 'error'; progress: number; error?: string; abort?: AbortController };
const ICONS = { docking: Satellite, flyby: Orbit, launch: Rocket, rover: Mountain };

export function useSceneDownloads() {
  const [states, setStates] = useState<Record<SceneId, DownloadState>>(() => Object.fromEntries(SCENES.map(s => [s.id, { status: 'checking', progress: 0 }])) as Record<SceneId, DownloadState>);
  const set = (id: SceneId, next: Partial<DownloadState>) => setStates(old => ({ ...old, [id]: { ...old[id], ...next } }));
  useEffect(() => { for (const s of SCENES) isDownloaded(s).then(ok => set(s.id, { status: ok ? 'ready' : 'idle', progress: ok ? 1 : 0 })).catch(() => set(s.id, { status: 'idle' })); }, []);
  const download = useCallback(async (scene: SceneInfo) => {
    const abort = new AbortController(); set(scene.id, { status: 'downloading', progress: 0, error: undefined, abort });
    try { await downloadScene(scene, p => set(scene.id, { progress: p }), abort.signal); set(scene.id, { status: 'ready', progress: 1, abort: undefined }); }
    catch (e) { set(scene.id, { status: abort.signal.aborted ? 'idle' : 'error', progress: 0, error: abort.signal.aborted ? undefined : (e as Error).message, abort: undefined }); }
  }, []);
  const remove = useCallback(async (scene: SceneInfo) => { await removeScene(scene); set(scene.id, { status: 'idle', progress: 0 }); }, []);
  return { states, download, remove };
}

function Ring({ progress }: { progress: number }) {
  const r = 15, c = 2 * Math.PI * r;
  return <svg className="ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r={r} className="ring-track" /><circle cx="18" cy="18" r={r} className="ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - progress)} /></svg>;
}

export function SceneAction({ scene, state, onDownload, onOpen, onRemove }: { scene: SceneInfo; state: DownloadState; onDownload: () => void; onOpen: () => void; onRemove: () => void }) {
  if (state.status === 'downloading') return <button className="scene-action downloading" aria-label={`Cancel download, ${Math.round(state.progress * 100)}%`} onClick={() => state.abort?.abort()}>
    <Ring progress={state.progress} /><span className="pct">{Math.round(state.progress * 100)}</span><X size={12} className="cancel" /></button>;
  if (state.status === 'ready') return <div className="scene-ready">
    <button className="scene-remove" aria-label={`Remove ${scene.title} download`} title="Remove download" onClick={onRemove}><Trash2 size={13} /></button>
    <button className="scene-open" onClick={onOpen}><Play size={13} fill="currentColor" />Open</button>
  </div>;
  return <button className="scene-action" disabled={state.status === 'checking'} aria-label={`Download ${scene.title}, ${formatBytes(sceneBytes(scene))}`} title={`Download · ${formatBytes(sceneBytes(scene))}`} onClick={onDownload}><ArrowDownToLine size={16} /></button>;
}

export default function SceneShelf({ states, onDownload, onOpen, onRemove }: { states: Record<SceneId, DownloadState>; onDownload: (s: SceneInfo) => void; onOpen: (id: SceneId) => void; onRemove: (s: SceneInfo) => void }) {
  return <section className="shelf" aria-label="Mission scenes">
    <div className="shelf-head"><span>Mission scenes</span><em>Download once, then open them as your workspace</em></div>
    <div className="shelf-grid">{SCENES.map(s => {
      const Icon = ICONS[s.id], state = states[s.id];
      return <article key={s.id} className={`scene-card card-${s.id} ${state.status}`} onClick={() => state.status === 'ready' && onOpen(s.id)}>
        <div className={`scene-art art-${s.id}`}><Icon size={20} /><span className="scene-size">{state.status === 'ready' ? 'Downloaded' : formatBytes(sceneBytes(s))}</span></div>
        <div className="scene-body">
          <div><h3>{s.title}</h3><p>{s.blurb}</p>{state.error && <p className="scene-error">{state.error}</p>}</div>
          <div onClick={e => e.stopPropagation()}><SceneAction scene={s} state={state} onDownload={() => onDownload(s)} onOpen={() => onOpen(s.id)} onRemove={() => onRemove(s)} /></div>
        </div>
      </article>;
    })}</div>
  </section>;
}

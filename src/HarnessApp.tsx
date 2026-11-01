import { appUrl } from './urls';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { ArrowUp, ArrowUpRight, AudioLines, Mic, MessageSquare, Sparkles, Zap, BookOpen, Check, ChevronDown, ChevronRight, Circle, Download, FileCode2, FileJson, FileText, FolderSearch, Loader2, Orbit, PanelLeft, Pause, Pencil, Play, Plus, RotateCcw, Save, Search, Settings2, Square, Terminal, Trash2, TriangleAlert, X } from 'lucide-react';
import { api, DEFAULT_CONFIG, clock, type Health, type Mission, type Plan } from './types';
import { harnessApi, type AgentRun, type RunEvent } from './harnessTypes';
import Universe from './Universe';
import AetherSprite, { moodFor, type Mood } from './AetherSprite';
import SceneShelf, { SceneAction, useSceneDownloads } from './scenes/SceneShelf';
import { SCENES, type SceneId } from './scenes/catalog';
import type { SceneStatus } from './scenes/SceneView';
import type { SceneHandle } from './scenes/kit';
import { useVoice } from './voice/useVoice';
import VoiceOverlay from './voice/VoiceOverlay';
const SceneView = lazy(() => import('./scenes/SceneView'));

/** What the avatar feels about the scene it is watching. */
function sceneMood(phase: string): Mood {
  if (/capture|reached|separation|released/i.test(phase)) return 'success';
  if (/burn|ignition|liftoff|max-q/i.test(phase)) return 'simulating';
  if (/abort|failed|timeout/i.test(phase)) return 'worried';
  if (/planning|holding|retreat|starting/i.test(phase)) return 'thinking';
  if (/driving|approach|coast|ascent/i.test(phase)) return 'reading';
  return 'idle';
}

const SUGGESTIONS = [
  { label: 'Build a docking controller', mood: 'editing' as Mood, mission: 'docking', task: 'Build and verify a PD controller for a rotating docking port. Inspect the starter code, write meaningful tests for damping and acceleration limits, fix failures, run a parameter sweep, then compare with the reference docking simulation and write an engineering report.' },
  { label: 'Find a fuel-feasible orbit', mood: 'running' as Mood, mission: 'orbit', task: 'Plan a transfer from a 300 km Earth orbit to an 800 km orbit. Verify the fuel budget, run the simulation, then investigate whether it still works with only 12 kg of fuel. Save the nominal plan and a report explaining the limiting physics.' },
  { label: 'Map a path to the Moon', mood: 'simulating' as Mood, mission: 'lunar', task: 'Inspect the physics knowledge graph and mission configuration. Compute an Earth-to-lunar-distance transfer, verify fuel and travel time, simulate it, and write a concise report that states why lunar-distance transfer is not lunar interception or capture.' },
];
const LABELS: Record<string, string> = { list_files: 'Listed files', find_files: 'Found files', read_file: 'Read', grep: 'Searched', write_file: 'Created', edit_file: 'Edited', delete_file: 'Deleted', run_python: 'Ran', run_tests: 'Tested', search_physics: 'Looked up', plan_mission: 'Planned mission', simulate_mission: 'Simulated mission', update_plan: 'Updated plan' };
const ACTIVE = ['running', 'queued', 'created'];
const STATUS_TEXT: Partial<Record<Mood, string>> = { thinking: 'Thinking', reading: 'Reading the workspace', editing: 'Writing code', running: 'Running checks', simulating: 'Simulating the mission', oops: 'A check failed, investigating', panic: 'Physics veto, rethinking', explaining: 'Writing up' };

function FileIcon({ path, size = 14 }: { path: string; size?: number }) { return path.endsWith('.py') ? <FileCode2 size={size} /> : path.endsWith('.json') ? <FileJson size={size} /> : <FileText size={size} />; }
function mergeEvents(old: RunEvent[], fresh: RunEvent[]) { return [...new Map([...old, ...fresh].map(e => [e.id, e])).values()].sort((a, b) => a.id - b.id); }

type Block = { kind: 'message'; event: RunEvent } | { kind: 'work'; events: RunEvent[]; key: number } | { kind: 'error'; event: RunEvent };
/** Messages stand alone; everything the agent does between them collapses into one "work" block. */
function toBlocks(events: RunEvent[]): Block[] {
  const blocks: Block[] = [];
  for (const e of events) {
    if (e.type === 'message') blocks.push({ kind: 'message', event: e });
    else if (e.type === 'error') blocks.push({ kind: 'error', event: e });
    else if (['tool_start', 'thinking', 'notice'].includes(e.type)) {
      const last = blocks.at(-1);
      if (last?.kind === 'work') last.events.push(e); else blocks.push({ kind: 'work', events: [e], key: e.id });
    }
  }
  return blocks;
}

export default function HarnessApp() {
  const [health, setHealth] = useState<Health | null>(null), [missions, setMissions] = useState<Mission[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]), [id, setId] = useState<string | null>(null), [run, setRun] = useState<AgentRun | null>(null), [events, setEvents] = useState<RunEvent[]>([]);
  const [task, setTask] = useState(''), [mode, setMode] = useState('demo'), [scenario, setScenario] = useState('docking'), [steps, setSteps] = useState(24);
  const [creating, setCreating] = useState(false), [error, setError] = useState(''), [sidebar, setSidebar] = useState(() => window.innerWidth > 900), [settings, setSettings] = useState(false), [peek, setPeek] = useState<Mood | null>(null);
  const [drawer, setDrawer] = useState<'files' | 'mission' | null>(null), [file, setFile] = useState('controller.py'), [text, setText] = useState(''), [savedText, setSavedText] = useState(''), [editing, setEditing] = useState(false), [fileError, setFileError] = useState('');
  const [simulation, setSimulation] = useState<Plan | null>(null), [time, setTime] = useState(0), [playing, setPlaying] = useState(false), [resetKey, setResetKey] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null), end = useRef<HTMLDivElement>(null), eventRef = useRef<RunEvent[]>([]); eventRef.current = events;
  const working = creating || !!run && ACTIVE.includes(run.status), dirty = text !== savedText;
  const config = missions.find(m => m.id === scenario)?.defaults ?? DEFAULT_CONFIG;
  const mood = moodFor(run, events, working), toolEnds = new Map(events.filter(e => e.type === 'tool_end').map(e => [e.data.call_id, e]));
  const fileMeta = run?.files.find(f => f.path === file), sample = simulation?.samples?.find((s, i, a) => s.t >= time || i === a.length - 1) ?? null;
  const blocks = toBlocks(events), lastWork = [...blocks].reverse().find(b => b.kind === 'work');
  const { states: downloads, download, remove } = useSceneDownloads();
  const [scene, setScene] = useState<SceneId | null>(null), [chatOpen, setChatOpen] = useState(true), [sceneStatus, setSceneStatus] = useState<SceneStatus | null>(null);
  const [facing, setFacing] = useState<'left' | 'right'>('left');
  const [summon, setSummon] = useState(false), [summonText, setSummonText] = useState(''), sceneHandle = useRef<SceneHandle | null>(null);
  const [poked, setPoked] = useState(false), [bubble, setBubble] = useState(''), [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });
  const voice = useVoice(), voiceOpen = voice.state !== 'idle', [speaker, setSpeaker] = useState<'assistant' | 'user' | 'none'>('none');
  const heroAnchor = useRef<HTMLDivElement>(null), [anchor, setAnchor] = useState<DOMRect | null>(null), lastPhase = useRef('');

  useEffect(() => {
    Promise.all([api<Health>('health'), api<Mission[]>('missions'), harnessApi<AgentRun[]>('runs')]).then(([h, m, r]) => {
      setHealth(h); setMissions(m); setRuns(r); setMode(h.provider);
      const saved = localStorage.getItem('aether-run'); if (saved && r.some(x => x.id === saved)) setId(saved);
    }).catch(e => setError('Start the Python server on port 8000. ' + e.message));
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); newRun(); } if (e.key === 'Escape') { if (summon) setSummon(false); else if (voiceOpen) { if (voice.state === 'error') voice.dismissError(); else void voice.stop(); } else if (drawer) setDrawer(null); else if (scene && chatOpen) setChatOpen(false); } };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  });
  useEffect(() => {
    if (!id) return; localStorage.setItem('aether-run', id); let disposed = false;
    const refresh = () => harnessApi<AgentRun>(`runs/${id}?after=${eventRef.current.at(-1)?.id ?? 0}`).then(r => {
      if (disposed) return; setRun(r); setEvents(old => mergeEvents(old, r.events)); setRuns(old => [r, ...old.filter(x => x.id !== r.id)]);
    }).catch(e => { if (!disposed) setError(e.message); });
    void refresh();
    const timer = setInterval(() => void refresh(), 1500), stream = new EventSource(appUrl(`/api/harness/runs/${id}/events`));
    stream.onmessage = e => {
      if (disposed) return; const event = JSON.parse(e.data) as RunEvent; setEvents(old => mergeEvents(old, [event]));
      if (event.type === 'status') { setRun(old => old ? { ...old, status: event.data.status, summary: event.data.summary ?? old.summary } : old); if (!ACTIVE.includes(event.data.status)) stream.close(); }
      if (event.type === 'plan') setRun(old => old ? { ...old, plan: event.data.steps } : old);
      if (['tool_end', 'status', 'simulation'].includes(event.type)) void refresh();
    };
    return () => { disposed = true; clearInterval(timer); stream.close(); };
  }, [id]);
  useEffect(() => {
    if (!id || !file || drawer !== 'files') return; let disposed = false;
    harnessApi<{ text: string }>(`runs/${id}/file?path=${encodeURIComponent(file)}`).then(r => { if (!disposed && !editing) { setText(r.text); setSavedText(r.text); setFileError(''); } }).catch(e => { if (!disposed) setFileError(e.message); });
    return () => { disposed = true; };
  }, [id, file, fileMeta?.sha256, editing, drawer]);
  useEffect(() => { if (!id || !run?.has_simulation) return; harnessApi<Plan>(`runs/${id}/simulation`).then(setSimulation).catch(() => {}); }, [id, run?.has_simulation]);
  useEffect(() => {
    if (!playing || !simulation) return; const start = Date.now(), base = time;
    const timer = setInterval(() => setTime(Math.min(simulation.duration_s, base + (Date.now() - start) / 1000 * simulation.duration_s / 15)), 100);
    return () => clearInterval(timer);
  }, [playing, simulation]);
  useEffect(() => { if (simulation && time >= simulation.duration_s) setPlaying(false); }, [time, simulation]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [events.length, run?.status]);
  useEffect(() => { const t = input.current; if (t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 220) + 'px'; } }, [task]);
  // The single avatar flies between the hero slot, the chat corner and the scene launcher; track where those are.
  // The hero slot moves with sidebar animation, scrolling and late-loading content, so follow it every frame (state only changes when it moves).
  // Per-frame layout reads are only needed while the hero slot exists; elsewhere a resize listener is enough.
  const heroVisible = !run && !scene;
  useLayoutEffect(() => {
    let frame = 0;
    const measure = (loop: boolean) => {
      const r = heroAnchor.current?.getBoundingClientRect() ?? null, w = window.innerWidth, h = window.innerHeight;
      setViewport(v => v.w === w && v.h === h ? v : { w, h });
      setAnchor(a => (!a && !r) || (a && r && Math.abs(a.left - r.left) < .5 && Math.abs(a.top - r.top) < .5 && a.width === r.width) ? a : r);
      if (loop) frame = requestAnimationFrame(() => measure(true));
    };
    const onResize = () => measure(false);
    measure(heroVisible); window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', onResize); };
  }, [heroVisible]);
  useEffect(() => {
    if (!scene) { setBubble(''); return; }
    setBubble('Tap me to ask anything'); const t = setTimeout(() => setBubble(''), 4500); return () => clearTimeout(t);
  }, [scene]);
  useEffect(() => {
    const phase = sceneStatus?.phase ?? ''; if (!phase || phase === lastPhase.current) return;
    const first = !lastPhase.current; lastPhase.current = phase; if (first || chatOpen) return;
    setBubble(phase); const t = setTimeout(() => setBubble(''), 3500); return () => clearTimeout(t);
  }, [sceneStatus?.phase, chatOpen]);

  const confirmDiscard = () => !dirty || window.confirm('Discard unsaved edits?');
  function reset() { setEvents([]); eventRef.current = []; setEditing(false); setSimulation(null); setTime(0); setPlaying(false); setTask(''); setError(''); setDrawer(null); }
  function selectRun(next: AgentRun) { if (!confirmDiscard()) return; reset(); setId(next.id); setRun(next); if (window.innerWidth <= 900) setSidebar(false); }
  function newRun() { if (!confirmDiscard()) return; reset(); setId(null); setRun(null); localStorage.removeItem('aether-run'); setTimeout(() => input.current?.focus()); }
  async function start(e?: FormEvent, text?: string) {
    e?.preventDefault(); const prompt = (text ?? task).trim(); if (!prompt || working) return; setCreating(true); setError('');
    try {
      if (id && run) { const r = await harnessApi<AgentRun>(`runs/${id}/continue`, { task: prompt }); setRun({ ...r, status: 'queued' }); setEvents(old => mergeEvents(old, r.events)); }
      else { const r = await harnessApi<AgentRun>('runs', { task: prompt, config, mode, max_steps: steps, token_budget: 40000 }); setRun(r); setEvents(r.events); eventRef.current = r.events; setId(r.id); }
      setTask('');
    } catch (e) { setError((e as Error).message); } finally { setCreating(false); }
  }
  async function stop() { if (id) try { await harnessApi(`runs/${id}/cancel`, {}); } catch (e) { setError((e as Error).message); } }
  async function save() { if (!id || working) return; try { await harnessApi(`runs/${id}/file`, { path: file, content: text }, 'PUT'); setSavedText(text); setEditing(false); setFileError(''); } catch (e) { setFileError((e as Error).message); } }
  function openFile(path: string) { if (!confirmDiscard()) return; setFile(path); setEditing(false); setDrawer('files'); }
  function openScene(next: SceneId) { setScene(next); setChatOpen(false); setSceneStatus(null); lastPhase.current = ''; setDrawer(null); if (window.innerWidth <= 900) setSidebar(false); }
  function closeScene() { setScene(null); setChatOpen(true); setSceneStatus(null); }
  function pokeBuddy() {
    setPoked(true); setTimeout(() => setPoked(false), 1600);
    // It only ever turns when clicked, and then only sometimes.
    if (Math.random() < .5) setFacing(f => f === 'left' ? 'right' : 'left');
    if (voiceOpen || inHero) return;
    // Anywhere else, the avatar comes to centre stage with "what next?"; clicking it again sends it back.
    setBubble(''); setSummon(o => !o);
  }
  /** Close the summon panel, then do the thing. */
  function act(run: () => void) { setSummon(false); setSummonText(''); run(); }
  function ask(text: string) {
    act(() => { if (scene) setChatOpen(true); void start(undefined, text); });
  }

  // One avatar, three homes: the hero slot, the chat corner, or the scene launcher beside the floating chat.
  const narrow = viewport.w <= 700, inHero = !scene && !run && !!anchor;
  const buddySize = voiceOpen ? (narrow ? 176 : 232) : summon ? (narrow ? 150 : 190) : inHero ? 156 : scene ? (narrow ? 84 : 112) : (narrow ? 64 : 92);
  const voiceMood: Mood = voice.state === 'connecting' || voice.state === 'closing' ? 'thinking' : voice.state === 'error' ? 'worried' : voice.muted ? 'sleepy' : speaker === 'assistant' ? 'explaining' : 'listening';
  const buddyMood: Mood = poked ? 'poked' : voiceOpen ? voiceMood : summon ? (summonText.trim() ? 'listening' : 'idle') : working ? mood : scene && sceneStatus ? ((sceneStatus.mood as Mood | null | undefined) ?? sceneMood(sceneStatus.phase)) : !run ? (peek ?? (error ? 'worried' : task.trim() ? 'listening' : 'idle')) : mood;
  const panelWidth = Math.min(460, viewport.w - 32);
  const buddyStyle: CSSProperties = voiceOpen
    ? { left: viewport.w / 2 - buddySize / 2, top: viewport.h * (narrow ? .2 : .24) - buddySize / 2, width: buddySize, height: buddySize }
    : summon ? { left: viewport.w / 2 - buddySize / 2, top: Math.max(8, viewport.h * (narrow ? .13 : .17) - buddySize / 2), width: buddySize, height: buddySize }
    : inHero
    ? { left: anchor!.left + anchor!.width / 2 - buddySize / 2, top: anchor!.top + anchor!.height / 2 - buddySize / 2, width: buddySize, height: buddySize }
    : scene && chatOpen && narrow ? { left: viewport.w - buddySize - 4, top: 4, width: buddySize, height: buddySize }
    : scene && chatOpen ? { left: viewport.w - 16 - panelWidth - buddySize + 18, top: viewport.h - buddySize - 18, width: buddySize, height: buddySize }
    : { left: viewport.w - buddySize - (narrow ? 6 : 18), top: viewport.h - buddySize - (scene ? 22 : narrow ? 150 : 120), width: buddySize, height: buddySize };

  const composer = <form className={`composer ${working ? 'is-working' : ''}`} onSubmit={start}>
    <textarea ref={input} aria-label="Message Aether" rows={1} value={task} disabled={working} onChange={e => setTask(e.target.value)}
      placeholder={working ? 'Aether is working…' : run ? 'Ask for a follow-up…' : 'Give Aether a mission…'}
      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void start(); } }} />
    <div className="composer-row">
      {!run && <div className="composer-options">
        <label><select aria-label="Agent provider" value={mode} onChange={e => setMode(e.target.value)}><option value="openai">OpenAI</option><option value="ollama">Ollama</option><option value="demo">Demo</option></select><ChevronDown size={12} /></label>
        <label><Orbit size={13} /><select aria-label="Mission scenario" value={scenario} onChange={e => setScenario(e.target.value)}>{missions.map(m => <option value={m.id} key={m.id}>{m.name}</option>)}</select><ChevronDown size={12} /></label>
      </div>}
      {!working && <button type="button" className="voice-button" aria-label="Talk to Aether" title={voice.status?.key_configured === false ? 'Voice needs OPENAI_API_KEY on the server' : 'Talk to Aether'} onClick={() => void voice.start()}><AudioLines size={18} /></button>}
      {working
        ? <button type="button" className="send stop" aria-label="Stop agent" onClick={() => void stop()}><Square size={11} fill="currentColor" /></button>
        : <button type="submit" className="send" aria-label={run ? 'Continue agent' : 'Start agent'} disabled={!task.trim() || dirty}><ArrowUp size={17} /></button>}
    </div>
  </form>;

  return <div className={`app ${sidebar ? 'with-sidebar' : ''} ${scene ? 'scene-mode' : ''} ${scene && chatOpen ? 'chat-open' : ''}`}>
    {scene && <Suspense fallback={null}><SceneView id={scene} onClose={closeScene} onStatus={setSceneStatus} onHandle={h => { sceneHandle.current = h; }} /></Suspense>}
    <aside className="sidebar" aria-label="Sessions">
      <div className="sidebar-top">
        <button className="icon-button" aria-label="Close sidebar" onClick={() => setSidebar(false)}><PanelLeft size={18} /></button>
        <button className="icon-button" aria-label="New task" onClick={newRun}><Pencil size={17} /></button>
      </div>
      <button className="brand" onClick={newRun}><span className="brand-mark" /><span>Aether</span></button>
      <div className="session-label">Scenes</div>
      <div className="scene-list">{SCENES.map(s => <div key={s.id} className={`scene-row ${scene === s.id ? 'active' : ''}`}>
        <button className="scene-row-title" disabled={downloads[s.id].status !== 'ready'} onClick={() => openScene(s.id)}><span className={`scene-dot art-${s.id}`} />{s.title}</button>
        <SceneAction scene={s} state={downloads[s.id]} onDownload={() => void download(s)} onOpen={() => openScene(s.id)} onRemove={() => void remove(s)} />
      </div>)}</div>
      <div className="session-label">Recent</div>
      <nav className="sessions">
        {runs.map(r => <button key={r.id} className={id === r.id ? 'active' : ''} onClick={() => selectRun(r)}>
          <span className={`dot ${r.status}`} /><span className="session-title">{r.task}</span>
        </button>)}
        {!runs.length && <p className="sessions-empty">Your missions will show up here.</p>}
      </nav>
      <button className="sidebar-settings" onClick={() => setSettings(true)}><Settings2 size={16} />Settings<span className={`engine ${health ? 'on' : ''}`} /></button>
    </aside>
    {sidebar && <div className="sidebar-scrim" onClick={() => setSidebar(false)} />}

    <main className="main">
      <header className="topbar">
        {!sidebar && <><button className="icon-button" aria-label="Open sidebar" onClick={() => setSidebar(true)}><PanelLeft size={18} /></button><button className="icon-button" aria-label="New task" onClick={newRun}><Pencil size={17} /></button></>}
        <span className="topbar-title">{run ? run.task : ''}</span>
        <a className="icon-button" href="/physics" aria-label="Open physics library" title="Physics library"><BookOpen size={17}/></a>
        {scene && <button className="icon-button" aria-label="Hide chat" title="Hide chat" onClick={() => setChatOpen(false)}><X size={17} /></button>}
        {run && <div className="topbar-actions">
          {run.has_simulation && <button className={drawer === 'mission' ? 'active' : ''} onClick={() => setDrawer(drawer === 'mission' ? null : 'mission')}><Orbit size={15} />Mission</button>}
          <button className={drawer === 'files' ? 'active' : ''} onClick={() => setDrawer(drawer === 'files' ? null : 'files')}><FileCode2 size={15} />Files<span>{run.files.length}</span></button>
        </div>}
      </header>
      {error && <div className="banner" role="alert"><TriangleAlert size={15} /><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={14} /></button></div>}

      {!run ? <section className="hero">
        <div ref={heroAnchor} className="buddy-anchor" />
        <h1>What should we work on?</h1>
        {composer}
        <div className="chips">{SUGGESTIONS.map(s => <button key={s.label} onMouseEnter={() => setPeek(s.mood)} onMouseLeave={() => setPeek(null)} onClick={() => { setTask(s.task); setScenario(s.mission); input.current?.focus(); }}>{s.label}</button>)}</div>
        {mode === 'demo' && <p className="hero-note">Demo mode runs a scripted session with real tools. Pick OpenAI or Ollama for live autonomy.</p>}
        {!scene && <SceneShelf states={downloads} onDownload={s => void download(s)} onOpen={openScene} onRemove={s => void remove(s)} />}
      </section> : <>
        <section className="thread">
          {blocks.map(b => b.kind === 'message'
            ? (b.event.data.role === 'user'
              ? <div key={b.event.id} className="msg-user"><p>{b.event.data.text}</p></div>
              : <div key={b.event.id} className="msg-agent"><p>{b.event.data.text}</p></div>)
            : b.kind === 'error' ? <div key={b.event.id} className="msg-error"><TriangleAlert size={14} />{b.event.data.message}</div>
            : <WorkBlock key={b.key} events={b.events} ends={toolEnds} live={working && b === lastWork} plan={b === lastWork ? run.plan : []} onFile={openFile} />)}
          {working && <div className="live"><span className="live-dot" /><span className="shimmer">{STATUS_TEXT[mood] ?? 'Working'}…</span></div>}
          {!working && run.status !== 'completed' && run.status !== 'created' && <div className="msg-agent ended"><p>{run.summary || `Run ${run.status}.`}<span>Workspace preserved. Send a follow-up to continue.</span></p></div>}
          {!working && run.status === 'completed' && <div className="outcome">
            <div className="outcome-actions">
              {run.files.some(f => f.path === 'artifacts/report.md') && <button onClick={() => openFile('artifacts/report.md')}><FileText size={14} />Report</button>}
              {run.has_simulation && <button onClick={() => setDrawer('mission')}><Orbit size={14} />Simulation</button>}
              <button onClick={() => setDrawer('files')}><FileCode2 size={14} />Workspace</button>
            </div>
          </div>}
          <div ref={end} />
        </section>
        <div className="dock">{composer}<p className="dock-note">{run.provider === 'demo' ? 'Scripted demo · real tools, no model calls' : `${run.tokens.toLocaleString()} tokens · ${run.steps}/${run.max_steps} turns`}</p></div>
      </>}
    </main>

    {drawer && run && <aside className="drawer" aria-label={drawer === 'files' ? 'Workspace files' : 'Mission simulation'}>
      <header>
        <div className="drawer-tabs">
          <button className={drawer === 'files' ? 'active' : ''} onClick={() => setDrawer('files')}>Files</button>
          {run.has_simulation && <button className={drawer === 'mission' ? 'active' : ''} onClick={() => setDrawer('mission')}>Mission</button>}
        </div>
        <button className="icon-button" aria-label="Close panel" onClick={() => setDrawer(null)}><X size={17} /></button>
      </header>
      {drawer === 'files' ? <div className="files">
        <nav className="file-list">{run.files.map(f => <button key={f.path} className={f.path === file ? 'active' : ''} onClick={() => openFile(f.path)}><FileIcon path={f.path} size={13} /><span>{f.path}</span></button>)}</nav>
        <div className="file-bar">
          <span><FileIcon path={file} size={13} />{file}{dirty && <i />}</span>
          <a className="icon-button" aria-label="Download file" href={appUrl(`/api/harness/runs/${id}/download?path=${encodeURIComponent(file)}`)}><Download size={15} /></a>
          {editing ? <button className="icon-button" aria-label="Save file" disabled={working || !dirty} onClick={() => void save()}><Save size={15} /></button>
            : <button className="icon-button" aria-label="Edit file" disabled={working} onClick={() => setEditing(true)}><Pencil size={15} /></button>}
        </div>
        <textarea className={`code ${/\.(md|txt)$/.test(file) ? 'wrap' : ''}`} spellCheck={false} aria-label="Workspace file editor" value={text} readOnly={!editing || working} onChange={e => setText(e.target.value)} />
        {fileError && <p className="file-error">{fileError}</p>}
      </div> : <div className="mission">
        <div className="viewport"><Universe config={simulation?.config ?? config} plan={simulation} sample={sample} resetKey={resetKey} /><button className="icon-button viewport-reset" aria-label="Reset mission camera" onClick={() => setResetKey(x => x + 1)}><RotateCcw size={14} /></button></div>
        <div className="playback">
          <button aria-label={playing ? 'Pause trajectory' : 'Play trajectory'} disabled={!simulation} onClick={() => { if (simulation && time >= simulation.duration_s) setTime(0); setPlaying(!playing); }}>{playing ? <Pause size={14} /> : <Play size={14} />}</button>
          <input aria-label="Trajectory time" type="range" min="0" max={simulation?.duration_s ?? 1} value={time} step="any" disabled={!simulation || playing} onChange={e => setTime(Number(e.target.value))} />
          <span>T+ {clock(time)}</span>
        </div>
        {simulation && <div className="stats">
          <div><span>Delta-v</span><strong>{simulation.delta_v_m_s.toFixed(1)} <small>m/s</small></strong></div>
          <div><span>Fuel left</span><strong>{(sample?.fuel_kg ?? simulation.fuel_remaining_kg).toFixed(1)} <small>kg</small></strong></div>
          <div><span>{simulation.config.mission_type === 'docking' ? 'Port distance' : 'Altitude'}</span><strong>{simulation.config.mission_type === 'docking' ? (sample?.distance_m ?? 0).toFixed(2) : (sample?.altitude_km ?? 0).toFixed(1)} <small>{simulation.config.mission_type === 'docking' ? 'm' : 'km'}</small></strong></div>
          <div><span>Speed</span><strong>{(sample?.speed_m_s ?? 0).toFixed(1)} <small>m/s</small></strong></div>
        </div>}
        {simulation && <p className="mission-note">{simulation.summary} Computed by the built-in reference physics model; playback is accelerated.</p>}
      </div>}
    </aside>}

    {settings && <div className="modal-scrim" onClick={() => setSettings(false)}>
      <section className="modal" role="dialog" aria-modal="true" aria-label="Settings" onClick={e => e.stopPropagation()}>
        <header><h2>Settings</h2><button className="icon-button" aria-label="Close settings" onClick={() => setSettings(false)}><X size={17} /></button></header>
        <label>Turn budget<select aria-label="Reasoning turn budget" value={steps} onChange={e => setSteps(Number(e.target.value))}><option value="12">12 turns</option><option value="24">24 turns</option><option value="40">40 turns</option></select></label>
        <dl>
          <div><dt>Server</dt><dd>{health ? 'Connected' : 'Unavailable'}</dd></div>
          <div><dt>OpenAI key</dt><dd>{health?.key_configured ? `Configured · ${health.reasoning_model}` : 'Not configured'}</dd></div>
          <div><dt>Python</dt><dd>Numerical sandbox</dd></div>
          <div><dt>Storage</dt><dd>.aether/runs</dd></div>
        </dl>
        <p>For live autonomy, add OPENAI_API_KEY to .env and restart the server. Set HARNESS_EXECUTION_MODE=docker for full Python in a container.</p>
      </section>
    </div>}

    {summon && (() => {
      const live = scene ? sceneHandle.current?.live : undefined, sceneInfo = SCENES.find(s => s.id === scene), liveOn = live?.status().state === 'live';
      const actions: { key: string; icon: ReactNode; label: string; hint?: string; tone?: string; disabled?: boolean; run: () => void }[] = [];
      if (scene && sceneInfo) {
        live?.actions.forEach(a => actions.push({ key: `fault-${a.id}`, icon: <Zap size={16} />, label: a.label, hint: a.hint, tone: 'fault', disabled: !liveOn, run: () => act(() => void live.act(a.id)) }));
        const recent = (live?.entries() ?? []).slice(0, 6).map(e => `[${e.layer ? `L${e.layer}` : '-'}] ${e.title}${e.detail ? ` (${e.detail})` : ''}`).join('\n');
        actions.push({ key: 'explain', icon: <Sparkles size={16} />, label: 'Explain what just happened', hint: 'Send the latest decisions to Aether', run: () => ask(`I'm watching the ${sceneInfo.title} scene (${sceneStatus?.phase ?? ''}). Explain what the flight stack just did and whether it was the right call:\n${recent || 'No decisions yet.'}`) });
        if (live) actions.push({ key: 'restart', icon: <RotateCcw size={16} />, label: 'Run again', hint: 'Fresh vehicle, default program', run: () => act(() => void live.restart()) });
        actions.push({ key: 'chat', icon: <MessageSquare size={16} />, label: chatOpen ? 'Hide chat' : 'Open chat', run: () => act(() => setChatOpen(o => !o)) });
        actions.push({ key: 'leave', icon: <X size={16} />, label: 'Leave scene', run: () => act(closeScene) });
      } else {
        if (run) {
          actions.push({ key: 'files', icon: <FileCode2 size={16} />, label: 'Show workspace files', run: () => act(() => setDrawer('files')) });
          if (run.files.some(f => f.path === 'artifacts/report.md')) actions.push({ key: 'report', icon: <FileText size={16} />, label: 'Open the report', run: () => act(() => openFile('artifacts/report.md')) });
          if (run.has_simulation) actions.push({ key: 'sim', icon: <Orbit size={16} />, label: 'Show the simulation', run: () => act(() => setDrawer('mission')) });
          actions.push({ key: 'new', icon: <Plus size={16} />, label: 'Start a new task', run: () => act(newRun) });
        }
        SCENES.filter(s => downloads[s.id].status === 'ready').forEach(s => actions.push({ key: `scene-${s.id}`, icon: <Play size={16} />, label: `Open ${s.title}`, hint: s.subtitle, run: () => act(() => openScene(s.id)) }));
      }
      actions.push({ key: 'talk', icon: <Mic size={16} />, label: 'Talk to Aether', hint: 'Voice conversation', run: () => act(() => void voice.start()) });
      return <div className="summon" role="dialog" aria-modal="true" aria-label="What should we do next" onClick={() => setSummon(false)}>
        <div className="summon-stage" onClick={e => e.stopPropagation()}>
          <h2>What should we do next?</h2>
          <p className="summon-context">{scene && sceneInfo ? `${sceneInfo.title} · ${sceneStatus?.phase ?? 'loading'}` : run ? run.task : 'Pick up where we left off'}</p>
          <form className="summon-input" onSubmit={e => { e.preventDefault(); if (summonText.trim()) ask(summonText); }}>
            <input autoFocus aria-label="Ask Aether" value={summonText} onChange={e => setSummonText(e.target.value)} placeholder={scene && sceneInfo ? `Ask about the ${sceneInfo.title.toLowerCase()}…` : 'Ask Aether anything…'} />
            <button type="button" className="voice-button" aria-label="Talk to Aether instead" onClick={() => act(() => void voice.start())}><AudioLines size={18} /></button>
            <button type="submit" className="send" aria-label="Send to Aether" disabled={!summonText.trim() || working}><ArrowUp size={17} /></button>
          </form>
          <div className="summon-grid">{actions.map(a => <button key={a.key} className={`summon-action ${a.tone ?? ''}`} disabled={a.disabled} onClick={a.run}>
            <span className="summon-icon">{a.icon}</span><span><b>{a.label}</b>{a.hint && <em>{a.hint}</em>}</span></button>)}</div>
          <span className="summon-hint">Esc or click outside to close</span>
        </div>
      </div>;
    })()}
    {voiceOpen && <VoiceOverlay voice={voice} speaker={speaker} onSpeaker={setSpeaker} />}
    <button className={`buddy ${inHero ? 'in-hero' : ''} ${scene && !voiceOpen ? 'in-scene' : ''} ${voiceOpen ? `in-voice speaker-${speaker}` : ''}`} style={buddyStyle} onClick={pokeBuddy}
      aria-label={voiceOpen ? 'Aether' : scene ? (chatOpen ? 'Hide chat' : 'Ask Aether') : 'Aether'} aria-expanded={scene && !voiceOpen ? chatOpen : undefined}>
      <AetherSprite mood={buddyMood} size={buddySize} facing={facing} />
      {bubble && !voiceOpen && !(scene && chatOpen) && <span className="buddy-bubble">{bubble}</span>}
      {working && !inHero && !voiceOpen && <span className="buddy-busy" />}
    </button>
    {scene && !chatOpen && !voiceOpen && !summon && <button className="buddy-mic" aria-label="Talk to Aether" title="Talk to Aether"
      // Sits on the orb's lower-left edge; the orb fills only the middle ~60% of the sprite cell.
      style={{ left: (buddyStyle.left as number) + buddySize * .2 - 14, top: (buddyStyle.top as number) + buddySize * .66 - 14 }} onClick={() => void voice.start()}><Mic size={16} /></button>}
  </div>;
}

function WorkBlock({ events, ends, live, plan, onFile }: { events: RunEvent[]; ends: Map<string, RunEvent>; live: boolean; plan: { title: string; status: string }[]; onFile: (path: string) => void }) {
  const [open, setOpen] = useState(live);
  useEffect(() => { setOpen(live); }, [live]); // Unfold while working, fold to a one-line summary when done.
  const tools = events.filter(e => e.type === 'tool_start' && e.data.name !== 'update_plan');
  const failed = tools.filter(e => ends.get(e.data.call_id)?.data.ok === false).length;
  const edited = new Set(tools.filter(e => ['write_file', 'edit_file', 'delete_file'].includes(e.data.name)).map(e => e.data.arguments?.path)).size;
  const summary = [`${tools.length} step${tools.length === 1 ? '' : 's'}`, edited && `${edited} file${edited === 1 ? '' : 's'} changed`, failed && `${failed} failed check${failed === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
  return <div className={`work ${open ? 'open' : ''}`}>
    <button className="work-head" onClick={() => setOpen(!open)}>{live ? <Loader2 size={14} className="spin" /> : <Check size={14} />}<span>{live ? 'Working' : 'Worked through'} {summary}</span><ChevronRight size={14} className="chev" /></button>
    {open && <div className="work-body">
      {plan.length > 0 && <ul className="plan">{plan.map((s, i) => <li key={i} className={s.status}>{s.status === 'completed' ? <Check size={12} /> : s.status === 'in_progress' ? <Loader2 size={12} className="spin" /> : <Circle size={10} />}{s.title}</li>)}</ul>}
      {events.map(e => e.type === 'thinking' ? <Thought key={e.id} text={e.data.text} />
        : e.type === 'notice' ? <p key={e.id} className="work-note">{e.data.message}</p>
        : e.data.name === 'update_plan' ? null
        : <ToolRow key={e.id} event={e} end={ends.get(e.data.call_id)} onFile={onFile} />)}
    </div>}
  </div>;
}

function Thought({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return <div className="thought"><button onClick={() => setOpen(!open)}><span>Thought</span><ChevronRight size={12} className={open ? 'chev open' : 'chev'} /></button>{open ? <p>{text}</p> : <p className="clamp">{text}</p>}</div>;
}

function ToolRow({ event, end, onFile }: { event: RunEvent; end?: RunEvent; onFile: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const d = event.data, args = d.arguments ?? {}, result = end?.data.result, detail = String(args.path ?? args.pattern ?? args.glob ?? args.query ?? args.config_path ?? '');
  const icon: ReactNode = d.name === 'grep' ? <Search size={13} /> : d.name === 'find_files' ? <FolderSearch size={13} /> : d.name === 'delete_file' ? <Trash2 size={13} /> : ['write_file', 'edit_file'].includes(d.name) ? <Pencil size={13} /> : ['run_python', 'run_tests'].includes(d.name) ? <Terminal size={13} /> : d.name === 'search_physics' ? <BookOpen size={13} /> : ['plan_mission', 'simulate_mission'].includes(d.name) ? <Orbit size={13} /> : <FileText size={13} />;
  const tests = result?.tests as { name: string; passed: boolean; error?: string }[] | undefined;
  const badge = !end ? <Loader2 size={12} className="spin" /> : tests?.length ? <em className={end.data.ok ? 'ok' : 'bad'}>{tests.filter(t => t.passed).length}/{tests.length} passed</em> : !end.data.ok ? <em className="bad">failed</em> : null;
  return <div className={`tool ${end && !end.data.ok ? 'failed' : ''}`}>
    <button className="tool-head" onClick={() => setOpen(!open)}>{icon}<span>{LABELS[d.name] ?? d.name}</span>{detail && <code>{detail}</code>}{badge}</button>
    {open && <div className="tool-body">
      {result?.diff ? <pre className="diff">{result.diff.split('\n').map((l: string, i: number) => <div key={i} className={l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l.startsWith('@@') ? 'hunk' : ''}>{l || ' '}</div>)}</pre>
        : tests?.length ? <ul className="tests">{tests.map(t => <li key={t.name} className={t.passed ? 'pass' : 'fail'}>{t.passed ? <Check size={12} /> : <X size={12} />}{t.name}{t.error && <pre>{t.error}</pre>}</li>)}</ul>
        : result?.content ? <pre>{result.content}</pre>
        : result?.stdout ? <pre>{'$ python ' + args.path + '\n' + result.stdout}</pre>
        : result?.matches ? <pre>{result.matches.join('\n') || 'No matches'}</pre>
        : result?.files ? <div className="file-links">{result.files.map((f: any) => <button key={f.path} onClick={() => onFile(f.path)}><FileIcon path={f.path} size={12} />{f.path}</button>)}</div>
        : result ? <pre>{JSON.stringify(result, null, 2)}</pre> : <pre>Waiting for result…</pre>}
      {result?.error && <pre className="tool-error">{result.error}</pre>}
      {end && end.data.files_changed?.length > 0 && <div className="file-links">{end.data.files_changed.map((f: string) => <button key={f} onClick={() => onFile(f)}><FileIcon path={f} size={12} />{f}<ArrowUpRight size={11} /></button>)}</div>}
    </div>}
  </div>;
}

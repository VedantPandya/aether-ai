import { appUrl } from './urls';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Activity, ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check, CheckCircle2, ChevronDown, CircleDot, Clock3, Download, Expand, FlaskConical, Fuel, Globe2, Layers3, Loader2, Minus, MoreHorizontal, Orbit, Pause, Play, Plus, Radio, Rocket, RotateCcw, Send, Settings2, ShieldCheck, Sparkles, Target, Terminal, TriangleAlert, X, Zap } from 'lucide-react';
import Universe from './Universe';
import PhysicsTopic from './PhysicsTopic';
import { api, clock, DEFAULT_CONFIG, duration, type Config, type Health, type Message, type Mission, type Plan, type Sample, type Topic, type Trace } from './types';

const INTRO: Message = { role: 'assistant', content: "I'm Aether, your mission copilot. Tell me where you want to go. I'll consult the physics library, calculate a flight plan, and check the fuel before we fly." };
const missionIcons = { orbit: Orbit, lunar: Globe2, docking: Target, launch: Rocket };
function pretty(n: number | undefined, digits = 1) { return n === undefined ? '--' : n.toLocaleString('en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits }); }
function interpolate(samples: Sample[] | undefined, time: number): Sample | null {
  if (!samples?.length) return null;
  let low = 0, high = samples.length - 1;
  while (low < high) { const mid = Math.ceil((low + high) / 2); if (samples[mid].t <= time) low = mid; else high = mid - 1; }
  const a = samples[low], b = samples[Math.min(low + 1, samples.length - 1)];
  const w = b.t === a.t ? 0 : Math.min(1, Math.max(0, (time - a.t) / (b.t - a.t)));
  const lerp = (x: number, y: number) => x + (y - x) * w;
  return { ...a, t: time, x: lerp(a.x,b.x), y: lerp(a.y,b.y), altitude_km: lerp(a.altitude_km,b.altitude_km), speed_m_s: lerp(a.speed_m_s,b.speed_m_s), fuel_kg: lerp(a.fuel_kg,b.fuel_kg), distance_m: a.distance_m === undefined ? undefined : lerp(a.distance_m,b.distance_m!), station_angle: a.station_angle === undefined ? undefined : lerp(a.station_angle,b.station_angle!) };
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [messages, setMessages] = useState<Message[]>([INTRO]);
  const [traces, setTraces] = useState<Trace[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const [view, setView] = useState<'control' | 'knowledge' | 'log'>('control');
  const [modal, setModal] = useState<'missions' | 'settings' | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [complete, setComplete] = useState(false);
  const [warp, setWarp] = useState('demo');
  const [resetKey, setResetKey] = useState(0);
  const [topicId, setTopicId] = useState('gravity');
  const [search, setSearch] = useState('');
  const chatEnd = useRef<HTMLDivElement>(null);
  const scenePanel = useRef<HTMLDivElement>(null);
  const mission = missions.find(m => m.id === config.mission_type);
  const samples = plan?.samples;
  const sample = interpolate(samples, elapsed);
  const activeProvider = offline ? 'demo' : health?.provider ?? 'demo';
  const progress = plan?.duration_s ? Math.min(1, elapsed / plan.duration_s) : 0;
  const running = playing || (elapsed > 0 && !complete);

  useEffect(() => { Promise.all([api<Health>('health'), api<Mission[]>('missions'), api<Topic[]>('knowledge')]).then(([h,m,t]) => { setHealth(h); setMissions(m); setTopics(t); }).catch(e => setError(`Backend unavailable. Start the Python server on port 8000. ${e.message}`)); }, []);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages, busy]);
  useEffect(() => {
    if (!playing || !plan) return;
    const rate = warp === 'demo' ? plan.duration_s / 30 : warp === 'fast' ? plan.duration_s / 10 : 1;
    let last = performance.now();
    const timer = window.setInterval(() => { const now = performance.now(); const dt = (now-last)/1000; last=now; setElapsed(old => Math.min(plan.duration_s,old+dt*rate)); }, 40);
    return () => clearInterval(timer);
  }, [playing, plan, warp]);
  useEffect(() => { if (plan && elapsed >= plan.duration_s && elapsed > 0) { setPlaying(false); setComplete(true); } }, [elapsed, plan]);

  async function send(text = input, override?: Config) {
    if (!text.trim() || busy || playing) return;
    const current = override ?? config;
    setInput(''); setBusy(true); setError(''); setPlaying(false);
    const history = messages.slice(-8).map(({role,content}) => ({role,content}));
    setMessages(old => [...old,{role:'user',content:text}]);
    try {
      const result = await api<{reply: string; plan: Plan | null; provider: string; trace: Trace[]}>('chat',{message:text,config:current,history,offline});
      if (result.plan) {
        const computed = result.plan.feasible ? await api<Plan>('simulate',result.plan.config) : result.plan;
        setPlan(computed); setConfig(computed.config); setElapsed(0); setComplete(false);
      }
      setMessages(old => [...old,{role:'assistant',content:result.reply,trace:result.trace}]);
      setTraces(old => [...old,...result.trace].slice(-40));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function execute() {
    if (!plan?.feasible || busy) return;
    if (elapsed > 0 && !complete) { setPlaying(!playing); return; }
    setBusy(true); setError('');
    try {
      const result = await api<{ action: string; source: string; trace: Trace[] }>('reflex',{config,offline});
      setTraces(old => [...old,...result.trace]);
      if (result.action !== 'continue') { setError(`Preflight reflex selected ${result.action}. Review or replan the mission.`); return; }
      const simulation = await api<Plan>('simulate',config);
      setPlan(simulation); setElapsed(0); setComplete(false); setPlaying(true);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  function selectMission(m: Mission) {
    setConfig(m.defaults); setPlan(null); setElapsed(0); setPlaying(false); setComplete(false); setTraces([]); setError('');
    setMessages([{role:'assistant',content:`${m.name} is on deck. ${m.subtitle} Describe your objective, or use the suggested mission below. Model: ${m.model}.`}]);
    setModal(null); setView('control');
  }
  function resetFlight() { setPlaying(false); setElapsed(0); setComplete(false); }
  function downloadReport() {
    if (!plan) return;
    const report = { product: 'Aether Mission Control', generated_at: new Date().toISOString(), provider: activeProvider, playback_completed: complete, mission: { ...plan, samples: undefined }, trace: traces, note: 'Educational simulation; not real spacecraft guidance.' };
    const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})); const a=document.createElement('a'); a.href=url; a.download=`aether-${config.mission_type}-${plan.id}.json`; a.click(); URL.revokeObjectURL(url);
  }
  function onSubmit(e: FormEvent) { e.preventDefault(); void send(); }
  const selectedTopic = topics.find(t => t.id === topicId);
  const normalizeSearch = (text: string) => text.normalize('NFKD').toLowerCase().replace(/[-_\u2010-\u2015]/g, ' ');
  const searchWords = normalizeSearch(search).trim().split(/\s+/).filter(Boolean);
  const filteredTopics = topics.filter(t => {
    const text = normalizeSearch([t.id, t.title, t.category, t.summary, t.details, t.equation, ...(t.keywords ?? [])].join(' '));
    return searchWords.every(word => text.includes(word));
  });

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Aether home"><img src={appUrl("/favicon.png")} alt=""/><span>aether<span className="brand-dot">.</span></span></a>
      <div className="workspace-label">EXPLORATION WORKSPACE</div>
      <nav className="main-nav" aria-label="Main navigation">
        <button className={view==='control'?'active':''} onClick={()=>setView('control')}><Orbit size={19}/>Mission control<span className="nav-dot"/></button>
        <button className={view==='knowledge'?'active':''} onClick={()=>setView('knowledge')}><BookOpen size={19}/>Physics library<span className="nav-count">{topics.length || '—'}</span></button>
        <button className={view==='log'?'active':''} onClick={()=>setView('log')}><Terminal size={18}/>Flight log{traces.length>0&&<span className="nav-count">{traces.length}</span>}</button>
      </nav>
      <div className="sidebar-rule"/>
      <div className="section-label side-label">YOUR MISSIONS <button aria-label="Choose mission" onClick={()=>setModal('missions')} disabled={busy||playing}><Plus size={15}/></button></div>
      <div className="mission-nav">{missions.map(m=>{const Icon=missionIcons[m.id]; return <button key={m.id} className={config.mission_type===m.id?'selected':''} disabled={busy||playing} onClick={()=>selectMission(m)}><Icon size={16}/><span>{m.name}</span>{config.mission_type===m.id&&<span className="tiny-dot"/>}</button>;})}</div>
      <div className="sidebar-bottom">
        <div className="mini-card"><span className="small-orbit"><Sparkles size={17}/></span><strong>Built to go further.</strong><p>Describe the mission.<br/>Let physics lead the way.</p><button onClick={()=>{setTopicId('control-hierarchy');setView('knowledge');}}>Meet your flight stack <ArrowUpRight size={14}/></button></div>
        <button className="settings-nav" onClick={()=>setModal('settings')} disabled={busy||playing}><Settings2 size={18}/>Mission settings</button>
        <div className="local-badge"><span className={health?'status-dot':'status-dot muted'}/><span>{health?'Simulation server online':'Connecting to simulation'}</span></div>
      </div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>{view==='control'?'Mission control':view==='knowledge'?'Physics library':'Flight log'}</strong></div><div className="topbar-right"><span className="educational"><FlaskConical size={13}/> SIMULATION LAB</span><span className="version">v0.1</span><a href="https://github.com/VedantPandya/aether-ai" target="_blank" rel="noreferrer" className="source-link">Source <ArrowUpRight size={14}/></a></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow"><span/> AUTONOMOUS EXPLORATION</div><h1>{view==='control'?'Your mission. Our trajectory.':view==='knowledge'?'Grounded in the laws of physics.':'Every decision, in the open.'}</h1><p>{view==='control'?'A little curiosity. Real physics. An AI with a flight plan.':view==='knowledge'?'A connected, sourced knowledge base for your mission-planning agent.':'Inspect the tool calls and control layers behind each mission.'}</p></div><button className="button secondary" onClick={()=>setModal('missions')} disabled={busy||playing}><Plus size={16}/>New mission</button></div>
        {error&&<div className="error-banner" role="alert"><TriangleAlert size={18}/><span>{error}</span><button aria-label="Dismiss error" onClick={()=>setError('')}><X size={16}/></button></div>}

        {view==='control'&&<>
          <div className="mission-strip"><div className="mission-strip-icon"><Rocket size={19}/></div><div><div className="section-label">ACTIVE MISSION <span className="mission-number">AX-{config.mission_type.toUpperCase()}-01</span></div><button className="mission-title" onClick={()=>setModal('missions')} disabled={busy||playing}>{mission?.name??'Orbital transfer'}<ChevronDown size={15}/></button></div><div className={`mission-state ${plan&&!plan.feasible?'blocked':complete?'finished':''}`}><span/>{busy?'COMPUTING':complete?'MISSION COMPLETE':playing?'IN FLIGHT':plan?.feasible?'READY FOR FLIGHT':plan?'MISSION ON HOLD':'AWAITING FLIGHT PLAN'}</div></div>
          <div className="control-layout">
            <div className="flight-column">
              <div className="stats-grid">
                <Stat icon={<Target size={15}/>} label={config.mission_type==='docking'?'PORT DISTANCE':config.mission_type==='launch'?'TARGET ALTITUDE':'DESTINATION'} value={config.mission_type==='docking'?pretty(sample?.distance_m??88,1):config.mission_type==='lunar'?'384,400':config.mission_type==='launch'?'100':pretty(config.target_altitude_km,0)} unit={config.mission_type==='docking'?'m':'km'} detail={config.mission_type==='docking'?'Rotating station frame':config.mission_type==='lunar'?'From Earth?s center':config.mission_type==='launch'?'Suborbital space boundary':'Above Earth?s surface'}/>
                <Stat icon={<Zap size={15}/>} label="MANEUVER BUDGET" value={pretty(plan?.delta_v_m_s,0)} unit="m/s" detail="Computed by the physics engine"/>
                <Stat icon={<Fuel size={15}/>} label="PROPELLANT" value={pretty(sample&&elapsed>0?sample.fuel_kg:config.fuel_kg,1)} unit="kg" detail={plan?`${pretty(plan.fuel_required_kg,1)} kg predicted consumption`:'Fuel loaded aboard Aether-01'}/>
                <Stat icon={<Clock3 size={15}/>} label="FLIGHT TIME" value={plan?duration(plan.duration_s):'--'} unit="" detail="Simulated mission duration"/>
              </div>
              <div className="scene-panel" ref={scenePanel}>
                <Universe config={config} plan={plan} sample={sample} resetKey={resetKey}/>
                <div className="scene-top"><div className="viewport-label"><span className="status-dot"/>{config.mission_type==='docking'?'STATION RELATIVE VIEW':config.mission_type==='launch'?'ASCENT VIEW':'ORBITAL VIEW'}<span className="scene-divider"/>3D</div><div className="scene-tools"><button aria-label="Reset camera" title="Reset camera" onClick={()=>setResetKey(x=>x+1)}><RotateCcw size={15}/></button><button aria-label="Fullscreen simulation" title="Fullscreen" onClick={()=>void scenePanel.current?.requestFullscreen().catch(()=>setError('Fullscreen is unavailable in this browser.'))}><Expand size={15}/></button></div></div>
                <div className="live-telemetry"><span>{sample&&elapsed>0?sample.phase:'PREFLIGHT'}</span><strong>{config.mission_type==='docking'?pretty(sample?.distance_m??88,2):pretty(sample?.altitude_km??(config.mission_type==='launch'?0:config.start_altitude_km),1)}<small>{config.mission_type==='docking'?'m to port':'km altitude'}</small></strong><span>{pretty((sample?.speed_m_s??0)/(config.mission_type==='docking'?1:1000),2)} {config.mission_type==='docking'?'m/s relative':'km/s velocity'}</span></div><div className="scene-coordinates"><span>REFERENCE FRAME</span><strong>{config.mission_type==='docking'?'LOCAL INERTIAL':config.mission_type==='launch'?'EARTH VERTICAL':'EARTH CENTERED'}</strong><span>{config.mission_type==='lunar'?'Bodies enlarged / path to scale':config.mission_type==='docking'?'Local relative motion':config.mission_type==='launch'?'Altitude exaggerated for visibility':'Vessel enlarged for visibility'}</span></div>
                <div className="scene-legend"><span><i className="lime-line"/>Flight path</span>{config.mission_type==='orbit'&&<span><i className="dashed-line"/>Target orbit</span>}<span className="scene-help">Drag to orbit / Scroll to zoom</span></div>
                {complete&&<div className="completion-card" role="status"><CheckCircle2 size={23}/><div><strong>{plan?.summary}</strong><span>Physics constraints met. Mission complete.</span></div></div>}
                {!plan&&!busy&&<div className="viewport-prompt"><span className="prompt-cross">+</span>Your next adventure starts with a flight plan.</div>}
              </div>
              <div className="playback"><button className="playback-toggle" aria-label={playing?'Pause playback':'Resume playback'} disabled={!plan?.feasible||busy||complete} onClick={()=>playing?setPlaying(false):void execute()}>{playing?<Pause size={16}/>:<Play size={16}/>}</button><span className="mission-clock">T+ {clock(elapsed)}</span><input aria-label="Mission timeline" type="range" min="0" max={plan?.duration_s||1} step="any" value={elapsed} disabled={!plan?.feasible||playing||busy} onChange={e=>{setElapsed(Number(e.target.value));setComplete(false);}}/><select aria-label="Playback speed" value={warp} onChange={e=>setWarp(e.target.value)}><option value="demo">30 s demo</option><option value="fast">10 s demo</option><option value="real">Real time</option></select><button className="icon-button" aria-label="Reset flight" disabled={!plan||busy} onClick={resetFlight}><RotateCcw size={15}/></button></div>
              <div className="flight-program"><div className="card-heading"><div><span className="section-label">FLIGHT PROGRAM</span><h2>{plan?'A calculated path forward.':'Ready when you are.'}</h2></div><span className="model-chip"><CircleDot size={12}/> {config.mission_type==='docking'?'PD CONTROL':config.mission_type==='launch'?'ASCENT MODEL':'NEWTONIAN PHYSICS'}</span></div>
                <div className="burn-grid">{(plan?.burns??[{name:'Calculate trajectory',description:'Aether checks your objective and physics.',at_s:0,delta_v_m_s:0},{name:'Verify & execute',description:'Review fuel, then let the autopilot fly.',at_s:0,delta_v_m_s:0}]).map((burn,i)=><div className={`burn-card ${plan&&elapsed>=burn.at_s&&elapsed>0?'burn-done':''}`} key={i}><div className="burn-number">{plan&&elapsed>=burn.at_s&&elapsed>0?<Check size={14}/>:String(i+1).padStart(2,'0')}</div><div><strong>{burn.name}</strong><p>{burn.description}</p><span>{plan?`T+ ${clock(burn.at_s)}  /  ${pretty(burn.delta_v_m_s,1)} m/s`:'AWAITING PLAN'}</span></div></div>)}</div>
                {plan&&<details className="assumptions"><summary><FlaskConical size={13}/>Model assumptions & limits<ChevronDown size={13}/></summary><ul>{plan.assumptions.map(a=><li key={a}>{a}</li>)}</ul><div className="knowledge-links">{plan.knowledge_ids.map(id=><button key={id} onClick={()=>{setTopicId(id);setView('knowledge');}}>{topics.find(t=>t.id===id)?.title??id}<ArrowUpRight size={11}/></button>)}</div></details>}
                <div className="program-footer"><span><ShieldCheck size={15}/>{plan?.feasible?'Physics checked. Ready for your go.':plan?'Physics check failed. Replan to continue.':'Every flight starts with a physics check.'}</span><button className="button primary" disabled={busy||playing||(!!plan&&!plan.feasible)} onClick={()=>plan?void execute():void send(mission?.objective??'Move from a 300 km orbit to an 800 km Earth orbit.')}>{busy?<Loader2 size={16} className="spin"/>:complete?<RotateCcw size={16}/>:<Play size={15}/>} {busy?'Calculating...':complete?'Fly again':running?'Resume mission':plan?'Execute mission':'Plan mission'}<ArrowRight size={15}/></button></div>
              </div>
              <div className="control-tiers">{[{tier:1,title:'Physics & control',sub:'Deterministic / no API calls',icon:Activity},{tier:2,title:'Reflex decisions',sub:activeProvider==='openai'?'Decisions API / on events':'Local rules / offline',icon:Zap},{tier:3,title:'Mission reasoning',sub:activeProvider==='openai'?'Responses API / on demand':activeProvider==='ollama'?'Open-weight / Ollama':'Scripted planner / offline',icon:Sparkles}].map(t=><button key={t.tier} onClick={()=>{setTopicId('control-hierarchy');setView('knowledge');}}><span className="tier-icon"><t.icon size={16}/></span><div><strong><small>0{t.tier}</small>{t.title}</strong><span>{t.sub}</span></div><ArrowUpRight size={13}/></button>)}</div>
            </div>
            <aside className="chat-panel"><div className="chat-heading"><div className="avatar-small"><img src={appUrl("/aether-avatar.png")} alt="Aether AI companion"/></div><div><h2>Aether copilot <span className="status-dot"/></h2><span>{activeProvider==='demo'?'Offline planner':activeProvider==='ollama'?'Local open-weight agent':'OpenAI mission agent'}</span></div><Sparkles size={17}/></div>
              <div className="chat-disclosure"><span className="tiny-dot"/>{activeProvider==='demo'?'DEMO MODE / RULE-BASED PLANNING':activeProvider==='ollama'?'LOCAL MODEL / PHYSICS TOOLS':'LIVE AI / PHYSICS TOOLS'}</div>
              <div className="chat-messages" aria-live="polite">{messages.map((m,i)=><div className={`message ${m.role}`} key={i}>{m.role==='assistant'&&<span className="message-sender"><img src={appUrl("/favicon.png")} alt=""/>AETHER</span>}<div className="message-content">{m.content}</div>{m.trace&&<details className="message-trace"><summary><Layers3 size={12}/>{m.trace.length} verified steps<ChevronDown size={12}/></summary>{m.trace.map((t,j)=><div className="trace-step" key={j}><Check size={11}/><span>{t.name}</span><code>{t.duration_ms}ms</code></div>)}</details>}</div>)}{busy&&<div className="thinking"><span/><span/><span/><span>Consulting the flight stack</span></div>}<div ref={chatEnd}/></div>
              <div className="chat-actions">{!plan&&<button disabled={busy||playing} onClick={()=>void send(mission?.objective??'Transfer to an 800 km Earth orbit.')}><Sparkles size={13}/>Plan this mission<ArrowUpRight size={12}/></button>}{plan&&<><button disabled={busy||playing} onClick={()=>void send('Explain the physics behind this flight plan.')}><BookOpen size={13}/>Explain the physics</button><button className="anomaly-button" disabled={busy||playing} onClick={()=>void send('We have a fuel leak. Only 10% of our current fuel remains. Recalculate and tell me if we can proceed.')}><TriangleAlert size={13}/>Inject fuel leak</button></>}</div>
              <form className="chat-input" onSubmit={onSubmit}><textarea aria-label="Message Aether" rows={2} placeholder={playing?'Pause the flight to replan...':'Tell Aether your mission...'} value={input} disabled={busy||playing} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send();}}}/><div><span><span className="keyboard-key">Enter</span> to send</span><button type="submit" aria-label="Send message" disabled={!input.trim()||busy||playing}><ArrowUpRight size={17}/></button></div></form>
              <p className="chat-note">The agent plans. The physics engine verifies.</p>
            </aside>
          </div>
          {complete&&<div className="report-banner"><div><CheckCircle2 size={18}/><strong>Mission report ready.</strong><span>Keep the computed outcome and decision trace.</span></div><button onClick={downloadReport}><Download size={15}/>Download report</button></div>}
        </>}

        {view==='knowledge'&&<div className="knowledge-layout"><div className="topic-list"><label className="search-label"><BookOpen size={16}/><input aria-label="Search physics library" placeholder="Search the physics library..." value={search} onChange={e=>setSearch(e.target.value)}/></label>{filteredTopics.map(t=><button className={topicId===t.id?'selected':''} key={t.id} onClick={()=>setTopicId(t.id)}><span>{t.category}</span><strong>{t.title}</strong><ArrowUpRight size={15}/></button>)}{!filteredTopics.length&&<p className="empty-state">No topics match. Try gravity, fuel or control.</p>}</div><div className="topic-content">{selectedTopic&&<PhysicsTopic topic={selectedTopic} topics={topics} onSelect={setTopicId}/>}</div></div>}
        {view==='log'&&<div className="log-panel"><div className="card-heading"><div><span className="section-label">OBSERVABLE AUTONOMY</span><h2>Flight stack activity</h2></div><button className="button secondary" disabled={!plan} onClick={downloadReport}><Download size={15}/>Export report</button></div>{traces.length?traces.map((t,i)=><details className="log-entry" key={i}><summary><span className={`tier-badge tier-${t.tier}`}>T{t.tier}</span><strong>{t.name}</strong><span>{t.duration_ms} ms</span><ChevronDown size={15}/></summary><pre>{JSON.stringify(t.output,null,2)}</pre></details>):<div className="empty-log"><Terminal size={30}/><h3>No flight activity yet.</h3><p>Plan a mission to see the actual knowledge lookups, calculations and agent calls.</p><button className="button primary" onClick={()=>setView('control')}>Open mission control<ArrowRight size={15}/></button></div>}</div>}
        <footer className="page-footer"><span><span className="tiny-dot"/>AETHER MISSION CONTROL</span><span>Made for the next frontier. <span className="footer-separator">/</span> Educational simulation</span><button onClick={()=>{setTopicId('control-hierarchy');setView('knowledge');}}>Powered by physics <ArrowUpRight size={12}/></button></footer>
      </main>
    </div>
    {modal&&<div className="modal-backdrop" onClick={()=>setModal(null)}><section className="modal" role="dialog" aria-modal="true" aria-label={modal==='missions'?'Choose your mission':'Mission settings'} onClick={e=>e.stopPropagation()}><button className="modal-close" aria-label="Close dialog" onClick={()=>setModal(null)}><X size={20}/></button>{modal==='missions'?<><span className="eyebrow">CHOOSE YOUR NEXT CHAPTER</span><h2>Where shall we go?</h2><p>Four focused missions. One physics-powered copilot.</p><div className="mission-options">{missions.map(m=>{const Icon=missionIcons[m.id];return <button key={m.id} onClick={()=>selectMission(m)}><Icon size={25}/><h3>{m.name}</h3><p>{m.subtitle}</p><span>{m.model}<ArrowUpRight size={14}/></span></button>;})}</div></>:<Settings config={config} setConfig={c=>{setConfig(c);setPlan(null);resetFlight();setModal(null);}} offline={offline} setOffline={setOffline} health={health}/>}</section></div>}
  </div>;
}

function Stat({icon,label,value,unit,detail}:{icon:React.ReactNode;label:string;value:string;unit:string;detail:string}) { return <div className="stat-card"><div className="stat-label">{icon}{label}</div><div className="stat-value">{value}<span>{unit}</span></div><p>{detail}</p></div>; }
function Settings({config,setConfig,offline,setOffline,health}:{config:Config;setConfig:(c:Config)=>void;offline:boolean;setOffline:(v:boolean)=>void;health:Health|null}) {
  const [draft,setDraft]=useState(config);
  const fields: {key:keyof Config;label:string;min:number;max:number;step?:number}[]=[{key:'fuel_kg',label:'Fuel (kg)',min:0,max:20000},{key:'payload_kg',label:'Payload (kg)',min:0,max:10000},{key:'dry_mass_kg',label:'Dry mass (kg)',min:100,max:20000},{key:'isp_s',label:'Specific impulse (s)',min:100,max:500},...(config.mission_type==='orbit'?[{key:'start_altitude_km' as const,label:'Starting altitude (km)',min:160,max:2000},{key:'target_altitude_km' as const,label:'Target altitude (km)',min:180,max:40000}]:[]),...(config.mission_type==='docking'?[{key:'station_rpm' as const,label:'Station rotation (rpm)',min:0.05,max:1,step:0.05}]:[])];
  return <><span className="eyebrow">SPACECRAFT CONFIGURATION</span><h2>Set up your flight.</h2><p>Changing a parameter clears the previous plan.</p><form onSubmit={e=>{e.preventDefault();setConfig(draft);}}><div className="settings-grid">{fields.map(f=><label key={f.key}>{f.label}<input required type="number" min={f.min} max={f.max} step={f.step??1} value={draft[f.key]} onChange={e=>setDraft({...draft,[f.key]:Number(e.target.value)})}/></label>)}</div><label className="offline-toggle"><input type="checkbox" checked={offline} onChange={e=>setOffline(e.target.checked)}/><span><strong>Use offline planner</strong><small>Rule-based planning, no model calls. Server provider: {health?.provider??'unavailable'}.</small></span></label><p className="settings-secret">API credentials stay on the server in .env. No keys are sent to your browser.</p><button className="button primary" type="submit">Save configuration<Check size={16}/></button></form></>;
}

import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import type { Topic } from './types';
import './physics-library.css';

export default function PhysicsTopic({ topic, topics, onSelect }: { topic: Topic; topics: Topic[]; onSelect: (id: string) => void }) {
  const status = topic.simulation_status ?? 'reference_only';
  const labels = { implemented: 'Implemented', simplified: 'Simplified model', reference_only: 'Reference only' };
  return <>
    <div className="eyebrow">CONNECTED PHYSICS KNOWLEDGE</div>
    <h2>{topic.title}</h2>
    <div className={`physics-status physics-status-${status}`}>{labels[status]}</div>
    <p className="topic-summary">{topic.summary}</p>
    <div className="equation">{topic.equation}</div>
    <p>{topic.details}</p>
    {topic.regime && <div className="physics-regime"><strong>Validity regime</strong><p>{topic.regime}</p></div>}
    {topic.assumptions?.length && <><h3>Assumptions</h3><ul className="physics-conditions">{topic.assumptions.map(a => <li key={a}>{a}</li>)}</ul></>}
    {topic.limitations?.length && <><h3>Limits of this equation</h3><ul className="physics-conditions">{topic.limitations.map(a => <li key={a}>{a}</li>)}</ul></>}
    {topic.simulation_notes && <div className="physics-implementation"><strong>In this simulator</strong><p>{topic.simulation_notes}</p></div>}
    <h3>Connected concepts</h3>
    <div className="concept-graph">
      <svg viewBox="0 0 600 180" aria-hidden="true">{topic.related.map((_, i) => <line key={i} x1="300" y1="40" x2={topic.related.length === 1 ? 300 : 100 + i * 400 / (topic.related.length - 1)} y2="135"/>)}</svg>
      <div className="graph-root">{topic.title}</div>
      <div className="graph-children">{topic.related.map(id => <button key={id} onClick={() => onSelect(id)}>{topics.find(t => t.id === id)?.title}<ArrowUpRight size={12}/></button>)}</div>
    </div>
    <h3>Primary references</h3>
    <div className="source-list">{topic.sources.map(s => <a key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.title}<ArrowUpRight size={15}/></a>)}</div>
    <div className="knowledge-note"><ShieldCheck size={16}/>The agent retrieves this equation together with its validity regime and implementation status.</div>
  </>;
}

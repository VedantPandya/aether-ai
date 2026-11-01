import { useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, Search } from 'lucide-react';
import { api, type Topic } from './types';
import PhysicsTopic from './PhysicsTopic';
import './physics-page.css';

export default function PhysicsLibrary() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selected, setSelected] = useState('gravity');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { api<Topic[]>('knowledge').then(setTopics).catch(e => setError(e.message)); }, []);
  const normalize = (s: string) => s.normalize('NFKD').toLowerCase().replace(/[-_\u2010-\u2015]/g, ' ');
  const words = normalize(search).trim().split(/\s+/).filter(Boolean);
  const filtered = topics.filter(t => {
    const text = normalize([t.id, t.title, t.category, t.summary, t.details, t.equation, ...(t.keywords ?? [])].join(' '));
    return (!category || t.category === category) && words.every(w => text.includes(w));
  });
  const topic = topics.find(t => t.id === selected);
  return <main className="physics-library-page">
    <header className="physics-page-header"><a href="/"><ArrowLeft size={16}/>Workspace</a><span><BookOpen size={16}/>Physics library</span><strong className="physics-topic-count">{topics.length} topics</strong></header>
    <section className="physics-page-intro"><div className="eyebrow">AETHER / SOURCED KNOWLEDGE</div><h1>From Newton to spacetime.</h1><p>Equations, assumptions and limits for the mission-planning agent. Reference knowledge is labelled separately from implemented simulation models.</p></section>
    {error && <p role="alert">Could not load the physics library: {error}</p>}
    <div className="knowledge-layout">
      <nav className="topic-list" aria-label="Physics topics">
        <label className="search-label"><Search size={15}/><input aria-label="Search physics library" placeholder="Search concepts or equations…" value={search} onChange={e => setSearch(e.target.value)}/></label>
        <select aria-label="Filter physics category" value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{[...new Set(topics.map(t => t.category))].sort().map(c => <option key={c}>{c}</option>)}</select>
        <p className="physics-result-count">{filtered.length} matching topics</p>
        {filtered.map(t => <button key={t.id} className={selected === t.id ? 'selected' : ''} onClick={() => setSelected(t.id)}><span>{t.category}</span><strong>{t.title}</strong></button>)}
        {!!topics.length && !filtered.length && <p>No matches. Try “staging”, “docking”, or “time dilation”.</p>}
      </nav>
      <article className="topic-content">{topic ? <PhysicsTopic topic={topic} topics={topics} onSelect={setSelected}/> : !error && <p role="status">Loading physics topics…</p>}</article>
    </div>
  </main>;
}

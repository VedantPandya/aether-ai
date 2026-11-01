import type { LiveAction, LiveEntry, LivePanel, LiveStatus } from './kit';

/**
 * In-browser three-layer flight stack, mirroring backend/autonomy for scenes the backend does not run:
 *   L1 control executes a tunable program every step and enforces local guards,
 *   L2 reflex classifies the state on a fixed cadence (deterministic rules, recorded with latency),
 *   L3 strategy rolls candidate programs forward on a copy of the plant and applies the best admissible one.
 * Nothing here is pre-recorded: faults change the plant, and the controller program changes in response.
 */
export type Layer = 1 | 2 | 3;
export type Tone = LiveEntry['tone'];
export interface Candidate<P> { program: P; label: string; admissible: boolean; score: number; reason: string }

export class FlightStack<P> {
  private list: LiveEntry[] = [];
  private nextId = 0;
  private moodState: { mood: string; at: number } | null = null;
  status: LiveStatus = { state: 'live', ai: false, aiAvailable: false, provider: 'browser', summary: '', activeLayer: null };
  pendingStrategy: { at: number; why: string } | null = null;
  faults: string[] = [];
  private checks = 0;
  private lastAct: Record<string, number> = {};
  private story: { text: string; at: number } | null = null;

  /** `calm` narrates nominal flight; incidents override it for a few seconds. */
  constructor(public actions: LiveAction[], private handlers: { act(id: string): void; restart(): void }, private calm: () => string) {}

  log(layer: Layer | null, tone: Tone, title: string, detail: string | undefined, t: number, mood?: string, tech?: string) {
    if (layer) this.status = { ...this.status, activeLayer: layer };
    if (mood) this.moodState = { mood, at: performance.now() };
    const last = this.list[0];
    if (last && last.title === title && last.detail === detail) { this.list = [{ ...last, t, count: (last.count ?? 1) + 1 }, ...this.list.slice(1)]; return; }
    this.list = [{ id: ++this.nextId, layer, tone, title, detail, tech, t }, ...this.list].slice(0, 40);
  }
  /** Set the headline: what is happening right now, in one plain sentence. */
  say(text: string) { this.story = { text, at: performance.now() }; }
  /** A routine reflex check found nothing: count it rather than list it. */
  ok() { this.checks++; this.status = { ...this.status, activeLayer: 2 }; }
  fault(id: string, title: string, detail: string, t: number) {
    this.faults.push(id); this.log(1, 'bad', `Fault: ${title}`, detail, t, 'panic'); this.say(`${detail} Holding course while the stack responds.`);
  }
  /** Escalate to strategy after a short local hold, like the backend's reflex → strategy hand-off. */
  escalate(why: string, t: number, delay = 1.2) {
    if (this.pendingStrategy) return;
    this.pendingStrategy = { at: t + delay, why };
    this.log(3, 'info', 'Looking for a better plan', why, t, 'thinking', 'strategy layer · forward rollouts');
    this.say(`${why}. Testing alternative plans before changing anything.`);
  }
  /** Run the strategic search: preview the leading candidates, apply the best admissible one, or report none. */
  decide(candidates: Candidate<P>[], t: number, apply: (p: P) => void, describe: (p: P) => string): Candidate<P> | null {
    this.pendingStrategy = null;
    const ranked = [...candidates].sort((a, b) => Number(b.admissible) - Number(a.admissible) || b.score - a.score);
    const rejected = candidates.filter(c => !c.admissible).length;
    const best = ranked.find(c => c.admissible) ?? null;
    if (best) {
      apply(best.program); this.faults = [];
      this.log(1, 'good', 'New plan adopted', `Picked the best of ${candidates.length} options${rejected ? `; ${rejected} failed the safety check` : ''}. ${best.reason}.`, t, 'editing', `${best.label} · ${describe(best.program)}`);
      this.say(`New plan adopted: ${best.label}. Back on track.`);
    } else {
      this.log(3, 'bad', 'No safe plan found', `All ${candidates.length} options failed the safety check.`, t, 'worried', ranked[0]?.reason);
      this.say('No safe plan found. Holding position.');
    }
    return best;
  }
  end(summary: string, good: boolean, t: number) {
    if (this.status.state === 'ended') return;
    this.status = { ...this.status, state: 'ended', summary };
    this.log(1, good ? 'good' : 'bad', good ? summary : `Ended: ${summary}`, undefined, t);
    this.moodState = { mood: good ? 'success' : 'worried', at: performance.now() + 1e9 };
  }
  reset() { this.list = []; this.moodState = null; this.pendingStrategy = null; this.faults = []; this.checks = 0; this.story = null; this.status = { ...this.status, state: 'live', summary: '', activeLayer: null }; }
  panel(): LivePanel {
    return {
      entries: () => this.list, status: () => this.status, actions: this.actions,
      act: async id => {
        // A second click on the same fault within a few seconds is almost always a double-click, not a new emergency.
        const now = performance.now(); if (this.status.state !== 'live' || now - (this.lastAct[id] ?? -1e9) < 4000) return;
        this.lastAct[id] = now; this.handlers.act(id);
      },
      restart: async () => { this.reset(); this.handlers.restart(); },
      mood: () => this.moodState && performance.now() - this.moodState.at < 4500 ? this.moodState.mood : null,
      headline: () => this.status.state === 'ended' ? this.status.summary
        : this.pendingStrategy || (this.story && performance.now() - this.story.at < 9000) ? this.story?.text ?? this.calm() : this.calm(),
      routine: () => this.checks,
    };
  }
}

/** Discrete PID with clamped integral (anti-windup). */
export class Pid {
  integral = 0; private last: number | null = null;
  constructor(public kp: number, public ki: number, public kd: number, private iLimit = 1) {}
  step(error: number, dt: number, rate?: number) {
    if (dt <= 0) return this.kp * error + this.ki * this.integral;
    this.integral = Math.max(-this.iLimit, Math.min(this.iLimit, this.integral + error * dt));
    const d = rate ?? (this.last === null ? 0 : (error - this.last) / dt); this.last = error;
    return this.kp * error + this.ki * this.integral + this.kd * d;
  }
  tune(kp: number, ki: number, kd: number) { this.kp = kp; this.ki = ki; this.kd = kd; }
  reset() { this.integral = 0; this.last = null; }
}

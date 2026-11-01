import { useEffect, useRef, useState } from 'react';
import type { AgentRun, RunEvent } from './harnessTypes';

// v2 sheets (docs/AVATAR-SPRITES-V2.md): 4 x 8 grid; each row holds two expressions as left/right pairs.
const SHEET_A = ['neutral','blink','curious','thinking','calculating','eureka','explaining','listening','happy','laughing','excited','proud','confident','wink','smug','skeptical'] as const;
const SHEET_B = ['surprised','shocked','worried','fuel-panic','oops','embarrassed','confused','dizzy','frustrated','grumpy','sad','crying','relieved','determined','sleepy','asleep'] as const;
export type Expression = typeof SHEET_A[number] | typeof SHEET_B[number];
export type Facing = 'left' | 'right';

// The generated sheets do not place the orb consistently: sheet B drifts ~23% of a cell from top row to bottom.
// Per-cell [dx, dy, scale] (cell fractions) re-centre every orb at one size; measured by scripts/measure-sprites.mjs.
const REGISTRATION: Record<'a' | 'b', [number, number, number][]> = {
  a: [[-0.0221,-0.091,1.0542],[0.012,-0.0899,1.0432],[-0.0081,-0.0929,1.0444],[0.0176,-0.0921,1.0397],[-0.0202,-0.0721,1.0277],[0.012,-0.0723,1.0155],[-0.0141,-0.0665,1.0112],[0.0129,-0.0711,1.0161],[-0.021,-0.0667,1.0043],[0.0103,-0.0686,1.0058],[-0.007,-0.0666,0.9981],[0.0169,-0.0669,1],[-0.0178,-0.0591,0.9918],[0.0109,-0.0594,0.9933],[-0.0113,-0.0594,0.989],[0.0157,-0.0622,0.9937],[-0.0161,-0.0561,0.985],[0.0115,-0.0551,0.9801],[-0.0086,-0.0564,0.9797],[0.0153,-0.0607,0.9843],[-0.0169,-0.0431,0.9722],[0.01,-0.0432,0.9702],[-0.0111,-0.0536,0.9836],[0.0142,-0.053,0.9874],[-0.0143,-0.0442,0.9804],[0.0106,-0.0439,0.9797],[-0.0094,-0.0464,0.9736],[0.015,-0.0482,0.978],[-0.0153,-0.0414,0.9813],[0.0125,-0.0407,0.9785],[-0.0097,-0.0412,0.9741],[0.0142,-0.0386,0.9806]],
  b: [[-0.0406,-0.1008,1.0458],[-0.0008,-0.0984,1.0377],[0.0097,-0.0987,1.0365],[0.0366,-0.0971,1.0309],[-0.0419,-0.0628,1.0306],[-0.0012,-0.0612,1.0222],[0.0086,-0.0637,1.0243],[0.0345,-0.0615,1.0193],[-0.0391,-0.0279,1.0195],[-0.0048,-0.0266,1.012],[0.0087,-0.0267,1.0168],[0.0343,-0.0261,1.006],[-0.041,0.0064,1.013],[-0.0034,0.0073,1.0042],[0.0056,0.0064,1.0074],[0.0343,0.0072,1.0057],[-0.0402,0.0371,1.0088],[-0.0024,0.0377,1.0031],[0.0069,0.0369,1.0068],[0.0326,0.0371,1.0011],[-0.0407,0.0718,0.9981],[-0.0037,0.072,0.9911],[0.0015,0.0709,0.9974],[0.0323,0.071,0.9932],[-0.0392,0.1016,0.9992],[-0.0026,0.1029,0.9959],[0.0029,0.1017,0.9981],[0.0326,0.1025,0.9963],[-0.0385,0.1338,1.005],[-0.0024,0.1337,0.9998],[0.0013,0.1342,1.0054],[0.0326,0.1338,0.9994]],
};

function cell(expression: Expression, facing: Facing) {
  const a = (SHEET_A as readonly string[]).indexOf(expression), index = a >= 0 ? a : (SHEET_B as readonly string[]).indexOf(expression);
  const row = Math.floor(index / 2), column = (index % 2) * 2 + (facing === 'right' ? 1 : 0), sheet = a >= 0 ? 'a' : 'b';
  const [dx, dy, scale] = REGISTRATION[sheet][row * 4 + column];
  return { sheet, x: column / 3 * 100, y: row / 7 * 100, transform: `translate(${(dx * 100).toFixed(2)}%, ${(dy * 100).toFixed(2)}%) scale(${scale})` };
}

type Step = [Expression, number];
const SEQUENCES = {
  listening:  [['listening',1300],['blink',120],['curious',900],['listening',1100],['happy',700]],
  thinking:   [['thinking',800],['calculating',600],['thinking',500],['blink',120],['curious',500],['determined',600]],
  reading:    [['curious',700],['listening',500],['thinking',600],['blink',120]],
  editing:    [['confident',600],['explaining',500],['determined',600],['wink',400]],
  running:    [['calculating',500],['determined',400],['thinking',450],['calculating',500]],
  simulating: [['excited',600],['eureka',500],['calculating',500],['excited',400]],
  explaining: [['explaining',600],['happy',400],['explaining',500],['blink',120]],
  oops:       [['oops',800],['embarrassed',700],['confused',600],['determined',700]],
  panic:      [['fuel-panic',500],['shocked',400],['worried',600],['fuel-panic',500]],
  success:    [['excited',600],['laughing',600],['proud',800],['happy',700],['wink',500],['smug',1400]],
  done:       [['proud',1500],['blink',130],['smug',1000],['happy',900]],
  worried:    [['worried',1100],['sad',800],['blink',130],['determined',900]],
  sleepy:     [['sleepy',1600],['asleep',2400],['blink',300],['sleepy',1200]],
  poked:      [['surprised',350],['laughing',700],['happy',600]],
  dizzy:      [['dizzy',900],['confused',600],['relieved',700]],
} satisfies Record<string, Step[]>;
// Idle is not a fixed loop: it wanders through friendly expressions, blinking in between, so the orb never feels canned.
const IDLE_POOL: Expression[] = ['neutral','neutral','neutral','curious','listening','happy','wink','proud','thinking','laughing','smug','confident','eureka','relieved','skeptical'];
export type Mood = keyof typeof SEQUENCES | 'idle';

const TOOL_MOODS: Record<string, Mood> = { list_files:'reading', find_files:'reading', read_file:'reading', grep:'reading', search_physics:'reading', write_file:'editing', edit_file:'editing', delete_file:'editing', run_python:'running', run_tests:'running', plan_mission:'running', simulate_mission:'simulating', update_plan:'thinking' };

/** Map live run state to a mood, so the avatar reflects what the harness is actually doing. */
export function moodFor(run: AgentRun | null, events: RunEvent[], working: boolean): Mood {
  if (!run) return 'idle';
  const last = events.at(-1);
  if (working) {
    if (!last || ['model_start', 'thinking', 'status', 'model_end'].includes(last.type)) return 'thinking';
    if (last.type === 'tool_start') return TOOL_MOODS[last.data.name] ?? 'running';
    if (last.type === 'tool_end' && !last.data.ok) return /feasib|fuel|blocked/i.test(JSON.stringify(last.data.result ?? '')) ? 'panic' : 'oops';
    if (last.type === 'message') return 'explaining';
    return 'thinking';
  }
  if (run.status === 'completed') {
    const tests = events.filter(e => e.type === 'tool_end' && e.data.name === 'run_tests').at(-1)?.data.result?.tests as { passed: boolean }[] | undefined;
    return tests?.length && tests.every(t => t.passed) ? 'success' : 'done';
  }
  if (run.status === 'failed') return 'worried';
  if (run.status === 'limited') return 'panic';
  if (['cancelled', 'interrupted'].includes(run.status)) return 'sleepy';
  return 'idle';
}

function nextIdle(previous: Expression): Step {
  if (previous !== 'blink' && Math.random() < .45) return ['blink', 130];
  let pick = previous;
  while (pick === previous) pick = IDLE_POOL[Math.floor(Math.random() * IDLE_POOL.length)];
  return [pick, pick === 'neutral' ? 1800 + Math.random() * 1800 : 900 + Math.random() * 1100];
}

/** Facing is owned by the caller: the orb only turns when someone tells it to, never on its own. */
export default function AetherSprite({ mood, size = 40, facing = 'left', className = '' }: { mood: Mood; size?: number; facing?: Facing; className?: string }) {
  const [frame, setFrame] = useState<Step>(['neutral', 1200]), [tick, setTick] = useState(0);
  const step = useRef(0);
  useEffect(() => { step.current = 0; setFrame(mood === 'idle' ? ['neutral', 1400] : SEQUENCES[mood][0]); setTick(t => t + 1); }, [mood]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (mood === 'idle') setFrame(f => nextIdle(f[0]));
      else { step.current = (step.current + 1) % SEQUENCES[mood].length; setFrame(SEQUENCES[mood][step.current]); }
      setTick(t => t + 1);
    }, frame[1]);
    return () => clearTimeout(timer);
  }, [tick, frame, mood]);
  const c = cell(frame[0], facing);
  return <span role="img" aria-label={`Aether looks ${frame[0].replace('-', ' ')}`} data-mood={mood} className={`aether-sprite ${className}`} style={{ width: size, height: size }}>
    <span className={`aether-frame sheet-${c.sheet}`} style={{ backgroundPosition: `${c.x}% ${c.y}%`, transform: c.transform }} />
  </span>;
}

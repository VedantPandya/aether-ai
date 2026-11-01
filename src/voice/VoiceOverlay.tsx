import { useEffect, useRef } from 'react';
import { Mic, MicOff, X } from 'lucide-react';
import type { useVoice } from './useVoice';

type Voice = ReturnType<typeof useVoice>;
// Palette follows the avatar: lime eyes, ivory shell, plus a cool and a warm accent for depth.
const WAVES = [
  { color: [215, 242, 126], speed: .9, frequency: 6, amp: 1 },
  { color: [140, 214, 255], speed: -1.25, frequency: 4.4, amp: .8 },
  { color: [190, 160, 255], speed: 1.6, frequency: 8.2, amp: .62 },
  { color: [255, 196, 128], speed: -.7, frequency: 3.4, amp: .5 },
];

/** Who is talking, from audio energy, so the UI reacts even before captions arrive. */
export function talker(v: { input: number; output: number }) { return v.output > .06 ? 'assistant' : v.input > .07 ? 'user' : 'none'; }

export default function VoiceOverlay({ voice, speaker, onSpeaker }: { voice: Voice; speaker: 'assistant' | 'user' | 'none'; onSpeaker: (s: 'assistant' | 'user' | 'none') => void }) {
  const canvas = useRef<HTMLCanvasElement>(null), glow = useRef<HTMLDivElement>(null), speakerRef = useRef(onSpeaker); speakerRef.current = onSpeaker;
  const levelsRef = useRef(voice.levels); levelsRef.current = voice.levels;
  const stateRef = useRef(voice.state); stateRef.current = voice.state;

  useEffect(() => {
    const c = canvas.current!, g = c.getContext('2d')!, root = document.documentElement;
    let frame = 0, phase = 0, smooth = 0, out = 0, last = performance.now(), speaker = 'none';
    const draw = (now: number) => {
      const dt = Math.min(.05, (now - last) / 1000); last = now;
      const lv = levelsRef.current(), connecting = stateRef.current === 'connecting';
      const target = connecting ? .18 + .1 * Math.sin(now / 300) : Math.max(lv.input, lv.output);
      smooth += (target - smooth) * (target > smooth ? .35 : .08); out += (lv.output - out) * .25;
      phase += dt * (2.2 + smooth * 6);
      root.style.setProperty('--voice-level', smooth.toFixed(3)); root.style.setProperty('--voice-out', out.toFixed(3));
      const next = talker(lv); if (next !== speaker) { speaker = next; speakerRef.current(next as never); }

      const dpr = Math.min(devicePixelRatio, 2), w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h); g.globalCompositeOperation = 'lighter';
      const mid = h / 2, base = .04 + smooth * .96;
      for (const wave of WAVES) {
        const amplitude = h * .42 * base * wave.amp;
        g.beginPath(); g.moveTo(0, mid);
        for (let px = 0; px <= w; px += 3) {
          const x = (px / w) * 4 - 2, attenuation = (4 / (4 + x ** 4)) ** 4; // Siri-style envelope: loud centre, silent edges
          g.lineTo(px, mid + Math.sin(x * wave.frequency - phase * wave.speed) * amplitude * attenuation);
        }
        g.lineTo(w, mid); g.closePath();
        const [r, gr, b] = wave.color, fill = g.createLinearGradient(0, mid - h / 2, 0, mid + h / 2);
        fill.addColorStop(0, `rgba(${r},${gr},${b},0)`); fill.addColorStop(.5, `rgba(${r},${gr},${b},${.22 + smooth * .3})`); fill.addColorStop(1, `rgba(${r},${gr},${b},0)`);
        g.fillStyle = fill; g.fill();
        g.strokeStyle = `rgba(${r},${gr},${b},${.55 + smooth * .45})`; g.lineWidth = 1.6; g.stroke();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); root.style.removeProperty('--voice-level'); root.style.removeProperty('--voice-out'); };
  }, []);

  const lastAssistant = [...voice.captions].reverse().find(c => c.role === 'assistant'), lastUser = [...voice.captions].reverse().find(c => c.role === 'user');
  const label = voice.state === 'connecting' ? 'Connecting to Aether…' : voice.state === 'closing' ? 'Wrapping up…' : voice.state === 'error' ? 'Voice unavailable' : speaker === 'assistant' ? 'Aether is speaking' : voice.muted ? 'Microphone muted' : 'Listening';
  return <div className={`voice-overlay ${voice.state}`} role="dialog" aria-modal="true" aria-label="Voice conversation with Aether">
    <div ref={glow} className="voice-edge" aria-hidden="true"><span><i /></span><span><i /></span></div>
    <div className="voice-stage">
      <div className="voice-captions" aria-live="polite">
        {voice.state === 'error'
          ? <p className="voice-error">{voice.error}</p>
          : <>{lastUser && <p className="voice-user" key={`u${lastUser.id}`}>{lastUser.text}</p>}
              {lastAssistant ? <p className="voice-assistant" key={`a${lastAssistant.id}`}>{lastAssistant.text}</p> : voice.state === 'live' && <p className="voice-hint">Say hello. You can interrupt anytime.</p>}</>}
      </div>
      <canvas ref={canvas} className="voice-wave" aria-hidden="true" />
      <div className="voice-status"><span className="voice-dot" />{label}</div>
      <div className="voice-controls">
        <button className={`voice-mute ${voice.muted ? 'on' : ''}`} aria-pressed={voice.muted} aria-label={voice.muted ? 'Unmute microphone' : 'Mute microphone'} disabled={voice.state !== 'live'} onClick={voice.toggleMute}>{voice.muted ? <MicOff size={20} /> : <Mic size={20} />}</button>
        <button className="voice-end" aria-label="End voice conversation" onClick={() => voice.state === 'error' ? voice.dismissError() : void voice.stop()}><X size={22} /></button>
      </div>
      {voice.error && voice.state !== 'error' && <p className="voice-warning">{voice.error}</p>}
    </div>
  </div>;
}

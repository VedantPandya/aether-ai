import { appUrl } from '../urls';
import { useCallback, useEffect, useRef, useState } from 'react';

// Client side of docs/VOICE_MODE.md: WebRTC media for speech, the oai-events data channel for captions and control.
export type VoiceState = 'idle' | 'connecting' | 'live' | 'closing' | 'error';
export interface Caption { id: number; role: 'user' | 'assistant'; text: string; endMs: number }
export interface VoiceStatus { key_configured: boolean; model: string; voice: string }

const GAP_MS = 1400; // fragments further apart than this start a new caption

function analyser(ctx: AudioContext, stream: MediaStream) {
  const node = ctx.createAnalyser(); node.fftSize = 512; node.smoothingTimeConstant = .6;
  ctx.createMediaStreamSource(stream).connect(node);
  const data = new Uint8Array(node.fftSize);
  return () => { node.getByteTimeDomainData(data); let sum = 0; for (const v of data) sum += ((v - 128) / 128) ** 2; return Math.min(1, Math.sqrt(sum / data.length) * 4.5); };
}

export function useVoice() {
  const [state, setState] = useState<VoiceState>('idle'), [error, setError] = useState(''), [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState<Caption[]>([]), [status, setStatus] = useState<VoiceStatus | null>(null);
  const pc = useRef<RTCPeerConnection | null>(null), dc = useRef<RTCDataChannel | null>(null), mic = useRef<MediaStream | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null), ctx = useRef<AudioContext | null>(null);
  const meters = useRef<{ input?: () => number; output?: () => number }>({}), closed = useRef<(() => void) | null>(null), captionId = useRef(0);

  useEffect(() => { fetch(appUrl('/api/voice/status')).then(r => r.ok ? r.json() : null).then(setStatus).catch(() => setStatus(null)); }, []);

  const release = useCallback(() => {
    mic.current?.getTracks().forEach(t => t.stop()); mic.current = null;
    dc.current?.close(); dc.current = null; pc.current?.close(); pc.current = null;
    if (audio.current) { audio.current.srcObject = null; audio.current = null; }
    void ctx.current?.close(); ctx.current = null; meters.current = {};
  }, []);

  const addFragment = useCallback((role: Caption['role'], text: string, start: number, end: number) => {
    setCaptions(list => {
      const last = [...list].reverse().find(c => c.role === role);
      if (last && start - last.endMs < GAP_MS) return list.map(c => c === last ? { ...c, text: c.text + text, endMs: end } : c);
      return [...list, { id: ++captionId.current, role, text: text.trimStart(), endMs: end }].slice(-12);
    });
  }, []);

  const start = useCallback(async () => {
    if (pc.current) return;
    setError(''); setCaptions([]); setMuted(false); setState('connecting');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot capture audio. Use a current browser on localhost or HTTPS.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      mic.current = stream;
      const audioCtx = new AudioContext(); ctx.current = audioCtx; meters.current.input = analyser(audioCtx, stream);
      const peer = new RTCPeerConnection(); pc.current = peer;
      stream.getTracks().forEach(t => peer.addTrack(t, stream));
      const player = new Audio(); player.autoplay = true; audio.current = player;
      peer.ontrack = e => { player.srcObject = e.streams[0]; meters.current.output = analyser(audioCtx, e.streams[0]); void player.play().catch(() => setError('Tap anywhere to allow audio playback.')); };
      peer.onconnectionstatechange = () => { if (['failed', 'disconnected'].includes(peer.connectionState) && pc.current === peer) { setError('Voice connection lost.'); setState('error'); release(); } };
      // Register channel handlers before the offer, as the contract requires.
      const channel = peer.createDataChannel('oai-events'); dc.current = channel;
      channel.onmessage = e => {
        let event: any; try { event = JSON.parse(e.data); } catch { return; }
        if (event.type === 'session.started') setState('live');
        else if (event.type === 'session.input_transcript.delta') addFragment('user', event.delta ?? event.text ?? '', event.start_ms ?? 0, event.end_ms ?? 0);
        else if (event.type === 'session.output_transcript.delta') addFragment('assistant', event.delta ?? event.text ?? '', event.start_ms ?? 0, event.end_ms ?? 0);
        else if (event.type === 'session.closed') closed.current?.();
        else if (event.type === 'error') setError(event.error?.message ?? event.message ?? 'Voice session error.');
      };
      await peer.setLocalDescription(await peer.createOffer());
      await new Promise<void>(resolve => {
        if (peer.iceGatheringState === 'complete') return resolve();
        const timer = setTimeout(resolve, 3000);
        peer.addEventListener('icegatheringstatechange', () => { if (peer.iceGatheringState === 'complete') { clearTimeout(timer); resolve(); } });
      });
      const response = await fetch(appUrl('/api/voice/sessions'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sdp: peer.localDescription!.sdp }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : `Voice setup failed (${response.status}).`);
      if (pc.current !== peer) return;
      await peer.setRemoteDescription({ type: 'answer', sdp: body.transport.sdp });
    } catch (e) {
      const err = e as Error;
      setError(err.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in the browser to talk to Aether.' : err.message);
      setState('error'); release();
    }
  }, [addFragment, release]);

  const stop = useCallback(async () => {
    const channel = dc.current;
    if (!pc.current) { setState('idle'); return; }
    setState('closing');
    if (channel?.readyState === 'open') {
      // Keep media alive until the server confirms, bounded so a lost reply cannot hang the UI.
      await new Promise<void>(resolve => { closed.current = resolve; channel.send(JSON.stringify({ type: 'session.close' })); setTimeout(resolve, 4000); });
    }
    closed.current = null; release(); setState('idle');
  }, [release]);

  const toggleMute = useCallback(() => {
    const next = !muted; setMuted(next);
    mic.current?.getAudioTracks().forEach(t => { t.enabled = !next; });
    if (dc.current?.readyState === 'open') dc.current.send(JSON.stringify({ type: next ? 'session.input_audio.mute' : 'session.input_audio.unmute' }));
  }, [muted]);

  useEffect(() => () => { if (dc.current?.readyState === 'open') dc.current.send(JSON.stringify({ type: 'session.close' })); release(); }, [release]);

  /** Smoothed-on-read audio levels for animation; never stored in React state. */
  const levels = useCallback(() => ({ input: muted ? 0 : meters.current.input?.() ?? 0, output: meters.current.output?.() ?? 0 }), [muted]);
  return { state, error, muted, captions, status, start, stop, toggleMute, levels, dismissError: () => { setError(''); if (state === 'error') setState('idle'); } };
}

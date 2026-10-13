import { getUiPreference } from './preferences';

/**
 * Soft synthesized navigation sounds, in the spirit of a console UI. Nothing
 * is bundled: every cue is a few enveloped oscillators through a gentle
 * low-pass, kept quiet so it never competes with game audio.
 */
export type UiSound = 'move' | 'select' | 'back' | 'open' | 'close' | 'toggle' | 'error' | 'notify';

type ToneSpec = {
  frequency: number;
  endFrequency?: number;
  start?: number;
  duration: number;
  gain: number;
  type?: OscillatorType;
};

const RECIPES: Record<UiSound, ToneSpec[]> = {
  move: [
    { frequency: 1760, endFrequency: 1380, duration: 0.045, gain: 0.045 },
    { frequency: 3520, endFrequency: 2900, duration: 0.02, gain: 0.01, type: 'triangle' }
  ],
  select: [
    { frequency: 880, duration: 0.09, gain: 0.05 },
    { frequency: 1318.5, start: 0.05, duration: 0.15, gain: 0.045 }
  ],
  back: [{ frequency: 990, endFrequency: 640, duration: 0.11, gain: 0.045 }],
  open: [
    { frequency: 660, duration: 0.08, gain: 0.04 },
    { frequency: 990, start: 0.045, duration: 0.1, gain: 0.036 },
    { frequency: 1320, start: 0.09, duration: 0.17, gain: 0.032 }
  ],
  close: [{ frequency: 1100, endFrequency: 720, duration: 0.12, gain: 0.038 }],
  toggle: [{ frequency: 1480, duration: 0.05, gain: 0.036, type: 'triangle' }],
  error: [
    { frequency: 233, duration: 0.13, gain: 0.04, type: 'triangle' },
    { frequency: 196, start: 0.11, duration: 0.17, gain: 0.036, type: 'triangle' }
  ],
  notify: [
    { frequency: 1046.5, duration: 0.12, gain: 0.04 },
    { frequency: 1568, start: 0.08, duration: 0.22, gain: 0.034 }
  ]
};

const MOVE_THROTTLE_MS = 45;

let context: AudioContext | null = null;
let output: AudioNode | null = null;
let lastMoveAt = 0;

function audioGraph(): { context: AudioContext; output: AudioNode } | null {
  if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') return null;
  if (!context || !output) {
    context = new window.AudioContext({ latencyHint: 'interactive' });
    const master = context.createGain();
    master.gain.value = 0.6;
    const softener = context.createBiquadFilter();
    softener.type = 'lowpass';
    softener.frequency.value = 5200;
    master.connect(softener);
    softener.connect(context.destination);
    output = master;
  }
  if (context.state === 'suspended') void context.resume().catch(() => undefined);
  return { context, output };
}

function scheduleTone(graph: { context: AudioContext; output: AudioNode }, spec: ToneSpec): void {
  const startAt = graph.context.currentTime + (spec.start ?? 0);
  const endAt = startAt + spec.duration;
  const oscillator = graph.context.createOscillator();
  oscillator.type = spec.type ?? 'sine';
  oscillator.frequency.setValueAtTime(spec.frequency, startAt);
  if (spec.endFrequency) oscillator.frequency.exponentialRampToValueAtTime(spec.endFrequency, endAt);
  const envelope = graph.context.createGain();
  envelope.gain.setValueAtTime(0.0001, startAt);
  envelope.gain.exponentialRampToValueAtTime(spec.gain, startAt + 0.006);
  envelope.gain.exponentialRampToValueAtTime(0.0001, endAt);
  oscillator.connect(envelope);
  envelope.connect(graph.output);
  oscillator.start(startAt);
  oscillator.stop(endAt + 0.02);
}

/** Plays a navigation cue unless the station has UI sounds turned off. */
export function playUiSound(kind: UiSound): void {
  if (!getUiPreference('uiSounds')) return;
  if (kind === 'move') {
    const now = performance.now();
    if (now - lastMoveAt < MOVE_THROTTLE_MS) return;
    lastMoveAt = now;
  }
  try {
    const graph = audioGraph();
    if (!graph) return;
    for (const spec of RECIPES[kind]) scheduleTone(graph, spec);
  } catch {
    // Audio output can be unavailable (no device, policy); stay silent.
  }
}

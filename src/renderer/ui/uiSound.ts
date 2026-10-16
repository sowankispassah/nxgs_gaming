import { getUiPreference } from './preferences';

/**
 * Synthesized navigation sounds in the spirit of the PS5 interface: a soft
 * woody tick for moving, an airy two-note chime for selecting, a falling tone
 * for back and whooshes for screens opening and closing. Nothing is bundled:
 * every cue is a few enveloped oscillators and filtered noise bursts through a
 * short, dark room echo, kept quiet so it never competes with game audio.
 */
export type UiSound = 'move' | 'select' | 'back' | 'open' | 'close' | 'toggle' | 'error' | 'notify';

type ToneVoice = {
  kind: 'tone';
  wave?: OscillatorType;
  frequency: number;
  /** Pitch glides here over `glide` seconds (the whole voice by default). */
  endFrequency?: number;
  glide?: number;
  start?: number;
  attack?: number;
  /** Seconds from the voice's start until it has faded out. */
  duration: number;
  gain: number;
};

/** A burst of white noise through a filter: the air and texture of a cue. */
type NoiseVoice = {
  kind: 'noise';
  filter: BiquadFilterType;
  frequency: number;
  endFrequency?: number;
  q?: number;
  start?: number;
  attack?: number;
  duration: number;
  gain: number;
};

type Voice = ToneVoice | NoiseVoice;

const RECIPES: Record<UiSound, Voice[]> = {
  // A soft wooden tap: a short falling body, a faint inharmonic overtone and
  // a tiny noise transient for the tick.
  move: [
    { kind: 'tone', frequency: 1320, endFrequency: 1180, glide: 0.03, attack: 0.002, duration: 0.07, gain: 0.05 },
    { kind: 'tone', frequency: 3300, attack: 0.001, duration: 0.025, gain: 0.01 },
    { kind: 'noise', filter: 'bandpass', frequency: 2800, q: 1.4, attack: 0.001, duration: 0.018, gain: 0.03 }
  ],
  // An airy rising swish under a rising fifth (E6 to B6) with a faint shimmer.
  select: [
    { kind: 'noise', filter: 'bandpass', frequency: 1500, endFrequency: 6000, q: 0.9, attack: 0.012, duration: 0.16, gain: 0.022 },
    { kind: 'tone', frequency: 1318.5, start: 0.012, attack: 0.004, duration: 0.3, gain: 0.04 },
    { kind: 'tone', frequency: 1975.5, start: 0.05, attack: 0.004, duration: 0.32, gain: 0.026 },
    { kind: 'tone', frequency: 3951, start: 0.05, attack: 0.002, duration: 0.08, gain: 0.006 }
  ],
  // Softer and lower than select, and falling.
  back: [
    { kind: 'noise', filter: 'bandpass', frequency: 2600, endFrequency: 900, q: 0.9, attack: 0.006, duration: 0.12, gain: 0.01 },
    { kind: 'tone', frequency: 988, endFrequency: 740, glide: 0.09, attack: 0.003, duration: 0.16, gain: 0.042 }
  ],
  // A screen or panel opening: a rising whoosh that blooms into A5, E6, A6.
  open: [
    { kind: 'noise', filter: 'bandpass', frequency: 700, endFrequency: 4200, q: 0.7, attack: 0.05, duration: 0.28, gain: 0.02 },
    { kind: 'tone', frequency: 880, start: 0.04, attack: 0.02, duration: 0.42, gain: 0.03 },
    { kind: 'tone', frequency: 1318.5, start: 0.09, attack: 0.02, duration: 0.45, gain: 0.026 },
    { kind: 'tone', frequency: 1760, start: 0.14, attack: 0.015, duration: 0.4, gain: 0.016 }
  ],
  // The reverse of open: a falling whoosh and two settling tones.
  close: [
    { kind: 'noise', filter: 'bandpass', frequency: 2200, endFrequency: 500, q: 0.7, attack: 0.02, duration: 0.24, gain: 0.01 },
    { kind: 'tone', frequency: 1318.5, endFrequency: 988, glide: 0.18, start: 0.01, attack: 0.01, duration: 0.3, gain: 0.03 },
    { kind: 'tone', frequency: 880, endFrequency: 660, glide: 0.18, start: 0.06, attack: 0.01, duration: 0.3, gain: 0.02 }
  ],
  // A crisp little click for switches such as mute.
  toggle: [
    { kind: 'noise', filter: 'bandpass', frequency: 3400, q: 2, attack: 0.001, duration: 0.015, gain: 0.03 },
    { kind: 'tone', frequency: 1760, attack: 0.002, duration: 0.045, gain: 0.032 },
    { kind: 'tone', frequency: 3520, attack: 0.001, duration: 0.02, gain: 0.008 }
  ],
  // Two low, muted knocks instead of a harsh buzz.
  error: [
    { kind: 'noise', filter: 'lowpass', frequency: 900, attack: 0.002, duration: 0.03, gain: 0.02 },
    { kind: 'tone', frequency: 330, attack: 0.004, duration: 0.14, gain: 0.045 },
    { kind: 'tone', wave: 'triangle', frequency: 330, attack: 0.004, duration: 0.1, gain: 0.014 },
    { kind: 'noise', filter: 'lowpass', frequency: 900, start: 0.13, attack: 0.002, duration: 0.03, gain: 0.02 },
    { kind: 'tone', frequency: 247, start: 0.13, attack: 0.004, duration: 0.22, gain: 0.045 },
    { kind: 'tone', wave: 'triangle', frequency: 247, start: 0.13, attack: 0.004, duration: 0.16, gain: 0.014 }
  ],
  // A gentle rising chime (C6, G6, C7) with a breath of air.
  notify: [
    { kind: 'noise', filter: 'highpass', frequency: 5000, attack: 0.03, duration: 0.25, gain: 0.005 },
    { kind: 'tone', frequency: 1046.5, attack: 0.004, duration: 0.5, gain: 0.035 },
    { kind: 'tone', frequency: 2093, attack: 0.002, duration: 0.2, gain: 0.008 },
    { kind: 'tone', frequency: 1568, start: 0.09, attack: 0.004, duration: 0.55, gain: 0.03 },
    { kind: 'tone', frequency: 2093, start: 0.18, attack: 0.004, duration: 0.6, gain: 0.022 }
  ]
};

const MOVE_THROTTLE_MS = 45;
// Repeated ticks vary their pitch slightly so fast scrolling doesn't sound mechanical.
const MOVE_PITCH_SPREAD = 0.02;
const ECHO_SECONDS = 0.5;
const ECHO_LEVEL = 0.18;

type SoundGraph = { context: BaseAudioContext; input: AudioNode; noise: AudioBuffer };

let live: SoundGraph | null = null;
let lastMoveAt = 0;

/** Decaying, darkened stereo noise: the impulse of a small soft room. */
function echoImpulse(context: BaseAudioContext): AudioBuffer {
  const length = Math.ceil(context.sampleRate * ECHO_SECONDS);
  const predelay = Math.ceil(context.sampleRate * 0.008);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const samples = impulse.getChannelData(channel);
    let smoothed = 0;
    for (let index = predelay; index < length; index += 1) {
      smoothed += 0.35 * (Math.random() * 2 - 1 - smoothed);
      samples[index] = smoothed * Math.exp(-(index - predelay) / (context.sampleRate * 0.09));
    }
  }
  return impulse;
}

function createGraph(context: BaseAudioContext): SoundGraph {
  const input = context.createGain();
  input.gain.value = 0.6;
  const softener = context.createBiquadFilter();
  softener.type = 'lowpass';
  softener.frequency.value = 7500;
  const echo = context.createConvolver();
  echo.buffer = echoImpulse(context);
  const echoLevel = context.createGain();
  echoLevel.gain.value = ECHO_LEVEL;
  input.connect(softener);
  input.connect(echo);
  echo.connect(echoLevel);
  echoLevel.connect(softener);
  softener.connect(context.destination);

  const noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const samples = noise.getChannelData(0);
  for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;
  return { context, input, noise };
}

function liveGraph(): SoundGraph | null {
  if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') return null;
  live ??= createGraph(new window.AudioContext({ latencyHint: 'interactive' }));
  const context = live.context as AudioContext;
  if (context.state === 'suspended') void context.resume().catch(() => undefined);
  return live;
}

function envelope(graph: SoundGraph, voice: Voice, startAt: number): GainNode {
  const attackEnd = startAt + (voice.attack ?? 0.004);
  const gain = graph.context.createGain();
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(voice.gain, attackEnd);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + voice.duration);
  gain.connect(graph.input);
  return gain;
}

function scheduleVoice(graph: SoundGraph, voice: Voice, at: number, pitch: number): void {
  const startAt = at + (voice.start ?? 0);
  const endAt = startAt + voice.duration;
  const amp = envelope(graph, voice, startAt);
  if (voice.kind === 'tone') {
    const oscillator = graph.context.createOscillator();
    oscillator.type = voice.wave ?? 'sine';
    oscillator.frequency.setValueAtTime(voice.frequency * pitch, startAt);
    if (voice.endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(voice.endFrequency * pitch, startAt + (voice.glide ?? voice.duration));
    }
    oscillator.connect(amp);
    oscillator.start(startAt);
    oscillator.stop(endAt + 0.02);
    return;
  }
  const source = graph.context.createBufferSource();
  source.buffer = graph.noise;
  const filter = graph.context.createBiquadFilter();
  filter.type = voice.filter;
  filter.Q.value = voice.q ?? 0.7;
  filter.frequency.setValueAtTime(voice.frequency * pitch, startAt);
  if (voice.endFrequency) filter.frequency.exponentialRampToValueAtTime(voice.endFrequency * pitch, endAt);
  source.connect(filter);
  filter.connect(amp);
  // A random offset keeps back-to-back bursts from sounding identical.
  source.start(startAt, Math.random() * (graph.noise.duration - voice.duration - 0.05));
  source.stop(endAt + 0.02);
}

function scheduleCue(graph: SoundGraph, kind: UiSound, at: number, pitch: number): void {
  for (const voice of RECIPES[kind]) scheduleVoice(graph, voice, at, pitch);
}

/** Plays a navigation cue unless the station has UI sounds turned off. */
export function playUiSound(kind: UiSound): void {
  if (!getUiPreference('uiSounds')) return;
  let pitch = 1;
  if (kind === 'move') {
    const now = performance.now();
    if (now - lastMoveAt < MOVE_THROTTLE_MS) return;
    lastMoveAt = now;
    pitch += (Math.random() * 2 - 1) * MOVE_PITCH_SPREAD;
  }
  try {
    const graph = liveGraph();
    if (!graph) return;
    scheduleCue(graph, kind, graph.context.currentTime, pitch);
  } catch {
    // Audio output can be unavailable (no device, policy); stay silent.
  }
}

/** Renders one cue offline, for previewing and checking the sound design. */
export function renderUiSound(kind: UiSound, sampleRate = 48000): Promise<AudioBuffer> {
  const length = Math.max(...RECIPES[kind].map((voice) => (voice.start ?? 0) + voice.duration)) + ECHO_SECONDS + 0.05;
  const context = new OfflineAudioContext(2, Math.ceil(length * sampleRate), sampleRate);
  scheduleCue(createGraph(context), kind, 0, 1);
  return context.startRendering();
}

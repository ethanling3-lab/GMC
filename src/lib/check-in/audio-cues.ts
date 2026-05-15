"use client";

// M7.1d — audio cues for the scanner station. Built on the Web Audio API
// so we don't ship MP3 assets. Three distinct tones:
//   - success: positive double-chime (~400ms)
//   - warn:    soft single tone (~200ms)
//   - error:   descending low tone (~300ms)
//
// iOS Safari requires a prior user gesture before audio can play. We
// lazily create the AudioContext + prime it inside `primeAudio()`, which
// the scanner UI calls on the first interaction (Pause/Resume tap,
// manual search keystroke, etc.). After that, programmatic playback is
// fine for the rest of the session.

type Tone = {
  freq: number;       // Hz
  endFreq?: number;   // for descending tones (linear ramp)
  durationMs: number;
  attackMs?: number;
  releaseMs?: number;
  gain?: number;      // 0..1, default 0.18 to stay below painful
};

const PRESETS: Record<"success-a" | "success-b" | "warn" | "error", Tone> = {
  "success-a": { freq: 880, durationMs: 130, gain: 0.18 },
  "success-b": { freq: 1320, durationMs: 200, gain: 0.20 },
  warn: { freq: 660, durationMs: 220, gain: 0.16 },
  error: { freq: 440, endFreq: 330, durationMs: 320, gain: 0.18 },
};

let ctx: AudioContext | null = null;
let primed = false;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const AnyWindow = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = AnyWindow.AudioContext ?? AnyWindow.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

export function primeAudio(): void {
  if (primed) return;
  const c = getCtx();
  if (!c) return;
  // Resume the context after the gesture if it started suspended.
  if (c.state === "suspended") {
    void c.resume().catch(() => {});
  }
  // Play a 1ms silent ping to fully wake the context on iOS Safari.
  const osc = c.createOscillator();
  const gain = c.createGain();
  gain.gain.value = 0;
  osc.connect(gain).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + 0.001);
  primed = true;
}

function playTone(preset: Tone, offsetMs = 0): void {
  const c = getCtx();
  if (!c || !primed) return;
  const t0 = c.currentTime + offsetMs / 1000;
  const tEnd = t0 + preset.durationMs / 1000;
  const attack = (preset.attackMs ?? 8) / 1000;
  const release = (preset.releaseMs ?? 60) / 1000;
  const gainPeak = preset.gain ?? 0.18;

  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(preset.freq, t0);
  if (preset.endFreq !== undefined) {
    osc.frequency.linearRampToValueAtTime(preset.endFreq, tEnd);
  }
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(gainPeak, t0 + attack);
  gain.gain.setValueAtTime(gainPeak, tEnd - release);
  gain.gain.linearRampToValueAtTime(0, tEnd);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(tEnd + 0.05);
}

export function playSuccess(): void {
  playTone(PRESETS["success-a"], 0);
  playTone(PRESETS["success-b"], 90);
}

export function playWarn(): void {
  playTone(PRESETS.warn);
}

export function playError(): void {
  playTone(PRESETS.error);
}

// ---------------------------------------------------------------
// Tiny UI-sound synth built on the Web Audio API.
//
// No audio files: every click is generated on the fly from a short
// burst of white noise pushed through a band-pass filter, plus an
// optional low sine "body". That keeps the page light and lets you
// tune pitch / volume live from the playground.
//
// Usage:
//   import { createClicker } from "../../assets/js/sound.js";
//   const sfx = createClicker({ profile: "clicky", pitch: 3300 });
//   sfx.press();   // on pointerdown / keydown
//   sfx.release(); // on pointerup / keyup
// ---------------------------------------------------------------

// Each profile describes one "switch". Values were tuned by ear
// against the reference recording (≈3.3 kHz peak, ~20 ms decay).
export const PROFILES = {
  clicky: {
    label: "Clicky switch",
    q: 3.5,          // band-pass sharpness: higher = more "pingy"
    decay: 0.018,    // seconds for the noise burst to die out
    bodyHz: 0,       // no low thump
    bodyGain: 0,
    releaseBoost: 1.15, // release click slightly louder, like the reference
  },
  thocky: {
    label: "Thocky switch",
    q: 1.4,
    decay: 0.03,
    bodyHz: 170,
    bodyGain: 0.55,
    releaseBoost: 0.8,
    pitchScale: 0.35, // darker: filter sits well below the chosen pitch
  },
  pop: {
    label: "Soft pop",
    q: 0.8,
    decay: 0.012,
    bodyHz: 520,
    bodyGain: 0.9,
    bodySweep: 0.45, // pitch drops to 45% — the "bloop" of a bubble
    releaseBoost: 0.7,
    pitchScale: 0.6,
  },
};

export function createClicker(options = {}) {
  const settings = {
    enabled: true,
    profile: "clicky",
    pitch: 3300,
    volume: 0.6,
    ...options,
  };

  let ctx = null;
  let master = null;
  let noise = null;

  // Browsers only allow audio after a user gesture, so the context is
  // created lazily on the first press (which *is* a gesture).
  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.connect(ctx.destination);
      noise = makeNoise(ctx, 0.08);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function click(strength = 1) {
    if (!settings.enabled || !ensure()) return;
    const p = PROFILES[settings.profile] ?? PROFILES.clicky;
    const t = ctx.currentTime;
    const peak = settings.volume * strength;
    master.gain.value = 1;

    // 1) Noise transient → band-pass → fast exponential decay
    const src = ctx.createBufferSource();
    src.buffer = noise;
    // Tiny random playback-rate jitter so repeat presses don't sound robotic.
    src.playbackRate.value = 0.94 + Math.random() * 0.12;

    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = settings.pitch * (p.pitchScale ?? 1);
    band.Q.value = p.q;

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(peak, t + 0.001);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + p.decay);

    src.connect(band).connect(amp).connect(master);
    src.start(t);
    src.stop(t + p.decay + 0.02);

    // 2) Optional sine "body" for thock / pop character
    if (p.bodyHz) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(p.bodyHz, t);
      if (p.bodySweep) {
        osc.frequency.exponentialRampToValueAtTime(p.bodyHz * p.bodySweep, t + 0.06);
      }
      const body = ctx.createGain();
      body.gain.setValueAtTime(0.0001, t);
      body.gain.exponentialRampToValueAtTime(peak * p.bodyGain, t + 0.003);
      body.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      osc.connect(body).connect(master);
      osc.start(t);
      osc.stop(t + 0.09);
    }
  }

  return {
    settings,
    set(patch) { Object.assign(settings, patch); },
    press() { click(1); },
    release() {
      const p = PROFILES[settings.profile] ?? PROFILES.clicky;
      click(p.releaseBoost ?? 1);
    },
    // Plays the full down+up pair, ~120 ms apart like a real keypress.
    preview() {
      this.press();
      setTimeout(() => this.release(), 120);
    },
  };
}

function makeNoise(ctx, seconds) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// Light haptic tap on devices that support it (mostly Android Chrome).
export function haptic(ms = 8) {
  try { navigator.vibrate?.(ms); } catch { /* not supported */ }
}

// ---------------------------------------------------------------
// General-purpose game synth: tones, sweeps and filtered noise.
// Every sound effect in a game can be built from these two calls.
//
//   const sfx = createSynth({ volume: 0.5 });
//   sfx.tone({ freq: 660, to: 990, type: "triangle", dur: 0.12 });
//   sfx.noise({ dur: 0.4, freq: 900, to: 80 });   // a boom
// ---------------------------------------------------------------
export function createSynth(options = {}) {
  const settings = { enabled: true, volume: 0.5, ...options };
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.connect(ctx.destination);
      noiseBuf = makeNoise(ctx, 1.5);
    }
    if (ctx.state === "suspended") ctx.resume();
    master.gain.value = settings.volume;
    return ctx;
  }

  // Shape a gain node: quick attack, exponential fall to silence.
  function envelope(t, peak, attack, dur) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(master);
    return g;
  }

  return {
    settings,
    set(patch) { Object.assign(settings, patch); },
    // Call from a user gesture (e.g. the Play button) so later sounds aren't blocked.
    unlock() { ensure(); },

    tone({ freq = 440, to, type = "sine", dur = 0.15, gain = 0.5, attack = 0.005, delay = 0 } = {}) {
      if (!settings.enabled || !ensure()) return;
      const t = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
      osc.connect(envelope(t, gain, attack, dur));
      osc.start(t);
      osc.stop(t + dur + 0.05);
    },

    noise({ dur = 0.2, freq = 1200, to, q = 0.8, filter = "lowpass", gain = 0.5, attack = 0.003, delay = 0 } = {}) {
      if (!settings.enabled || !ensure()) return;
      const t = ctx.currentTime + delay;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = filter;
      f.Q.value = q;
      f.frequency.setValueAtTime(freq, t);
      if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
      src.connect(f).connect(envelope(t, gain, attack, dur));
      src.start(t);
      src.stop(t + dur + 0.05);
    },
  };
}

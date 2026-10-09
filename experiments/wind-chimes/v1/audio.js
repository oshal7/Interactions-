// ---------------------------------------------------------------
// Chime voice: what a struck aluminium tube sounds like.
//
// A tube hanging free at both ends vibrates like a "free-free bar".
// Its overtones are NOT at 2×, 3×, 4× (that would sound like a string)
// but at 2.756×, 5.404×, 8.933×…, which is why chimes sound like bells.
// Higher modes die away faster, the fundamental rings for many
// seconds, and the moment of impact adds a short bright "tick".
// ---------------------------------------------------------------

const MODES = [1, 2.756, 5.404, 8.933];        // free-free bar mode ratios
const MODE_GAIN = [1, 0.5, 0.26, 0.12];
const MODE_DECAY = [1, 0.42, 0.18, 0.08];     // × the fundamental's ring time

export function createChimeAudio(synth) {
  let active = 0;
  const lastAt = new Map();                   // tube → { t, amp } for de-bouncing resting contacts

  function voice(ctx, out, freq, amp, ringTime, when, detune = 0) {
    for (let m = 0; m < MODES.length; m++) {
      const f = freq * MODES[m];
      if (f > 16000) continue;
      const t0 = when;
      const T = ringTime * MODE_DECAY[m];
      const peak = amp * MODE_GAIN[m] * (m === 0 ? 1 : 0.9 + Math.random() * 0.2);

      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f;
      osc.detune.value = detune + (Math.random() - 0.5) * 4;   // tiny imperfections

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + T);

      // the fundamental shimmers a little as the tube turns on its string:
      // a separate gain stage (1 ± 0.18) multiplies the decaying signal
      let last = g;
      if (m === 0) {
        const trem = ctx.createGain();
        trem.gain.value = 1;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 2.5 + Math.random() * 2;
        const depth = ctx.createGain();
        depth.gain.value = 0.18;
        lfo.connect(depth).connect(trem.gain);
        lfo.start(t0);
        lfo.stop(t0 + T + 0.05);
        g.connect(trem);
        last = trem;
      }

      osc.connect(g);
      last.connect(out);
      osc.start(t0);
      osc.stop(t0 + T + 0.05);
    }
  }

  return {
    // speed = closing speed of the impact (m/s); hardness 1 = metal on metal, ~0.6 = wooden striker
    ring(tube, speed, { pan = 0, ringLength = 1, brightness = 1, hardness = 1 } = {}) {
      const a = synth.context();
      if (!a || !synth.settings.enabled) return;
      const { ctx, master } = a;
      const now = ctx.currentTime;

      // louder for harder hits, with a soft knee so brushes stay gentle
      const amp = Math.min(1, speed / 0.9) ** 1.15 * 0.22;
      if (amp < 0.004) return;

      // resting contacts produce a stream of tiny "hits": ignore repeats unless clearly harder
      const prev = lastAt.get(tube);
      if (prev && now - prev.t < 0.06 && amp < prev.amp * 1.6) return;
      lastAt.set(tube, { t: now, amp });

      if (active > 36 && amp < 0.05) return;  // keep the voice count sane in a big tangle
      active++;

      const freq = tube.note.freq;
      // low tubes ring longer (bigger, slower-damped vibration)
      const ringTime = 7.5 * ringLength * Math.pow(440 / freq, 0.35);

      const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      const out = ctx.createGain();
      out.gain.value = 1;
      if (panner) { panner.pan.value = Math.max(-1, Math.min(1, pan)); out.connect(panner).connect(master); }
      else out.connect(master);

      // brighter tone for harder hits: upper modes scale with hardness and impact
      const bright = brightness * hardness * (0.5 + Math.min(1, speed / 0.6) * 0.5);
      const scaled = Math.max(0.0005, amp);
      voice(ctx, out, freq, scaled, ringTime, now);
      // a second, very slightly detuned copy of the fundamental → slow natural beating
      const beat = ctx.createGain();
      beat.gain.value = 0.35;
      beat.connect(out);
      const o = ctx.createOscillator();
      o.frequency.value = freq * 1.0012;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, scaled * 0.5), now + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, now + ringTime * 0.9);
      o.connect(g).connect(beat);
      o.start(now); o.stop(now + ringTime);

      // upper partial balance
      out.gain.setValueAtTime(0.75 + 0.5 * bright, now);

      // the strike itself: a very short bright tick (duller for the wooden striker)
      synth.noise({
        filter: "bandpass", freq: hardness >= 1 ? 5200 : 2400, q: 2.2,
        dur: 0.018, gain: amp * (hardness >= 1 ? 0.9 : 0.6), pan,
      });

      setTimeout(() => { active--; }, ringTime * 1000);
    },
  };
}

// ---------------------------------------------------------------
// Tunings. Calm, pentatonic-flavoured sets like those used on
// well-known tuned chimes. Each is a list of semitones from the root.
// ---------------------------------------------------------------
export const TUNINGS = {
  pentatonic: { label: "Pentatonic · nature", root: 62, steps: [0, 2, 4, 7, 9, 12, 14, 16] },
  zen: { label: "Zen · Japanese In scale", root: 64, steps: [0, 1, 5, 7, 8, 12, 13, 17] },
  celtic: { label: "Celtic · minor pentatonic", root: 57, steps: [0, 3, 5, 7, 10, 12, 15, 17] },
  healing: { label: "Healing · open major 9th", root: 49, steps: [0, 7, 11, 14, 16, 19, 23, 26] },
  tenor: { label: "Tenor · deep and slow", root: 50, steps: [0, 2, 4, 7, 9, 12, 14, 16] },
};
const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export function notesFor(key, count, transpose = 0) {
  const t = TUNINGS[key] ?? TUNINGS.pentatonic;
  return t.steps.slice(0, count).map((s) => {
    const midi = t.root + s + transpose;
    return { midi, freq: 440 * Math.pow(2, (midi - 69) / 12), name: `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}` };
  });
}
